use tauri::{AppHandle, Emitter, Manager};
use crate::state::CryptoSession;
use crate::AppState;
use serde_json::{json, Value};
use argon2::{Argon2, Algorithm, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use rand::{Rng, RngCore};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, LazyLock, Mutex, RwLock,
    },
    time::Duration,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305,
    Key,
    Nonce,
};

static ACCOUNT_CACHE: LazyLock<RwLock<HashMap<u64, Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static CACHE_INDEX_CACHE: LazyLock<RwLock<HashMap<u64, Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static CHAT_SETTINGS_CACHE: LazyLock<RwLock<HashMap<(u64, i64), Value>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static DERIVE_KEY_CACHE: LazyLock<RwLock<HashMap<(String, String), [u8; 32]>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static PENDING_WRITES: LazyLock<Mutex<HashMap<PathBuf, (Value, Option<[u8; 32]>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static SCHEDULED_PATHS: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn save_coalesced(path: PathBuf, value: Value, key: Option<[u8; 32]>, delay: Duration) {
    {
        let mut pending = PENDING_WRITES.lock().unwrap();
        pending.insert(path.clone(), (value, key));
    }

    let should_spawn = {
        let mut scheduled = SCHEDULED_PATHS.lock().unwrap();
        scheduled.insert(path.clone())
    };

    if should_spawn {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(delay).await;

                let item = {
                    let mut pending = PENDING_WRITES.lock().unwrap();
                    pending.remove(&path)
                };

                if let Some((val, k)) = item {
                    let path_clone = path.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        Storage::new(k).save_direct(&path_clone, &val)
                    })
                    .await;
                }

                let done = {
                    let pending = PENDING_WRITES.lock().unwrap();
                    if pending.contains_key(&path) {
                        false
                    } else {
                        let mut scheduled = SCHEDULED_PATHS.lock().unwrap();
                        scheduled.remove(&path);
                        true
                    }
                };

                if done {
                    break;
                }
            }
        });
    }
}

pub(crate) struct Storage {
    key: Option<[u8;32]>
}

impl Storage {
    pub(crate) fn new(
        key: Option<[u8;32]>
    ) -> Self {
        Self { key }
    }

    fn encrypt(
        data: &[u8],
        key: &[u8; 32],
    ) -> Result<Vec<u8>, String> {
        let cipher = ChaCha20Poly1305::new(
            &Key::from(*key)
        );

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let nonce = Nonce::from(nonce_bytes);

        let encrypted = cipher.encrypt(
            &nonce,
            data
        ).map_err(|e| e.to_string())?;

        let mut result = Vec::with_capacity(15 + encrypted.len());

        result.extend_from_slice(b"ENC");
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&encrypted);

        Ok(result)
    }

    pub fn decrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        if !data.starts_with(b"ENC") {
            return Ok(data.to_vec());
        }

        if data.len() < 15 {
            return Err("Encrypted data too short".into());
        }

        let cipher = ChaCha20Poly1305::new(
            &Key::from(*key)
        );

        let nonce = Nonce::try_from(&data[3..15]).map_err(|e| e.to_string())?;

        let encrypted = &data[15..];

        cipher.decrypt(&nonce, encrypted).map_err(|e| e.to_string())
    }

    pub(crate) fn load(&self, path: impl AsRef<Path>) -> Option<Value> {
        let path_ref = path.as_ref();
        if let Ok(guard) = PENDING_WRITES.lock() {
            if let Some((val, _)) = guard.get(path_ref) {
                return Some(val.clone());
            }
        }

        let bytes = fs::read(path_ref).ok()?;

        let bytes = if bytes.starts_with(b"ENC") {
            let key = self.key?;
            Self::decrypt(&bytes, &key).ok()?
        } else {
            bytes
        };

        rmp_serde::from_slice(&bytes).ok()
    }

    pub(crate) fn save_direct(
        &self,
        path: impl AsRef<Path>,
        value: &Value,
    ) -> Result<(), String> {
        let path = path.as_ref();
        if let Ok(mut guard) = PENDING_WRITES.lock() {
            guard.remove(path);
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| e.to_string())?;
        }

        let mut bytes = rmp_serde::to_vec(value)
            .map_err(|e| e.to_string())?;

        if let Some(key) = &self.key {
            bytes = Self::encrypt(
                &bytes,
                key,
            )?;
        }

        fs::write(path, bytes)
            .map_err(|e| e.to_string())
    }

    pub(crate) fn save(
        &self,
        path: impl AsRef<Path>,
        value: &Value,
    ) -> Result<(), String> {
        self.save_direct(path, value)
    }

    pub(crate) fn save_coalesced(
        &self,
        path: impl AsRef<Path>,
        value: &Value,
    ) {
        save_coalesced(
            path.as_ref().to_path_buf(),
            value.clone(),
            self.key,
            Duration::from_millis(150),
        );
    }

    fn list(
        dir:impl AsRef<Path>
    )->Vec<PathBuf>{
        let mut result = fs::read_dir(dir)
            .ok()
            .into_iter()
            .flat_map(|x| x.flatten())
            .map(|x| x.path())
            .collect::<Vec<_>>();
            result.sort();
            result
    }
}

