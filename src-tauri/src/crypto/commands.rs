use crate::crypto::asymmetric::{
    advance_recv_chain_to, compute_key_confirmation_mac, create_pq_handshake_accept,
    create_pq_handshake_init, derive_initial_ratchet_chains, generate_pq_keypair_bundle,
    parse_and_verify_handshake, ratchet_root_with_xwing, step_chain_key,
    verify_key_confirmation_mac, xwing_decapsulate, xwing_encapsulate, ParsedHandshake,
    XWingKeypair, XWING_CT_LEN, XWING_PK_LEN,
};
use crate::crypto::emoji::{derive_call_fingerprint, generate_fingerprint};
use crate::crypto::media::{
    decrypt_media_bytes_v2, encrypt_media_bytes_v2, MediaDescriptor, MediaEncryptAuth,
};
use crate::crypto::obfuscation::{DictionaryData, RussianObfuscator, WordsObfuscator};
use crate::crypto::protocol::{
    pack_message_v2, unpack_message_v2, PayloadData, PROTOCOL_VERSION_V2, V2SessionHeader,
};
use crate::stores::Storage;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, LazyLock, RwLock,
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IncomingMessageDto {
    pub id: Value,
    pub text: Option<String>,
    pub sender: Option<Value>,
    pub time: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DecryptedMessageDto {
    pub text: String,
    pub obf: Option<String>,
    pub is_encrypted: bool,
    pub media: Option<MediaDescriptor>,
    pub is_handshake_request: bool,
    pub is_handshake_accept: bool,
    pub handshake_data: Option<String>,
    pub error: Option<String>,
}

fn load_chat_settings_json(app: &AppHandle, account: u64, chat_id: i64) -> Value {
    crate::stores::get_chat_settings_sync(app, account, chat_id).unwrap_or_else(|_| {
        json!({
            "version": 1,
            "keys": {
                "current": null,
                "keys": [],
                "messages": []
            },
            "password": null,
            "obfs": null,
            "reader": true
        })
    })
}

fn save_chat_settings_json(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    data: &Value,
) -> Result<(), String> {
    crate::stores::save_chat_settings_raw_locked(app, account, chat_id, data)
}

fn get_active_session_key(settings: &Value) -> Option<[u8; 32]> {
    let hex_key = settings
        .get("session")
        .and_then(|s| s.get("shared_secret"))
        .and_then(|k| k.as_str())?;

    let bytes = hex::decode(hex_key).ok()?;
    if bytes.len() == 32 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Some(arr)
    } else {
        None
    }
}

fn get_all_session_keys(settings: &Value) -> Vec<[u8; 32]> {
    let mut list = Vec::new();
    if let Some(root_hex) = settings
        .get("session")
        .and_then(|s| s.get("root_key"))
        .and_then(|k| k.as_str())
    {
        if let Some(arr) = decode_hex_32(root_hex) {
            list.push(arr);
        }
    }
    if let Some(active) = get_active_session_key(settings) {
        if !list.contains(&active) {
            list.push(active);
        }
    }
    if let Some(keys_arr) = settings.get("keys").and_then(|k| k.get("keys")).and_then(|k| k.as_array()) {
        for entry in keys_arr {
            for field in ["root_key", "shared_secret"] {
                if let Some(hex_key) = entry.get(field).and_then(|s| s.as_str()) {
                    if let Some(arr) = decode_hex_32(hex_key) {
                        if !list.contains(&arr) {
                            list.push(arr);
                        }
                    }
                }
            }
        }
    }
    list
}

fn archive_current_session(settings: &mut Value, until_timestamp: i64) {
    if let Some(session) = settings.get("session").and_then(|s| s.as_object()).cloned() {
        crate::stores::archive_session_into_keys(&session, settings, until_timestamp);
    }
}


static DICTIONARY_CACHE: LazyLock<RwLock<Option<Arc<DictionaryData>>>> =
    LazyLock::new(|| RwLock::new(None));

struct StoredPqCallKey {
    mlkem_sk: Zeroizing<Vec<u8>>,
    x_sk: Zeroizing<[u8; 32]>,
    x_pk: [u8; 32],
}

static CALL_PQ_PENDING: LazyLock<RwLock<HashMap<u64, StoredPqCallKey>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));
static NEXT_CALL_PQ_HANDLE: AtomicU64 = AtomicU64::new(1);

fn decode_hex_32(hex_str: &str) -> Option<[u8; 32]> {
    let bytes = hex::decode(hex_str).ok()?;
    if bytes.len() == 32 {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Some(arr)
    } else {
        None
    }
}

fn decode_obfuscated_packet(
    raw_text: &str,
    dict_opt: Option<&DictionaryData>,
) -> Option<(Option<String>, Vec<u8>)> {
    if RussianObfuscator::detect(raw_text) {
        if let Ok(b) = RussianObfuscator::deobfuscate(raw_text) {
            return Some((Some("ru".into()), b));
        }
    }

    if let Some(dict) = dict_opt {
        if WordsObfuscator::detect(raw_text, dict) {
            if let Ok(b) = WordsObfuscator::deobfuscate(raw_text, dict) {
                return Some((Some("words".into()), b));
            }
        }
    }

    if let Ok(b) = STANDARD.decode(raw_text) {
        if !b.is_empty() && ((b[0] >> 6) & 0x03) == PROTOCOL_VERSION_V2 {
            return Some((None, b));
        }
    }

    None
}

