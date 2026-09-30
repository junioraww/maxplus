use tauri::AppHandle;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{LazyLock, RwLock},
};

use super::storage::{crypto_key, Paths, Storage};

pub static CHAT_SETTINGS_CACHE: LazyLock<RwLock<HashMap<(u64, i64), Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

#[tauri::command]
pub async fn get_contact(
    app: AppHandle,
    account: u64,
    contact_id: u64,
) -> Result<Option<Value>, String> {
    tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app, account);
        Ok(Storage::new(key).load(Paths::new(&app, account).contact(contact_id)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_contact(
    app: AppHandle,
    account: u64,
    contact_id: u64,
    data: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app, account);
        Storage::new(key).save(Paths::new(&app, account).contact(contact_id), &data)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_contacts(
    app: AppHandle,
    account: u64,
) -> Result<Vec<Value>, String> {
    tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app, account);
        let storage = Storage::new(key);
        Ok(Storage::list(Paths::new(&app, account).contacts())
            .into_iter()
            .filter_map(|x| storage.load(x))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_chats(
    app: AppHandle,
    account: u64,
    chats: Vec<Value>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app, account);
        let storage = Storage::new(key);
        let paths = Paths::new(&app, account);

        for chat in chats {
            let chat_id = chat.get("id").and_then(|v| {
                v.as_i64()
                    .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            });

            if let Some(id) = chat_id {
                let path = paths.info(id);
                let to_save = if let Some(mut existing) = storage.load(&path) {
                    if let Some(existing_obj) = existing.as_object_mut() {
                        if let Some(new_obj) = chat.as_object() {
                            for (k, v) in new_obj {
                                existing_obj.insert(k.clone(), v.clone());
                            }
                        }
                        Value::Object(existing_obj.clone())
                    } else {
                        chat
                    }
                } else {
                    chat
                };
                storage.save(path, &to_save)?;
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_chats(
    app: AppHandle,
    account: u64,
) -> Result<Vec<Value>, String> {
    tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app, account);
        let storage = Storage::new(key);
        let paths = Paths::new(&app, account);

        let mut chat_ids: Vec<i64> = Storage::list(paths.chats())
            .into_iter()
            .filter(|p| p.is_dir())
            .filter_map(|p| {
                p.file_name()?
                    .to_str()?
                    .parse::<i64>()
                    .ok()
            })
            .collect();

        chat_ids.sort();

        let chats = chat_ids
            .into_iter()
            .filter_map(|id| storage.load(paths.info(id)))
            .collect();

        Ok(chats)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn get_chat_settings_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<Value, String> {
    let cache_key = (account, chat_id);
    if let Ok(guard) = CHAT_SETTINGS_CACHE.read() {
        if let Some(val) = guard.get(&cache_key) {
            return Ok(val.clone());
        }
    }

    let key = crypto_key(app, account);
    let val = Storage::new(key)
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
        });

    if let Ok(mut guard) = CHAT_SETTINGS_CACHE.write() {
        guard.insert(cache_key, val.clone());
    }

    Ok(val)
}

#[tauri::command]
pub async fn get_chat_settings(
    app: AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || {
        get_chat_settings_sync(&app, account, chat_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn set_chat_settings_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    data: Value,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    let storage = Storage::new(key);
    storage.save_coalesced(Paths::new(app, account).settings(chat_id), &data);

    if let Ok(mut guard) = CHAT_SETTINGS_CACHE.write() {
        guard.insert((account, chat_id), data);
    }

    Ok(())
}

#[tauri::command]
pub async fn set_chat_settings(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    data: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        set_chat_settings_sync(&app, account, chat_id, data)
    })
    .await
    .map_err(|e| e.to_string())?
}
