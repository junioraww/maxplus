use crate::crypto::media::MediaDescriptor;
use crate::crypto::symmetric;
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PROTOCOL_VERSION_V2: u8 = 0x01;

pub const FLAG_SESSION: u8 = 1 << 5;
pub const FLAG_PASSWORD: u8 = 1 << 4;
pub const FLAG_PQ_REKEY: u8 = 1 << 3;
pub const FLAG_CONTROL: u8 = 1 << 2;
pub const FLAG_SENDER_ROLE: u8 = 1 << 1;
pub const FLAG_EPOCH_ZERO: u8 = 1 << 0;

fn write_varint(buf: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        buf.push((v as u8 & 0x7F) | 0x80);
        v >>= 7;
    }
    buf.push(v as u8);
}

fn read_varint(data: &[u8], pos: &mut usize) -> Result<u64, String> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    loop {
        if *pos >= data.len() {
            return Err("Truncated varint".into());
        }
        let b = data[*pos];
        *pos += 1;
        result |= ((b & 0x7F) as u64) << shift;
        if (b & 0x80) == 0 {
            return Ok(result);
        }
        shift += 7;
        if shift >= 64 {
            return Err("Varint overflow".into());
        }
    }
}

fn derive_session_xnonce(
    msg_key: &[u8; 32],
    header_byte: u8,
    chat_id: i64,
    meta: &[u8],
) -> [u8; 24] {
    let mut hasher = Sha256::new();
    hasher.update(b"maxplus-v2-det-nonce:");
    hasher.update(msg_key);
    hasher.update([header_byte]);
    hasher.update(chat_id.to_be_bytes());
    hasher.update(meta);
    let digest = hasher.finalize();
    let mut xnonce = [0u8; 24];
    xnonce.copy_from_slice(&digest[..24]);
    xnonce
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum PayloadData {
    Text(String),
    Media {
        text: String,
        media: MediaDescriptor,
    },
    Handshake(Vec<u8>),
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
    let (is_control, mut current) = encode_payload_inner(payload)?;

    let has_session = session_msg_key.is_some() && session_header.is_some();
    let has_pq_rekey = session_header
        .map(|h| !h.pq_rekey_bytes.is_empty())
        .unwrap_or(false);
    let has_password = password.is_some();
    let sender_role_bit = session_header
        .map(|h| h.sender_role != 0)
        .unwrap_or(false);
    let epoch_zero_bit = session_header
        .map(|h| h.epoch == 0)
        .unwrap_or(false);

    let header_byte = ((PROTOCOL_VERSION_V2 & 0x03) << 6)
        | if has_session { FLAG_SESSION } else { 0 }
        | if has_password { FLAG_PASSWORD } else { 0 }
        | if has_pq_rekey { FLAG_PQ_REKEY } else { 0 }
        | if is_control { FLAG_CONTROL } else { 0 }
        | if sender_role_bit { FLAG_SENDER_ROLE } else { 0 }
        | if epoch_zero_bit { FLAG_EPOCH_ZERO } else { 0 };

    if let (Some(msg_key), Some(sh)) = (session_msg_key, session_header) {
        let pq_len = sh.pq_rekey_bytes.len();
        if pq_len > u16::MAX as usize {
            return Err("PQ rekey payload too large".into());
        }

        let mut meta = Vec::with_capacity(8 + pq_len);
        if sh.epoch != 0 {
            write_varint(&mut meta, sh.epoch as u64);
        }
        write_varint(&mut meta, sh.counter);
        if has_pq_rekey {
            write_varint(&mut meta, pq_len as u64);
            meta.extend_from_slice(&sh.pq_rekey_bytes);
        }

        let xnonce = derive_session_xnonce(msg_key, header_byte, chat_id, &meta);

        let mut aad = Vec::with_capacity(1 + 8 + meta.len());
        aad.push(header_byte);
        aad.extend_from_slice(&chat_id.to_be_bytes());
        aad.extend_from_slice(&meta);

        let ct = symmetric::encrypt_xchacha(msg_key, &xnonce, &current, Some(&aad))?;

        let mut session_payload = Vec::with_capacity(meta.len() + ct.len());
        session_payload.extend_from_slice(&meta);
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
        let mut pos = 0usize;
        let epoch = if (header_byte & FLAG_EPOCH_ZERO) != 0 {
            0
        } else {
            read_varint(&current, &mut pos)? as u32
        };
        let counter = read_varint(&current, &mut pos)?;
        let sender_role = if (header_byte & FLAG_SENDER_ROLE) != 0 { 1 } else { 0 };
        let pq_rekey_bytes = if (header_byte & FLAG_PQ_REKEY) != 0 {
            let pq_len = read_varint(&current, &mut pos)? as usize;
            if pos + pq_len > current.len() {
                return Err("v2 session payload truncated".into());
            }
            let bytes = current[pos..pos + pq_len].to_vec();
            pos += pq_len;
            bytes
        } else {
            Vec::new()
        };
        let meta_len = pos;
        if current.len() < meta_len + 16 {
            return Err("v2 session payload too short".into());
        }
        let sh = V2SessionHeader {
            epoch,
            counter,
            sender_role,
            pq_rekey_bytes,
        };
        let msg_key = resolve_session_key(&sh)?;
        let xnonce = derive_session_xnonce(&msg_key, header_byte, chat_id, &current[..meta_len]);
        let ct = &current[meta_len..];

        let mut aad = Vec::with_capacity(1 + 8 + meta_len);
        aad.push(header_byte);
        aad.extend_from_slice(&chat_id.to_be_bytes());
        aad.extend_from_slice(&current[..meta_len]);

        current = symmetric::decrypt_xchacha(&msg_key, &xnonce, ct, Some(&aad))
            .map_err(|_| "Failed to decrypt v2 ratcheted message".to_string())?;
    }

    decode_payload_inner(is_control, &current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_v2_plain_and_password_roundtrip() {
        let chat_id = 42i64;
        let pwd = "synthetic_password_xyz";
        let text = "Synthetic password encrypted message".to_string();
        let packed = pack_message_v2(PayloadData::Text(text.clone()), None, None, Some(pwd), chat_id).unwrap();

        let unpacked = unpack_message_v2(&packed, Some(pwd), chat_id, |_| Err("no session".into())).unwrap();
        match unpacked {
            PayloadData::Text(t) => assert_eq!(t, text),
            _ => panic!("Expected text payload"),
        }

        assert!(unpack_message_v2(&packed, Some("wrong_password"), chat_id, |_| Err("no session".into())).is_err());
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
