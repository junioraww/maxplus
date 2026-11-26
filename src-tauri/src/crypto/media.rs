use crate::crypto::symmetric::{self, hkdf_sha512};
use rand::{RngCore, thread_rng};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const BINARY_MAGIC: [u8; 2] = [0x8F, 0x3D];
pub const MAGIC_MEDIA_V2: [u8; 4] = [0x8F, 0x3D, 0x4D, 0x02];
const LEGACY_MAGIC: &[u8] = b"MAXMEDIA\x01";

const MEDIA_MODE_OBF_EPHEMERAL: u8 = 0x00;
const MEDIA_MODE_SESSION_HKDF: u8 = 0x01;
const MEDIA_MODE_PASSWORD_ARGON2: u8 = 0x02;

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

fn dummy_header_for(dummy_type: &str) -> &'static [u8] {
    match dummy_type {
        "docx" | "xlsx" => b"PK\x03\x04\x14\x00\x08\x00\x08\x00",
        "mp3" => b"ID3\x03\x00\x00\x00\x00\x00",
        "ogg" => b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00",
        _ => b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n",
    }
}

pub enum MediaEncryptAuth<'a> {
    Session(&'a [u8; 32]),
    Password(&'a str),
    ObfuscationOnly,
}

pub fn encrypt_media_bytes_v2(
    raw_bytes: &[u8],
    auth: MediaEncryptAuth<'_>,
    dummy_type: &str,
) -> Result<Vec<u8>, String> {
    let dummy_header = dummy_header_for(dummy_type);
    let mut xnonce = [0u8; 24];
    thread_rng().fill_bytes(&mut xnonce);

    let (mode_byte, param_bytes): (u8, Vec<u8>) = match auth {
        MediaEncryptAuth::Session(_) => {
            let mut salt = [0u8; 16];
            thread_rng().fill_bytes(&mut salt);
            (MEDIA_MODE_SESSION_HKDF, salt.to_vec())
        }
        MediaEncryptAuth::Password(_) => {
            let mut salt = [0u8; 16];
            thread_rng().fill_bytes(&mut salt);
            (MEDIA_MODE_PASSWORD_ARGON2, salt.to_vec())
        }
        MediaEncryptAuth::ObfuscationOnly => {
            let mut eph_key = Zeroizing::new([0u8; 32]);
            thread_rng().fill_bytes(&mut *eph_key);
            (MEDIA_MODE_OBF_EPHEMERAL, eph_key.to_vec())
        }
    };

    let mut file_key = Zeroizing::new([0u8; 32]);
    match auth {
        MediaEncryptAuth::Session(session_key) => {
            hkdf_sha512(session_key, &param_bytes, b"maxplus-media-v2", &mut *file_key)?;
        }
        MediaEncryptAuth::Password(pwd) => {
            let k = symmetric::derive_key(pwd, &param_bytes)?;
            *file_key = k;
        }
        MediaEncryptAuth::ObfuscationOnly => {
            file_key.copy_from_slice(&param_bytes);
        }
    }

    let mut aad = Vec::with_capacity(MAGIC_MEDIA_V2.len() + 1 + param_bytes.len());
    aad.extend_from_slice(&MAGIC_MEDIA_V2);
    aad.push(mode_byte);
    aad.extend_from_slice(&param_bytes);

    let ciphertext = symmetric::encrypt_xchacha(&file_key, &xnonce, raw_bytes, Some(&aad))?;

    let mut out = Vec::with_capacity(
        dummy_header.len() + MAGIC_MEDIA_V2.len() + 1 + param_bytes.len() + 24 + ciphertext.len(),
    );
    out.extend_from_slice(dummy_header);
    out.extend_from_slice(&MAGIC_MEDIA_V2);
    out.push(mode_byte);
    out.extend_from_slice(&param_bytes);
    out.extend_from_slice(&xnonce);
    out.extend_from_slice(&ciphertext);

    Ok(out)
}

pub fn decrypt_media_bytes_v2(
    encrypted_bytes: &[u8],
    session_keys: &[[u8; 32]],
    password: Option<&str>,
) -> Result<Vec<u8>, String> {
    if let Some(pos) = encrypted_bytes
        .windows(MAGIC_MEDIA_V2.len())
        .position(|w| w == MAGIC_MEDIA_V2)
    {
        let payload = &encrypted_bytes[pos + MAGIC_MEDIA_V2.len()..];
        if payload.is_empty() {
            return Err("Corrupted v2 media header".into());
        }
        let mode_byte = payload[0];
        let rest = &payload[1..];

        match mode_byte {
            MEDIA_MODE_OBF_EPHEMERAL => {
                if rest.len() < 32 + 24 + 16 {
                    return Err("Truncated v2 obfuscated media payload".into());
                }
                let mut eph_key = Zeroizing::new([0u8; 32]);
                eph_key.copy_from_slice(&rest[..32]);
                let mut xnonce = [0u8; 24];
                xnonce.copy_from_slice(&rest[32..56]);
                let ct = &rest[56..];
                let mut aad = Vec::with_capacity(MAGIC_MEDIA_V2.len() + 1 + 32);
                aad.extend_from_slice(&MAGIC_MEDIA_V2);
                aad.push(mode_byte);
                aad.extend_from_slice(&*eph_key);
                return symmetric::decrypt_xchacha(&eph_key, &xnonce, ct, Some(&aad));
            }
            MEDIA_MODE_SESSION_HKDF => {
                if rest.len() < 16 + 24 + 16 {
                    return Err("Truncated v2 session media payload".into());
                }
                let salt = &rest[..16];
                let mut xnonce = [0u8; 24];
                xnonce.copy_from_slice(&rest[16..40]);
                let ct = &rest[40..];
                let mut aad = Vec::with_capacity(MAGIC_MEDIA_V2.len() + 1 + 16);
                aad.extend_from_slice(&MAGIC_MEDIA_V2);
                aad.push(mode_byte);
                aad.extend_from_slice(salt);

                for sk in session_keys {
                    let mut file_key = Zeroizing::new([0u8; 32]);
                    if hkdf_sha512(sk, salt, b"maxplus-media-v2", &mut *file_key).is_ok() {
                        if let Ok(pt) = symmetric::decrypt_xchacha(&file_key, &xnonce, ct, Some(&aad)) {
                            return Ok(pt);
                        }
                    }
                }
                return Err("Failed to decrypt v2 media with available session keys".into());
            }
            MEDIA_MODE_PASSWORD_ARGON2 => {
                if rest.len() < 16 + 24 + 16 {
                    return Err("Truncated v2 password media payload".into());
                }
                let pwd = password.ok_or_else(|| "Password required to decrypt v2 media".to_string())?;
                let salt = &rest[..16];
                let mut xnonce = [0u8; 24];
                xnonce.copy_from_slice(&rest[16..40]);
                let ct = &rest[40..];
                let mut aad = Vec::with_capacity(MAGIC_MEDIA_V2.len() + 1 + 16);
                aad.extend_from_slice(&MAGIC_MEDIA_V2);
                aad.push(mode_byte);
                aad.extend_from_slice(salt);

                let file_key = Zeroizing::new(symmetric::derive_key(pwd, salt)?);
                return symmetric::decrypt_xchacha(&file_key, &xnonce, ct, Some(&aad));
            }
            _ => return Err("Unknown v2 media encryption mode".into()),
        }
    }

    for sk in session_keys {
        if let Ok(pt) = decrypt_media_bytes(encrypted_bytes, sk) {
            return Ok(pt);
        }
    }
    if let Some(pwd) = password {
        let salt = b"maxplus_media_salt_bytes";
        if let Ok(derived) = symmetric::derive_key(pwd, salt) {
            if let Ok(pt) = decrypt_media_bytes(encrypted_bytes, &derived) {
                return Ok(pt);
            }
        }
    }
    // Legacy obfuscation-only v1 files from older clients
    let legacy_obf_key = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"maxplus_media_obfuscation_fixed_key_v1");
        let res: [u8; 32] = hasher.finalize().into();
        res
    };
    decrypt_media_bytes(encrypted_bytes, &legacy_obf_key)
}

#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_v2_session_and_obf_roundtrip() {
        let sk = [0x44u8; 32];
        let sample = b"synthetic-media-v2-bytes-0123456789";

        let enc_session = encrypt_media_bytes_v2(sample, MediaEncryptAuth::Session(&sk), "pdf").unwrap();
        assert!(enc_session.starts_with(b"%PDF-1.4"));
        let dec_session = decrypt_media_bytes_v2(&enc_session, &[sk], None).unwrap();
        assert_eq!(dec_session, sample);
        assert!(decrypt_media_bytes_v2(&enc_session, &[[0x99u8; 32]], None).is_err());

        let enc_obf = encrypt_media_bytes_v2(sample, MediaEncryptAuth::ObfuscationOnly, "docx").unwrap();
        let dec_obf = decrypt_media_bytes_v2(&enc_obf, &[], None).unwrap();
        assert_eq!(dec_obf, sample);
    }
}
