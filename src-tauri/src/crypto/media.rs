use crate::crypto::symmetric;
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};

const MAGIC_MARKER: &[u8] = b"MAXMEDIA\x01";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaDescriptor {
    pub attach_index: usize,
    pub name: String,
    pub mime: String,
    pub media_type: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<f64>,
}

pub fn encrypt_media_bytes(
    raw_bytes: &[u8],
    key: &[u8; 32],
    dummy_type: &str,
) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    thread_rng().fill_bytes(&mut nonce);

    let ciphertext = symmetric::encrypt(key, &nonce, raw_bytes, Some(MAGIC_MARKER))?;

    let dummy_header: &[u8] = match dummy_type {
        "pdf" => b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",
        "docx" => b"PK\x03\x04\x14\x00\x08\x00\x08\x00",
        "mp3" => b"ID3\x03\x00\x00\x00\x00\x00",
        _ => b"",
    };

    let mut out = Vec::with_capacity(dummy_header.len() + MAGIC_MARKER.len() + 12 + ciphertext.len());
    out.extend_from_slice(dummy_header);
    out.extend_from_slice(MAGIC_MARKER);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);

    Ok(out)
}

pub fn decrypt_media_bytes(encrypted_bytes: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let marker_pos = encrypted_bytes
        .windows(MAGIC_MARKER.len())
        .position(|window| window == MAGIC_MARKER);

    let payload_start = match marker_pos {
        Some(pos) => pos + MAGIC_MARKER.len(),
        None => {
            if encrypted_bytes.len() >= 28 {
                0
            } else {
                return Err("Encrypted media header missing".into());
            }
        }
    };

    let remaining = &encrypted_bytes[payload_start..];
    if remaining.len() < 28 {
        return Err("Encrypted payload too short".into());
    }

    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&remaining[..12]);
    let ciphertext = &remaining[12..];

    symmetric::decrypt(key, &nonce, ciphertext, Some(MAGIC_MARKER))
        .or_else(|_| symmetric::decrypt(key, &nonce, ciphertext, None))
}
