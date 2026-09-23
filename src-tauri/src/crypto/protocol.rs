use crate::crypto::media::MediaDescriptor;
use crate::crypto::symmetric;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

pub const PROTOCOL_VERSION: u8 = 0x00;

pub const FLAG_SESSION: u8 = 1 << 5;
pub const FLAG_PASSWORD: u8 = 1 << 4;
pub const FLAG_COMPRESSED: u8 = 1 << 3;
pub const FLAG_CONTROL: u8 = 1 << 2;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum PayloadData {
    Text(String),
    Media {
        text: String,
        media: MediaDescriptor,
    },
    Handshake(Vec<u8>),
}

pub struct Header {
    pub version: u8,
    pub has_session: bool,
    pub has_password: bool,
    pub is_compressed: bool,
    pub is_control: bool,
}

impl Header {
    pub fn encode(&self) -> u8 {
        ((self.version & 0x03) << 6)
            | if self.has_session { FLAG_SESSION } else { 0 }
            | if self.has_password { FLAG_PASSWORD } else { 0 }
            | if self.is_compressed { FLAG_COMPRESSED } else { 0 }
            | if self.is_control { FLAG_CONTROL } else { 0 }
    }

    pub fn decode(byte: u8) -> Self {
        Self {
            version: (byte >> 6) & 0x03,
            has_session: (byte & FLAG_SESSION) != 0,
            has_password: (byte & FLAG_PASSWORD) != 0,
            is_compressed: (byte & FLAG_COMPRESSED) != 0,
            is_control: (byte & FLAG_CONTROL) != 0,
        }
    }
}

pub fn compress_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(bytes).map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())
}

pub fn decompress_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = DeflateDecoder::new(bytes);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

pub fn pack_message(
    payload: PayloadData,
    session_key: Option<&[u8; 32]>,
    password: Option<&str>,
) -> Result<Vec<u8>, String> {
    let is_control = matches!(payload, PayloadData::Handshake(_));
    let mut raw_bytes = match payload {
        PayloadData::Text(t) => {
            let mut b = Vec::with_capacity(1 + t.len());
            b.push(0x01);
            b.extend_from_slice(t.as_bytes());
            b
        }
        PayloadData::Media { text, media } => {
            let mut b = Vec::new();
            b.push(0x02);
            let encoded = rmp_serde::to_vec(&(text, media)).map_err(|e| e.to_string())?;
            b.extend_from_slice(&encoded);
            b
        }
        PayloadData::Handshake(bytes) => bytes,
    };

    let should_compress = !is_control && raw_bytes.len() >= 64;
    let mut is_compressed = false;
    if should_compress {
        if let Ok(compressed) = compress_bytes(&raw_bytes) {
            if compressed.len() < raw_bytes.len() {
                raw_bytes = compressed;
                is_compressed = true;
            }
        }
    }

    let has_session = session_key.is_some();
    if let Some(s_key) = session_key {
        let mut nonce = [0u8; 12];
        thread_rng().fill_bytes(&mut nonce);
        let ciphertext = symmetric::encrypt(s_key, &nonce, &raw_bytes, None)?;
        let mut session_payload = Vec::with_capacity(12 + ciphertext.len());
        session_payload.extend_from_slice(&nonce);
        session_payload.extend_from_slice(&ciphertext);
        raw_bytes = session_payload;
    }

    let has_password = password.is_some();
    if let Some(pwd) = password {
        let mut salt = [0u8; 16];
        let mut nonce = [0u8; 12];
        thread_rng().fill_bytes(&mut salt);
        thread_rng().fill_bytes(&mut nonce);

        let p_key = symmetric::derive_key(pwd, &salt)?;
        let ciphertext = symmetric::encrypt(&p_key, &nonce, &raw_bytes, None)?;

        let mut pass_payload = Vec::with_capacity(16 + 12 + ciphertext.len());
        pass_payload.extend_from_slice(&salt);
        pass_payload.extend_from_slice(&nonce);
        pass_payload.extend_from_slice(&ciphertext);
        raw_bytes = pass_payload;
    }

    let header = Header {
        version: PROTOCOL_VERSION,
        has_session,
        has_password,
        is_compressed,
        is_control,
    };

    let mut out = Vec::with_capacity(1 + raw_bytes.len());
    out.push(header.encode());
    out.extend_from_slice(&raw_bytes);

    Ok(out)
}

