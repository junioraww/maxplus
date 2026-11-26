use crate::crypto::asymmetric::{
    advance_recv_chain_to, compute_key_confirmation_mac, compute_shared_secret,
    create_handshake_accept, create_pq_handshake_accept,
    create_pq_handshake_init, derive_initial_ratchet_chains, generate_keypair_bundle,
    generate_pq_keypair_bundle, parse_and_verify_handshake_any, ratchet_root_with_xwing,
    step_chain_key, verify_key_confirmation_mac, xwing_decapsulate, xwing_encapsulate,
    ParsedHandshakeAny, XWingKeypair, PQ_RATCHET_INTERVAL, XWING_CT_LEN, XWING_PK_LEN,
};
use crate::crypto::emoji::{derive_call_fingerprint, generate_fingerprint};
use crate::crypto::media::{
    decrypt_media_bytes_v2, encrypt_media_bytes_v2, MediaDescriptor, MediaEncryptAuth,
};
use crate::crypto::obfuscation::{ChineseObfuscator, DictionaryData, WordsObfuscator};
use crate::crypto::protocol::{
    pack_message, pack_message_v2, unpack_message, unpack_message_v2, PayloadData,
    PROTOCOL_VERSION, PROTOCOL_VERSION_V2, V2SessionHeader,
};
use crate::stores::Storage;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use futures_util::future::join_all;
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
    crate::stores::set_chat_settings_sync(app, account, chat_id, data.clone())
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
    if let Some(session) = settings.get("session").cloned() {
        if let Some(secret) = session.get("shared_secret").and_then(|s| s.as_str()) {
            if !secret.is_empty() {
                let from_ts = session.get("established_at").and_then(|t| t.as_i64()).unwrap_or(0);
                let fp = session.get("fingerprint").and_then(|f| f.as_str()).unwrap_or("");
                if settings.get("keys").is_none() || !settings["keys"].is_object() {
                    settings["keys"] = json!({
                        "current": null,
                        "keys": [],
                        "messages": []
                    });
                }
                let keys_arr = settings["keys"].get_mut("keys").and_then(|k| k.as_array_mut());
                let entry = json!({
                    "shared_secret": secret,
                    "fingerprint": fp,
                    "message_from": from_ts,
                    "message_until": until_timestamp,
                });
                if let Some(arr) = keys_arr {
                    let mut exists = false;
                    for item in arr.iter_mut() {
                        if item.get("shared_secret").and_then(|s| s.as_str()) == Some(secret) {
                            if let Some(obj) = item.as_object_mut() {
                                obj.insert("message_until".into(), json!(until_timestamp));
                            }
                            exists = true;
                            break;
                        }
                    }
                    if !exists {
                        arr.push(entry);
                    }
                } else {
                    settings["keys"]["keys"] = json!([entry]);
                }
            }
        }
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
    if ChineseObfuscator::detect(raw_text) {
        if let Ok(b) = ChineseObfuscator::deobfuscate(raw_text) {
            return Some((Some("zh".into()), b));
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
        if !b.is_empty() && ((b[0] >> 6) == PROTOCOL_VERSION || (b[0] >> 6) == PROTOCOL_VERSION_V2)
        {
            return Some((None, b));
        }
    }

    None
}

fn handshake_dto_from_bytes(hs_bytes: &[u8], obf_name: Option<String>) -> DecryptedMessageDto {
    match parse_and_verify_handshake_any(hs_bytes) {
        Ok(parsed) => {
            let is_init = matches!(
                parsed,
                ParsedHandshakeAny::V1(ref p) if p.subtype == 0x01
            ) || matches!(parsed, ParsedHandshakeAny::V2Init(_));
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

#[tauri::command]
fn decrypt_single_message_dto(
    msg: IncomingMessageDto,
    session_keys: &[[u8; 32]],
    effective_password: Option<&str>,
    dict_opt: Option<&DictionaryData>,
) -> Option<(String, DecryptedMessageDto)> {
    let msg_id_str = match &msg.id {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };

    let raw_text = match msg.text.as_deref() {
        Some(t) if !t.trim().is_empty() => t.trim(),
        _ => return None,
    };

    let (obf_name, bytes) = decode_obfuscated_packet(raw_text, dict_opt)?;

    let mut unpacked_res = None;
    for k in session_keys {
        if let Ok(payload) = unpack_message(&bytes, Some(k), effective_password) {
            unpacked_res = Some(Ok(payload));
            break;
        }
    }

    if unpacked_res.is_none() {
        if let Ok(payload) = unpack_message(&bytes, None, effective_password) {
            unpacked_res = Some(Ok(payload));
        } else if let Some(first_key) = session_keys.first() {
            unpacked_res = Some(unpack_message(&bytes, Some(first_key), effective_password));
        } else {
            unpacked_res = Some(unpack_message(&bytes, None, effective_password));
        }
    }

    let dto = match unpacked_res.unwrap() {
        Ok(payload) => payload_to_dto(payload, obf_name),
        Err(e) => DecryptedMessageDto {
            text: format!("<b style=\"color:#f66\">Ошибка!</b> {e}"),
            obf: obf_name,
            is_encrypted: true,
            media: None,
            is_handshake_request: false,
            is_handshake_accept: false,
            handshake_data: None,
            error: Some(e),
        },
    };

    Some((msg_id_str, dto))
}

fn decrypt_v2_packet_with_session(
    bytes: &[u8],
    obf_name: Option<String>,
    chat_id: i64,
    effective_password: Option<&str>,
    settings: &mut Value,
    settings_dirty: &mut bool,
) -> DecryptedMessageDto {
    let session_obj = settings.get("session").cloned();
    let res = unpack_message_v2(bytes, effective_password, chat_id, |sh| {
        let s_obj = session_obj
            .as_ref()
            .ok_or_else(|| "Session key required to decrypt this message".to_string())?;
        let cache_key = format!("{}:{}:{}", sh.epoch, sh.sender_role, sh.counter);

        if let Some(hex_mk) = settings
            .get("session")
            .and_then(|s| s.get("msg_keys"))
            .and_then(|m| m.get(&cache_key))
            .and_then(|v| v.as_str())
        {
            if let Some(mk) = decode_hex_32(hex_mk) {
                return Ok(mk);
            }
        }

        let my_role = s_obj.get("role").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
        if sh.sender_role == my_role {
            return Err("Outgoing message key not in local cache".into());
        }

        let mut cur_epoch = settings["session"]
            .get("pq_epoch")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        if sh.epoch > cur_epoch {
            if sh.pq_rekey_bytes.len() != XWING_CT_LEN + XWING_PK_LEN {
                return Err("Missing PQ ratchet rekey payload for new epoch".into());
            }
            let ct = &sh.pq_rekey_bytes[..XWING_CT_LEN];
            let next_peer_pk = &sh.pq_rekey_bytes[XWING_CT_LEN..];

            let root_hex = settings["session"]
                .get("root_key")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing root_key for PQ ratchet".to_string())?;
            let root_key = decode_hex_32(root_hex).ok_or("Invalid root_key")?;
            let mlkem_sk_hex = settings["session"]
                .get("my_ratchet_mlkem_sk")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing my_ratchet_mlkem_sk".to_string())?;
            let mlkem_sk = hex::decode(mlkem_sk_hex).map_err(|e| e.to_string())?;
            let x_sk_hex = settings["session"]
                .get("my_ratchet_x_sk")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing my_ratchet_x_sk".to_string())?;
            let x_sk = decode_hex_32(x_sk_hex).ok_or("Invalid my_ratchet_x_sk")?;
            let x_pk_hex = settings["session"]
                .get("my_ratchet_x_pk")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing my_ratchet_x_pk".to_string())?;
            let x_pk = decode_hex_32(x_pk_hex).ok_or("Invalid my_ratchet_x_pk")?;

            let pq_ss = xwing_decapsulate(&mlkem_sk, &x_sk, &x_pk, ct)?;
            let (new_root, new_send, new_recv) =
                ratchet_root_with_xwing(&root_key, &pq_ss, false)?;

            let old_recv_chain = settings["session"]
                .get("recv_chain")
                .cloned()
                .unwrap_or(Value::Null);
            let old_recv_counter = settings["session"]
                .get("recv_counter")
                .cloned()
                .unwrap_or(json!(0u64));
            settings["session"]["prev_pq_epoch"] = json!(cur_epoch);
            settings["session"]["prev_recv_chain"] = old_recv_chain;
            settings["session"]["prev_recv_counter"] = old_recv_counter;

            settings["session"]["root_key"] = json!(hex::encode(*new_root));
            settings["session"]["send_chain"] = json!(hex::encode(*new_send));
            settings["session"]["recv_chain"] = json!(hex::encode(*new_recv));
            settings["session"]["send_counter"] = json!(0u64);
            settings["session"]["recv_counter"] = json!(0u64);
            settings["session"]["pq_epoch"] = json!(sh.epoch);
            settings["session"]["peer_ratchet_xwing_pk"] = json!(hex::encode(next_peer_pk));
            cur_epoch = sh.epoch;
            *settings_dirty = true;
        }

        if sh.epoch != cur_epoch {
            let prev_epoch = settings["session"]
                .get("prev_pq_epoch")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            if prev_epoch == Some(sh.epoch) {
                let prev_chain_hex = settings["session"]
                    .get("prev_recv_chain")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Missing prev_recv_chain".to_string())?;
                let mut prev_chain =
                    decode_hex_32(prev_chain_hex).ok_or("Invalid prev_recv_chain")?;
                let mut prev_counter = settings["session"]
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
                settings["session"]["prev_recv_chain"] = json!(hex::encode(prev_chain));
                settings["session"]["prev_recv_counter"] = json!(prev_counter);
                if !settings["session"]["msg_keys"].is_object() {
                    settings["session"]["msg_keys"] = json!({});
                }
                if let Some(mk_map) = settings["session"]["msg_keys"].as_object_mut() {
                    mk_map.insert(cache_key, json!(hex::encode(*msg_key)));
                    prune_msg_keys_map(mk_map);
                }
                *settings_dirty = true;
                return Ok(*msg_key);
            }
            return Err("Message epoch behind current ratchet state".into());
        }

        let recv_chain_hex = settings["session"]
            .get("recv_chain")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing recv_chain".to_string())?;
        let mut recv_chain = decode_hex_32(recv_chain_hex).ok_or("Invalid recv_chain")?;
        let mut recv_counter = settings["session"]
            .get("recv_counter")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        let mut skipped_map: HashMap<(u32, u64), [u8; 32]> = HashMap::new();
        if let Some(obj) = settings["session"]
            .get("skipped_keys")
            .and_then(|v| v.as_object())
        {
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

        settings["session"]["recv_chain"] = json!(hex::encode(recv_chain));
        settings["session"]["recv_counter"] = json!(recv_counter);
        let skipped_json: serde_json::Map<String, Value> = skipped_map
            .into_iter()
            .map(|((ep, cnt), kb)| (format!("{ep}:{cnt}"), json!(hex::encode(kb))))
            .collect();
        settings["session"]["skipped_keys"] = Value::Object(skipped_json);

        if !settings["session"]["msg_keys"].is_object() {
            settings["session"]["msg_keys"] = json!({});
        }
        if let Some(mk_map) = settings["session"]["msg_keys"].as_object_mut() {
            mk_map.insert(cache_key, json!(hex::encode(*msg_key)));
            prune_msg_keys_map(mk_map);
        }
        *settings_dirty = true;

        Ok(*msg_key)
    });

    match res {
        Ok(payload) => payload_to_dto(payload, obf_name),
        Err(e) => DecryptedMessageDto {
            text: format!("<b style=\"color:#f66\">Ошибка!</b> {e}"),
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
pub async fn batch_decrypt_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    messages: Vec<IncomingMessageDto>,
    password: Option<String>,
) -> Result<HashMap<String, DecryptedMessageDto>, String> {
    let mut settings = load_chat_settings_json(&app, account, chat_id);
    let session_keys = Arc::new(get_all_session_keys(&settings));
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
    let effective_password = Arc::new(effective_password);

    let mut v1_messages = Vec::new();
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
                continue;
            }
        }
        v1_messages.push(msg);
    }

    v2_messages.sort_by_key(|item| item.3);

    let tasks: Vec<_> = v1_messages
        .into_iter()
        .map(|msg| {
            let session_keys = session_keys.clone();
            let effective_password = effective_password.clone();
            let dict_opt = dict_opt.clone();
            tokio::task::spawn_blocking(move || {
                decrypt_single_message_dto(
                    msg,
                    session_keys.as_ref(),
                    effective_password.as_deref(),
                    dict_opt.as_deref(),
                )
            })
        })
        .collect();

    let results_vec = join_all(tasks).await;

    let mut results = HashMap::with_capacity(results_vec.len() + v2_messages.len());
    for res in results_vec {
        if let Ok(Some((msg_id_str, dto))) = res {
            results.insert(msg_id_str, dto);
        }
    }

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

    let session_version = settings
        .get("session")
        .and_then(|s| s.get("version"))
        .and_then(|v| v.as_u64())
        .unwrap_or(1);

    let packed = if use_session && session_version >= 2 {
        let send_chain_hex = settings
            .get("session")
            .and_then(|s| s.get("send_chain"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing send_chain in v2 session".to_string())?
            .to_string();
        let send_chain = decode_hex_32(&send_chain_hex).ok_or("Invalid send_chain")?;
        let mut epoch = settings["session"]
            .get("pq_epoch")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let mut counter = settings["session"]
            .get("send_counter")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let role = settings["session"]
            .get("role")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u8;

        let mut pq_rekey_bytes = Vec::new();
        let active_send_chain = if counter >= PQ_RATCHET_INTERVAL {
            if let Some(peer_ratchet_pk_hex) = settings["session"]
                .get("peer_ratchet_xwing_pk")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
            {
                if let Ok(peer_ratchet_pk) = hex::decode(&peer_ratchet_pk_hex) {
                    if peer_ratchet_pk.len() == XWING_PK_LEN {
                        let root_hex = settings["session"]
                            .get("root_key")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| "Missing root_key".to_string())?
                            .to_string();
                        let root_key = decode_hex_32(&root_hex).ok_or("Invalid root_key")?;
                        let (ct, pq_ss) = xwing_encapsulate(&peer_ratchet_pk)?;
                        let next_kp = XWingKeypair::generate()?;
                        let next_pk = next_kp.public_key_bytes();
                        let (new_root, new_send, new_recv) =
                            ratchet_root_with_xwing(&root_key, &pq_ss, true)?;

                        epoch = epoch.wrapping_add(1);
                        counter = 0;
                        pq_rekey_bytes.extend_from_slice(&ct);
                        pq_rekey_bytes.extend_from_slice(&next_pk);

                        let old_recv_chain = settings["session"]
                            .get("recv_chain")
                            .cloned()
                            .unwrap_or(Value::Null);
                        let old_recv_counter = settings["session"]
                            .get("recv_counter")
                            .cloned()
                            .unwrap_or(json!(0u64));
                        settings["session"]["prev_pq_epoch"] = json!(epoch.saturating_sub(1));
                        settings["session"]["prev_recv_chain"] = old_recv_chain;
                        settings["session"]["prev_recv_counter"] = old_recv_counter;

                        settings["session"]["root_key"] = json!(hex::encode(*new_root));
                        settings["session"]["recv_chain"] = json!(hex::encode(*new_recv));
                        settings["session"]["recv_counter"] = json!(0u64);
                        settings["session"]["pq_epoch"] = json!(epoch);
                        settings["session"]["my_ratchet_mlkem_sk"] =
                            json!(hex::encode(&*next_kp.mlkem_sk));
                        settings["session"]["my_ratchet_x_sk"] = json!(hex::encode(&*next_kp.x_sk));
                        settings["session"]["my_ratchet_x_pk"] = json!(hex::encode(next_kp.x_pk));
                        if let Some(obj) = settings["session"].as_object_mut() {
                            obj.remove("peer_ratchet_xwing_pk");
                        }
                        *new_send
                    } else {
                        send_chain
                    }
                } else {
                    send_chain
                }
            } else {
                send_chain
            }
        } else {
            send_chain
        };

        let (next_send_chain, msg_key) = step_chain_key(&active_send_chain)?;
        let header = V2SessionHeader {
            epoch,
            counter,
            sender_role: role,
            pq_rekey_bytes,
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
    } else if use_session {
        let session_key = get_active_session_key(&settings);
        pack_message(
            payload,
            session_key.as_ref(),
            effective_password.as_deref(),
            Some(chat_id),
        )?
    } else if effective_password.is_some() {
        pack_message_v2(
            payload,
            None,
            None,
            effective_password.as_deref(),
            chat_id,
        )?
    } else {
        pack_message(payload, None, None, Some(chat_id))?
    };

    let target_obf = obf.or_else(|| {
        settings
            .get("obfs")
            .and_then(|o| o.as_str())
            .map(|s| s.to_string())
    });

    match target_obf.as_deref() {
        Some("zh") => Ok(ChineseObfuscator::obfuscate(&packed)),
        Some("words") => {
            if packed.len() > 600 {
                return Ok(ChineseObfuscator::obfuscate(&packed));
            }
            let dict = load_dictionary_data(&app)
                .ok_or_else(|| "Dictionary not loaded. Please download dictionary in settings.".to_string())?;
            let worded = WordsObfuscator::obfuscate(&packed, &dict)?;
            if worded.chars().count() > 3600 {
                Ok(ChineseObfuscator::obfuscate(&packed))
            } else {
                Ok(worded)
            }
        }
        _ => Ok(STANDARD.encode(&packed)),
    }
}

fn encode_handshake_output(
    app: &AppHandle,
    packed: &[u8],
    obf: Option<String>,
) -> Result<String, String> {
    let target_obf = obf.unwrap_or_else(|| "zh".into());
    if target_obf == "words" && packed.len() <= 600 {
        if let Some(dict) = load_dictionary_data(app) {
            return WordsObfuscator::obfuscate(packed, &dict);
        }
    }
    Ok(ChineseObfuscator::obfuscate(packed))
}

#[tauri::command]
pub async fn init_e2e_handshake(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    obf: Option<String>,
) -> Result<String, String> {
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
}

#[tauri::command]
pub async fn accept_e2e_handshake(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    handshake_data: String,
    obf: Option<String>,
) -> Result<String, String> {
    let hs_bytes = hex::decode(&handshake_data).map_err(|e| e.to_string())?;
    let parsed = parse_and_verify_handshake_any(&hs_bytes)?;
    let timestamp = Utc::now().timestamp_millis();
    let mut settings = load_chat_settings_json(&app, account, chat_id);

    match parsed {
        ParsedHandshakeAny::V1(p) => {
            let my_bundle = generate_keypair_bundle();
            let shared_secret = compute_shared_secret(&my_bundle.x_sk, &p.x_pk);
            let fingerprint = generate_fingerprint(&shared_secret);

            archive_current_session(&mut settings, timestamp);
            settings["session"] = json!({
                "version": 1,
                "shared_secret": hex::encode(shared_secret),
                "fingerprint": fingerprint,
                "peer_ed_pk": hex::encode(p.ed_pk),
                "peer_x_pk": hex::encode(p.x_pk),
                "my_ed_sk": hex::encode(my_bundle.ed_sk),
                "my_ed_pk": hex::encode(my_bundle.ed_pk),
                "established_at": timestamp
            });
            settings["keys"]["current"] = json!(1);
            if let Some(o) = settings.as_object_mut() {
                o.remove("pending");
                o.remove("e2e_declined");
            }
            save_chat_settings_json(&app, account, chat_id, &settings)?;

            let hs_packet = create_handshake_accept(
                &my_bundle.ed_sk,
                &my_bundle.ed_pk,
                &my_bundle.x_pk,
                timestamp,
            );
            let packed =
                pack_message(PayloadData::Handshake(hs_packet), None, None, Some(chat_id))?;
            encode_handshake_output(&app, &packed, obf)
        }
        ParsedHandshakeAny::V2Init(init) => {
            let my_bundle = generate_pq_keypair_bundle()?;
            let ratchet_kp = XWingKeypair::generate()?;
            let ratchet_pk = ratchet_kp.public_key_bytes();

            let (xwing_ct, shared_secret) = xwing_encapsulate(&init.xwing_pk)?;
            let confirm_mac = compute_key_confirmation_mac(
                &shared_secret,
                &init.ed_pk,
                &init.xwing_pk,
                &my_bundle.ed_pk,
                &xwing_ct,
                &ratchet_pk,
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
                "my_ratchet_mlkem_sk": hex::encode(&*ratchet_kp.mlkem_sk),
                "my_ratchet_x_sk": hex::encode(&*ratchet_kp.x_sk),
                "my_ratchet_x_pk": hex::encode(ratchet_kp.x_pk),
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
                &ratchet_pk,
                timestamp,
                &confirm_mac,
            )?;
            let packed =
                pack_message_v2(PayloadData::Handshake(hs_packet), None, None, None, chat_id)?;
            encode_handshake_output(&app, &packed, obf)
        }
        ParsedHandshakeAny::V2Accept(_) => {
            Err("Cannot accept a handshake accept packet".into())
        }
    }
}

#[tauri::command]
pub async fn process_e2e_accept(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    handshake_data: String,
) -> Result<String, String> {
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
    let parsed = parse_and_verify_handshake_any(&hs_bytes)?;
    let timestamp = Utc::now().timestamp_millis();

    match parsed {
        ParsedHandshakeAny::V1(p) => {
            let x_sk_hex = pending
                .get("x_sk")
                .and_then(|x| x.as_str())
                .ok_or_else(|| "Missing pending x_sk".to_string())?;
            let my_x_sk = decode_hex_32(x_sk_hex).ok_or("Invalid x_sk length")?;
            let shared_secret = compute_shared_secret(&my_x_sk, &p.x_pk);
            let fingerprint = generate_fingerprint(&shared_secret);

            archive_current_session(&mut settings, timestamp);
            settings["session"] = json!({
                "version": 1,
                "shared_secret": hex::encode(shared_secret),
                "fingerprint": fingerprint.clone(),
                "peer_ed_pk": hex::encode(p.ed_pk),
                "peer_x_pk": hex::encode(p.x_pk),
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
        ParsedHandshakeAny::V2Accept(accept) => {
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
                &accept.ratchet_xwing_pk,
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
                "peer_ratchet_xwing_pk": hex::encode(&accept.ratchet_xwing_pk),
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
        ParsedHandshakeAny::V2Init(_) => Err("Expected handshake accept packet, got init".into()),
    }
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
