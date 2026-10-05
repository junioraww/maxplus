pub mod storage;
pub mod accounts;
pub mod messages;
pub mod cache;
pub mod generic;
pub mod chats;

use tauri::AppHandle;
use serde_json::{json, Value};

use storage::crypto_key;
pub use storage::{Paths, Storage};
pub use accounts::{current_get, load_accounts, update_account_token};
#[cfg(target_os = "android")]
pub use accounts::{get_background_creds, resolve_app_root};
pub use messages::clear_local_messages;
pub use cache::{add_cache_index_alias, get_cached_file_sync, hash, set_cached_file_with_meta};
pub use chats::{get_chat_settings_sync, set_chat_settings_sync};

pub fn load_sync_state<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    account: u64,
) -> Option<T> {
    let key = crypto_key(app, account);
    let val = Storage::new(key).load(Paths::new(app, account).sync_state())?;
    serde_json::from_value(val).ok()
}

pub fn save_sync_state<T: serde::Serialize>(
    app: &AppHandle,
    account: u64,
    state: &T,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    let val = serde_json::to_value(state).map_err(|e| e.to_string())?;
    Storage::new(key).save(Paths::new(app, account).sync_state(), &val)
}

pub fn save_user_settings(
    app: &AppHandle,
    account: u64,
    settings: &Value,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    let paths = Paths::new(app, account);
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