pub fn unpack_message(
    bytes: &[u8],
    session_key: Option<&[u8; 32]>,
    password: Option<&str>,
) -> Result<PayloadData, String> {
    if bytes.is_empty() {
        return Err("Empty packet".into());
    }

    let header = Header::decode(bytes[0]);
    if header.version != PROTOCOL_VERSION {
        return Err("Unsupported protocol version".into());
    }

    let mut current = bytes[1..].to_vec();

    if header.has_password {
        let pwd = password.ok_or("Password required to decrypt this message")?;
        if current.len() < 16 + 12 + 16 {
            return Err("Password payload too short".into());
        }
        let salt = &current[..16];
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&current[16..28]);
        let ciphertext = &current[28..];

        let p_key = symmetric::derive_key(pwd, salt)?;
        current = symmetric::decrypt(&p_key, &nonce, ciphertext, None)
            .map_err(|_| "Wrong password".to_string())?;
    }

    if header.has_session {
        let s_key = session_key.ok_or("Session key required to decrypt this message")?;
        if current.len() < 12 + 16 {
            return Err("Session payload too short".into());
        }
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&current[..12]);
        let ciphertext = &current[12..];

        current = symmetric::decrypt(s_key, &nonce, ciphertext, None)
            .map_err(|_| "Failed to decrypt with session key".to_string())?;
    }

    if header.is_compressed {
        current = decompress_bytes(&current)?;
    }

    if header.is_control {
        return Ok(PayloadData::Handshake(current));
    }

    if current.is_empty() {
        return Ok(PayloadData::Text(String::new()));
    }

    match current[0] {
        0x01 => {
            let s = String::from_utf8(current[1..].to_vec()).map_err(|e| e.to_string())?;
            Ok(PayloadData::Text(s))
        }
        0x02 => {
            let (text, media): (String, MediaDescriptor) =
                rmp_serde::from_slice(&current[1..]).map_err(|e| e.to_string())?;
            Ok(PayloadData::Media { text, media })
        }
        _ => {
            if let Ok(s) = String::from_utf8(current.clone()) {
                Ok(PayloadData::Text(s))
            } else {
                Err("Unknown payload format".into())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_message_roundtrip() {
        let text = "Synthetic plain message test".to_string();
        let packed = pack_message(PayloadData::Text(text.clone()), None, None).unwrap();
        let unpacked = unpack_message(&packed, None, None).unwrap();

        match unpacked {
            PayloadData::Text(t) => assert_eq!(t, text),
            _ => panic!("Expected text payload"),
        }
    }

    #[test]
    fn test_session_encrypted_roundtrip() {
        let session_key = [55u8; 32];
        let text = "Synthetic session encrypted message".to_string();
        let packed =
            pack_message(PayloadData::Text(text.clone()), Some(&session_key), None).unwrap();
        assert_ne!(&packed[1..], text.as_bytes());

        let unpacked = unpack_message(&packed, Some(&session_key), None).unwrap();
        match unpacked {
            PayloadData::Text(t) => assert_eq!(t, text),
            _ => panic!("Expected text payload"),
        }
    }

    #[test]
    fn test_password_encrypted_roundtrip() {
        let password = "synthetic_password_xyz";
        let text = "Synthetic password encrypted message".to_string();
        let packed = pack_message(PayloadData::Text(text.clone()), None, Some(password)).unwrap();

        let unpacked = unpack_message(&packed, None, Some(password)).unwrap();
        match unpacked {
            PayloadData::Text(t) => assert_eq!(t, text),
            _ => panic!("Expected text payload"),
        }

        let wrong_unpacked = unpack_message(&packed, None, Some("wrong_password"));
        assert!(wrong_unpacked.is_err());
    }

    #[test]
    fn test_both_layers_roundtrip() {
        let session_key = [99u8; 32];
        let password = "dual_layer_secret";
        let text = "Synthetic dual layer message".to_string();

        let packed = pack_message(
            PayloadData::Text(text.clone()),
            Some(&session_key),
            Some(password),
        )
        .unwrap();

        let unpacked = unpack_message(&packed, Some(&session_key), Some(password)).unwrap();
        match unpacked {
            PayloadData::Text(t) => assert_eq!(t, text),
            _ => panic!("Expected text payload"),
        }
    }

    #[test]
    fn test_media_descriptor_messagepack_roundtrip() {
        let session_key = [77u8; 32];
        let desc = MediaDescriptor {
            attach_index: 0,
            name: "synthetic_image.jpg".into(),
            mime: "image/jpeg".into(),
            media_type: "PHOTO".into(),
            size: 1048576,
            width: Some(1920),
            height: Some(1080),
            duration: None,
            wave: None,
            video_type: None,
            color: None,
        };

        let caption = "Photo caption".to_string();
        let payload = PayloadData::Media {
            text: caption.clone(),
            media: desc.clone(),
        };

        let packed = pack_message(payload, Some(&session_key), None).unwrap();
        let unpacked = unpack_message(&packed, Some(&session_key), None).unwrap();

        match unpacked {
            PayloadData::Media {
                text,
                media: unpacked_media,
            } => {
                assert_eq!(text, caption);
                assert_eq!(unpacked_media.name, desc.name);
                assert_eq!(unpacked_media.mime, desc.mime);
                assert_eq!(unpacked_media.media_type, desc.media_type);
                assert_eq!(unpacked_media.size, desc.size);
                assert_eq!(unpacked_media.width, desc.width);
                assert_eq!(unpacked_media.height, desc.height);
            }
            _ => panic!("Expected media payload"),
        }
    }
}
