use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};

use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

static KEY_CACHE: LazyLock<RwLock<HashMap<(String, Vec<u8>), [u8; 32]>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let cache_key = (password.to_string(), salt.to_vec());
    if let Ok(guard) = KEY_CACHE.read() {
        if let Some(cached_key) = guard.get(&cache_key) {
            return Ok(*cached_key);
        }
    }

    let params = Params::new(19456, 2, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = KEY_CACHE.write() {
        guard.insert(cache_key, key);
    }

    Ok(key)
}

pub fn encrypt(
    key: &[u8; 32],
    nonce: &[u8; 12],
    plaintext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let n = Nonce::from_slice(nonce);

    match aad {
        Some(ad) => {
            use chacha20poly1305::aead::Payload;
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
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let n = Nonce::from_slice(nonce);

    match aad {
        Some(ad) => {
            use chacha20poly1305::aead::Payload;
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
}