fn handshake_dto_from_bytes(hs_bytes: &[u8], obf_name: Option<String>) -> DecryptedMessageDto {
    match parse_and_verify_handshake(hs_bytes) {
        Ok(parsed) => {
            let is_init = matches!(parsed, ParsedHandshake::Init(_));
            let notice_text = if is_init {
                "<b>Запрос на секретный чат</b>".to_string()
            } else {
                "<b>Секретный чат установлен</b>".to_string()
            };
            DecryptedMessageDto {
                text: notice_text,
                obf: obf_name,
                is_encrypted: true,
                media: None,
                is_handshake_request: is_init,
                is_handshake_accept: !is_init,
                handshake_data: Some(hex::encode(hs_bytes)),
                error: None,
            }
        }
        Err(e) => DecryptedMessageDto {
            text: "<b style=\"color:#f66\">Ошибка проверки рукопожатия</b>".into(),
            obf: obf_name,
            is_encrypted: true,
            media: None,
            is_handshake_request: false,
            is_handshake_accept: false,
            handshake_data: None,
            error: Some(e),
        },
    }
}

#[tauri::command]
pub fn verify_e2e_handshake_packet(bytes: Vec<u8>, chat_id: i64) -> Result<DecryptedMessageDto, String> {
    let payload = unpack_message_v2(&bytes, None, chat_id, |_| {
        Err("Expected unencrypted handshake packet".into())
    })?;
    match payload {
        PayloadData::Handshake(hs_bytes) => Ok(handshake_dto_from_bytes(&hs_bytes, None)),
        _ => Err("Not a handshake packet".into()),
    }
}

fn payload_to_dto(payload: PayloadData, obf_name: Option<String>) -> DecryptedMessageDto {
    match payload {
        PayloadData::Text(t) => DecryptedMessageDto {
            text: t,
            obf: obf_name,
            is_encrypted: true,
            media: None,
            is_handshake_request: false,
            is_handshake_accept: false,
            handshake_data: None,
            error: None,
        },
        PayloadData::Media { text, media } => DecryptedMessageDto {
            text,
            obf: obf_name,
            is_encrypted: true,
            media: Some(media),
            is_handshake_request: false,
            is_handshake_accept: false,
            handshake_data: None,
            error: None,
        },
        PayloadData::Handshake(hs_bytes) => handshake_dto_from_bytes(&hs_bytes, obf_name),
    }
}

fn prune_msg_keys_map(map: &mut serde_json::Map<String, Value>) {
    const MAX_CACHED_MSG_KEYS: usize = 1024;
    if map.len() > MAX_CACHED_MSG_KEYS {
        let excess = map.len() - MAX_CACHED_MSG_KEYS;
        let keys_to_remove: Vec<String> = map.keys().take(excess).cloned().collect();
        for k in keys_to_remove {
            map.remove(&k);
        }
    }
}

pub fn load_dictionary_data(app: &AppHandle) -> Option<Arc<DictionaryData>> {
    if let Ok(guard) = DICTIONARY_CACHE.read() {
        if let Some(ref d) = *guard {
            return Some(Arc::clone(d));
        }
    }

    let dict_path = app
        .path()
        .app_data_dir()
        .ok()?
        .join("data")
        .join("dictionary");
    let stored: Value = Storage::new(None).load(&dict_path)?;
    let data_val = stored.get("data")?;
    let mut parsed: DictionaryData = serde_json::from_value(data_val.clone()).ok()?;
    parsed.init_maps();
    let arc_data = Arc::new(parsed);

    if let Ok(mut guard) = DICTIONARY_CACHE.write() {
        *guard = Some(Arc::clone(&arc_data));
    }

    Some(arc_data)
}

pub fn invalidate_dictionary_cache() {
    if let Ok(mut guard) = DICTIONARY_CACHE.write() {
        *guard = None;
    }
}

