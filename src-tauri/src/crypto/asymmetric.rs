use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub struct KeypairBundle {
    pub ed_sk: [u8; 32],
    pub ed_pk: [u8; 32],
    pub x_sk: [u8; 32],
    pub x_pk: [u8; 32],
}

pub fn generate_keypair_bundle() -> KeypairBundle {
    let ed_signing = SigningKey::generate(&mut OsRng);
    let ed_verifying = ed_signing.verifying_key();

    let x_secret = StaticSecret::random_from_rng(OsRng);
    let x_public = PublicKey::from(&x_secret);

    KeypairBundle {
        ed_sk: ed_signing.to_bytes(),
        ed_pk: ed_verifying.to_bytes(),
        x_sk: x_secret.to_bytes(),
        x_pk: *x_public.as_bytes(),
    }
}

pub fn compute_shared_secret(my_x_sk: &[u8; 32], peer_x_pk: &[u8; 32]) -> [u8; 32] {
    let my_secret = StaticSecret::from(*my_x_sk);
    let peer_public = PublicKey::from(*peer_x_pk);
    let shared = my_secret.diffie_hellman(&peer_public);

    let mut hasher = Sha256::new();
    hasher.update(b"maxplus-e2e-session-v1");
    hasher.update(shared.as_bytes());
    let result = hasher.finalize();

    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

pub fn sign_data(ed_sk: &[u8; 32], data: &[u8]) -> [u8; 64] {
    let signing_key = SigningKey::from_bytes(ed_sk);
    let signature = signing_key.sign(data);
    signature.to_bytes()
}

pub fn verify_signature(ed_pk: &[u8; 32], data: &[u8], sig_bytes: &[u8; 64]) -> bool {
    let verifying_key = match VerifyingKey::from_bytes(ed_pk) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let signature = Signature::from_bytes(sig_bytes);
    verifying_key.verify(data, &signature).is_ok()
}

pub fn create_handshake_init(
    ed_sk: &[u8; 32],
    ed_pk: &[u8; 32],
    x_pk: &[u8; 32],
    timestamp: i64,
) -> Vec<u8> {
    let mut data_to_sign = Vec::with_capacity(74);
    data_to_sign.push(0x01);
    data_to_sign.extend_from_slice(ed_pk);
    data_to_sign.extend_from_slice(x_pk);
    data_to_sign.extend_from_slice(&timestamp.to_be_bytes());

    let sig = sign_data(ed_sk, &data_to_sign);

    let mut packet = Vec::with_capacity(1 + 74 + 64);
    packet.push(0x01);
    packet.extend_from_slice(ed_pk);
    packet.extend_from_slice(x_pk);
    packet.extend_from_slice(&timestamp.to_be_bytes());
    packet.extend_from_slice(&sig);
    packet
}

pub fn create_handshake_accept(
    ed_sk: &[u8; 32],
    ed_pk: &[u8; 32],
    x_pk: &[u8; 32],
    timestamp: i64,
) -> Vec<u8> {
    let mut data_to_sign = Vec::with_capacity(74);
    data_to_sign.push(0x02);
    data_to_sign.extend_from_slice(ed_pk);
    data_to_sign.extend_from_slice(x_pk);
    data_to_sign.extend_from_slice(&timestamp.to_be_bytes());

    let sig = sign_data(ed_sk, &data_to_sign);

    let mut packet = Vec::with_capacity(1 + 74 + 64);
    packet.push(0x02);
    packet.extend_from_slice(ed_pk);
    packet.extend_from_slice(x_pk);
    packet.extend_from_slice(&timestamp.to_be_bytes());
    packet.extend_from_slice(&sig);
    packet
}

#[allow(dead_code)]
pub struct ParsedHandshake {
    pub subtype: u8,
    pub ed_pk: [u8; 32],
    pub x_pk: [u8; 32],
    pub timestamp: i64,
}

pub fn parse_and_verify_handshake(bytes: &[u8]) -> Result<ParsedHandshake, String> {
    if bytes.len() != 1 + 32 + 32 + 8 + 64 {
        return Err("Invalid handshake packet length".into());
    }

    let subtype = bytes[0];
    if subtype != 0x01 && subtype != 0x02 {
        return Err("Unknown handshake subtype".into());
    }

    let mut ed_pk = [0u8; 32];
    ed_pk.copy_from_slice(&bytes[1..33]);

    let mut x_pk = [0u8; 32];
    x_pk.copy_from_slice(&bytes[33..65]);

    let ts_bytes: [u8; 8] = bytes[65..73].try_into().map_err(|e| format!("{e}"))?;
    let timestamp = i64::from_be_bytes(ts_bytes);

    let mut sig = [0u8; 64];
    sig.copy_from_slice(&bytes[73..137]);

    let data_to_verify = &bytes[0..73];
    if !verify_signature(&ed_pk, data_to_verify, &sig) {
        return Err("Invalid handshake signature".into());
    }

    Ok(ParsedHandshake {
        subtype,
        ed_pk,
        x_pk,
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dh_shared_secret_agreement() {
        let alice = generate_keypair_bundle();
        let bob = generate_keypair_bundle();

        let alice_shared = compute_shared_secret(&alice.x_sk, &bob.x_pk);
        let bob_shared = compute_shared_secret(&bob.x_sk, &alice.x_pk);

        assert_eq!(alice_shared, bob_shared);
    }

    #[test]
    fn test_signature_verification() {
        let bundle = generate_keypair_bundle();
        let data = b"synthetic verification payload";

        let sig = sign_data(&bundle.ed_sk, data);
        assert!(verify_signature(&bundle.ed_pk, data, &sig));

        let corrupted = b"synthetic verification corrupted";
        assert!(!verify_signature(&bundle.ed_pk, corrupted, &sig));
    }

    #[test]
    fn test_handshake_init_parse() {
        let bundle = generate_keypair_bundle();
        let ts = 1700000000000;
        let init_packet = create_handshake_init(&bundle.ed_sk, &bundle.ed_pk, &bundle.x_pk, ts);

        let parsed = parse_and_verify_handshake(&init_packet).unwrap();
        assert_eq!(parsed.subtype, 0x01);
        assert_eq!(parsed.ed_pk, bundle.ed_pk);
        assert_eq!(parsed.x_pk, bundle.x_pk);
        assert_eq!(parsed.timestamp, ts);
    }

    #[test]
    fn test_handshake_accept_parse() {
        let bundle = generate_keypair_bundle();
        let ts = 1700000005000;
        let accept_packet = create_handshake_accept(&bundle.ed_sk, &bundle.ed_pk, &bundle.x_pk, ts);

        let parsed = parse_and_verify_handshake(&accept_packet).unwrap();
        assert_eq!(parsed.subtype, 0x02);
        assert_eq!(parsed.ed_pk, bundle.ed_pk);
        assert_eq!(parsed.x_pk, bundle.x_pk);
        assert_eq!(parsed.timestamp, ts);
    }
}
