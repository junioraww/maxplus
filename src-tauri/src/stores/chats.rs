use tauri::AppHandle;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, LazyLock, Mutex, RwLock},
};

use super::storage::{crypto_key, Paths, Storage};

pub static CHAT_SETTINGS_CACHE: LazyLock<RwLock<HashMap<(u64, i64), Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static CHAT_LOCKS: LazyLock<Mutex<HashMap<(u64, i64), Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn with_chat_settings_lock<T>(account: u64, chat_id: i64, f: impl FnOnce() -> T) -> T {
    let lock = {
        let mut map = CHAT_LOCKS.lock().unwrap();
        map.entry((account, chat_id))
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _guard = lock.lock().unwrap();
    f()
}

pub fn archive_session_into_keys(
    session: &serde_json::Map<String, Value>,
    target: &mut Value,
    until_ts: i64,
) {
    let Some(secret) = session.get("shared_secret").and_then(|s| s.as_str()) else {
        return;
    };
    if secret.is_empty() {
        return;
    }
    if !target.get("keys").map_or(false, |k| k.is_object()) {
        target["keys"] = json!({ "current": null, "keys": [], "messages": [] });
    }
    if !target["keys"].get("keys").map_or(false, |k| k.is_array()) {
        target["keys"]["keys"] = json!([]);
    }
    let Some(arr) = target["keys"]["keys"].as_array_mut() else {
        return;
    };
    let existing_msg_keys = session.get("msg_keys").and_then(|m| m.as_object());
    let role_val = session.get("role").cloned().unwrap_or(json!(0));
    let fp_val = session.get("fingerprint").cloned().unwrap_or(json!(""));
    let from_val = session.get("established_at").cloned().unwrap_or(json!(0));

    let mut target_idx = arr
        .iter()
        .position(|item| item.get("shared_secret").and_then(|s| s.as_str()) == Some(secret));
    if target_idx.is_none() {
        arr.push(json!({
            "shared_secret": secret,
            "fingerprint": fp_val,
            "role": role_val,
            "message_from": from_val,
            "message_until": until_ts,
            "msg_keys": {},
        }));
        target_idx = Some(arr.len() - 1);
    }
    if let Some(obj) = arr[target_idx.unwrap()].as_object_mut() {
        obj.insert("message_until".into(), json!(until_ts));
        obj.entry("role").or_insert(role_val);
        if let Some(mk_map) = existing_msg_keys {
            let dst = obj.entry("msg_keys").or_insert_with(|| json!({}));
            if !dst.is_object() {
                *dst = json!({});
            }
            if let Some(dst_obj) = dst.as_object_mut() {
                for (k, v) in mk_map {
                    dst_obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
}

pub fn save_chat_settings_raw_locked(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    data: &Value,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    Storage::new(key).save_direct(Paths::new(app, account).settings(chat_id), data)?;
    if let Ok(mut guard) = CHAT_SETTINGS_CACHE.write() {
        guard.insert((account, chat_id), data.clone());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_contact(
    app: AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    account: u64,
    contact_id: u64,
) -> Result<Option<Value>, String> {
    let app_clone = app.clone();
    let (local, is_locked) = tokio::task::spawn_blocking(move || {
        let key = match crate::stores::accounts::check_account_encryption(&app_clone, account) {
            Ok(k) => k,
            Err(_) => return (None, true),
        };
        let storage = Storage::new(key.clone());
        if let Some(val) = storage.load(Paths::new(&app_clone, account).contact(contact_id)) {
            return (Some(val), false);
        }
        (storage.load(Paths::new(&app_clone, account).chat(contact_id as i64).join("info")), false)
    })
    .await
    .map_err(|e| e.to_string())?;

    if local.is_some() {
        return Ok(local);
    }

    if is_locked {
        return Ok(None);
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

pub fn save_contact_at(
    paths: &Paths,
    key: Option<[u8; 32]>,
    contact_id: u64,
    data: &Value,
) -> Result<(), String> {
    Storage::new(key).save(paths.contact(contact_id), data)
}

pub fn save_chats_at(
    paths: &Paths,
    key: Option<[u8; 32]>,
    chats: Vec<Value>,
) -> Result<(), String> {
    let storage = Storage::new(key);

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
}

pub fn load_chats_at(paths: &Paths, key: Option<[u8; 32]>) -> Vec<Value> {
    let storage = Storage::new(key);
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
    chat_ids
        .into_iter()
        .filter_map(|id| storage.load(paths.info(id)))
        .collect()
}

pub fn get_contacts_at(paths: &Paths, key: Option<[u8; 32]>) -> Vec<Value> {
    let storage = Storage::new(key);
    Storage::list(paths.contacts())
        .into_iter()
        .filter_map(|x| storage.load(x))
        .collect()
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
        save_contact_at(&Paths::new(&app, account), key, contact_id, &data)
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
        let key = crate::stores::accounts::check_account_encryption(&app, account)?;
        Ok(get_contacts_at(&Paths::new(&app, account), key))
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
        let key = crate::stores::accounts::check_account_encryption(&app, account)?;
        save_chats_at(&Paths::new(&app, account), key, chats)
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
        let key = crate::stores::accounts::check_account_encryption(&app, account)?;
        Ok(load_chats_at(&Paths::new(&app, account), key))
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

fn merge_archived_keys(existing: &Value, data: &mut Value) {
    let Some(existing_arr) = existing
        .get("keys")
        .and_then(|k| k.get("keys"))
        .and_then(|k| k.as_array())
    else {
        return;
    };
    if existing_arr.is_empty() {
        return;
    }
    if !data.get("keys").map_or(false, |k| k.is_object()) {
        data["keys"] = json!({ "current": null, "keys": [], "messages": [] });
    }
    if !data["keys"].get("keys").map_or(false, |k| k.is_array()) {
        data["keys"]["keys"] = json!([]);
    }
    let Some(dst_arr) = data["keys"]["keys"].as_array_mut() else {
        return;
    };
    for ex_item in existing_arr {
        let Some(secret) = ex_item.get("shared_secret").and_then(|s| s.as_str()) else {
            continue;
        };
        if let Some(dst_item) = dst_arr
            .iter_mut()
            .find(|it| it.get("shared_secret").and_then(|s| s.as_str()) == Some(secret))
        {
            if let (Some(ex_obj), Some(dst_obj)) = (ex_item.as_object(), dst_item.as_object_mut()) {
                if let Some(role) = ex_obj.get("role") {
                    dst_obj.insert("role".into(), role.clone());
                }
                if let Some(ex_mks) = ex_obj.get("msg_keys").and_then(|m| m.as_object()) {
                    let dst_mks = dst_obj.entry("msg_keys").or_insert_with(|| json!({}));
                    if !dst_mks.is_object() {
                        *dst_mks = json!({});
                    }
                    if let Some(dst_mks_obj) = dst_mks.as_object_mut() {
                        for (k, v) in ex_mks {
                            dst_mks_obj.entry(k.clone()).or_insert_with(|| v.clone());
                        }
                    }
                }
            }
        } else {
            dst_arr.push(ex_item.clone());
        }
    }
}

pub fn set_chat_settings_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    data: Value,
) -> Result<(), String> {
    with_chat_settings_lock(account, chat_id, || {
        let mut data = data;
        if let Ok(existing) = get_chat_settings_sync(app, account, chat_id) {
            if let Some(pinned) = existing.get("pinned_peer_ed_pk") {
                if data.get("pinned_peer_ed_pk").is_none() {
                    data["pinned_peer_ed_pk"] = pinned.clone();
                }
            }
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
            merge_archived_keys(&existing, &mut data);
            if let Some(existing_session) = existing.get("session").and_then(|s| s.as_object()) {
                if data.get("session").map_or(false, |s| s.is_object()) {
                    data["session"] = Value::Object(existing_session.clone());
                } else {
                    archive_session_into_keys(
                        existing_session,
                        &mut data,
                        chrono::Utc::now().timestamp_millis(),
                    );
                }
            }
        }

        save_chat_settings_raw_locked(app, account, chat_id, &data)
    })
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