fn resolve_key_in_active_session(
    sh: &V2SessionHeader,
    session: &mut Value,
    dirty: &mut bool,
) -> Result<[u8; 32], String> {
    let cache_key = format!("{}:{}:{}", sh.epoch, sh.sender_role, sh.counter);

    if let Some(hex_mk) = session
        .get("msg_keys")
        .and_then(|m| m.get(&cache_key))
        .and_then(|v| v.as_str())
    {
        if let Some(mk) = decode_hex_32(hex_mk) {
            return Ok(mk);
        }
    }

    let my_role = session.get("role").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
    if sh.sender_role == my_role {
        return Err("Outgoing message key not in local cache".into());
    }

    let mut cur_epoch = session
        .get("pq_epoch")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;

    if sh.epoch > cur_epoch {
        if sh.pq_rekey_bytes.len() != XWING_CT_LEN + XWING_PK_LEN {
            return Err("Missing PQ ratchet rekey payload for new epoch".into());
        }
        let ct = &sh.pq_rekey_bytes[..XWING_CT_LEN];
        let next_peer_pk = &sh.pq_rekey_bytes[XWING_CT_LEN..];

        let root_hex = session
            .get("root_key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing root_key for PQ ratchet".to_string())?;
        let root_key = decode_hex_32(root_hex).ok_or("Invalid root_key")?;
        let mlkem_sk_hex = session
            .get("my_ratchet_mlkem_sk")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing my_ratchet_mlkem_sk".to_string())?;
        let mlkem_sk = hex::decode(mlkem_sk_hex).map_err(|e| e.to_string())?;
        let x_sk_hex = session
            .get("my_ratchet_x_sk")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing my_ratchet_x_sk".to_string())?;
        let x_sk = decode_hex_32(x_sk_hex).ok_or("Invalid my_ratchet_x_sk")?;
        let x_pk_hex = session
            .get("my_ratchet_x_pk")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing my_ratchet_x_pk".to_string())?;
        let x_pk = decode_hex_32(x_pk_hex).ok_or("Invalid my_ratchet_x_pk")?;

        let pq_ss = xwing_decapsulate(&mlkem_sk, &x_sk, &x_pk, ct)?;
        let (new_root, new_send, new_recv) =
            ratchet_root_with_xwing(&root_key, &pq_ss, false)?;

        let old_recv_chain = session
            .get("recv_chain")
            .cloned()
            .unwrap_or(Value::Null);
        let old_recv_counter = session
            .get("recv_counter")
            .cloned()
            .unwrap_or(json!(0u64));
        session["prev_pq_epoch"] = json!(cur_epoch);
        session["prev_recv_chain"] = old_recv_chain;
        session["prev_recv_counter"] = old_recv_counter;

        session["root_key"] = json!(hex::encode(*new_root));
        session["send_chain"] = json!(hex::encode(*new_send));
        session["recv_chain"] = json!(hex::encode(*new_recv));
        session["send_counter"] = json!(0u64);
        session["recv_counter"] = json!(0u64);
        session["pq_epoch"] = json!(sh.epoch);
        session["peer_ratchet_xwing_pk"] = json!(hex::encode(next_peer_pk));
        cur_epoch = sh.epoch;
        *dirty = true;
    }

    if sh.epoch != cur_epoch {
        let prev_epoch = session
            .get("prev_pq_epoch")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        if prev_epoch == Some(sh.epoch) {
            let prev_chain_hex = session
                .get("prev_recv_chain")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing prev_recv_chain".to_string())?;
            let mut prev_chain =
                decode_hex_32(prev_chain_hex).ok_or("Invalid prev_recv_chain")?;
            let mut prev_counter = session
                .get("prev_recv_counter")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let mut skipped_map: HashMap<(u32, u64), [u8; 32]> = HashMap::new();
            let msg_key = advance_recv_chain_to(
                &mut prev_chain,
                &mut prev_counter,
                sh.counter,
                sh.epoch,
                &mut skipped_map,
            )?;
            session["prev_recv_chain"] = json!(hex::encode(prev_chain));
            session["prev_recv_counter"] = json!(prev_counter);
            if !session["msg_keys"].is_object() {
                session["msg_keys"] = json!({});
            }
            if let Some(mk_map) = session["msg_keys"].as_object_mut() {
                mk_map.insert(cache_key, json!(hex::encode(*msg_key)));
                prune_msg_keys_map(mk_map);
            }
            *dirty = true;
            return Ok(*msg_key);
        }
        return Err("Message epoch behind current ratchet state".into());
    }

    let recv_chain_hex = session
        .get("recv_chain")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Missing recv_chain".to_string())?;
    let mut recv_chain = decode_hex_32(recv_chain_hex).ok_or("Invalid recv_chain")?;
    let mut recv_counter = session
        .get("recv_counter")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let mut skipped_map: HashMap<(u32, u64), [u8; 32]> = HashMap::new();
    if let Some(obj) = session.get("skipped_keys").and_then(|v| v.as_object()) {
        for (k, v) in obj {
            if let (Some((ep_s, cnt_s)), Some(val_str)) = (k.split_once(':'), v.as_str()) {
                if let (Ok(ep), Ok(cnt), Some(key_bytes)) =
                    (ep_s.parse::<u32>(), cnt_s.parse::<u64>(), decode_hex_32(val_str))
                {
                    skipped_map.insert((ep, cnt), key_bytes);
                }
            }
        }
    }

    let msg_key = advance_recv_chain_to(
        &mut recv_chain,
        &mut recv_counter,
        sh.counter,
        cur_epoch,
        &mut skipped_map,
    )?;

    session["recv_chain"] = json!(hex::encode(recv_chain));
    session["recv_counter"] = json!(recv_counter);
    let skipped_json: serde_json::Map<String, Value> = skipped_map
        .into_iter()
        .map(|((ep, cnt), kb)| (format!("{ep}:{cnt}"), json!(hex::encode(kb))))
        .collect();
    session["skipped_keys"] = Value::Object(skipped_json);

    if !session["msg_keys"].is_object() {
        session["msg_keys"] = json!({});
    }
    if let Some(mk_map) = session["msg_keys"].as_object_mut() {
        mk_map.insert(cache_key, json!(hex::encode(*msg_key)));
        prune_msg_keys_map(mk_map);
    }
    *dirty = true;

    Ok(*msg_key)
}

fn try_decrypt_with_archived_keys(
    bytes: &[u8],
    effective_password: Option<&str>,
    chat_id: i64,
    archived_keys: &[Value],
) -> Option<PayloadData> {
    for item in archived_keys.iter().rev() {
        if let Ok(payload) = unpack_message_v2(bytes, effective_password, chat_id, |sh| {
            let cache_key = format!("{}:{}:{}", sh.epoch, sh.sender_role, sh.counter);
            let hex_mk = item
                .get("msg_keys")
                .and_then(|m| m.get(&cache_key))
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Not in archived msg_keys".to_string())?;
            decode_hex_32(hex_mk).ok_or_else(|| "Invalid archived key".to_string())
        }) {
            return Some(payload);
        }

        if let (Some(sec_hex), Some(role_u64)) = (
            item.get("shared_secret").and_then(|s| s.as_str()),
            item.get("role").and_then(|r| r.as_u64()),
        ) {
            if let Some(shared_secret) = decode_hex_32(sec_hex) {
                if let Ok(payload) = unpack_message_v2(bytes, effective_password, chat_id, |sh| {
                    if sh.epoch != 0 || sh.counter > 512 {
                        return Err("Counter out of fallback range".into());
                    }
                    let role = role_u64 as u8;
                    let (_, s_chain, r_chain) =
                        derive_initial_ratchet_chains(&shared_secret, role == 0)?;
                    let mut chain = if sh.sender_role == role { s_chain } else { r_chain };
                    let mut mk = [0u8; 32];
                    for _ in 0..=sh.counter {
                        let (next_chain, derived_mk) = step_chain_key(&chain)?;
                        chain = next_chain;
                        mk = *derived_mk;
                    }
                    Ok(mk)
                }) {
                    return Some(payload);
                }
            }
        }
    }
    None
}

