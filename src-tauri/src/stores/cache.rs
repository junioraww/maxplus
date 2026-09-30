use tauri::AppHandle;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{LazyLock, RwLock},
};

use super::storage::{crypto_key, Paths, Storage};

pub static CACHE_INDEX_CACHE: LazyLock<RwLock<HashMap<u64, Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

pub fn hash(src: &str) -> String {
    let mut hash: u32 = 2166136261;

    for b in src.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(16777619);
    }

    base36(hash)
}

pub fn base36(mut value: u32) -> String {
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

    if value == 0 {
        return "0".into();
    }

    let mut out = Vec::new();

    while value > 0 {
        out.push(CHARS[(value % 36) as usize]);
        value /= 36;
    }

    out.reverse();

    String::from_utf8(out).unwrap()
}

fn update_cache_index_entry(
    storage: &Storage,
    paths: &Paths,
    account: u64,
    key: &str,
    entry: Value,
) {
    let cached_opt = CACHE_INDEX_CACHE.read().ok().and_then(|g| g.get(&account).cloned());
    let mut index = cached_opt.unwrap_or_else(|| storage.load(paths.cache_index()).unwrap_or_else(|| json!({})));
    index[key] = entry;
    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
        guard.insert(account, index.clone());
    }
    storage.save_coalesced(paths.cache_index(), &index);
}

pub fn get_cached_file_sync(
    app: &AppHandle,
    account: u64,
    src: &str,
) -> Result<Option<String>, String> {
    let paths = Paths::new(app, account);
    let direct_file = paths.cache_file(&hash(src));
    if direct_file.exists() && fs::metadata(&direct_file).map(|m| m.len()).unwrap_or(0) > 0 {
        return Ok(Some(direct_file.to_string_lossy().to_string()));
    }

    let cached_opt = CACHE_INDEX_CACHE.read().ok().and_then(|g| g.get(&account).cloned());

    let (mut index, key, storage) = match cached_opt {
        Some(idx) => (idx, None, None),
        None => {
            let key = crypto_key(app, account);
            let storage = Storage::new(key);
            let loaded = storage
                .load(paths.cache_index())
                .unwrap_or(json!({}));
            if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
                guard.insert(account, loaded.clone());
            }
            (loaded, Some(key), Some(storage))
        }
    };

    let Some(entry) = index.get(src) else {
        return Ok(None);
    };

    let path = entry[0]
        .as_str()
        .ok_or("Invalid cache entry")?;

    let full = PathBuf::from(path);

    if !full.exists() {
        if let Some(map) = index.as_object_mut() {
            map.remove(src);
        }

        if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
            guard.insert(account, index.clone());
        }

        let key = key.unwrap_or_else(|| crypto_key(app, account));
        let storage = storage.unwrap_or_else(|| Storage::new(key));
        storage.save_coalesced(paths.cache_index(), &index);

        return Ok(None);
    }

    Ok(Some(path.to_string()))
}

#[tauri::command]
pub async fn get_cached_file(
    app: AppHandle,
    account: u64,
    src: String,
) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        get_cached_file_sync(&app, account, &src)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn set_cached_file_with_meta_sync(
    app: &AppHandle,
    account: u64,
    src: String,
    bytes: Vec<u8>,
    chat_id: Option<i64>,
    media_type: Option<String>,
) -> Result<String, String> {
    let key = crypto_key(app, account);
    let storage = Storage::new(key);
    let paths = Paths::new(app, account);

    fs::create_dir_all(paths.cache_files()).map_err(|e| e.to_string())?;

    let file = paths.cache_file(&hash(&src));

    if !file.exists() || fs::metadata(&file).map(|m| m.len()).unwrap_or(0) == 0 {
        let to_write = if let Some(ref k) = key {
            Storage::encrypt(&bytes, k)?
        } else {
            bytes.clone()
        };
        fs::write(&file, &to_write).map_err(|e| e.to_string())?;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let entry = json!([
        file.to_string_lossy(),
        (bytes.len() + 1023) / 1024,
        chat_id,
        media_type,
        now
    ]);

    update_cache_index_entry(&storage, &paths, account, &src, entry);

    Ok(file.to_string_lossy().to_string())
}

pub fn set_cached_file_with_meta(
    app: AppHandle,
    account: u64,
    src: String,
    bytes: Vec<u8>,
    chat_id: Option<i64>,
    media_type: Option<String>,
) -> Result<String, String> {
    set_cached_file_with_meta_sync(&app, account, src, bytes, chat_id, media_type)
}

#[tauri::command]
pub async fn set_cached_file(
    app: AppHandle,
    account: u64,
    src: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        set_cached_file_with_meta_sync(&app, account, src, bytes, None, None)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn add_cache_index_alias(
    app: AppHandle,
    account: u64,
    alias: String,
    file_path: String,
    size_kb: usize,
    chat_id: Option<i64>,
    media_type: Option<String>,
) -> Result<(), String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);
    let paths = Paths::new(&app, account);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let entry = json!([
        file_path,
        size_kb,
        chat_id,
        media_type,
        now
    ]);

    update_cache_index_entry(&storage, &paths, account, &alias, entry);

    Ok(())
}

pub fn delete_chat_cache_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    media_type: Option<String>,
) -> Result<usize, String> {
    let key = crypto_key(app, account);
    let storage = Storage::new(key);
    let paths = Paths::new(app, account);

    let cached_opt = CACHE_INDEX_CACHE.read().ok().and_then(|g| g.get(&account).cloned());

    let mut index = match cached_opt {
        Some(idx) => idx,
        None => storage
            .load(paths.cache_index())
            .unwrap_or(json!({})),
    };

    let mut to_remove = Vec::new();
    let mut deleted_count = 0;

    if let Some(map) = index.as_object_mut() {
        for (src, entry) in map.iter() {
            if let Some(arr) = entry.as_array() {
                let entry_chat_id = arr.get(2).and_then(|v| v.as_i64());
                let entry_type = arr.get(3).and_then(|v| v.as_str());

                if entry_chat_id == Some(chat_id) {
                    if let Some(ref m_type) = media_type {
                        if entry_type != Some(m_type.as_str()) {
                            continue;
                        }
                    }
                    if let Some(file_path) = arr.get(0).and_then(|v| v.as_str()) {
                        let _ = fs::remove_file(file_path);
                    }
                    to_remove.push(src.clone());
                    deleted_count += 1;
                }
            }
        }
        for src in to_remove {
            map.remove(&src);
        }
    }

    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
        guard.insert(account, index.clone());
    }

    storage.save_coalesced(paths.cache_index(), &index);
    Ok(deleted_count)
}

#[tauri::command]
pub async fn delete_chat_cache(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    media_type: Option<String>,
) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        delete_chat_cache_sync(&app, account, chat_id, media_type)
    })
    .await
    .map_err(|e| e.to_string())?
}
