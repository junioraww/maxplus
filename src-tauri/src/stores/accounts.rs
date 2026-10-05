use tauri::{AppHandle, Manager};
use crate::state::CryptoSession;
use crate::AppState;
use serde_json::{json, Value};
use rand::Rng;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{LazyLock, RwLock},
};

use super::storage::{
    crypto_key, derive_key, generate_salt, hash_key, verify_hash,
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
            "added": chrono::Utc::now().timestamp_millis()
        }),
    )?;

    store["accounts"].as_array_mut().unwrap().push(entry.clone());
    save_accounts(&app, &store)?;

    Ok(entry)
}

#[tauri::command]
pub async fn account_get(app: AppHandle, id: u64) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        if let Ok(guard) = ACCOUNT_CACHE.read() {
            if let Some(val) = guard.get(&id) {
                return Ok(val.clone());
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

        let res = json!({
            "id": account["id"],
            "encryption": account["encryption"],
            "meta": meta,
            "contact": contact
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
        let key = crypto_key(&app, id);
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
        if !store["accounts"]
            .as_array().unwrap().iter().any(|x| x["id"] == *id) {
            return Err("Account not found".into());
        }
    }

    store["current"] = id.map(Value::from).unwrap_or(Value::Null);
    save_accounts(&app, &store)
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

pub fn update_account_token(app: &AppHandle, id: u64, token: &str) -> Result<(), String> {
    let key = crypto_key(app, id);
    let storage = Storage::new(key);
    let meta_path = account_path(app, &id.to_string(), "meta");
    let mut meta = storage.load(&meta_path).unwrap_or(Value::Null);
    if let Value::Object(ref mut map) = meta {
        map.insert("token".to_string(), Value::String(token.to_string()));
        storage.save(meta_path, &meta)?;
        if let Ok(mut guard) = ACCOUNT_CACHE.write() {
            guard.remove(&id);
        }
    }
    Ok(())
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

            save_accounts(&app_clone, &store)?;

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

            save_accounts(&app_clone, &store)?;

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

#[cfg(target_os = "android")]
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

#[cfg(target_os = "android")]
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

    if !account_info.get("encryption").unwrap_or(&Value::Null).is_null() {
        eprintln!("Push: Account is encrypted. Background push delivery requires key.");
        return None;
    }

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