fn decrypt_v2_packet_with_session(
    bytes: &[u8],
    obf_name: Option<String>,
    chat_id: i64,
    effective_password: Option<&str>,
    settings: &mut Value,
    settings_dirty: &mut bool,
) -> DecryptedMessageDto {
    let archived_keys = settings
        .get("keys")
        .and_then(|k| k.get("keys"))
        .and_then(|k| k.as_array())
        .cloned()
        .unwrap_or_default();

    let mut active_err: Option<String> = None;
    if let Some(active_session) = settings.get("session").cloned() {
        let mut staged_session = active_session;
        let mut staged_dirty = false;
        match unpack_message_v2(bytes, effective_password, chat_id, |sh| {
            resolve_key_in_active_session(sh, &mut staged_session, &mut staged_dirty)
        }) {
            Ok(payload) => {
                if staged_dirty {
                    settings["session"] = staged_session;
                    *settings_dirty = true;
                }
                return payload_to_dto(payload, obf_name);
            }
            Err(e) => {
                active_err = Some(e);
            }
        }
    }

    if let Some(payload) =
        try_decrypt_with_archived_keys(bytes, effective_password, chat_id, &archived_keys)
    {
        return payload_to_dto(payload, obf_name);
    }

    let err_msg = active_err.unwrap_or_else(|| "Session key required to decrypt this message".into());
    DecryptedMessageDto {
        text: format!("<b style=\"color:#f66\">Ошибка!</b> {err_msg}"),
        obf: obf_name,
        is_encrypted: true,
        media: None,
        is_handshake_request: false,
        is_handshake_accept: false,
        handshake_data: None,
        error: Some(err_msg),
    }
}

#[tauri::command]
pub async fn batch_decrypt_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    messages: Vec<IncomingMessageDto>,
    password: Option<String>,
) -> Result<HashMap<String, DecryptedMessageDto>, String> {
    crate::stores::with_chat_settings_lock(account, chat_id, || {
        let mut settings = load_chat_settings_json(&app, account, chat_id);
        let effective_password = password.or_else(|| {
            settings
                .get("password")
                .and_then(|p| p.as_str())
                .map(|s| s.to_string())
        });

        if let Some(pwd) = effective_password.as_deref() {
            let chat_salt = crate::crypto::protocol::derive_chat_salt(chat_id);
            let _ = crate::crypto::symmetric::derive_key(pwd, &chat_salt);
        }

        let dict_opt = load_dictionary_data(&app);
        let mut v2_messages: Vec<(String, Option<String>, Vec<u8>, i64)> = Vec::new();

        for msg in messages {
            let msg_id_str = match &msg.id {
                Value::Number(n) => n.to_string(),
                Value::String(s) => s.clone(),
                _ => continue,
            };
            let raw_text = match msg.text.as_deref() {
                Some(t) if !t.trim().is_empty() => t.trim(),
                _ => continue,
            };
            if let Some((obf_name, bytes)) = decode_obfuscated_packet(raw_text, dict_opt.as_deref()) {
                if !bytes.is_empty() && ((bytes[0] >> 6) & 0x03) == PROTOCOL_VERSION_V2 {
                    v2_messages.push((msg_id_str, obf_name, bytes, msg.time.unwrap_or(0)));
                }
            }
        }

        v2_messages.sort_by_key(|item| item.3);

        let mut results = HashMap::with_capacity(v2_messages.len());
        if !v2_messages.is_empty() {
            let mut settings_dirty = false;
            for (msg_id_str, obf_name, bytes, _) in v2_messages {
                let dto = decrypt_v2_packet_with_session(
                    &bytes,
                    obf_name,
                    chat_id,
                    effective_password.as_deref(),
                    &mut settings,
                    &mut settings_dirty,
                );
                results.insert(msg_id_str, dto);
            }
            if settings_dirty {
                let _ = save_chat_settings_json(&app, account, chat_id, &settings);
            }
        }

        Ok(results)
    })
}

