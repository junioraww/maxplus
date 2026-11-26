use crate::crypto::symmetric::{hkdf_sha512, hmac_sha256, verify_hmac_sha256};
use aws_lc_rs::{
    digest::{Context as DigestContext, SHA3_256},
    kem::{Ciphertext, DecapsulationKey, EncapsulationKey, ML_KEM_768},
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::rngs::OsRng;
use std::collections::HashMap;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroizing;

pub const MLKEM768_PK_LEN: usize = 1184;
pub const MLKEM768_SK_LEN: usize = 2400;
pub const MLKEM768_CT_LEN: usize = 1088;
pub const XWING_PK_LEN: usize = MLKEM768_PK_LEN + 32; // 1216 bytes
pub const XWING_CT_LEN: usize = MLKEM768_CT_LEN + 32; // 1120 bytes
const XWING_LABEL: [u8; 6] = [0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c];

pub const HANDSHAKE_V2_INIT: u8 = 0x11;
pub const HANDSHAKE_V2_ACCEPT: u8 = 0x12;

pub const MAX_SKIPPED_KEYS: usize = 512;

pub struct XWingKeypair {
    pub mlkem_sk: Zeroizing<Vec<u8>>,
    pub mlkem_pk: Vec<u8>,
    pub x_sk: Zeroizing<[u8; 32]>,
    pub x_pk: [u8; 32],
}

impl XWingKeypair {
    pub fn generate() -> Result<Self, String> {
        let dk = DecapsulationKey::generate(&ML_KEM_768)
            .map_err(|_| "Failed to generate ML-KEM-768 keypair".to_string())?;
        let ek = dk
            .encapsulation_key()
            .map_err(|_| "Failed to extract ML-KEM-768 encapsulation key".to_string())?;
        let mlkem_sk_bytes = dk
            .key_bytes()
            .map_err(|_| "Failed to serialize ML-KEM-768 secret key".to_string())?;
        let mlkem_pk_bytes = ek
            .key_bytes()
            .map_err(|_| "Failed to serialize ML-KEM-768 public key".to_string())?;

        let x_secret = StaticSecret::random_from_rng(OsRng);
        let x_public = PublicKey::from(&x_secret);

        Ok(Self {
            mlkem_sk: Zeroizing::new(mlkem_sk_bytes.as_ref().to_vec()),
            mlkem_pk: mlkem_pk_bytes.as_ref().to_vec(),
            x_sk: Zeroizing::new(x_secret.to_bytes()),
            x_pk: *x_public.as_bytes(),
        })
    }

    pub fn public_key_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(XWING_PK_LEN);
        out.extend_from_slice(&self.mlkem_pk);
        out.extend_from_slice(&self.x_pk);
        out
    }
}

pub struct PqKeypairBundle {
    pub ed_sk: Zeroizing<[u8; 32]>,
    pub ed_pk: [u8; 32],
    pub xwing: XWingKeypair,
}

pub fn generate_pq_keypair_bundle() -> Result<PqKeypairBundle, String> {
    let ed_signing = SigningKey::generate(&mut OsRng);
    let ed_verifying = ed_signing.verifying_key();
    let xwing = XWingKeypair::generate()?;

    Ok(PqKeypairBundle {
        ed_sk: Zeroizing::new(ed_signing.to_bytes()),
        ed_pk: ed_verifying.to_bytes(),
        xwing,
    })
}

fn xwing_combiner(
    ss_mlkem: &[u8],
    ss_x25519: &[u8; 32],
    ct_x25519: &[u8; 32],
    pk_x25519: &[u8; 32],
) -> Zeroizing<[u8; 32]> {
    let mut ctx = DigestContext::new(&SHA3_256);
    ctx.update(ss_mlkem);
    ctx.update(ss_x25519);
    ctx.update(ct_x25519);
    ctx.update(pk_x25519);
    ctx.update(&XWING_LABEL);
    let digest = ctx.finish();
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(digest.as_ref());
    out
}

