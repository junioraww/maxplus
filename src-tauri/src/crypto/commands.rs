use crate::crypto::asymmetric::{
    compute_shared_secret, create_handshake_accept, create_handshake_init, generate_keypair_bundle,
    parse_and_verify_handshake,
};
use crate::crypto::emoji::generate_fingerprint;
use crate::crypto::media::{decrypt_media_bytes, encrypt_media_bytes, MediaDescriptor};
use crate::crypto::obfuscation::{ChineseObfuscator, DictionaryData, WordsObfuscator};
use crate::crypto::protocol::{pack_message, unpack_message, PayloadData};
use crate::stores::{crypto_key, Paths, Storage};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};

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
    let key = crypto_key(app, account);
    Storage::new(key)
        .load(Paths::new(app, account).settings(chat_id))
        .unwrap_or_else(|| {
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
    let key = crypto_key(app, account);
    Storage::new(key).save(Paths::new(app, account).settings(chat_id), data)
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

fn load_dictionary_data(app: &AppHandle) -> Option<DictionaryData> {
    let dict_path = app
        .path()
        .app_data_dir()
        .ok()?
        .join("data")
        .join("dictionary");
    let stored: Value = Storage::new(None).load(&dict_path)?;
    let data_val = stored.get("data")?;
    serde_json::from_value(data_val.clone()).ok()
}

#[tauri::command]
pub async fn batch_decrypt_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    messages: Vec<IncomingMessageDto>,
    password: Option<String>,
) -> Result<HashMap<String, DecryptedMessageDto>, String> {
    let settings = load_chat_settings_json(&app, account, chat_id);
    let session_key = get_active_session_key(&settings);
    let effective_password = password.or_else(|| {
        settings
            .get("password")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string())
    });

    let dict_opt = load_dictionary_data(&app);
    let mut results = HashMap::new();

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

        let mut obf_name: Option<String> = None;
        let mut raw_bytes: Option<Vec<u8>> = None;

        if ChineseObfuscator::detect(raw_text) {
            if let Ok(b) = ChineseObfuscator::deobfuscate(raw_text) {
                obf_name = Some("zh".into());
                raw_bytes = Some(b);
            }
        }

        if raw_bytes.is_none() {
            if let Some(ref dict) = dict_opt {
                if WordsObfuscator::detect(raw_text, dict) {
                    if let Ok(b) = WordsObfuscator::deobfuscate(raw_text, dict) {
                        obf_name = Some("words".into());
                        raw_bytes = Some(b);
                    }
                }
            }
        }

        if raw_bytes.is_none() {
            if let Ok(b) = STANDARD.decode(raw_text) {
                if !b.is_empty() && (b[0] >> 6) == 0 {
                    raw_bytes = Some(b);
                }
            }
        }

        let bytes = match raw_bytes {
            Some(b) => b,
            None => continue,
        };

        match unpack_message(&bytes, session_key.as_ref(), effective_password.as_deref()) {
            Ok(PayloadData::Text(t)) => {
                results.insert(
                    msg_id_str,
                    DecryptedMessageDto {
                        text: t,
                        obf: obf_name,
                        is_encrypted: true,
                        media: None,
                        is_handshake_request: false,
                        is_handshake_accept: false,
                        handshake_data: None,
                        error: None,
                    },
                );
            }
            Ok(PayloadData::Media { text, media }) => {
                results.insert(
                    msg_id_str,
                    DecryptedMessageDto {
                        text,
                        obf: obf_name,
                        is_encrypted: true,
                        media: Some(media),
                        is_handshake_request: false,
                        is_handshake_accept: false,
                        handshake_data: None,
                        error: None,
                    },
                );
            }
            Ok(PayloadData::Handshake(hs_bytes)) => {
                let parsed = parse_and_verify_handshake(&hs_bytes);
                match parsed {
                    Ok(p) => {
                        let is_init = p.subtype == 0x01;
                        let notice_text = if is_init {
                            "<b>Запрос на секретный чат</b>".to_string()
                        } else {
                            "<b>Секретный чат установлен</b>".to_string()
                        };
                        results.insert(
                            msg_id_str,
                            DecryptedMessageDto {
                                text: notice_text,
                                obf: obf_name,
                                is_encrypted: true,
                                media: None,
                                is_handshake_request: is_init,
                                is_handshake_accept: !is_init,
                                handshake_data: Some(hex::encode(&hs_bytes)),
                                error: None,
                            },
                        );
                    }
                    Err(e) => {
                        results.insert(
                            msg_id_str,
                            DecryptedMessageDto {
                                text: "<b style=\"color:#f66\">Ошибка проверки рукопожатия</b>"
                                    .into(),
                                obf: obf_name,
                                is_encrypted: true,
                                media: None,
                                is_handshake_request: false,
                                is_handshake_accept: false,
                                handshake_data: None,
                                error: Some(e),
                            },
                        );
                    }
                }
            }
            Err(e) => {
                results.insert(
                    msg_id_str,
                    DecryptedMessageDto {
                        text: format!("<b style=\"color:#f66\">Ошибка!</b> {e}"),
                        obf: obf_name,
                        is_encrypted: true,
                        media: None,
                        is_handshake_request: false,
                        is_handshake_accept: false,
                        handshake_data: None,
                        error: Some(e),
                    },
                );
            }
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
    let settings = load_chat_settings_json(&app, account, chat_id);
    let session_key = if use_session {
        get_active_session_key(&settings)
    } else {
        None
    };

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

    let packed = pack_message(
        payload,
        session_key.as_ref(),
        effective_password.as_deref(),
    )?;

    let target_obf = obf.or_else(|| {
        settings
            .get("obfs")
            .and_then(|o| o.as_str())
            .map(|s| s.to_string())
    });

    match target_obf.as_deref() {
        Some("zh") => Ok(ChineseObfuscator::obfuscate(&packed)),
        Some("words") => {
            let dict = load_dictionary_data(&app)
                .ok_or_else(|| "Dictionary not loaded. Please download dictionary in settings.".to_string())?;
            WordsObfuscator::obfuscate(&packed, &dict)
        }
        _ => Ok(STANDARD.encode(&packed)),
    }
}

#[tauri::command]
pub async fn init_e2e_handshake(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    obf: Option<String>,
) -> Result<String, String> {
    let bundle = generate_keypair_bundle();
    let timestamp = Utc::now().timestamp_millis();

    let mut settings = load_chat_settings_json(&app, account, chat_id);
    settings["pending"] = json!({
        "ed_sk": hex::encode(bundle.ed_sk),
        "ed_pk": hex::encode(bundle.ed_pk),
        "x_sk": hex::encode(bundle.x_sk),
        "x_pk": hex::encode(bundle.x_pk),
        "timestamp": timestamp
    });
    save_chat_settings_json(&app, account, chat_id, &settings)?;

    let hs_packet =
        create_handshake_init(&bundle.ed_sk, &bundle.ed_pk, &bundle.x_pk, timestamp);
    let packed = pack_message(PayloadData::Handshake(hs_packet), None, None)?;

    let target_obf = obf.unwrap_or_else(|| "zh".into());
    if target_obf == "words" {
        if let Some(dict) = load_dictionary_data(&app) {
            return WordsObfuscator::obfuscate(&packed, &dict);
        }
    }

    Ok(ChineseObfuscator::obfuscate(&packed))
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
    let parsed = parse_and_verify_handshake(&hs_bytes)?;

    let my_bundle = generate_keypair_bundle();
    let shared_secret = compute_shared_secret(&my_bundle.x_sk, &parsed.x_pk);
    let fingerprint = generate_fingerprint(&shared_secret);
    let timestamp = Utc::now().timestamp_millis();

    let mut settings = load_chat_settings_json(&app, account, chat_id);
    settings["session"] = json!({
        "shared_secret": hex::encode(shared_secret),
        "fingerprint": fingerprint,
        "peer_ed_pk": hex::encode(parsed.ed_pk),
        "peer_x_pk": hex::encode(parsed.x_pk),
        "my_ed_sk": hex::encode(my_bundle.ed_sk),
        "my_ed_pk": hex::encode(my_bundle.ed_pk),
        "established_at": timestamp
    });
    settings["keys"]["current"] = json!(1);
    save_chat_settings_json(&app, account, chat_id, &settings)?;

    let hs_packet = create_handshake_accept(
        &my_bundle.ed_sk,
        &my_bundle.ed_pk,
        &my_bundle.x_pk,
        timestamp,
    );
    let packed = pack_message(PayloadData::Handshake(hs_packet), None, None)?;

    let target_obf = obf.unwrap_or_else(|| "zh".into());
    if target_obf == "words" {
        if let Some(dict) = load_dictionary_data(&app) {
            return WordsObfuscator::obfuscate(&packed, &dict);
        }
    }

    Ok(ChineseObfuscator::obfuscate(&packed))
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

    let pending = settings.get("pending");
    let x_sk_hex = pending.and_then(|p| p.get("x_sk")).and_then(|x| x.as_str());

    let x_sk_hex = match x_sk_hex {
        Some(hex) => hex,
        None => {
            if let Some(fp) = existing_fingerprint {
                return Ok(fp);
            }
            return Err("Missing pending x_sk".to_string());
        }
    };

    let hs_bytes = hex::decode(&handshake_data).map_err(|e| e.to_string())?;
    let parsed = parse_and_verify_handshake(&hs_bytes)?;

    let x_sk_vec = hex::decode(x_sk_hex).map_err(|e| e.to_string())?;
    if x_sk_vec.len() != 32 {
        return Err("Invalid x_sk length".into());
    }
    let mut my_x_sk = [0u8; 32];
    my_x_sk.copy_from_slice(&x_sk_vec);

    let shared_secret = compute_shared_secret(&my_x_sk, &parsed.x_pk);
    let fingerprint = generate_fingerprint(&shared_secret);

    settings["session"] = json!({
        "shared_secret": hex::encode(shared_secret),
        "fingerprint": fingerprint.clone(),
        "peer_ed_pk": hex::encode(parsed.ed_pk),
        "peer_x_pk": hex::encode(parsed.x_pk),
        "established_at": Utc::now().timestamp_millis()
    });
    settings["keys"]["current"] = json!(1);
    settings.as_object_mut().map(|o| o.remove("pending"));
    save_chat_settings_json(&app, account, chat_id, &settings)?;

    Ok(fingerprint)
}

#[tauri::command]
pub async fn get_chat_encryption_info(
    app: AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<Value, String> {
    let settings = load_chat_settings_json(&app, account, chat_id);
    let has_session = settings.get("session").is_some();
    let fingerprint = settings
        .get("session")
        .and_then(|s| s.get("fingerprint"))
        .and_then(|f| f.as_str())
        .map(|s| s.to_string());

    let has_pending = settings.get("pending").is_some();

    Ok(json!({
        "active": has_session,
        "fingerprint": fingerprint,
        "pending": has_pending
    }))
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

    Ok(val)
}

#[tauri::command]
pub async fn encrypt_media_file(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    file_path: String,
    dummy_type: String,
) -> Result<String, String> {
    let settings = load_chat_settings_json(&app, account, chat_id);
    let session_key = get_active_session_key(&settings)
        .ok_or_else(|| "Session key required to encrypt media".to_string())?;

    let raw_bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let encrypted = encrypt_media_bytes(&raw_bytes, &session_key, &dummy_type)?;

    let out_path = format!("{}.enc", file_path);
    fs::write(&out_path, encrypted).map_err(|e| e.to_string())?;

    Ok(out_path)
}

#[tauri::command]
pub async fn decrypt_media_file(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    file_path: String,
    out_path: String,
) -> Result<String, String> {
    let settings = load_chat_settings_json(&app, account, chat_id);
    let session_key = get_active_session_key(&settings)
        .ok_or_else(|| "Session key required to decrypt media".to_string())?;

    let encrypted_bytes = fs::read(&file_path).map_err(|e| e.to_string())?;
    let decrypted = decrypt_media_bytes(&encrypted_bytes, &session_key)?;

    if let Some(parent) = Path::new(&out_path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&out_path, decrypted).map_err(|e| e.to_string())?;

    Ok(out_path)
}
