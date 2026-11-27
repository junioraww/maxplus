pub mod storage;
pub mod accounts;
pub mod messages;
pub mod cache;
pub mod generic;
pub mod chats;

use tauri::AppHandle;
use serde_json::{json, Value};

pub use storage::{crypto_key, get_crypto_key, Paths, Storage};
#[cfg(target_os = "android")]
pub use accounts::{is_account_privacy_active_disk, resolve_account_for_chat};
pub use accounts::{current_get, get_background_creds, is_account_encrypted_disk, load_accounts, resolve_account_creds_at, resolve_app_root};
pub use messages::clear_local_messages;
pub use cache::{add_cache_index_alias, get_cached_file_sync, hash, is_file_encrypted, set_cached_file_with_meta};
pub use chats::{
    archive_session_into_keys, get_chat_settings_sync, get_contacts_at, load_chats_at,
    save_chats_at, save_chat_settings_raw_locked, save_contact_at, with_chat_settings_lock,
};
pub use messages::{mark_message_deleted_at, update_messages_at};

pub fn load_sync_state_at<T: serde::de::DeserializeOwned>(
    paths: &Paths,
    key: Option<[u8; 32]>,
) -> Option<T> {
    let val = Storage::new(key).load(paths.sync_state())?;
    serde_json::from_value(val).ok()
}

pub fn save_sync_state_at<T: serde::Serialize>(
    paths: &Paths,
    key: Option<[u8; 32]>,
    state: &T,
) -> Result<(), String> {
    let val = serde_json::to_value(state).map_err(|e| e.to_string())?;
    Storage::new(key).save(paths.sync_state(), &val)
}

pub fn save_user_settings_at(
    paths: &Paths,
    key: Option<[u8; 32]>,
    settings: &Value,
) -> Result<(), String> {
    let storage = Storage::new(key);
    let mut current = storage.load(paths.user_settings()).unwrap_or(json!({}));
    if let (Some(dest), Some(src)) = (current.as_object_mut(), settings.as_object()) {
        for (k, v) in src {
            dest.insert(k.clone(), v.clone());
        }
    } else {
        current = settings.clone();
    }
    storage.save(paths.user_settings(), &current)
}

pub fn load_user_settings_at(paths: &Paths, key: Option<[u8; 32]>) -> Value {
    Storage::new(key)
        .load(paths.user_settings())
        .unwrap_or_else(|| json!({}))
}

pub fn save_user_settings(
    app: &AppHandle,
    account: u64,
    settings: &Value,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    let paths = Paths::new(app, account);
    save_user_settings_at(&paths, key, settings)
}

pub fn load_user_settings(
    app: &AppHandle,
    account: u64,
) -> Result<Value, String> {
    let key = crypto_key(app, account);
    let paths = Paths::new(app, account);
    Ok(load_user_settings_at(&paths, key))
}