pub(crate) fn crypto_key(
    app: &AppHandle,
    account: u64
) -> Option<[u8;32]> {
    app.state::<AppState>()
        .crypto
        .read()
        .unwrap()
        .as_ref()
        .filter(|x|x.account == account)
        .map(|x| x.key)
}

pub(crate) struct Paths {
    pub(crate) root: PathBuf,
    pub(crate) cache: PathBuf,
}

impl Paths {
    pub(crate) fn new(
        app: &AppHandle,
        account: u64,
    ) -> Self {
        Self {
            root: app.path().app_data_dir().unwrap().join("data").join(account.to_string()),
            cache: app.path().app_data_dir().unwrap().join("cache").join(account.to_string()),
        }
    }

    fn contacts(&self) -> PathBuf {
        self.root.join("contacts")
    }

    fn contact(
        &self,
        id: u64,
    ) -> PathBuf {
        self.contacts().join(format!("{id}"))
    }

    fn chats(&self) -> PathBuf {
        self.root.join("chats")
    }

    fn chat(&self, id: i64) -> PathBuf {
        self.chats().join(id.to_string())
    }

    fn info(&self, chat: i64) -> PathBuf {
        self.chat(chat).join("info")
    }

    pub(crate) fn settings(&self, chat: i64) -> PathBuf {
        self.chat(chat).join("settings")
    }

    fn messages(&self, chat: i64) -> PathBuf {
        self.chat(chat).join("messages")
    }

    fn cache_index(&self) -> PathBuf {
        self.cache.join("index")
    }

    fn cache_files(&self) -> PathBuf {
        self.cache.join("files")
    }

    pub(crate) fn cache_file(&self, name: &str) -> PathBuf {
        self.cache_files().join(name)
    }

    pub fn sync_state(&self) -> PathBuf {
        self.root.join("sync_state")
    }

    pub fn user_settings(&self) -> PathBuf {
        self.root.join("user_settings")
    }

    pub fn webapps(&self) -> PathBuf {
        self.root.join("webapps")
    }

