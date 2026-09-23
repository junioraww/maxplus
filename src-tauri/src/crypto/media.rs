use crate::crypto::symmetric;
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};

pub const BINARY_MAGIC: [u8; 2] = [0x8F, 0x3D];
const LEGACY_MAGIC: &[u8] = b"MAXMEDIA\x01";

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
    #[serde(default)]
    pub wave: Option<Vec<u8>>,
    #[serde(default)]
    pub video_type: Option<i32>,
    #[serde(default)]
    pub color: Option<String>,
}

pub fn encrypt_media_bytes(
    raw_bytes: &[u8],
    key: &[u8; 32],
    dummy_type: &str,
) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    thread_rng().fill_bytes(&mut nonce);

    let ciphertext = symmetric::encrypt(key, &nonce, raw_bytes, Some(&BINARY_MAGIC))?;

    let dummy_header: &[u8] = match dummy_type {
        "docx" | "xlsx" => b"PK\x03\x04\x14\x00\x08\x00\x08\x00",
        "mp3" => b"ID3\x03\x00\x00\x00\x00\x00",
        "ogg" => b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00",
        _ => b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",
    };

    let mut out = Vec::with_capacity(dummy_header.len() + BINARY_MAGIC.len() + 12 + ciphertext.len());
    out.extend_from_slice(dummy_header);
    out.extend_from_slice(&BINARY_MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);

    Ok(out)
}

pub fn decrypt_media_bytes(encrypted_bytes: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let marker_pos = encrypted_bytes
        .windows(BINARY_MAGIC.len())
        .position(|window| window == BINARY_MAGIC);

    if let Some(pos) = marker_pos {
        let payload = &encrypted_bytes[pos + BINARY_MAGIC.len()..];
        if payload.len() >= 28 {
            let mut nonce = [0u8; 12];
            nonce.copy_from_slice(&payload[..12]);
            let ciphertext = &payload[12..];
            if let Ok(dec) = symmetric::decrypt(key, &nonce, ciphertext, Some(&BINARY_MAGIC)) {
                return Ok(dec);
            }
            if let Ok(dec) = symmetric::decrypt(key, &nonce, ciphertext, None) {
                return Ok(dec);
            }
        }
    }

    let legacy_pos = encrypted_bytes
        .windows(LEGACY_MAGIC.len())
        .position(|window| window == LEGACY_MAGIC);

    if let Some(pos) = legacy_pos {
        let payload = &encrypted_bytes[pos + LEGACY_MAGIC.len()..];
        if payload.len() >= 28 {
            let mut nonce = [0u8; 12];
            nonce.copy_from_slice(&payload[..12]);
            let ciphertext = &payload[12..];
            if let Ok(dec) = symmetric::decrypt(key, &nonce, ciphertext, Some(LEGACY_MAGIC)) {
                return Ok(dec);
            }
            if let Ok(dec) = symmetric::decrypt(key, &nonce, ciphertext, None) {
                return Ok(dec);
            }
        }
    }

    let known_headers: &[&[u8]] = &[
        b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",
        b"PK\x03\x04\x14\x00\x08\x00\x08\x00",
        b"ID3\x03\x00\x00\x00\x00\x00",
        b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00",
    ];

    for hdr in known_headers {
        if encrypted_bytes.starts_with(hdr) && encrypted_bytes.len() >= hdr.len() + 28 {
            let payload = &encrypted_bytes[hdr.len()..];
            let mut nonce = [0u8; 12];
            nonce.copy_from_slice(&payload[..12]);
            let ciphertext = &payload[12..];
            if let Ok(dec) = symmetric::decrypt(key, &nonce, ciphertext, None) {
                return Ok(dec);
            }
        }
    }

    if encrypted_bytes.len() >= 28 {
        let mut nonce = [0u8; 12];
        nonce.copy_from_slice(&encrypted_bytes[..12]);
        let ciphertext = &encrypted_bytes[12..];
        if let Ok(dec) = symmetric::decrypt(key, &nonce, ciphertext, None) {
            return Ok(dec);
        }
    }

    Err("Failed to decrypt media bytes: invalid key or corrupted envelope".into())
}
