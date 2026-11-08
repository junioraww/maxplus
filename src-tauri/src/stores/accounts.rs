use tauri::{AppHandle, Manager};
use crate::state::CryptoSession;
use crate::AppState;
use serde_json::{json, Value};
use rand::{Rng, RngCore};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{LazyLock, RwLock},
};

use super::storage::{
    crypto_key, derive_key, generate_salt, hash_key, insert_crypto_key, remove_crypto_key, verify_hash,
    collect_all_account_files, migrate_all_files, Paths, Storage,
};
use super::cache::CACHE_INDEX_CACHE;
use super::chats::CHAT_SETTINGS_CACHE;

pub static ACCOUNT_CACHE: LazyLock<RwLock<HashMap<u64, Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn accounts_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("accounts")
}

pub fn load_accounts(app: &AppHandle) -> Value {
    Storage::new(None)
        .load(accounts_path(app))
        .unwrap_or_else(|| {
            json!({
                "accounts": [],
                "current": null
            })
        })
}

pub fn check_account_encryption(app: &AppHandle, account: u64) -> Result<Option<[u8; 32]>, String> {
    let store = load_accounts(app);
    let entry = store["accounts"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["id"] == account));
    let is_enc = entry.map(|x| !x["encryption"].is_null()).unwrap_or(false);
    let key = crypto_key(app, account);
    if is_enc && key.is_none() {
        return Err("Account is encrypted and locked".into());
    }
    Ok(key)
}

pub fn save_accounts(app: &AppHandle, data: &Value) -> Result<(), String> {
    Storage::new(None).save(accounts_path(app), data)
}

pub fn account_path(app: &AppHandle, id: &str, file: &str) -> PathBuf {
    Paths::new(app, id.parse().unwrap()).root.join(file)
}

#[tauri::command]
pub fn accounts_get(app: AppHandle) -> Result<Value, String> {
    Ok(load_accounts(&app)["accounts"].clone())
}

#[tauri::command]
pub fn accounts_add(
    app: AppHandle,
    token: Value,
    device: Value,
) -> Result<Value, String> {
    let mut store = load_accounts(&app);

    let id = loop {
        let id = rand::thread_rng().gen_range(10000000..99999999);

        if !store["accounts"].as_array().unwrap().iter().any(|x| x["id"] == id) {
            break id;
        }
    };

    let entry = json!({
        "id": id,
        "encryption": null,
        "key": null
    });

    let account_dir = app
        .path()
        .app_data_dir()
        .unwrap()
        .join("data")
        .join(id.to_string());

    fs::create_dir_all(account_dir).map_err(|e| e.to_string())?;

    let storage = Storage::new(None);

    storage.save(
        account_path(&app, &id.to_string(), "meta"),
        &json!({
            "version": 1,
            "token": token,
            "device": device,
            "telemetry": "fake",
            "presence": true,
            "added": chrono::Utc::now().timestamp_millis()
        }),
    )?;

    let is_first = store["accounts"].as_array().map(|a| a.is_empty()).unwrap_or(true);
    store["accounts"].as_array_mut().unwrap().push(entry.clone());
    if is_first || store["current"].is_null() {
        store["current"] = json!(id);
    }
    save_accounts(&app, &store)?;

    Ok(entry)
}