    pub fn webapp(&self, bot_id: &str) -> PathBuf {
        let safe_name: String = bot_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        let name = if safe_name.is_empty() {
            "default".to_string()
        } else {
            safe_name
        };
        self.webapps().join(name)
    }
}

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

        for mut chat in chats {
            let chat_id = chat.get("id").and_then(|v| {
                v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
            });

            if let Some(id) = chat_id {
                let path = paths.info(id);
                let missing_ddu = chat.get("dontDisturbUntil").map(|v| v.is_null()).unwrap_or(true);
                if missing_ddu {
                    if let Some(existing) = storage.load(&path) {
                        if let Some(ddu) = existing.get("dontDisturbUntil") {
                            if !ddu.is_null() {
                                if let Some(obj) = chat.as_object_mut() {
                                    obj.insert("dontDisturbUntil".to_string(), ddu.clone());
                                }
                            }
                        }
                    }
                }
                storage.save(path, &chat)?;
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

const MAX_CHUNK_MESSAGES: usize = 100;

pub fn load_messages_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    time: i64,
    amount: usize,
) -> Result<Vec<Value>, String> {
    let key = crypto_key(app, account);
    let storage = Storage::new(key);
    let dir = Paths::new(app, account).messages(chat_id);

    let mut files = Storage::list(dir);

    files.retain(|x| {
        x.file_name()
            .and_then(|x| x.to_str())
            .map(|x| x.starts_with("1_"))
            .unwrap_or(false)
    });

    if files.is_empty() {
        return Ok(vec![]);
    }

    let target_time = if time <= 0 {
        chrono::Utc::now().timestamp_millis() + 86400000
    } else {
        time
    };

    let target_day = chrono::DateTime::from_timestamp(target_time / 1000, 0)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default();

    let mut result: Vec<Value> = Vec::new();

    for file in files.into_iter().rev() {
        let file_name = match file.file_name().and_then(|x| x.to_str()) {
            Some(n) => n,
            None => continue,
        };

        let file_day = if file_name.len() >= 12 && file_name.starts_with("1_") {
            &file_name[2..12.min(file_name.len())]
        } else {
            ""
        };

        if !target_day.is_empty() && !file_day.is_empty() && file_day > target_day.as_str() {
            continue;
        }

        let mut data: Vec<Value> = storage
            .load(&file)
            .and_then(|x| x.as_array().cloned())
            .unwrap_or_default();

        let orig_len = data.len();
        data.retain(|x| {
            let is_sending = x.get("sending").and_then(|s| s.as_bool()).unwrap_or(false)
                || x.get("status").and_then(|s| s.as_i64()) == Some(0)
                || x.get("status").and_then(|s| s.as_str()) == Some("sending");
            !is_sending
        });
        if data.len() != orig_len {
            storage.save_coalesced(file.clone(), &Value::Array(data.clone()));
        }

        let mut left = 0;
        let mut right = data.len();

        while left < right {
            let mid = (left + right) / 2;
            let msg_time = data[mid].get("time").and_then(|x| x.as_i64()).unwrap_or(0);

            if msg_time <= target_time {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        if left > 0 {
            result.splice(0..0, data[..left].iter().cloned());

            if result.len() > amount {
                let remove = result.len() - amount;
                result.drain(0..remove);
            }

            if result.len() >= amount {
                break;
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn load_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    time: i64,
    amount: usize,
) -> Result<Vec<Value>, String> {
    tokio::task::spawn_blocking(move || {
        load_messages_sync(&app, account, chat_id, time, amount)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn compute_tokens_diff(old_text: &str, new_text: &str) -> Vec<Value> {
    let old_tokens: Vec<&str> = old_text.split_inclusive(|c: char| c.is_whitespace()).collect();
    let new_tokens: Vec<&str> = new_text.split_inclusive(|c: char| c.is_whitespace()).collect();
    let m = old_tokens.len();
    let n = new_tokens.len();

    if m == 0 && n == 0 {
        return vec![];
    }
    if m == 0 {
        return vec![json!({ "op": "+", "text": new_text })];
    }
    if n == 0 {
        return vec![json!({ "op": "-", "text": old_text })];
    }

    let mut dp = vec![vec![0u16; n + 1]; m + 1];
    for i in 0..m {
        for j in 0..n {
            if old_tokens[i] == new_tokens[j] {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = dp[i][j + 1].max(dp[i + 1][j]);
            }
        }
    }

    let mut i = m;
    let mut j = n;
    let mut raw_diff = Vec::new();

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_tokens[i - 1] == new_tokens[j - 1] {
            raw_diff.push(("=", old_tokens[i - 1].to_string()));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            raw_diff.push(("+", new_tokens[j - 1].to_string()));
            j -= 1;
        } else if i > 0 && (j == 0 || dp[i][j - 1] < dp[i - 1][j]) {
            raw_diff.push(("-", old_tokens[i - 1].to_string()));
            i -= 1;
        }
    }

    raw_diff.reverse();

    let mut merged: Vec<Value> = Vec::new();
    for (op, text) in raw_diff {
        if let Some(last) = merged.last_mut() {
            if last.get("op").and_then(|x| x.as_str()) == Some(op) {
                if let Some(t) = last.get_mut("text") {
                    if let Some(s) = t.as_str() {
                        *t = json!(format!("{}{}", s, text));
                        continue;
                    }
                }
            }
        }
        merged.push(json!({ "op": op, "text": text }));
    }

    merged
}

fn compute_attaches_diff(old_attaches: &[Value], new_attaches: &[Value]) -> Value {
    let mut added = Vec::new();
    let mut removed = Vec::new();

    for new_att in new_attaches {
        if !old_attaches.contains(new_att) {
            added.push(new_att.clone());
        }
    }
    for old_att in old_attaches {
        if !new_attaches.contains(old_att) {
            removed.push(old_att.clone());
        }
    }

    json!({
        "added": added,
        "removed": removed
    })
}

fn clean_sending_and_cids(saved: &mut Vec<Value>, incoming: &[Value]) {
    let incoming_cids: Vec<i64> = incoming.iter()
        .filter_map(|m| m.get("cid").and_then(|x| x.as_i64()))
        .collect();

    saved.retain(|m| {
        let is_sending = m.get("sending").and_then(|x| x.as_bool()).unwrap_or(false)
            || m.get("status").and_then(|x| x.as_i64()) == Some(0)
            || m.get("status").and_then(|x| x.as_str()) == Some("sending");

        if is_sending {
            return false;
        }

        if let Some(m_cid) = m.get("cid").and_then(|x| x.as_i64()) {
            if incoming_cids.contains(&m_cid) {
                let matching_incoming_id = incoming.iter()
                    .find(|inc| inc.get("cid").and_then(|x| x.as_i64()) == Some(m_cid))
                    .and_then(|inc| inc.get("id"));
                if matching_incoming_id.is_some() && m.get("id") != matching_incoming_id {
                    return false;
                }
            }
        }

        true
    });
}

fn merge_single_message(old: &mut Value, message: &Value) {
    let old_text = old.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let new_text = message.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let empty_vec = vec![];
    let old_atts = old.get("attaches").and_then(|x| x.as_array()).unwrap_or(&empty_vec).clone();
    let new_atts = message.get("attaches").and_then(|x| x.as_array()).unwrap_or(&empty_vec).clone();

    let text_changed = old_text != new_text && !new_text.is_empty() && !old_text.is_empty();
    let atts_changed = old_atts != new_atts && message.get("attaches").is_some();
    let is_edited_status = message.get("status").and_then(|x| x.as_str()) == Some("EDITED")
        || message.get("edited").and_then(|x| x.as_bool()).unwrap_or(false);
    let is_deleted_status = message.get("deleted").and_then(|x| x.as_bool()).unwrap_or(false)
        || message.get("status").and_then(|x| x.as_str()) == Some("REMOVED");

    let was_deleted = old.get("deleted").and_then(|x| x.as_bool()).unwrap_or(false);
    let old_deleted_at = old.get("deleted_at").cloned();
    let was_edited = old.get("edited").and_then(|x| x.as_bool()).unwrap_or(false);
    let old_edited_at = old.get("edited_at").cloned();

    let incoming_has_history = message.get("history")
        .and_then(|x| x.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false);

    if (text_changed || atts_changed) && !incoming_has_history {
        let at = chrono::Utc::now().timestamp_millis();
        let text_diff = if text_changed {
            compute_tokens_diff(&old_text, &new_text)
        } else {
            vec![]
        };
        let atts_diff = if atts_changed {
            Some(compute_attaches_diff(&old_atts, &new_atts))
        } else {
            None
        };

        if let Some(obj) = old.as_object_mut() {
            let history = obj.entry("history").or_insert_with(|| Value::Array(vec![]));
            if let Value::Array(arr) = history {
                let mut entry = serde_json::Map::new();
                entry.insert("at".to_string(), json!(at));
                if !text_diff.is_empty() {
                    entry.insert("diff".to_string(), json!(text_diff));
                }
                if let Some(ad) = atts_diff {
                    entry.insert("attaches_diff".to_string(), ad);
                }
                arr.push(Value::Object(entry));
            }
            obj.insert("edited".to_string(), json!(true));
            obj.insert("edited_at".to_string(), json!(at));
        }
    }

    if let Some(incoming_history) = message.get("history").and_then(|x| x.as_array()) {
        if let Some(obj) = old.as_object_mut() {
            let history = obj.entry("history").or_insert_with(|| Value::Array(vec![]));
            if let Value::Array(arr) = history {
                for item in incoming_history {
                    let is_dup = arr.iter().any(|existing| {
                        existing == item
                            || (existing.get("diff").is_some() && existing.get("diff") == item.get("diff"))
                    });
                    if !is_dup {
                        arr.push(item.clone());
                    }
                }
            }
        }
    }

    if let Some(map) = message.as_object() {
        for (key, value) in map {
            if key == "history" || key == "deleted" || key == "deleted_at" || key == "edited" || key == "edited_at" {
                continue;
            }
            old.as_object_mut().unwrap().insert(key.clone(), value.clone());
        }
    }

    if let Some(obj) = old.as_object_mut() {
        if was_deleted || is_deleted_status {
            obj.insert("deleted".to_string(), json!(true));
            if let Some(at) = old_deleted_at {
                obj.insert("deleted_at".to_string(), at);
            } else if !obj.contains_key("deleted_at") {
                obj.insert("deleted_at".to_string(), json!(chrono::Utc::now().timestamp_millis()));
            }
        }
        if was_edited || is_edited_status {
            obj.insert("edited".to_string(), json!(true));
            if let Some(at) = old_edited_at {
                obj.insert("edited_at".to_string(), at);
            } else if !obj.contains_key("edited_at") {
                obj.insert("edited_at".to_string(), json!(chrono::Utc::now().timestamp_millis()));
            }
        }
    }
}

pub fn update_messages_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    messages: Vec<Value>,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    let storage = Storage::new(key);
    let dir = Paths::new(app, account).messages(chat_id);

    let mut bulks: std::collections::HashMap<String, Vec<Value>> = std::collections::HashMap::new();

    for message in messages {
        let time = message.get("time")
            .and_then(|x| x.as_i64())
            .or_else(|| message.get("editTime").and_then(|x| x.as_i64()))
            .or_else(|| message.get("created_at").and_then(|x| x.as_i64()))
            .or_else(|| message.get("deleted_at").and_then(|x| x.as_i64()))
            .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let day = chrono::DateTime::from_timestamp(time / 1000, 0)
            .unwrap_or_else(|| chrono::Utc::now())
            .format("%Y-%m-%d")
            .to_string();
        bulks.entry(day).or_default().push(message);
    }

    for (day, incoming) in bulks {
        let day_prefix = format!("1_{}_", day);
        let legacy_name = format!("1_{}", day);

        let mut day_files: Vec<PathBuf> = Storage::list(&dir)
            .into_iter()
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.starts_with(&day_prefix) || s == legacy_name)
                    .unwrap_or(false)
            })
            .collect();
        day_files.sort();

        let mut to_process = incoming;
        to_process.retain(|m| {
            let is_sending = m.get("sending").and_then(|s| s.as_bool()).unwrap_or(false)
                || m.get("status").and_then(|s| s.as_i64()) == Some(0)
                || m.get("status").and_then(|s| s.as_str()) == Some("sending");
            !is_sending
        });

        if to_process.is_empty() {
            continue;
        }

        let mut unhandled = Vec::new();

        for message in to_process {
            let id = message.get("id").cloned();
            let mut found = false;

            if let Some(id) = id {
                for file in day_files.iter().rev() {
                    let mut saved: Vec<Value> = storage
                        .load(file)
                        .and_then(|x| x.as_array().cloned())
                        .unwrap_or_default();

                    let orig_len = saved.len();
                    clean_sending_and_cids(&mut saved, std::slice::from_ref(&message));

                    if let Some(old) = saved.iter_mut().find(|x| x.get("id") == Some(&id)) {
                        merge_single_message(old, &message);
                        saved.sort_by_key(|x| x.get("time").and_then(|t| t.as_i64()).unwrap_or(0));
                        storage.save_coalesced(file.clone(), &Value::Array(saved));
                        found = true;
                        break;
                    } else if saved.len() != orig_len {
                        storage.save_coalesced(file.clone(), &Value::Array(saved));
                    }
                }
            }

            if !found {
                unhandled.push(message);
            }
        }

        if unhandled.is_empty() {
            continue;
        }

        unhandled.sort_by_key(|x| x.get("time").and_then(|t| t.as_i64()).unwrap_or(0));

        let mut remaining = unhandled.as_slice();

        if let Some(last_file) = day_files.last() {
            let mut saved: Vec<Value> = storage
                .load(last_file)
                .and_then(|x| x.as_array().cloned())
                .unwrap_or_default();

            clean_sending_and_cids(&mut saved, remaining);

            if saved.len() < MAX_CHUNK_MESSAGES {
                let capacity = MAX_CHUNK_MESSAGES - saved.len();
                let take_count = capacity.min(remaining.len());
                saved.extend_from_slice(&remaining[..take_count]);
                saved.sort_by_key(|x| x.get("time").and_then(|t| t.as_i64()).unwrap_or(0));
                storage.save_coalesced(last_file.clone(), &Value::Array(saved));
                remaining = &remaining[take_count..];
            }
        }

        let mut next_idx = if let Some(last_file) = day_files.last() {
            let last_name = last_file.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if let Some(suffix) = last_name.strip_prefix(&day_prefix) {
                suffix.parse::<usize>().unwrap_or(0) + 1
            } else {
                1
            }
        } else {
            0
        };

        while !remaining.is_empty() {
            let take_count = MAX_CHUNK_MESSAGES.min(remaining.len());
            let chunk_items = &remaining[..take_count];
            let chunk_file = dir.join(format!("1_{}_{:04}", day, next_idx));
            storage.save_coalesced(chunk_file, &Value::Array(chunk_items.to_vec()));
            next_idx += 1;
            remaining = &remaining[take_count..];
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn update_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    messages: Vec<Value>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        update_messages_sync(&app, account, chat_id, messages)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn mark_message_deleted_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    message_id: &str,
) -> Result<(), String> {
    let key = crypto_key(app, account);
    let storage = Storage::new(key);
    let dir = Paths::new(app, account).messages(chat_id);

    let mut files = Storage::list(&dir);
    files.retain(|x| {
        x.file_name()
            .and_then(|x| x.to_str())
            .map(|x| x.starts_with("1_"))
            .unwrap_or(false)
    });

    for file in files.into_iter().rev() {
        let mut saved: Vec<Value> = storage
            .load(&file)
            .and_then(|x| x.as_array().cloned())
            .unwrap_or_default();

        let mut modified = false;
        for msg in saved.iter_mut() {
            let mid = msg.get("id").map(|x| x.to_string().replace('"', ""));
            if mid.as_deref() == Some(message_id) {
                if let Some(obj) = msg.as_object_mut() {
                    obj.insert("deleted".to_string(), json!(true));
                    obj.insert("deleted_at".to_string(), json!(chrono::Utc::now().timestamp_millis()));
                    modified = true;
                }
            }
        }

        if modified {
            storage.save_coalesced(file, &Value::Array(saved));
            break;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn mark_message_deleted(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    message_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        mark_message_deleted_sync(&app, account, chat_id, &message_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn clear_local_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<(), String> {
    let dir = Paths::new(&app, account).messages(chat_id);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(())
}


fn accounts_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("accounts")
}

pub(crate) fn load_accounts(app: &AppHandle) -> Value {
    Storage::new(None)
        .load(accounts_path(app))
        .unwrap_or_else(|| {
            json!({
                "accounts": [],
                "current": null
            })
        })
}

fn save_accounts(
    app:&AppHandle,
    data:&Value,
)->Result<(),String>{
    Storage::new(None).save(accounts_path(app), data)
}

fn account_path(
    app: &AppHandle,
    id: &str,
    file: &str,
) -> PathBuf {
    Paths::new(app, id.parse().unwrap()).root.join(file)
}

#[tauri::command]
pub fn accounts_get(
    app: AppHandle,
) -> Result<Value, String> {
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
pub async fn account_get(
    app: AppHandle,
    id: u64,
) -> Result<Value, String> {
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
pub fn account_delete(
    app: AppHandle,
    id: u64,
) -> Result<(), String> {
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

    save_accounts(&app,&store)?;

    let path = app.path().app_data_dir().unwrap().join("data").join(id.to_string());

    if path.exists() {
        fs::remove_dir_all(path)
        .map_err(|e|e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn account_delete_by_uid(
    app: AppHandle,
    uid: Value,
) -> Result<(), String> {
    let store = load_accounts(&app);

    let id = store["accounts"].as_array().unwrap()
        .iter().find(|x| x["uid"] == uid).and_then(|x| x["id"].as_u64())
        .ok_or("Account not found")?;

    account_delete(app, id)
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
pub fn current_get(
    app: AppHandle,
) -> Result<Value, String> {
    Ok(
        load_accounts(&app)["current"].clone()
    )
}

#[tauri::command]
pub fn current_set(
    app: AppHandle,
    id: Option<u64>,
) -> Result<(), String> {
    let mut store = load_accounts(&app);

    if let Some(ref id) = id {
        if !store["accounts"]
            .as_array().unwrap().iter().any(|x| x["id"] == *id){
                return Err("Account not found".into());
            }
    }

    store["current"] = id.map(Value::from).unwrap_or(Value::Null);
    save_accounts(&app, &store)
}

#[tauri::command]
pub async fn current_account_meta(
    app: AppHandle,
) -> Result<Value, String> {
    let id = current_get(app.clone())?;

    if id.is_null() {
        return Ok(Value::Null);
    }

    account_get(
        app, id.as_u64().expect("Wrong account id")
    ).await
}

#[tauri::command]
pub async fn account_meta(
    app: AppHandle,
    id: u64,
) -> Result<Value, String> {
    account_get(
        app, id
    ).await
}

#[tauri::command]
pub fn current_account(
    app:AppHandle,
)->Result<Value,String>{
    let id = current_get(app.clone())?;

    if id.is_null(){
        return Ok(Value::Null);
    }

    let store = load_accounts(&app);

    let account = store["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == id)
        .unwrap();

    Ok(json!({
        "id": account["id"],
        "encryption": account["encryption"]
    }))
}

#[tauri::command]
pub fn current_account_set(
    app: AppHandle,
    id: Option<u64>,
) -> Result<(), String> {
    current_set(app, id)
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
            return Err(
                "Account not encrypted".into()
            );
        }

        let salt = encryption["salt"]
            .as_str()
            .unwrap();

        let derived =
            derive_key(
                &key,
                salt
            )?;

        if !verify_hash(
            &derived,
            encryption["hash"]
                .as_str()
                .unwrap()
        ) {
            return Err(
                "Wrong key".into()
            );
        }

        *app.state::<AppState>()
            .crypto
            .write()
            .unwrap() = Some(
            CryptoSession{
                account,
                key: derived
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

fn collect_db_files(root: &Path) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !name.contains(".tmp") {
                    files.push(path.to_path_buf());
                }
            }
        }
    }
    files.sort();
    files
}

fn collect_all_account_files(paths: &Paths) -> Vec<PathBuf> {
    let mut files = collect_db_files(&paths.root);
    files.extend(collect_db_files(&paths.cache));
    files.sort();
    files
}

#[tauri::command]
pub fn get_database_files_count(
    app: AppHandle,
    account: u64,
) -> Result<usize, String> {
    let paths = Paths::new(&app, account);
    Ok(collect_all_account_files(&paths).len())
}

fn migrate_file_encrypt(path: &Path, key: &[u8; 32]) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.starts_with(b"ENC") {
        return Ok(());
    }
    let encrypted = Storage::encrypt(&bytes, key)?;
    let tmp_path = path.with_extension("tmp_enc");
    if fs::write(&tmp_path, &encrypted).is_ok() && fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }
    let _ = fs::remove_file(&tmp_path);
    fs::write(path, encrypted).map_err(|e| e.to_string())
}

fn migrate_file_decrypt(path: &Path, key: &[u8; 32]) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"ENC") {
        return Ok(());
    }
    let decrypted = Storage::decrypt(&bytes, key)?;
    let tmp_path = path.with_extension("tmp_dec");
    if fs::write(&tmp_path, &decrypted).is_ok() && fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }
    let _ = fs::remove_file(&tmp_path);
    fs::write(path, decrypted).map_err(|e| e.to_string())
}

fn migrate_all_files(
    app: &AppHandle,
    files: Vec<PathBuf>,
    key: &[u8; 32],
    encrypt: bool,
) -> Result<(), String> {
    let total = files.len();
    let phase = if encrypt { "encrypt" } else { "decrypt" };

    if total == 0 {
        let _ = app.emit(
            "encryption-migration-progress",
            json!({
                "current": 0,
                "total": 0,
                "percent": 100,
                "phase": phase
            }),
        );
        return Ok(());
    }

    let _ = app.emit(
        "encryption-migration-progress",
        json!({
            "current": 0,
            "total": total,
            "percent": 0,
            "phase": phase
        }),
    );

    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let num_workers = cpus.min(total).clamp(1, 16);

    let files = Arc::new(files);
    let next_idx = Arc::new(AtomicUsize::new(0));
    let done_counter = Arc::new(AtomicUsize::new(0));
    let error_slot = Arc::new(std::sync::Mutex::new(None::<String>));
    let key = *key;

    let mut handles = Vec::with_capacity(num_workers);

    for _ in 0..num_workers {
        let files = Arc::clone(&files);
        let next_idx = Arc::clone(&next_idx);
        let done_counter = Arc::clone(&done_counter);
        let error_slot = Arc::clone(&error_slot);
        let app = app.clone();

        handles.push(std::thread::spawn(move || {
            loop {
                if error_slot.lock().unwrap().is_some() {
                    break;
                }

                let idx = next_idx.fetch_add(1, Ordering::Relaxed);
                if idx >= total {
                    break;
                }

                let path = &files[idx];
                let res = if encrypt {
                    migrate_file_encrypt(path, &key)
                } else {
                    migrate_file_decrypt(path, &key)
                };

                if let Err(err) = res {
                    *error_slot.lock().unwrap() = Some(err);
                    break;
                }

                let done = done_counter.fetch_add(1, Ordering::Relaxed) + 1;
                let percent = ((done as f64 / total as f64) * 100.0).round() as usize;
                let step = (total / 50).max(1);
                if done == total || done == 1 || done % step == 0 {
                    let _ = app.emit(
                        "encryption-migration-progress",
                        json!({
                            "current": done,
                            "total": total,
                            "percent": percent,
                            "phase": phase
                        }),
                    );
                }
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    if let Some(err) = error_slot.lock().unwrap().take() {
        return Err(err);
    }

    let _ = app.emit(
        "encryption-migration-progress",
        json!({
            "current": total,
            "total": total,
            "percent": 100,
            "phase": phase
        }),
    );

    Ok(())
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

fn generate_salt() -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    STANDARD.encode(salt)
}

fn derive_key(password: &str, salt: &str) -> Result<[u8; 32], String> {
    let cache_key = (password.to_string(), salt.to_string());
    if let Ok(guard) = DERIVE_KEY_CACHE.read() {
        if let Some(cached) = guard.get(&cache_key) {
            return Ok(*cached);
        }
    }

    let salt_bytes = STANDARD.decode(salt).map_err(|e| e.to_string())?;

    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::default(),
    );

    let mut key = [0u8; 32];

    argon
        .hash_password_into(password.as_bytes(), &salt_bytes, &mut key)
        .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = DERIVE_KEY_CACHE.write() {
        guard.insert(cache_key, key);
    }

    Ok(key)
}

fn hash_key(key: &[u8; 32]) -> String {
    let first = Sha256::digest(key);
    let second = Sha256::digest(first);
    STANDARD.encode(second)
}

fn verify_hash(key: &[u8; 32], hash: &str) -> bool {
    hash_key(key) == hash
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

    let cached_opt = if let Ok(guard) = CACHE_INDEX_CACHE.read() {
        guard.get(&account).cloned()
    } else {
        None
    };

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

    fs::create_dir_all(paths.cache_files())
        .map_err(|e| e.to_string())?;

    let file = paths.cache_file(&hash(&src));

    if !file.exists() || fs::metadata(&file).map(|m| m.len()).unwrap_or(0) == 0 {
        let to_write = if let Some(ref k) = key {
            Storage::encrypt(&bytes, k)?
        } else {
            bytes.clone()
        };
        fs::write(&file, &to_write)
            .map_err(|e| e.to_string())?;
    }

    let cached_opt = if let Ok(guard) = CACHE_INDEX_CACHE.read() {
        guard.get(&account).cloned()
    } else {
        None
    };

    let mut index = match cached_opt {
        Some(idx) => idx,
        None => storage
            .load(paths.cache_index())
            .unwrap_or(json!({})),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    index[&src] = json!([
        file.to_string_lossy(),
        (bytes.len() + 1023) / 1024,
        chat_id,
        media_type,
        now
    ]);

    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
        guard.insert(account, index.clone());
    }

    storage.save_coalesced(paths.cache_index(), &index);

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

    let cached_opt = if let Ok(guard) = CACHE_INDEX_CACHE.read() {
        guard.get(&account).cloned()
    } else {
        None
    };

    let mut index = match cached_opt {
        Some(idx) => idx,
        None => storage
            .load(paths.cache_index())
            .unwrap_or(json!({})),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    index[&alias] = json!([
        file_path,
        size_kb,
        chat_id,
        media_type,
        now
    ]);

    if let Ok(mut guard) = CACHE_INDEX_CACHE.write() {
        guard.insert(account, index.clone());
    }

    storage.save_coalesced(paths.cache_index(), &index);

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

    let cached_opt = if let Ok(guard) = CACHE_INDEX_CACHE.read() {
        guard.get(&account).cloned()
    } else {
        None
    };

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

pub(crate) fn hash(src: &str) -> String {
    let mut hash: u32 = 2166136261;

    for b in src.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(16777619);
    }

    base36(hash)
}

fn base36(mut value: u32) -> String {
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

#[tauri::command]
pub async fn get_device(app: AppHandle) -> Value {
    tokio::task::spawn_blocking(move || {
        Storage::new(None)
            .load(app.path().app_data_dir().unwrap().join("data").join("device"))
            .unwrap_or_else(|| json!(null))
    })
    .await
    .unwrap_or_else(|_| json!(null))
}

#[tauri::command]
pub async fn save_device(
    app: AppHandle,
    device: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        Storage::new(None)
            .save(app.path().app_data_dir().unwrap().join("data").join("device"), &device)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_dictionary(
    app: AppHandle,
    data: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = app.path().app_data_dir().unwrap()
            .join("data")
            .join("dictionary");

        let mut store = Storage::new(None)
            .load(&path)
            .unwrap_or_else(|| json!({
                "url": null,
                "data": null
            }));

        store["data"] = data;

        Storage::new(None).save(&path, &store)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_dictionary(app: AppHandle) -> Value {
    tokio::task::spawn_blocking(move || {
        let path = app.path().app_data_dir().unwrap()
            .join("data")
            .join("dictionary");

        Storage::new(None)
            .load(&path)
            .unwrap_or_else(|| {
                json!({
                    "url": null,
                    "data": null
                })
            })
    })
    .await
    .unwrap_or_else(|_| json!({"url": null, "data": null}))
}

#[tauri::command]
pub async fn get_dictionary_url(app: AppHandle) -> Value {
    tokio::task::spawn_blocking(move || {
        let path = app.path().app_data_dir().unwrap()
            .join("data")
            .join("dictionary");

        let store = Storage::new(None)
            .load(&path)
            .unwrap_or_else(|| {
                json!({
                    "url": null,
                    "data": null
                })
            });

        store.get("url").cloned().unwrap_or(json!(null))
    })
    .await
    .unwrap_or_else(|_| json!(null))
}

#[tauri::command]
pub async fn set_dictionary_url(
    app: AppHandle,
    url: Value,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = app.path().app_data_dir().unwrap()
            .join("data")
            .join("dictionary");

        let mut store = Storage::new(None)
            .load(&path)
            .unwrap_or_else(|| {
                json!({
                    "url": null,
                    "data": null
                })
            });

        store["url"] = url;

        Storage::new(None).save(&path, &store)
    })
    .await
    .map_err(|e| e.to_string())?
}

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

pub fn load_user_settings(
    app: &AppHandle,
    account: u64,
) -> Option<Value> {
    let key = crypto_key(app, account);
    Storage::new(key).load(Paths::new(app, account).user_settings())
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

#[cfg(target_os = "android")]
pub(crate) fn resolve_app_root(app_dir: &str) -> std::path::PathBuf {
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
        eprintln!("Push: Аккаунт {} зашифрован. Отправка из фона невозможна без ключа.", local_id);
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
