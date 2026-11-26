use argon2::{Algorithm, Argon2, Params, Version};
use aws_lc_rs::{hkdf, hmac};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Key, Nonce, XChaCha20Poly1305, XNonce,
};
use zeroize::Zeroizing;

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

static KEY_CACHE: LazyLock<RwLock<HashMap<(String, Vec<u8>), [u8; 32]>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

struct HkdfOutLen(usize);

impl hkdf::KeyType for HkdfOutLen {
    fn len(&self) -> usize {
        self.0
    }
}

pub fn hkdf_sha512(ikm: &[u8], salt: &[u8], info: &[u8], out: &mut [u8]) -> Result<(), String> {
    if out.is_empty() {
        return Ok(());
    }
    let s = if salt.is_empty() {
        hkdf::Salt::none(hkdf::HKDF_SHA512)
    } else {
        hkdf::Salt::new(hkdf::HKDF_SHA512, salt)
    };
    let prk = s.extract(ikm);
    let info_slices = [info];
    let okm = prk
        .expand(&info_slices, HkdfOutLen(out.len()))
        .map_err(|_| "HKDF-SHA512 expand failed".to_string())?;
    okm.fill(out)
        .map_err(|_| "HKDF-SHA512 fill failed".to_string())
}

pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let k = hmac::Key::new(hmac::HMAC_SHA256, key);
    let tag = hmac::sign(&k, data);
    let mut out = [0u8; 32];
    out.copy_from_slice(tag.as_ref());
    out
}

pub fn verify_hmac_sha256(key: &[u8], data: &[u8], tag: &[u8]) -> bool {
    let k = hmac::Key::new(hmac::HMAC_SHA256, key);
    hmac::verify(&k, data, tag).is_ok()
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let cache_key = (password.to_string(), salt.to_vec());
    if let Ok(guard) = KEY_CACHE.read() {
        if let Some(cached_key) = guard.get(&cache_key) {
            return Ok(*cached_key);
        }
    }

    let params = Params::new(19456, 2, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut *key)
        .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = KEY_CACHE.write() {
        if guard.len() > 256 {
            guard.clear();
        }
        guard.insert(cache_key, *key);
    }

    Ok(*key)
}

pub fn encrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new(&Key::from(*key));
    let n = Nonce::from(*nonce);

    match aad {
        Some(ad) => {
            let payload = Payload {
                msg: plaintext,
                aad: ad,
            };
            cipher.encrypt(&n, payload).map_err(|e| e.to_string())
        }
        None => cipher.encrypt(&n, plaintext).map_err(|e| e.to_string()),
    }
}

pub fn decrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    ciphertext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new(&Key::from(*key));
    let n = Nonce::from(*nonce);

    match aad {
        Some(ad) => {
            let payload = Payload {
                msg: ciphertext,
                aad: ad,
            };
            cipher.decrypt(&n, payload).map_err(|e| e.to_string())
        }
        None => cipher.decrypt(&n, ciphertext).map_err(|e| e.to_string()),
    }
}

pub fn encrypt_xchacha(
    key: &[u8; 32],
    nonce: &[u8; 24],
    plaintext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(&Key::from(*key));
    let n = XNonce::from(*nonce);

    match aad {
        Some(ad) => {
            let payload = Payload {
                msg: plaintext,
                aad: ad,
            };
            cipher.encrypt(&n, payload).map_err(|e| e.to_string())
        }
        None => cipher.encrypt(&n, plaintext).map_err(|e| e.to_string()),
    }
}

pub fn decrypt_xchacha(
    key: &[u8; 32],
    nonce: &[u8; 24],
    ciphertext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(&Key::from(*key));
    let n = XNonce::from(*nonce);

    match aad {
        Some(ad) => {
            let payload = Payload {
                msg: ciphertext,
                aad: ad,
            };
            cipher.decrypt(&n, payload).map_err(|e| e.to_string())
        }
        None => cipher.decrypt(&n, ciphertext).map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_symmetric_roundtrip() {
        let key = [42u8; 32];
        let nonce = [7u8; 12];
        let plaintext = b"synthetic test message payload";
        let encrypted = encrypt(&key, &nonce, plaintext, None).unwrap();
        assert_ne!(encrypted, plaintext);

        let decrypted = decrypt(&key, &nonce, &encrypted, None).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_symmetric_wrong_key() {
        let key = [42u8; 32];
        let wrong_key = [43u8; 32];
        let nonce = [7u8; 12];
        let plaintext = b"synthetic test message";
        let encrypted = encrypt(&key, &nonce, plaintext, None).unwrap();

        let result = decrypt(&wrong_key, &nonce, &encrypted, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_argon2_derive_key() {
        let salt = [9u8; 16];
        let key1 = derive_key("password123", &salt).unwrap();
        let key2 = derive_key("password123", &salt).unwrap();
        assert_eq!(key1, key2);

        let key3 = derive_key("different", &salt).unwrap();
        assert_ne!(key1, key3);
    }

    #[test]
    fn test_xchacha_aad_and_hkdf() {
        let mut derived = [0u8; 32];
        hkdf_sha512(b"ikm-pq-secret", b"salt", b"info", &mut derived).unwrap();
        let nonce = [11u8; 24];
        let aad = b"header-v2";
        let ct = encrypt_xchacha(&derived, &nonce, b"pq-message", Some(aad)).unwrap();
        assert!(decrypt_xchacha(&derived, &nonce, &ct, Some(b"wrong-aad")).is_err());
        let pt = decrypt_xchacha(&derived, &nonce, &ct, Some(aad)).unwrap();
        assert_eq!(pt, b"pq-message");
    }
}