#[tauri::command]
pub async fn account_get(app: AppHandle, id: u64) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app, id);
        if let Ok(guard) = ACCOUNT_CACHE.read() {
            if let Some(val) = guard.get(&id) {
                let is_enc = val.get("encryption").map(|e| !e.is_null()).unwrap_or(false);
                let cached_unlocked = val.get("unlocked").and_then(|v| v.as_bool()).unwrap_or(false);
                let should_be_unlocked = !is_enc || key.is_some();
                if cached_unlocked == should_be_unlocked {
                    return Ok(val.clone());
                }
            }
        }

        let store = load_accounts(&app);

        let account = store["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == id)
            .ok_or("Account not found")?;

        let key = crypto_key(&app, id);
        let storage = Storage::new(key);

        let meta = storage.load(
            account_path(&app, &id.to_string(), "meta")
        ).unwrap_or(Value::Null);

        let contact = storage.load(
            account_path(&app, &id.to_string(), "self")
        ).unwrap_or(Value::Null);

        let is_encrypted = !account["encryption"].is_null();
        let is_unlocked = !is_encrypted || key.is_some();

        let res = json!({
            "id": account["id"],
            "encryption": account["encryption"],
            "preview": account.get("preview").cloned().unwrap_or(Value::Null),
            "meta": meta,
            "contact": contact,
            "unlocked": is_unlocked
        });

        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.insert(id, res.clone());
        }

        Ok(res)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn account_delete(app: AppHandle, id: u64) -> Result<(), String> {
    remove_crypto_key(id);
    if let Ok(mut guard) = ACCOUNT_CACHE.write() {
        guard.remove(&id);
    }
    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
        guard.remove(&id);
    }

    let mut store = load_accounts(&app);

    store["accounts"].as_array_mut().unwrap().retain(|x| x["id"] != id);

    if store["current"] == id {
        store["current"] = Value::Null;
    }

    save_accounts(&app, &store)?;

    let path = app.path().app_data_dir().unwrap().join("data").join(id.to_string());

    if path.exists() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn account_contact(
    app: AppHandle,
    id: u64,
    data: Option<Value>,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let key = if data.is_some() {
            check_account_encryption(&app, id)?
        } else {
            crypto_key(&app, id)
        };

        let storage = Storage::new(key);

        if let Some(ref d) = data {
            storage.save(account_path(&app, &id.to_string(), "self"), d)?;
        }

        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&id);
        }

        Ok(storage
            .load(account_path(&app, &id.to_string(), "self"))
            .unwrap_or(Value::Null)
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn current_get(app: AppHandle) -> Result<Value, String> {
    Ok(load_accounts(&app)["current"].clone())
}

#[tauri::command]
pub fn current_set(app: AppHandle, id: Option<u64>) -> Result<(), String> {
    let mut store = load_accounts(&app);

    if let Some(ref id) = id {
        let entry = store["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == *id)
            .ok_or("Account not found")?;

        if let Some(state) = app.try_state::<crate::AppState>() {
            if let Ok(mut c) = state.crypto.write() {
                if entry["encryption"].is_null() || c.as_ref().map(|s| s.account) != Some(*id) {
                    *c = None;
                    if let Ok(mut guard) = ACCOUNT_CACHE.write() {
                        guard.clear();
                    }
                    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
                        guard.clear();
                    }
                }
            }
        }
    } else {
        if let Some(state) = app.try_state::<crate::AppState>() {
            if let Ok(mut c) = state.crypto.write() {
                *c = None;
            }
        }
        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.clear();
        }
    }

    store["current"] = id.map(Value::from).unwrap_or(Value::Null);
    save_accounts(&app, &store)?;
    crate::daemon::trigger_daemon_reconnect();
    Ok(())
}

#[tauri::command]
pub fn account_set_preview(app: AppHandle, id: u64, preview: Option<Value>) -> Result<(), String> {
    let mut store = load_accounts(&app);
    let entry = store["accounts"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|x| x["id"] == id)
        .ok_or("Account not found")?;

    entry["preview"] = preview.unwrap_or(Value::Null);
    save_accounts(&app, &store)?;
    if let Ok(mut guard) = ACCOUNT_CACHE.write() {
        guard.remove(&id);
    }
    Ok(())
}

#[tauri::command]
pub async fn current_account_meta(app: AppHandle) -> Result<Value, String> {
    let id = current_get(app.clone())?;

    if id.is_null() {
        return Ok(Value::Null);
    }

    account_get(
        app,
        id.as_u64().expect("Wrong account id"),
    ).await
}

pub fn set_account_meta_field(app: &AppHandle, id: u64, key: &str, value: Value) -> Result<(), String> {
    let crypto_k = crypto_key(app, id);
    let storage = Storage::new(crypto_k);
    let meta_path = account_path(app, &id.to_string(), "meta");
    let mut meta = storage.load(&meta_path).unwrap_or(Value::Null);
    if let Value::Object(ref mut map) = meta {
        map.insert(key.to_string(), value);
        storage.save(meta_path, &meta)?;
        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&id);
        }
    }
    Ok(())
}

