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
    state: tauri::State<'_, crate::state::AppState>,
    account: u64,
    contact_id: u64,
) -> Result<Option<Value>, String> {
    let app_clone = app.clone();
    let local = tokio::task::spawn_blocking(move || {
        let key = crypto_key(&app_clone, account);
        let storage = Storage::new(key.clone());
        if let Some(val) = storage.load(Paths::new(&app_clone, account).contact(contact_id)) {
            return Some(val);
        }
        storage.load(Paths::new(&app_clone, account).chat(contact_id as i64).join("info"))
    })
    .await
    .map_err(|e| e.to_string())?;

    if local.is_some() {
        return Ok(local);
    }

    if let Ok(resp) = state.client.fetch_contacts(vec![contact_id]).await {
        if let Some(contacts) = resp.payload.get("contacts").and_then(|c| c.as_array()) {
            if let Some(first) = contacts.first().cloned() {
                let app_save = app.clone();
                let to_save = first.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    let key = crypto_key(&app_save, account);
                    Storage::new(key).save(Paths::new(&app_save, account).contact(contact_id), &to_save)
                }).await;
                return Ok(Some(first));
            }
        }
    }

    Ok(None)
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
    let mut data = data;
    if let Ok(existing) = get_chat_settings_sync(app, account, chat_id) {
        if data.get("pending").map_or(false, |p| p.is_boolean() && p.as_bool() == Some(true)) {
            if let Some(existing_pending) = existing.get("pending") {
                if existing_pending.is_object() {
                    data["pending"] = existing_pending.clone();
                }
            }
        } else if data.get("pending").map_or(false, |p| p.is_object()) {
            if let Some(existing_pending) = existing.get("pending") {
                if existing_pending.get("x_sk").is_some() && data["pending"].get("x_sk").is_none() {
                    data["pending"] = existing_pending.clone();
                }
            }
        }
        if let Some(existing_session) = existing.get("session") {
            if existing_session.is_object() {
                if let Some(session_obj) = data.get_mut("session").and_then(|s| s.as_object_mut()) {
                    if !session_obj.contains_key("shared_secret") {
                        if let Some(secret) = existing_session.get("shared_secret") {
                            session_obj.insert("shared_secret".to_string(), secret.clone());
                        }
                    }
                    if !session_obj.contains_key("peer_x_pk") {
                        if let Some(v) = existing_session.get("peer_x_pk") {
                            session_obj.insert("peer_x_pk".to_string(), v.clone());
                        }
                    }
                    if !session_obj.contains_key("peer_ed_pk") {
                        if let Some(v) = existing_session.get("peer_ed_pk") {
                            session_obj.insert("peer_ed_pk".to_string(), v.clone());
                        }
                    }
                    if !session_obj.contains_key("my_ed_sk") {
                        if let Some(v) = existing_session.get("my_ed_sk") {
                            session_obj.insert("my_ed_sk".to_string(), v.clone());
                        }
                    }
                    if !session_obj.contains_key("my_ed_pk") {
                        if let Some(v) = existing_session.get("my_ed_pk") {
                            session_obj.insert("my_ed_pk".to_string(), v.clone());
                        }
                    }
                }
            }
        }
    }

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
