use tauri::{AppHandle, Manager};
use serde_json::{json, Value};
use std::path::PathBuf;

use super::accounts::load_accounts;
use super::storage::{crypto_key, Paths, Storage};

fn common_store_path(app: &AppHandle, store: &str) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    match store {
        "device" => Ok(app_dir.join("data").join("device")),
        "dictionary" => Ok(app_dir.join("data").join("dictionary")),
        "credits_cache" => Ok(app_dir.join("data").join("common").join("credits_cache")),
        "plugin_meta" => Ok(app_dir.join("data").join("common").join("plugin_meta")),
        _ => Err(format!("Unknown common store: {store}")),
    }
}

#[tauri::command]
pub async fn common_store_load(
    app: AppHandle,
    store: String,
) -> Result<Option<Value>, String> {
    tokio::task::spawn_blocking(move || {
        let path = common_store_path(&app, &store)?;
        Ok(Storage::new(None).load(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn common_store_save(
    app: AppHandle,
    store: String,
    data: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = common_store_path(&app, &store)?;
        Storage::new(None).save(&path, &data)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn get_webapp_path_and_storage(app: &AppHandle, account: Option<u64>, bot_id: &str) -> (PathBuf, Storage) {
    let acc_id = account.unwrap_or_else(|| {
        let store = load_accounts(app);
        store.get("current").and_then(|x| x.as_u64()).unwrap_or(0)
    });

    if acc_id > 0 {
        let paths = Paths::new(app, acc_id);
        let key = crypto_key(app, acc_id);
        (paths.webapp(bot_id), Storage::new(key))
    } else {
        let safe_name: String = bot_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        let name = if safe_name.is_empty() {
            "default".to_string()
        } else {
            safe_name
        };
        let root = app.path().app_data_dir().unwrap().join("data").join("common").join("webapps");
        (root.join(name), Storage::new(None))
    }
}

#[tauri::command]
pub async fn webapp_storage_save_key(
    app: AppHandle,
    account: Option<u64>,
    bot_id: String,
    is_secure: bool,
    key: String,
    value: Option<String>,
) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        if key.is_empty() {
            return Ok(false);
        }
        let (path, storage) = get_webapp_path_and_storage(&app, account, &bot_id);
        let mut data = storage.load(&path).unwrap_or_else(|| json!({}));
        let scope_name = if is_secure { "sec" } else { "dev" };

        let obj = data.as_object_mut().ok_or_else(|| "Invalid store format".to_string())?;
        let scope_val = obj.entry(scope_name).or_insert_with(|| json!({}));
        let scope_obj = scope_val.as_object_mut().ok_or_else(|| "Invalid scope format".to_string())?;

        match value {
            Some(val) => {
                if !scope_obj.contains_key(&key) && scope_obj.len() >= 500 {
                    return Ok(false);
                }
                scope_obj.insert(key, Value::String(val));
            }
            None => {
                scope_obj.remove(&key);
            }
        }

        storage.save(&path, &data)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webapp_storage_get_key(
    app: AppHandle,
    account: Option<u64>,
    bot_id: String,
    is_secure: bool,
    key: String,
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let (path, storage) = get_webapp_path_and_storage(&app, account, &bot_id);
        let data = match storage.load(&path) {
            Some(d) => d,
            None => return Ok(None),
        };
        let scope_name = if is_secure { "sec" } else { "dev" };
        let val = data.get(scope_name)
            .and_then(|s| s.get(&key))
            .and_then(|v| {
                if let Some(s) = v.as_str() {
                    Some(s.to_string())
                } else if !v.is_null() {
                    Some(v.to_string())
                } else {
                    None
                }
            });
        Ok(val)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webapp_storage_clear(
    app: AppHandle,
    account: Option<u64>,
    bot_id: String,
    is_secure: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let (path, storage) = get_webapp_path_and_storage(&app, account, &bot_id);
        let mut data = storage.load(&path).unwrap_or_else(|| json!({}));
        let scope_name = if is_secure { "sec" } else { "dev" };
        if let Some(obj) = data.as_object_mut() {
            obj.insert(scope_name.to_string(), json!({}));
            storage.save(&path, &data)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webapp_storage_get_keys(
    app: AppHandle,
    account: Option<u64>,
    bot_id: String,
    is_secure: bool,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let (path, storage) = get_webapp_path_and_storage(&app, account, &bot_id);
        let data = match storage.load(&path) {
            Some(d) => d,
            None => return Ok(Vec::new()),
        };
        let scope_name = if is_secure { "sec" } else { "dev" };
        let keys = data.get(scope_name)
            .and_then(|s| s.as_object())
            .map(|obj| obj.keys().cloned().collect())
            .unwrap_or_default();
        Ok(keys)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webapp_biometry_get(
    app: AppHandle,
    account: Option<u64>,
    bot_id: String,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let (path, storage) = get_webapp_path_and_storage(&app, account, &bot_id);
        let data = storage.load(&path).unwrap_or_else(|| json!({}));
        let bio = data.get("biometry").cloned().unwrap_or_else(|| json!({}));
        Ok(bio)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webapp_biometry_set(
    app: AppHandle,
    account: Option<u64>,
    bot_id: String,
    biometry: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let (path, storage) = get_webapp_path_and_storage(&app, account, &bot_id);
        let mut data = storage.load(&path).unwrap_or_else(|| json!({}));
        if let Some(obj) = data.as_object_mut() {
            obj.insert("biometry".to_string(), biometry);
            storage.save(&path, &data)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn plugin_path(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    let safe_id: String = plugin_id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '_' || *c == '-')
        .collect();
    let name = if safe_id.is_empty() { "default" } else { &safe_id };
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("data").join("common").join("plugins").join(name))
}

#[tauri::command]
pub async fn plugin_storage_set(
    app: AppHandle,
    plugin_id: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = plugin_path(&app, &plugin_id)?;
        let storage = Storage::new(None);
        let mut data = storage.load(&path).unwrap_or_else(|| json!({}));
        let obj = data.as_object_mut().ok_or_else(|| "Invalid store format".to_string())?;
        match value {
            Some(val) => {
                if !obj.contains_key(&key) && obj.len() >= 1000 {
                    return Err("Storage limit reached".to_string());
                }
                obj.insert(key, Value::String(val));
            }
            None => {
                obj.remove(&key);
            }
        }
        storage.save(&path, &data)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_storage_get(
    app: AppHandle,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let path = plugin_path(&app, &plugin_id)?;
        let storage = Storage::new(None);
        let data = match storage.load(&path) {
            Some(d) => d,
            None => return Ok(None),
        };
        let val = data.get(&key).and_then(|v| {
            if let Some(s) = v.as_str() {
                Some(s.to_string())
            } else if !v.is_null() {
                Some(v.to_string())
            } else {
                None
            }
        });
        Ok(val)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_storage_get_all(
    app: AppHandle,
    plugin_id: String,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        let path = plugin_path(&app, &plugin_id)?;
        let storage = Storage::new(None);
        Ok(storage.load(&path).unwrap_or_else(|| json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_storage_clear(
    app: AppHandle,
    plugin_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = plugin_path(&app, &plugin_id)?;
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