pub fn update_account_token(app: &AppHandle, id: u64, token: &str) -> Result<(), String> {
    set_account_meta_field(app, id, "token", Value::String(token.to_string()))
}

#[tauri::command]
pub fn account_set_meta(app: AppHandle, id: u64, key: String, value: Value) -> Result<(), String> {
    set_account_meta_field(&app, id, &key, value)
}

#[tauri::command]
pub fn account_update_token(app: AppHandle, id: u64, token: String) -> Result<(), String> {
    update_account_token(&app, id, &token)
}

#[tauri::command]
pub async fn decrypt_account(
    app: AppHandle,
    account: u64,
    key: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let store = load_accounts(&app);

        let entry = store["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == account)
            .ok_or("Account not found")?;

        let encryption = &entry["encryption"];

        if encryption.is_null() {
            return Err("Account not encrypted".into());
        }

        let salt = encryption["salt"].as_str().unwrap();
        let derived = derive_key(&key, salt)?;

        if !verify_hash(&derived, encryption["hash"].as_str().unwrap()) {
            return Err("Wrong key".into());
        }

        insert_crypto_key(account, derived);

        *app.state::<AppState>().crypto.write().unwrap() = Some(
            CryptoSession {
                account,
                key: derived,
            }
        );

        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&account);
        }
        if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
            guard.remove(&account);
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_encryption(
    app: AppHandle,
    account: u64,
    key: String,
    enabled: bool,
    preview: Option<Value>,
) -> Result<(), String> {
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        let paths = Paths::new(&app_clone, account);
        let files = collect_all_account_files(&paths);

        let mut store = load_accounts(&app_clone);

        let entry = store["accounts"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|x| x["id"] == account)
            .ok_or("Account not found")?;

        if enabled {
            let salt = generate_salt();
            let derived = derive_key(&key, &salt)?;

            migrate_all_files(&app_clone, files, &derived, true)?;

            entry["encryption"] = json!({
                "type": "pin-1",
                "salt": salt,
                "hash": hash_key(&derived)
            });
            entry["preview"] = preview.unwrap_or(Value::Null);

            save_accounts(&app_clone, &store)?;

            insert_crypto_key(account, derived);

            *app_clone.state::<AppState>().crypto.write().unwrap() = Some(
                CryptoSession {
                    account,
                    key: derived,
                }
            );
        } else {
            let encryption = &entry["encryption"];

            let salt = encryption["salt"]
                .as_str()
                .ok_or("Salt not found")?;

            let derived = derive_key(&key, salt)?;

            if !verify_hash(
                &derived,
                encryption["hash"].as_str().ok_or("Hash not found")?,
            ) {
                return Err("Wrong key".into());
            }

            migrate_all_files(&app_clone, files, &derived, false)?;

            entry["encryption"] = Value::Null;
            entry["preview"] = Value::Null;

            save_accounts(&app_clone, &store)?;

            remove_crypto_key(account);

            *app_clone.state::<AppState>().crypto.write().unwrap() = None;
        }

        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&account);
        }
        if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
            guard.remove(&account);
        }
        if let Ok(mut guard) = CHAT_SETTINGS_CACHE.write() {
            guard.retain(|(acc, _), _| *acc != account);
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn generate_hardware_key() -> Result<String, String> {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    Ok(hex::encode(key))
}

#[tauri::command]
pub async fn decrypt_account_hardware(
    app: AppHandle,
    account: u64,
    key: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let key_bytes: [u8; 32] = hex::decode(&key)
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "Invalid key length".to_string())?;

        let store = load_accounts(&app);

        let entry = store["accounts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|x| x["id"] == account)
            .ok_or("Account not found")?;

        let encryption = &entry["encryption"];

        if encryption.is_null() {
            return Err("Account not encrypted".into());
        }

        if !verify_hash(&key_bytes, encryption["hash"].as_str().unwrap_or_default()) {
            return Err("Wrong key".into());
        }

        insert_crypto_key(account, key_bytes);

        *app.state::<AppState>().crypto.write().unwrap() = Some(
            CryptoSession {
                account,
                key: key_bytes,
            }
        );

        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&account);
        }
        if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
            guard.remove(&account);
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn lock_crypto_session(_app: AppHandle) {
    if let Ok(mut guard) = ACCOUNT_CACHE.write() {
        guard.clear();
    }
    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
        guard.clear();
    }
}