#[tauri::command]
pub async fn encrypt_message(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    text: String,
    media: Option<MediaDescriptor>,
    password: Option<String>,
    use_session: bool,
    obf: Option<String>,
) -> Result<String, String> {
    crate::stores::with_chat_settings_lock(account, chat_id, || {
        let mut settings = load_chat_settings_json(&app, account, chat_id);
        let effective_password = password.or_else(|| {
            settings
                .get("password")
                .and_then(|p| p.as_str())
                .map(|s| s.to_string())
        });

        let payload = match media {
            Some(m) => PayloadData::Media { text, media: m },
            None => PayloadData::Text(text),
        };

        let packed = if use_session {
            let role = settings["session"]
                .get("role")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u8;
            let send_chain = match settings
                .get("session")
                .and_then(|s| s.get("send_chain"))
                .and_then(|v| v.as_str())
                .and_then(decode_hex_32)
            {
                Some(c) => c,
                None => {
                    let shared_hex = settings
                        .get("session")
                        .and_then(|s| s.get("shared_secret"))
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "Missing send_chain in session".to_string())?;
                    let shared_secret =
                        decode_hex_32(shared_hex).ok_or("Missing send_chain in session")?;
                    let (root_key, init_send, init_recv) =
                        derive_initial_ratchet_chains(&shared_secret, role == 0)?;
                    settings["session"]["version"] = json!(2);
                    settings["session"]["role"] = json!(role);
                    settings["session"]["root_key"] = json!(hex::encode(*root_key));
                    settings["session"]["send_chain"] = json!(hex::encode(*init_send));
                    settings["session"]["recv_chain"] = json!(hex::encode(*init_recv));
                    *init_send
                }
            };
            let epoch = settings["session"]
                .get("pq_epoch")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let counter = settings["session"]
                .get("send_counter")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);

            let (next_send_chain, msg_key) = step_chain_key(&send_chain)?;
            let header = V2SessionHeader {
                epoch,
                counter,
                sender_role: role,
                pq_rekey_bytes: Vec::new(),
            };
            let bytes = pack_message_v2(
                payload,
                Some(&*msg_key),
                Some(&header),
                effective_password.as_deref(),
                chat_id,
            )?;

            settings["session"]["send_chain"] = json!(hex::encode(*next_send_chain));
            settings["session"]["send_counter"] = json!(counter + 1);
            if !settings["session"]["msg_keys"].is_object() {
                settings["session"]["msg_keys"] = json!({});
            }
            if let Some(mk_map) = settings["session"]["msg_keys"].as_object_mut() {
                mk_map.insert(format!("{epoch}:{role}:{counter}"), json!(hex::encode(*msg_key)));
                prune_msg_keys_map(mk_map);
            }
            save_chat_settings_json(&app, account, chat_id, &settings)?;
            bytes
        } else {
            pack_message_v2(
                payload,
                None,
                None,
                effective_password.as_deref(),
                chat_id,
            )?
        };

        let target_obf = obf.or_else(|| {
            settings
                .get("obfs")
                .and_then(|o| o.as_str())
                .map(|s| s.to_string())
        });

        match target_obf.as_deref() {
            Some("ru") => Ok(RussianObfuscator::obfuscate(&packed)),
            Some("words") => {
                if packed.len() > 600 {
                    return Ok(RussianObfuscator::obfuscate(&packed));
                }
                let dict = load_dictionary_data(&app)
                    .ok_or_else(|| "Dictionary not loaded. Please download dictionary in settings.".to_string())?;
                let worded = WordsObfuscator::obfuscate(&packed, &dict)?;
                if worded.chars().count() > 3600 {
                    Ok(RussianObfuscator::obfuscate(&packed))
                } else {
                    Ok(worded)
                }
            }
            _ => Ok(STANDARD.encode(&packed)),
        }
    })
}

fn encode_handshake_output(
    app: &AppHandle,
    packed: &[u8],
    obf: Option<String>,
) -> Result<String, String> {
    let target_obf = obf.unwrap_or_else(|| "ru".into());
    if target_obf == "raw" || target_obf == "b64" {
        return Ok(STANDARD.encode(packed));
    }
    if target_obf == "words" && packed.len() <= 600 {
        if let Some(dict) = load_dictionary_data(app) {
            return WordsObfuscator::obfuscate(packed, &dict);
        }
    }
    Ok(RussianObfuscator::obfuscate(packed))
}

#[tauri::command]
pub async fn init_e2e_handshake(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    obf: Option<String>,
) -> Result<String, String> {
    crate::stores::with_chat_settings_lock(account, chat_id, || {
        let bundle = generate_pq_keypair_bundle()?;
        let xwing_pk = bundle.xwing.public_key_bytes();
        let timestamp = Utc::now().timestamp_millis();

        let mut settings = load_chat_settings_json(&app, account, chat_id);
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("e2e_declined");
        }
        settings["pending"] = json!({
            "version": 2,
            "ed_sk": hex::encode(*bundle.ed_sk),
            "ed_pk": hex::encode(bundle.ed_pk),
            "x_sk": hex::encode(*bundle.xwing.x_sk),
            "x_pk": hex::encode(bundle.xwing.x_pk),
            "mlkem_sk": hex::encode(&*bundle.xwing.mlkem_sk),
            "mlkem_pk": hex::encode(&bundle.xwing.mlkem_pk),
            "xwing_pk": hex::encode(&xwing_pk),
            "timestamp": timestamp
        });
        save_chat_settings_json(&app, account, chat_id, &settings)?;

        let hs_packet =
            create_pq_handshake_init(&bundle.ed_sk, &bundle.ed_pk, &xwing_pk, timestamp)?;
        let packed = pack_message_v2(PayloadData::Handshake(hs_packet), None, None, None, chat_id)?;

        encode_handshake_output(&app, &packed, obf)
    })
}