pub fn xwing_encapsulate(peer_xwing_pk: &[u8]) -> Result<(Vec<u8>, Zeroizing<[u8; 32]>), String> {
    if peer_xwing_pk.len() != XWING_PK_LEN {
        return Err(format!(
            "Invalid X-Wing public key length: expected {}, got {}",
            XWING_PK_LEN,
            peer_xwing_pk.len()
        ));
    }
    let peer_mlkem_pk_bytes = &peer_xwing_pk[..MLKEM768_PK_LEN];
    let mut peer_x_pk = [0u8; 32];
    peer_x_pk.copy_from_slice(&peer_xwing_pk[MLKEM768_PK_LEN..]);

    let ek = EncapsulationKey::new(&ML_KEM_768, peer_mlkem_pk_bytes)
        .map_err(|_| "Invalid peer ML-KEM-768 encapsulation key".to_string())?;
    let (ct_m, ss_m) = ek
        .encapsulate()
        .map_err(|_| "ML-KEM-768 encapsulation failed".to_string())?;

    let eph_x_sk = StaticSecret::random_from_rng(OsRng);
    let eph_x_pk = PublicKey::from(&eph_x_sk);
    let ct_x = *eph_x_pk.as_bytes();
    let peer_pub = PublicKey::from(peer_x_pk);
    let ss_x = eph_x_sk.diffie_hellman(&peer_pub);

    let ss = xwing_combiner(ss_m.as_ref(), ss_x.as_bytes(), &ct_x, &peer_x_pk);

    let mut ct = Vec::with_capacity(XWING_CT_LEN);
    ct.extend_from_slice(ct_m.as_ref());
    ct.extend_from_slice(&ct_x);

    Ok((ct, ss))
}