#[tauri::command]
pub async fn set_hardware_encryption(
    app: AppHandle,
    account: u64,
    key: String,
    enabled: bool,
    preview: Option<Value>,
) -> Result<(), String> {
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        let key_bytes: [u8; 32] = hex::decode(&key)
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "Invalid key length".to_string())?;

        let paths = Paths::new(&app_clone, account);
        let files = collect_all_account_files(&paths);

        let mut store = load_accounts(&app_clone);

        let entry = store["accounts"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|x| x["id"] == account)
            .ok_or("Account not found")?;

        if enabled {
            migrate_all_files(&app_clone, files, &key_bytes, true)?;

            entry["encryption"] = json!({
                "type": "hardware-1",
                "hash": hash_key(&key_bytes)
            });
            entry["preview"] = preview.unwrap_or(Value::Null);

            save_accounts(&app_clone, &store)?;

            insert_crypto_key(account, key_bytes);

            *app_clone.state::<AppState>().crypto.write().unwrap() = Some(
                CryptoSession {
                    account,
                    key: key_bytes,
                }
            );
        } else {
            let encryption = &entry["encryption"];

            if !verify_hash(
                &key_bytes,
                encryption["hash"].as_str().ok_or("Hash not found")?,
            ) {
                return Err("Wrong key".into());
            }

            migrate_all_files(&app_clone, files, &key_bytes, false)?;

            entry["encryption"] = Value::Null;
            entry["preview"] = Value::Null;

            save_accounts(&app_clone, &store)?;

            remove_crypto_key(account);

            *app_clone.state::<AppState>().crypto.write().unwrap() = None;
        }

        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&account);
        }
        if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
            guard.remove(&account);
        }
        if let Ok(mut guard) = CHAT_SETTINGS_CACHE.write() {
            guard.retain(|(acc, _), _| *acc != account);
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_database_files_count(
    app: AppHandle,
    account: u64,
) -> Result<usize, String> {
    let paths = Paths::new(&app, account);
    Ok(collect_all_account_files(&paths).len())
}

pub fn resolve_app_root(app_dir: &str) -> std::path::PathBuf {
    let base = std::path::PathBuf::from(app_dir);
    if base.join("accounts").exists() {
        return base;
    }
    if base.join("files").join("accounts").exists() {
        return base.join("files");
    }
    if let Some(parent) = base.parent() {
        if parent.join("accounts").exists() {
            return parent.to_path_buf();
        }
        if parent.join("files").join("accounts").exists() {
            return parent.join("files");
        }
    }
    if base.join("files").exists() {
        return base.join("files");
    }
    base
}

pub fn is_account_encrypted_disk(app_dir: &str, account_id: u64) -> bool {
    let root = resolve_app_root(app_dir);
    let accounts_path = root.join("accounts");
    let storage = Storage::new(None);
    let store = match storage.load(&accounts_path) {
        Some(s) => s,
        None => return false,
    };
    let accounts = match store.get("accounts").and_then(|a| a.as_array()) {
        Some(a) => a,
        None => return false,
    };
    let target = if account_id != 0 {
        accounts.iter().find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(account_id))
            .or_else(|| store.get("current").and_then(|c| c.as_u64()).and_then(|cid| {
                accounts.iter().find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(cid))
            }))
            .or_else(|| accounts.first())
    } else {
        store.get("current").and_then(|c| c.as_u64()).and_then(|cid| {
            accounts.iter().find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(cid))
        }).or_else(|| accounts.first())
    };
    target.map(|acc| !acc.get("encryption").unwrap_or(&Value::Null).is_null()).unwrap_or(false)
}

