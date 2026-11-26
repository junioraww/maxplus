use crate::crypto::media::MediaDescriptor;
use crate::crypto::symmetric;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

pub const PROTOCOL_VERSION: u8 = 0x00;
pub const PROTOCOL_VERSION_V2: u8 = 0x01;

pub const FLAG_SESSION: u8 = 1 << 5;
pub const FLAG_PASSWORD: u8 = 1 << 4;
pub const FLAG_COMPRESSED: u8 = 1 << 3;
pub const FLAG_PQ_REKEY: u8 = 1 << 3; // In v2, bit 3 indicates embedded PQ ratchet rekey bytes
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

pub fn derive_chat_salt(chat_id: i64) -> [u8; 16] {
    let mut salt = [0u8; 16];
    let mut hasher = Sha256::new();
    hasher.update(b"maxplus_chat_pwd_salt_v1:");
    hasher.update(chat_id.to_be_bytes());
    let hash = hasher.finalize();
    salt.copy_from_slice(&hash[..16]);
    salt
}

pub fn pack_message(
    payload: PayloadData,
    session_key: Option<&[u8; 32]>,
    password: Option<&str>,
    chat_id: Option<i64>,
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
        if let Some(cid) = chat_id {
            salt = derive_chat_salt(cid);
        } else {
            thread_rng().fill_bytes(&mut salt);
        }
        let mut nonce = [0u8; 12];
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

fn pad_plaintext_v2(raw: &[u8]) -> Vec<u8> {
    let total_unpadded = 4 + raw.len();
    let bucket = ((total_unpadded + 63) / 64) * 64;
    let mut out = Vec::with_capacity(bucket);
    out.extend_from_slice(&(raw.len() as u32).to_be_bytes());
    out.extend_from_slice(raw);
    out.resize(bucket, 0u8);
    out
}

fn unpad_plaintext_v2(padded: &[u8]) -> Result<Vec<u8>, String> {
    if padded.len() < 4 {
        return Err("Padded v2 payload too short".into());
    }
    let len = u32::from_be_bytes([padded[0], padded[1], padded[2], padded[3]]) as usize;
    if 4 + len > padded.len() {
        return Err("Invalid v2 padded length".into());
    }
    Ok(padded[4..4 + len].to_vec())
}

fn encode_payload_inner(payload: PayloadData) -> Result<(bool, Vec<u8>), String> {
    let is_control = matches!(payload, PayloadData::Handshake(_));
    let raw_bytes = match payload {
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
    Ok((is_control, raw_bytes))
}

fn decode_payload_inner(is_control: bool, current: &[u8]) -> Result<PayloadData, String> {
    if is_control {
        return Ok(PayloadData::Handshake(current.to_vec()));
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
            if let Ok(s) = String::from_utf8(current.to_vec()) {
                Ok(PayloadData::Text(s))
            } else {
                Err("Unknown payload format".into())
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct V2SessionHeader {
    pub epoch: u32,
    pub counter: u64,
    pub sender_role: u8, // 0 = initiator, 1 = responder
    pub pq_rekey_bytes: Vec<u8>,
}

pub fn pack_message_v2(
    payload: PayloadData,
    session_msg_key: Option<&[u8; 32]>,
    session_header: Option<&V2SessionHeader>,
    password: Option<&str>,
    chat_id: i64,
) -> Result<Vec<u8>, String> {
    let (is_control, raw_inner) = encode_payload_inner(payload)?;
    let mut current = if is_control {
        raw_inner
    } else {
        pad_plaintext_v2(&raw_inner)
    };

    let has_session = session_msg_key.is_some() && session_header.is_some();
    let has_pq_rekey = session_header
        .map(|h| !h.pq_rekey_bytes.is_empty())
        .unwrap_or(false);
    let has_password = password.is_some();

    let header_byte = ((PROTOCOL_VERSION_V2 & 0x03) << 6)
        | if has_session { FLAG_SESSION } else { 0 }
        | if has_password { FLAG_PASSWORD } else { 0 }
        | if has_pq_rekey { FLAG_PQ_REKEY } else { 0 }
        | if is_control { FLAG_CONTROL } else { 0 };

    if let (Some(msg_key), Some(sh)) = (session_msg_key, session_header) {
        let mut xnonce = [0u8; 24];
        thread_rng().fill_bytes(&mut xnonce);

        let pq_len = sh.pq_rekey_bytes.len();
        if pq_len > u16::MAX as usize {
            return Err("PQ rekey payload too large".into());
        }

        let mut meta = Vec::with_capacity(4 + 8 + 1 + 2 + pq_len);
        meta.extend_from_slice(&sh.epoch.to_be_bytes());
        meta.extend_from_slice(&sh.counter.to_be_bytes());
        meta.push(sh.sender_role);
        meta.extend_from_slice(&(pq_len as u16).to_be_bytes());
        meta.extend_from_slice(&sh.pq_rekey_bytes);

        let mut aad = Vec::with_capacity(1 + 8 + meta.len());
        aad.push(header_byte);
        aad.extend_from_slice(&chat_id.to_be_bytes());
        aad.extend_from_slice(&meta);

        let ct = symmetric::encrypt_xchacha(msg_key, &xnonce, &current, Some(&aad))?;

        let mut session_payload = Vec::with_capacity(meta.len() + 24 + ct.len());
        session_payload.extend_from_slice(&meta);
        session_payload.extend_from_slice(&xnonce);
        session_payload.extend_from_slice(&ct);
        current = session_payload;
    }

    if let Some(pwd) = password {
        let mut salt = [0u8; 16];
        thread_rng().fill_bytes(&mut salt);
        let mut xnonce = [0u8; 24];
        thread_rng().fill_bytes(&mut xnonce);

        let p_key = symmetric::derive_key(pwd, &salt)?;
        let mut aad = Vec::with_capacity(1 + 8 + 16);
        aad.push(header_byte);
        aad.extend_from_slice(&chat_id.to_be_bytes());
        aad.extend_from_slice(&salt);

        let ct = symmetric::encrypt_xchacha(&p_key, &xnonce, &current, Some(&aad))?;
        let mut pass_payload = Vec::with_capacity(16 + 24 + ct.len());
        pass_payload.extend_from_slice(&salt);
        pass_payload.extend_from_slice(&xnonce);
        pass_payload.extend_from_slice(&ct);
        current = pass_payload;
    }

    let mut out = Vec::with_capacity(1 + current.len());
    out.push(header_byte);
    out.extend_from_slice(&current);
    Ok(out)
}

pub fn unpack_message_v2<F>(
    bytes: &[u8],
    password: Option<&str>,
    chat_id: i64,
    mut resolve_session_key: F,
) -> Result<PayloadData, String>
where
    F: FnMut(&V2SessionHeader) -> Result<[u8; 32], String>,
{
    if bytes.is_empty() {
        return Err("Empty v2 packet".into());
    }
    let header_byte = bytes[0];
    let version = (header_byte >> 6) & 0x03;
    if version != PROTOCOL_VERSION_V2 {
        return Err("Not a v2 packet".into());
    }
    let has_session = (header_byte & FLAG_SESSION) != 0;
    let has_password = (header_byte & FLAG_PASSWORD) != 0;
    let is_control = (header_byte & FLAG_CONTROL) != 0;

    let mut current = bytes[1..].to_vec();

    if has_password {
        let pwd = password.ok_or("Password required to decrypt this message")?;
        if current.len() < 16 + 24 + 16 {
            return Err("v2 password payload too short".into());
        }
        let salt = &current[..16];
        let mut xnonce = [0u8; 24];
        xnonce.copy_from_slice(&current[16..40]);
        let ct = &current[40..];

        let mut aad = Vec::with_capacity(1 + 8 + 16);
        aad.push(header_byte);
        aad.extend_from_slice(&chat_id.to_be_bytes());
        aad.extend_from_slice(salt);

        let p_key = symmetric::derive_key(pwd, salt)?;
        current = symmetric::decrypt_xchacha(&p_key, &xnonce, ct, Some(&aad))
            .map_err(|_| "Wrong password or tampered v2 message".to_string())?;
    }

    if has_session {
        if current.len() < 15 + 24 + 16 {
            return Err("v2 session payload too short".into());
        }
        let epoch = u32::from_be_bytes([current[0], current[1], current[2], current[3]]);
        let counter = u64::from_be_bytes([
            current[4], current[5], current[6], current[7], current[8], current[9], current[10],
            current[11],
        ]);
        let sender_role = current[12];
        let pq_len = u16::from_be_bytes([current[13], current[14]]) as usize;
        let meta_len = 15 + pq_len;
        if current.len() < meta_len + 24 + 16 {
            return Err("v2 session payload truncated".into());
        }
        let pq_rekey_bytes = current[15..meta_len].to_vec();
        let sh = V2SessionHeader {
            epoch,
            counter,
            sender_role,
            pq_rekey_bytes,
        };
        let msg_key = resolve_session_key(&sh)?;

        let mut xnonce = [0u8; 24];
        xnonce.copy_from_slice(&current[meta_len..meta_len + 24]);
        let ct = &current[meta_len + 24..];

        let mut aad = Vec::with_capacity(1 + 8 + meta_len);
        aad.push(header_byte);
        aad.extend_from_slice(&chat_id.to_be_bytes());
        aad.extend_from_slice(&current[..meta_len]);

        current = symmetric::decrypt_xchacha(&msg_key, &xnonce, ct, Some(&aad))
            .map_err(|_| "Failed to decrypt v2 ratcheted message".to_string())?;
    }

    let unpadded = if is_control {
        current
    } else {
        unpad_plaintext_v2(&current)?
    };
    decode_payload_inner(is_control, &unpadded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_message_roundtrip() {
        let text = "Synthetic plain message test".to_string();
        let packed = pack_message(PayloadData::Text(text.clone()), None, None, None).unwrap();
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
            pack_message(PayloadData::Text(text.clone()), Some(&session_key), None, None).unwrap();
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
        let packed = pack_message(PayloadData::Text(text.clone()), None, Some(password), Some(42)).unwrap();

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
            Some(42),
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

        let packed = pack_message(payload, Some(&session_key), None, None).unwrap();
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

    #[test]
    fn test_v2_ratchet_and_aad_roundtrip() {
        let msg_key = [0x22u8; 32];
        let sh = V2SessionHeader {
            epoch: 1,
            counter: 7,
            sender_role: 0,
            pq_rekey_bytes: vec![],
        };
        let chat_id = 123456i64;
        let packed = pack_message_v2(
            PayloadData::Text("Post-quantum message".into()),
            Some(&msg_key),
            Some(&sh),
            Some("pwd123"),
            chat_id,
        )
        .unwrap();

        assert_eq!((packed[0] >> 6) & 0x03, PROTOCOL_VERSION_V2);
        // Wrong chat_id must fail AAD verification
        assert!(unpack_message_v2(&packed, Some("pwd123"), chat_id + 1, |_| Ok(msg_key)).is_err());

        let unpacked = unpack_message_v2(&packed, Some("pwd123"), chat_id, |parsed| {
            assert_eq!(parsed.epoch, 1);
            assert_eq!(parsed.counter, 7);
            Ok(msg_key)
        })
        .unwrap();

        match unpacked {
            PayloadData::Text(t) => assert_eq!(t, "Post-quantum message"),
            _ => panic!("Expected text payload"),
        }
    }
}