#[tauri::command]
pub async fn accept_e2e_handshake(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    handshake_data: String,
    obf: Option<String>,
) -> Result<String, String> {
    crate::stores::with_chat_settings_lock(account, chat_id, || {
        let hs_bytes = hex::decode(&handshake_data).map_err(|e| e.to_string())?;
        let parsed = parse_and_verify_handshake(&hs_bytes)?;
        let timestamp = Utc::now().timestamp_millis();
        let mut settings = load_chat_settings_json(&app, account, chat_id);

        match parsed {
            ParsedHandshake::Init(init) => {
                let my_bundle = generate_pq_keypair_bundle()?;
                let (xwing_ct, shared_secret) = xwing_encapsulate(&init.xwing_pk)?;
                let confirm_mac = compute_key_confirmation_mac(
                    &shared_secret,
                    &init.ed_pk,
                    &init.xwing_pk,
                    &my_bundle.ed_pk,
                    &xwing_ct,
                )?;
                let fingerprint = generate_fingerprint(&shared_secret);
                let (root_key, send_chain, recv_chain) =
                    derive_initial_ratchet_chains(&shared_secret, false)?;

                let peer_ed_hex = hex::encode(init.ed_pk);
                let prev_pinned = settings
                    .get("pinned_peer_ed_pk")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let peer_key_changed = prev_pinned
                    .as_deref()
                    .map(|prev| prev != peer_ed_hex)
                    .unwrap_or(false);
                settings["pinned_peer_ed_pk"] = json!(peer_ed_hex.clone());

                archive_current_session(&mut settings, timestamp);
                settings["session"] = json!({
                    "version": 2,
                    "role": 1,
                    "pq_epoch": 0,
                    "send_counter": 0,
                    "recv_counter": 0,
                    "shared_secret": hex::encode(*shared_secret),
                    "root_key": hex::encode(*root_key),
                    "send_chain": hex::encode(*send_chain),
                    "recv_chain": hex::encode(*recv_chain),
                    "fingerprint": fingerprint,
                    "peer_ed_pk": peer_ed_hex,
                    "peer_key_changed": peer_key_changed,
                    "my_ed_pk": hex::encode(my_bundle.ed_pk),
                    "msg_keys": {},
                    "skipped_keys": {},
                    "established_at": timestamp
                });
                settings["keys"]["current"] = json!(1);
                if let Some(o) = settings.as_object_mut() {
                    o.remove("pending");
                    o.remove("e2e_declined");
                }
                save_chat_settings_json(&app, account, chat_id, &settings)?;

                let hs_packet = create_pq_handshake_accept(
                    &my_bundle.ed_sk,
                    &my_bundle.ed_pk,
                    &xwing_ct,
                    timestamp,
                    &confirm_mac,
                )?;
                let packed =
                    pack_message_v2(PayloadData::Handshake(hs_packet), None, None, None, chat_id)?;
                encode_handshake_output(&app, &packed, obf)
            }
            ParsedHandshake::Accept(_) => {
                Err("Cannot accept a handshake accept packet".into())
            }
        }
    })
}

#[tauri::command]
pub async fn process_e2e_accept(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    handshake_data: String,
) -> Result<String, String> {
    crate::stores::with_chat_settings_lock(account, chat_id, || {
        let mut settings = load_chat_settings_json(&app, account, chat_id);

        let existing_fingerprint = settings
            .get("session")
            .and_then(|s| s.get("fingerprint"))
            .and_then(|f| f.as_str())
            .map(|s| s.to_string());

        if let Some(ref fp) = existing_fingerprint {
            if settings.get("session").and_then(|s| s.get("shared_secret")).is_some()
                && settings.get("pending").is_none()
            {
                return Ok(fp.clone());
            }
        }

        let pending = settings.get("pending").cloned();
        let pending = match pending {
            Some(p) => p,
            None => {
                if let Some(fp) = existing_fingerprint {
                    return Ok(fp);
                }
                return Err("Missing pending handshake state".to_string());
            }
        };

        let hs_bytes = hex::decode(&handshake_data).map_err(|e| e.to_string())?;
        let parsed = parse_and_verify_handshake(&hs_bytes)?;
        let timestamp = Utc::now().timestamp_millis();

        match parsed {
            ParsedHandshake::Accept(accept) => {
                let mlkem_sk_hex = pending
                    .get("mlkem_sk")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing pending mlkem_sk".to_string())?;
                let mlkem_sk = hex::decode(mlkem_sk_hex).map_err(|e| e.to_string())?;
                let x_sk_hex = pending
                    .get("x_sk")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing pending x_sk".to_string())?;
                let my_x_sk = decode_hex_32(x_sk_hex).ok_or("Invalid pending x_sk")?;
                let x_pk_hex = pending
                    .get("x_pk")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing pending x_pk".to_string())?;
                let my_x_pk = decode_hex_32(x_pk_hex).ok_or("Invalid pending x_pk")?;
                let my_ed_pk_hex = pending
                    .get("ed_pk")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing pending ed_pk".to_string())?;
                let my_ed_pk = decode_hex_32(my_ed_pk_hex).ok_or("Invalid pending ed_pk")?;
                let my_xwing_pk_hex = pending
                    .get("xwing_pk")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing pending xwing_pk".to_string())?;
                let my_xwing_pk = hex::decode(my_xwing_pk_hex).map_err(|e| e.to_string())?;

                let shared_secret =
                    xwing_decapsulate(&mlkem_sk, &my_x_sk, &my_x_pk, &accept.xwing_ct)?;

                let mac_ok = verify_key_confirmation_mac(
                    &shared_secret,
                    &my_ed_pk,
                    &my_xwing_pk,
                    &accept.ed_pk,
                    &accept.xwing_ct,
                    &accept.confirm_mac,
                )?;
                if !mac_ok {
                    return Err("Post-quantum handshake key confirmation MAC failed".into());
                }

                let fingerprint = generate_fingerprint(&shared_secret);
                let (root_key, send_chain, recv_chain) =
                    derive_initial_ratchet_chains(&shared_secret, true)?;

                let peer_ed_hex = hex::encode(accept.ed_pk);
                let prev_pinned = settings
                    .get("pinned_peer_ed_pk")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let peer_key_changed = prev_pinned
                    .as_deref()
                    .map(|prev| prev != peer_ed_hex)
                    .unwrap_or(false);
                settings["pinned_peer_ed_pk"] = json!(peer_ed_hex.clone());

                archive_current_session(&mut settings, timestamp);
                settings["session"] = json!({
                    "version": 2,
                    "role": 0,
                    "pq_epoch": 0,
                    "send_counter": 0,
                    "recv_counter": 0,
                    "shared_secret": hex::encode(*shared_secret),
                    "root_key": hex::encode(*root_key),
                    "send_chain": hex::encode(*send_chain),
                    "recv_chain": hex::encode(*recv_chain),
                    "fingerprint": fingerprint.clone(),
                    "peer_ed_pk": peer_ed_hex,
                    "peer_key_changed": peer_key_changed,
                    "msg_keys": {},
                    "skipped_keys": {},
                    "established_at": timestamp
                });
                settings["keys"]["current"] = json!(1);
                if let Some(o) = settings.as_object_mut() {
                    o.remove("pending");
                    o.remove("e2e_declined");
                }
                save_chat_settings_json(&app, account, chat_id, &settings)?;
                Ok(fingerprint)
            }
            ParsedHandshake::Init(_) => Err("Expected handshake accept packet, got init".into()),
        }
    })
}