#[cfg(target_os = "android")]
pub fn resolve_account_for_chat(app_dir: &str, chat_id: i64) -> u64 {
    let root = resolve_app_root(app_dir);
    let accounts_path = root.join("accounts");
    let storage = Storage::new(None);
    let store = match storage.load(&accounts_path) {
        Some(s) => s,
        None => return 0,
    };
    let accounts = match store.get("accounts").and_then(|a| a.as_array()) {
        Some(a) => a,
        None => return 0,
    };

    if chat_id != 0 {
        for acc in accounts {
            if let Some(id) = acc.get("id").and_then(|v| v.as_u64()) {
                let chat_dir = root.join("data").join(id.to_string()).join("chats").join(chat_id.to_string());
                if chat_dir.exists() {
                    return id;
                }
            }
        }
    }

    if let Some(curr) = store.get("current").and_then(|v| v.as_u64()) {
        if curr != 0 {
            return curr;
        }
    }

    accounts.first().and_then(|a| a.get("id")?.as_u64()).unwrap_or(0)
}

#[cfg(target_os = "android")]
pub fn is_account_privacy_active_disk(app_dir: &str, account_id: u64) -> bool {
    let root = resolve_app_root(app_dir);
    let accounts_path = root.join("accounts");
    let storage = Storage::new(None);
    let store = match storage.load(&accounts_path) {
        Some(s) => s,
        None => return false,
    };
    let accounts = match store.get("accounts").and_then(|a| a.as_array()) {
        Some(a) => a,
        None => return false,
    };
    let target = if account_id != 0 {
        accounts.iter().find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(account_id))
            .or_else(|| store.get("current").and_then(|c| c.as_u64()).and_then(|cid| {
                accounts.iter().find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(cid))
            }))
            .or_else(|| accounts.first())
    } else {
        store.get("current").and_then(|c| c.as_u64()).and_then(|cid| {
            accounts.iter().find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(cid))
        }).or_else(|| accounts.first())
    };
    let acc = match target {
        Some(a) => a,
        None => return false,
    };
    if acc.get("encryption").unwrap_or(&Value::Null).is_null() {
        return false;
    }
    let local_id = acc.get("id").and_then(|id| id.as_u64()).unwrap_or(account_id);
    let key = crate::stores::get_crypto_key(local_id);
    let storage = Storage::new(key);
    let meta_path = root.join("data").join(local_id.to_string()).join("meta");
    if let Some(meta) = storage.load(&meta_path) {
        if meta.get("hide_locked_notifications").and_then(|v| v.as_bool()) == Some(false) {
            return false;
        }
    }
    true
}

pub fn get_background_creds(
    app_dir: &str,
    account_id: u64,
) -> Option<(u64, u64, String, rumax::models::Identity)> {
    let root = resolve_app_root(app_dir);
    let accounts_path = root.join("accounts");

    let storage = Storage::new(None);
    let store = storage.load(&accounts_path)?;
    let accounts = store.get("accounts")?.as_array()?;

    let local_id = accounts
        .iter()
        .find_map(|acc| {
            let lid = acc.get("id")?.as_u64()?;
            if lid == account_id {
                return Some(lid);
            }
            let self_path = root.join("data").join(lid.to_string()).join("self");
            if let Some(self_val) = storage.load(&self_path) {
                if self_val.get("id").and_then(|id| id.as_u64()) == Some(account_id) {
                    return Some(lid);
                }
            }
            None
        })
        .or_else(|| store.get("current").and_then(|c| c.as_u64()))
        .or_else(|| accounts.first().and_then(|a| a.get("id")?.as_u64()))?;

    let account_info = accounts
        .iter()
        .find(|x| x.get("id").and_then(|id| id.as_u64()) == Some(local_id))?;

    let is_encrypted = !account_info.get("encryption").unwrap_or(&Value::Null).is_null();
    let key = crate::stores::get_crypto_key(local_id);
    if is_encrypted && key.is_none() {
        return None;
    }

    let storage = Storage::new(key);
    let meta_path = root.join("data").join(local_id.to_string()).join("meta");
    let meta = storage.load(&meta_path)?;

    let token = meta.get("token")?.as_str()?.to_string();
    let device = meta.get("device")?.clone();
    let identity: rumax::models::Identity = serde_json::from_value(device).ok()?;

    let self_path = root.join("data").join(local_id.to_string()).join("self");
    let server_user_id = storage
        .load(&self_path)
        .and_then(|s| s.get("id").and_then(|id| id.as_u64()))
        .unwrap_or(if account_id != 0 { account_id } else { local_id });

    Some((local_id, server_user_id, token, identity))
}