pub fn xwing_decapsulate(
    my_mlkem_sk: &[u8],
    my_x_sk: &[u8; 32],
    my_x_pk: &[u8; 32],
    ciphertext: &[u8],
) -> Result<Zeroizing<[u8; 32]>, String> {
    if my_mlkem_sk.len() != MLKEM768_SK_LEN {
        return Err("Invalid ML-KEM-768 decapsulation key length".into());
    }
    if ciphertext.len() != XWING_CT_LEN {
        return Err(format!(
            "Invalid X-Wing ciphertext length: expected {}, got {}",
            XWING_CT_LEN,
            ciphertext.len()
        ));
    }

    let ct_m = &ciphertext[..MLKEM768_CT_LEN];
    let mut ct_x = [0u8; 32];
    ct_x.copy_from_slice(&ciphertext[MLKEM768_CT_LEN..]);

    let dk = DecapsulationKey::new(&ML_KEM_768, my_mlkem_sk)
        .map_err(|_| "Invalid ML-KEM-768 decapsulation key".to_string())?;
    let ss_m = dk
        .decapsulate(Ciphertext::from(ct_m))
        .map_err(|_| "ML-KEM-768 decapsulation failed".to_string())?;

    let my_secret = StaticSecret::from(*my_x_sk);
    let peer_eph_pk = PublicKey::from(ct_x);
    let ss_x = my_secret.diffie_hellman(&peer_eph_pk);

    Ok(xwing_combiner(ss_m.as_ref(), ss_x.as_bytes(), &ct_x, my_x_pk))
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

pub fn create_pq_handshake_init(
    ed_sk: &[u8; 32],
    ed_pk: &[u8; 32],
    xwing_pk: &[u8],
    timestamp: i64,
) -> Result<Vec<u8>, String> {
    if xwing_pk.len() != XWING_PK_LEN {
        return Err("Invalid X-Wing public key length for init".into());
    }
    let body_len = 1 + 32 + XWING_PK_LEN + 8;
    let mut data_to_sign = Vec::with_capacity(body_len);
    data_to_sign.push(HANDSHAKE_V2_INIT);
    data_to_sign.extend_from_slice(ed_pk);
    data_to_sign.extend_from_slice(xwing_pk);
    data_to_sign.extend_from_slice(&timestamp.to_be_bytes());

    let sig = sign_data(ed_sk, &data_to_sign);
    let mut packet = Vec::with_capacity(body_len + 64);
    packet.extend_from_slice(&data_to_sign);
    packet.extend_from_slice(&sig);
    Ok(packet)
}

pub fn compute_key_confirmation_mac(
    shared_secret: &[u8; 32],
    init_ed_pk: &[u8; 32],
    init_xwing_pk: &[u8],
    resp_ed_pk: &[u8; 32],
    xwing_ct: &[u8],
) -> Result<[u8; 32], String> {
    let mut confirm_key = Zeroizing::new([0u8; 32]);
    hkdf_sha512(
        shared_secret,
        b"maxplus-pq-v2-salt",
        b"maxplus-pq-v2-confirm",
        &mut *confirm_key,
    )?;
    let mut transcript = Vec::with_capacity(32 + init_xwing_pk.len() + 32 + xwing_ct.len());
    transcript.extend_from_slice(init_ed_pk);
    transcript.extend_from_slice(init_xwing_pk);
    transcript.extend_from_slice(resp_ed_pk);
    transcript.extend_from_slice(xwing_ct);
    Ok(hmac_sha256(&*confirm_key, &transcript))
}

pub fn create_pq_handshake_accept(
    ed_sk: &[u8; 32],
    ed_pk: &[u8; 32],
    xwing_ct: &[u8],
    timestamp: i64,
    confirm_mac: &[u8; 32],
) -> Result<Vec<u8>, String> {
    if xwing_ct.len() != XWING_CT_LEN {
        return Err("Invalid X-Wing ciphertext length for accept".into());
    }
    let body_len = 1 + 32 + XWING_CT_LEN + 8 + 32;
    let mut data_to_sign = Vec::with_capacity(body_len);
    data_to_sign.push(HANDSHAKE_V2_ACCEPT);
    data_to_sign.extend_from_slice(ed_pk);
    data_to_sign.extend_from_slice(xwing_ct);
    data_to_sign.extend_from_slice(&timestamp.to_be_bytes());
    data_to_sign.extend_from_slice(confirm_mac);

    let sig = sign_data(ed_sk, &data_to_sign);
    let mut packet = Vec::with_capacity(body_len + 64);
    packet.extend_from_slice(&data_to_sign);
    packet.extend_from_slice(&sig);
    Ok(packet)
}

#[allow(dead_code)]
pub struct ParsedPqInit {
    pub ed_pk: [u8; 32],
    pub xwing_pk: Vec<u8>,
    pub timestamp: i64,
}

#[allow(dead_code)]
pub struct ParsedPqAccept {
    pub ed_pk: [u8; 32],
    pub xwing_ct: Vec<u8>,
    pub timestamp: i64,
    pub confirm_mac: [u8; 32],
}

pub enum ParsedHandshake {
    Init(ParsedPqInit),
    Accept(ParsedPqAccept),
}

pub fn parse_and_verify_handshake(bytes: &[u8]) -> Result<ParsedHandshake, String> {
    if bytes.is_empty() {
        return Err("Empty handshake packet".into());
    }
    match bytes[0] {
        HANDSHAKE_V2_INIT => {
            let expected_len = 1 + 32 + XWING_PK_LEN + 8 + 64;
            if bytes.len() != expected_len {
                return Err("Invalid PQ handshake init length".into());
            }
            let mut ed_pk = [0u8; 32];
            ed_pk.copy_from_slice(&bytes[1..33]);
            let xwing_pk = bytes[33..33 + XWING_PK_LEN].to_vec();
            let ts_off = 33 + XWING_PK_LEN;
            let ts_bytes: [u8; 8] = bytes[ts_off..ts_off + 8].try_into().map_err(|e| format!("{e}"))?;
            let timestamp = i64::from_be_bytes(ts_bytes);
            let sig_off = ts_off + 8;
            let mut sig = [0u8; 64];
            sig.copy_from_slice(&bytes[sig_off..sig_off + 64]);
            if !verify_signature(&ed_pk, &bytes[..sig_off], &sig) {
                return Err("Invalid PQ handshake init signature".into());
            }
            Ok(ParsedHandshake::Init(ParsedPqInit {
                ed_pk,
                xwing_pk,
                timestamp,
            }))
        }
        HANDSHAKE_V2_ACCEPT => {
            let expected_len = 1 + 32 + XWING_CT_LEN + 8 + 32 + 64;
            if bytes.len() != expected_len {
                return Err("Invalid PQ handshake accept length".into());
            }
            let mut ed_pk = [0u8; 32];
            ed_pk.copy_from_slice(&bytes[1..33]);
            let ct_off = 33;
            let xwing_ct = bytes[ct_off..ct_off + XWING_CT_LEN].to_vec();
            let ts_off = ct_off + XWING_CT_LEN;
            let ts_bytes: [u8; 8] = bytes[ts_off..ts_off + 8].try_into().map_err(|e| format!("{e}"))?;
            let timestamp = i64::from_be_bytes(ts_bytes);
            let mac_off = ts_off + 8;
            let mut confirm_mac = [0u8; 32];
            confirm_mac.copy_from_slice(&bytes[mac_off..mac_off + 32]);
            let sig_off = mac_off + 32;
            let mut sig = [0u8; 64];
            sig.copy_from_slice(&bytes[sig_off..sig_off + 64]);
            if !verify_signature(&ed_pk, &bytes[..sig_off], &sig) {
                return Err("Invalid PQ handshake accept signature".into());
            }
            Ok(ParsedHandshake::Accept(ParsedPqAccept {
                ed_pk,
                xwing_ct,
                timestamp,
                confirm_mac,
            }))
        }
        _ => Err("Unknown handshake subtype".into()),
    }
}

pub fn verify_key_confirmation_mac(
    shared_secret: &[u8; 32],
    init_ed_pk: &[u8; 32],
    init_xwing_pk: &[u8],
    resp_ed_pk: &[u8; 32],
    xwing_ct: &[u8],
    mac: &[u8; 32],
) -> Result<bool, String> {
    let mut confirm_key = Zeroizing::new([0u8; 32]);
    hkdf_sha512(
        shared_secret,
        b"maxplus-pq-v2-salt",
        b"maxplus-pq-v2-confirm",
        &mut *confirm_key,
    )?;
    let mut transcript = Vec::with_capacity(32 + init_xwing_pk.len() + 32 + xwing_ct.len());
    transcript.extend_from_slice(init_ed_pk);
    transcript.extend_from_slice(init_xwing_pk);
    transcript.extend_from_slice(resp_ed_pk);
    transcript.extend_from_slice(xwing_ct);
    Ok(verify_hmac_sha256(&*confirm_key, &transcript, mac))
}

pub fn derive_initial_ratchet_chains(
    shared_secret: &[u8; 32],
    is_initiator: bool,
) -> Result<(Zeroizing<[u8; 32]>, Zeroizing<[u8; 32]>, Zeroizing<[u8; 32]>), String> {
    let mut root_key = Zeroizing::new([0u8; 32]);
    let mut init_chain = Zeroizing::new([0u8; 32]);
    let mut resp_chain = Zeroizing::new([0u8; 32]);
    hkdf_sha512(shared_secret, b"maxplus-pq-v2-salt", b"maxplus-pq-v2-root", &mut *root_key)?;
    hkdf_sha512(&*root_key, b"maxplus-pq-v2-salt", b"maxplus-pq-v2-chain-init", &mut *init_chain)?;
    hkdf_sha512(&*root_key, b"maxplus-pq-v2-salt", b"maxplus-pq-v2-chain-resp", &mut *resp_chain)?;
    if is_initiator {
        Ok((root_key, init_chain, resp_chain))
    } else {
        Ok((root_key, resp_chain, init_chain))
    }
}

pub fn step_chain_key(chain_key: &[u8; 32]) -> Result<(Zeroizing<[u8; 32]>, Zeroizing<[u8; 32]>), String> {
    let mut out = Zeroizing::new([0u8; 64]);
    hkdf_sha512(chain_key, b"maxplus-chain-step-v2", b"chain+msg", &mut *out)?;
    let mut next_chain = Zeroizing::new([0u8; 32]);
    let mut msg_key = Zeroizing::new([0u8; 32]);
    next_chain.copy_from_slice(&out[..32]);
    msg_key.copy_from_slice(&out[32..64]);
    Ok((next_chain, msg_key))
}

pub fn ratchet_root_with_xwing(
    root_key: &[u8; 32],
    xwing_ss: &[u8; 32],
    is_sender: bool,
) -> Result<(Zeroizing<[u8; 32]>, Zeroizing<[u8; 32]>, Zeroizing<[u8; 32]>), String> {
    let mut new_root = Zeroizing::new([0u8; 32]);
    let mut send_chain = Zeroizing::new([0u8; 32]);
    let mut recv_chain = Zeroizing::new([0u8; 32]);
    hkdf_sha512(xwing_ss, root_key, b"maxplus-pq-ratchet-root-v2", &mut *new_root)?;
    let (s_info, r_info) = if is_sender {
        (b"maxplus-pq-ratchet-s2r".as_slice(), b"maxplus-pq-ratchet-r2s".as_slice())
    } else {
        (b"maxplus-pq-ratchet-r2s".as_slice(), b"maxplus-pq-ratchet-s2r".as_slice())
    };
    hkdf_sha512(&*new_root, b"maxplus-pq-v2-salt", s_info, &mut *send_chain)?;
    hkdf_sha512(&*new_root, b"maxplus-pq-v2-salt", r_info, &mut *recv_chain)?;
    Ok((new_root, send_chain, recv_chain))
}

pub fn advance_recv_chain_to(
    recv_chain: &mut [u8; 32],
    current_counter: &mut u64,
    target_counter: u64,
    epoch: u32,
    skipped_keys: &mut HashMap<(u32, u64), [u8; 32]>,
) -> Result<Zeroizing<[u8; 32]>, String> {
    if target_counter < *current_counter {
        if let Some(k) = skipped_keys.remove(&(epoch, target_counter)) {
            return Ok(Zeroizing::new(k));
        }
        return Err("Message counter behind ratchet window or already consumed".into());
    }
    let delta = target_counter - *current_counter;
    if delta > MAX_SKIPPED_KEYS as u64 {
        return Err("Message counter jump exceeds max skipped key window".into());
    }
    while *current_counter < target_counter {
        let (next, skipped_msg_key) = step_chain_key(recv_chain)?;
        if skipped_keys.len() >= MAX_SKIPPED_KEYS {
            if let Some(oldest) = skipped_keys.keys().copied().min() {
                skipped_keys.remove(&oldest);
            }
        }
        skipped_keys.insert((epoch, *current_counter), *skipped_msg_key);
        *recv_chain = *next;
        *current_counter += 1;
    }
    let (next, msg_key) = step_chain_key(recv_chain)?;
    *recv_chain = *next;
    *current_counter += 1;
    Ok(msg_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pq_handshake_v2_and_ratchet_roundtrip() {
        let alice_bundle = generate_pq_keypair_bundle().unwrap();
        let bob_bundle = generate_pq_keypair_bundle().unwrap();

        let alice_xwing_pk = alice_bundle.xwing.public_key_bytes();
        let init_pkt = create_pq_handshake_init(
            &alice_bundle.ed_sk,
            &alice_bundle.ed_pk,
            &alice_xwing_pk,
            1700000000000,
        )
        .unwrap();

        let parsed_init = match parse_and_verify_handshake(&init_pkt).unwrap() {
            ParsedHandshake::Init(p) => p,
            _ => panic!("Expected Init"),
        };

        let (ct, bob_ss) = xwing_encapsulate(&parsed_init.xwing_pk).unwrap();
        let mac = compute_key_confirmation_mac(
            &bob_ss,
            &parsed_init.ed_pk,
            &parsed_init.xwing_pk,
            &bob_bundle.ed_pk,
            &ct,
        )
        .unwrap();
        let accept_pkt = create_pq_handshake_accept(
            &bob_bundle.ed_sk,
            &bob_bundle.ed_pk,
            &ct,
            1700000001000,
            &mac,
        )
        .unwrap();

        let parsed_accept = match parse_and_verify_handshake(&accept_pkt).unwrap() {
            ParsedHandshake::Accept(p) => p,
            _ => panic!("Expected Accept"),
        };

        let alice_ss = xwing_decapsulate(
            &alice_bundle.xwing.mlkem_sk,
            &alice_bundle.xwing.x_sk,
            &alice_bundle.xwing.x_pk,
            &parsed_accept.xwing_ct,
        )
        .unwrap();
        assert_eq!(*alice_ss, *bob_ss);
        assert!(verify_key_confirmation_mac(
            &alice_ss,
            &alice_bundle.ed_pk,
            &alice_xwing_pk,
            &parsed_accept.ed_pk,
            &parsed_accept.xwing_ct,
            &parsed_accept.confirm_mac,
        )
        .unwrap());

        let (_, mut alice_send, _) = derive_initial_ratchet_chains(&alice_ss, true).unwrap();
        let (_, _, mut bob_recv) = derive_initial_ratchet_chains(&bob_ss, false).unwrap();

        let (next_a, k0) = step_chain_key(&alice_send).unwrap();
        alice_send = next_a;
        let (next_a2, k1) = step_chain_key(&alice_send).unwrap();
        let _ = next_a2;

        let mut bob_counter = 0u64;
        let mut skipped = HashMap::new();
        let bob_k1 = advance_recv_chain_to(&mut bob_recv, &mut bob_counter, 1, 0, &mut skipped).unwrap();
        assert_eq!(*bob_k1, *k1);
        let bob_k0 = advance_recv_chain_to(&mut bob_recv, &mut bob_counter, 0, 0, &mut skipped).unwrap();
        assert_eq!(*bob_k0, *k0);
    }
}