#[tauri::command]
pub async fn disable_e2e_session(
    app: AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<Value, String> {
    crate::stores::with_chat_settings_lock(account, chat_id, || {
        let mut settings = load_chat_settings_json(&app, account, chat_id);
        let timestamp = Utc::now().timestamp_millis();
        archive_current_session(&mut settings, timestamp);
        if settings.get("keys").map_or(false, |k| k.is_object()) {
            settings["keys"]["current"] = json!(null);
        }
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("session");
            obj.remove("pending");
            obj.remove("e2e_declined");
        }
        save_chat_settings_json(&app, account, chat_id, &settings)?;
        Ok(settings)
    })
}

#[tauri::command]
pub async fn get_chat_encryption_info(
    app: AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<Value, String> {
    let settings = load_chat_settings_json(&app, account, chat_id);
    let has_session = settings.get("session").is_some();
    let has_pwd = settings
        .get("password")
        .and_then(|p| p.as_str())
        .map_or(false, |s| !s.trim().is_empty());
    let fingerprint = settings
        .get("session")
        .and_then(|s| s.get("fingerprint"))
        .and_then(|f| f.as_str())
        .map(|s| s.to_string());
    let is_pq = settings
        .get("session")
        .and_then(|s| s.get("version"))
        .and_then(|v| v.as_u64())
        .map(|v| v >= 2)
        .unwrap_or(false);
    let peer_key_changed = settings
        .get("session")
        .and_then(|s| s.get("peer_key_changed"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let has_pending = settings.get("pending").is_some();

    Ok(json!({
        "active": has_session || has_pwd,
        "fingerprint": fingerprint,
        "pending": has_pending,
        "pq": is_pq,
        "peerKeyChanged": peer_key_changed
    }))
}

#[tauri::command]
pub fn get_call_encryption_fingerprint(
    dh_secret: Option<String>,
    password: Option<String>,
) -> Result<Option<String>, String> {
    Ok(derive_call_fingerprint(dh_secret.as_deref(), password.as_deref()))
}

#[tauri::command]
pub async fn make_dictionary(app: AppHandle, text: Value) -> Result<Value, String> {
    let text_str = match text {
        Value::String(s) => s,
        Value::Array(arr) => {
            let bytes: Vec<u8> = arr
                .into_iter()
                .filter_map(|v| v.as_u64().map(|b| b as u8))
                .collect();
            String::from_utf8_lossy(&bytes).to_string()
        }
        _ => return Err("Invalid dictionary text input".into()),
    };

    let dict = WordsObfuscator::build_dictionary(&text_str)?;
    let val = serde_json::to_value(&dict).map_err(|e| e.to_string())?;

    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("data")
        .join("dictionary");

    let mut store = Storage::new(None)
        .load(&path)
        .unwrap_or_else(|| json!({ "url": null, "data": null }));
    store["data"] = val.clone();
    Storage::new(None).save(&path, &store)?;
    invalidate_dictionary_cache();

    Ok(val)
}

fn get_media_auth<'a>(
    settings: &'a Value,
    password_arg: Option<&'a str>,
    session_key_slot: &'a mut Option<[u8; 32]>,
) -> MediaEncryptAuth<'a> {
    let active = settings
        .get("session")
        .and_then(|s| s.get("root_key"))
        .and_then(|k| k.as_str())
        .and_then(decode_hex_32)
        .or_else(|| get_active_session_key(settings));

    if let Some(sk) = active {
        *session_key_slot = Some(sk);
        return MediaEncryptAuth::Session(session_key_slot.as_ref().unwrap());
    }

    let effective_password = password_arg.or_else(|| {
        settings
            .get("password")
            .and_then(|p| p.as_str())
            .filter(|s| !s.trim().is_empty())
    });

    if let Some(pwd) = effective_password {
        return MediaEncryptAuth::Password(pwd);
    }

    MediaEncryptAuth::ObfuscationOnly
}

#[tauri::command]
pub async fn encrypt_media_file(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    file_path: String,
    dummy_type: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    let settings = load_chat_settings_json(&app, account, chat_id);
    let mut sk_slot = None;
    let auth = get_media_auth(&settings, password.as_deref(), &mut sk_slot);

    let raw_bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let dummy = dummy_type.as_deref().unwrap_or("pdf");
    let encrypted = encrypt_media_bytes_v2(&raw_bytes, auth, dummy)?;

    let ext = match dummy {
        "docx" => "docx",
        "xlsx" => "xlsx",
        "mp3" => "mp3",
        "ogg" => "ogg",
        _ => "pdf",
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("encrypted_outgoing");
    let _ = fs::create_dir_all(&cache_dir);
    let rand_id = uuid::Uuid::new_v4().to_string();
    let out_path = cache_dir.join(format!("{}.{}", rand_id, ext));
    fs::write(&out_path, encrypted).map_err(|e| e.to_string())?;

    Ok(out_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn decrypt_media_file(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    file_path: String,
    out_path: Option<String>,
    target_path: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    let effective_out = out_path
        .or(target_path)
        .ok_or_else(|| "Missing out_path or target_path".to_string())?;

    let settings = load_chat_settings_json(&app, account, chat_id);
    let session_keys = get_all_session_keys(&settings);
    let effective_password = password.or_else(|| {
        settings
            .get("password")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
    });

    let encrypted_bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let decrypted = tokio::task::spawn_blocking(move || {
        decrypt_media_bytes_v2(&encrypted_bytes, &session_keys, effective_password.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(parent) = Path::new(&effective_out).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&effective_out, decrypted).map_err(|e| e.to_string())?;

    if file_path.ends_with(".enc") {
        let _ = fs::remove_file(&file_path);
    }

    Ok(effective_out)
}

#[tauri::command]
pub async fn cache_encrypted_media(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    file_id: u64,
    src: String,
    password: Option<String>,
    media_type: Option<String>,
) -> Result<String, String> {
    let cache_key = format!("enc_media_{}", file_id);

    if let Ok(Some(existing)) = crate::stores::get_cached_file_sync(&app, account, &cache_key) {
        if Path::new(&existing).exists() {
            return Ok(existing);
        }
    }

    let encrypted_bytes = if src.starts_with("http://") || src.starts_with("https://") {
        let client = rumax::shared_http_client();
        let resp = client.get(&src)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }
        resp.bytes().await.map_err(|e| e.to_string())?.to_vec()
    } else {
        fs::read(&src).map_err(|e| e.to_string())?
    };

    let settings = load_chat_settings_json(&app, account, chat_id);
    let session_keys = get_all_session_keys(&settings);
    let effective_password = password.or_else(|| {
        settings
            .get("password")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
    });

    let decrypted = tokio::task::spawn_blocking(move || {
        decrypt_media_bytes_v2(&encrypted_bytes, &session_keys, effective_password.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;

    let path = crate::stores::set_cached_file_with_meta(
        app.clone(),
        account,
        cache_key.clone(),
        decrypted.clone(),
        Some(chat_id),
        media_type.clone(),
    )?;

    let size_kb = (decrypted.len() + 1023) / 1024;
    let _ = crate::stores::add_cache_index_alias(app, account, src, path.clone(), size_kb, Some(chat_id), media_type);

    Ok(path)
}

#[tauri::command]
pub async fn register_media_cache(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    file_id: u64,
    local_path: String,
    media_type: Option<String>,
) -> Result<String, String> {
    let cache_key = format!("enc_media_{}", file_id);
    let bytes = fs::read(&local_path).map_err(|e| e.to_string())?;
    crate::stores::set_cached_file_with_meta(
        app,
        account,
        cache_key,
        bytes,
        Some(chat_id),
        media_type,
    )
}

#[tauri::command]
pub fn generate_call_pq_keypair() -> Result<Value, String> {
    let kp = XWingKeypair::generate()?;
    let pk_hex = hex::encode(kp.public_key_bytes());
    let handle_id = NEXT_CALL_PQ_HANDLE.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut guard) = CALL_PQ_PENDING.write() {
        if guard.len() > 64 {
            guard.clear();
        }
        guard.insert(
            handle_id,
            StoredPqCallKey {
                mlkem_sk: kp.mlkem_sk,
                x_sk: kp.x_sk,
                x_pk: kp.x_pk,
            },
        );
    }
    Ok(json!({
        "handleId": handle_id,
        "pkHex": pk_hex
    }))
}

#[tauri::command]
pub fn encapsulate_call_pq(peer_pk_hex: String) -> Result<Value, String> {
    let peer_pk = hex::decode(&peer_pk_hex).map_err(|e| e.to_string())?;
    let (ct, ss) = xwing_encapsulate(&peer_pk)?;
    Ok(json!({
        "ctHex": hex::encode(ct),
        "ssHex": hex::encode(*ss)
    }))
}

#[tauri::command]
pub fn decapsulate_call_pq(handle_id: u64, ct_hex: String) -> Result<String, String> {
    let ct = hex::decode(&ct_hex).map_err(|e| e.to_string())?;
    let stored = CALL_PQ_PENDING
        .write()
        .map_err(|_| "Call PQ lock poisoned".to_string())?
        .remove(&handle_id)
        .ok_or_else(|| "Call PQ key handle not found or already consumed".to_string())?;
    let ss = xwing_decapsulate(&stored.mlkem_sk, &stored.x_sk, &stored.x_pk, &ct)?;
    Ok(hex::encode(*ss))
}
