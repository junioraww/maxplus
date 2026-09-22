use tauri::{AppHandle, Manager};
use crate::state::CryptoSession;
use crate::AppState;
use serde_json::{json, Value};
use argon2::{Argon2, Algorithm, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use rand::{Rng, RngCore};
use std::{
    fs,
    path::{Path, PathBuf},
};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305,
    Key,
    Nonce,
};


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
        data:&[u8], key:&[u8;32]
    )->Result<Vec<u8>,String>{
        let cipher = ChaCha20Poly1305::new(
            &Key::from(*key)
        );

        let mut nonce_bytes = [0u8;12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let nonce = Nonce::from(nonce_bytes);

        let encrypted = cipher.encrypt(
            &nonce,
            data
        ).map_err(|e|e.to_string())?;

        let mut result = Vec::new();

        result.extend_from_slice(b"ENC");
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&encrypted);

        Ok(result)
    }

    fn decrypt(data: &[u8], key: &[u8;32]) -> Result<Vec<u8>, String> {
        if !data.starts_with(b"ENC") {
            return Ok(data.to_vec());
        }

        let cipher = ChaCha20Poly1305::new(
            &Key::from(*key)
        );

        let nonce = Nonce::try_from(&data[3..15]).map_err(|e| e.to_string())?;

        let encrypted = &data[15..];

        cipher.decrypt(&nonce, encrypted).map_err(|e|e.to_string())
    }

    pub(crate) fn load(&self, path: impl AsRef<Path>) -> Option<Value> {
        let bytes = fs::read(path).ok()?;

        let bytes = if bytes.starts_with(b"ENC") {
            let key = self.key?;
            Self::decrypt(&bytes, &key).ok()?
        } else {
            bytes
        };

        rmp_serde::from_slice(&bytes).ok()
    }

    pub(crate) fn save(
        &self,
        path: impl AsRef<Path>,
        value:&Value,
    )->Result<(),String>{
        let path = path.as_ref();

        if let Some(parent)=path.parent(){
            fs::create_dir_all(parent)
                .map_err(|e|e.to_string())?;
        }

        let mut bytes = rmp_serde::to_vec(value)
            .map_err(|e|e.to_string())?;

        if let Some(key)=&self.key {
            bytes = Self::encrypt(
                &bytes,
                key
            )?;
        }

        fs::write(path, bytes)
            .map_err(|e|e.to_string())
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

fn crypto_key(
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

struct Paths {
    root: PathBuf,
    cache: PathBuf,
}

impl Paths {
    fn new(
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

    fn settings(&self, chat: i64) -> PathBuf {
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

    fn cache_file(&self, name: &str) -> PathBuf {
        self.cache_files().join(name)
    }

    pub fn sync_state(&self) -> PathBuf {
        self.root.join("sync_state")
    }

    pub fn user_settings(&self) -> PathBuf {
        self.root.join("user_settings")
    }
}

#[tauri::command]
pub fn get_contact(
    app: AppHandle,
    account: u64,
    contact_id: u64,
) -> Result<Option<Value>, String>{
    let key = crypto_key(&app, account);

    Ok(Storage::new(key)
      .load(
         Paths::new(&app,account)
         .contact(contact_id)
    ))
}

#[tauri::command]
pub fn set_contact(
    app: AppHandle,
    account: u64,
    contact_id: u64,
    data: Value,
) -> Result<(), String>{
    let key = crypto_key(&app,account);

    Storage::new(key).save(
        Paths::new(&app,account)
        .contact(contact_id),
          &data
    )
}

#[tauri::command]
pub fn get_contacts(
    app: AppHandle,
    account: u64,
) -> Result<Vec<Value>, String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);

    Ok(Storage::list(
        Paths::new(&app, account).contacts()
    )
    .into_iter()
    .filter_map(|x| storage.load(x))
    .collect())
}

#[tauri::command]
pub fn save_chats(
    app: AppHandle,
    account: u64,
    chats: Vec<Value>,
) -> Result<(), String> {
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
}

#[tauri::command]
pub fn load_chats(
    app: AppHandle,
    account: u64,
) -> Result<Vec<Value>, String> {
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
}

#[tauri::command]
pub fn get_chat_settings(
    app: AppHandle,
    account: u64,
    chat_id: i64,
) -> Result<Value,String> {
    let key = crypto_key(&app, account);

    Ok(
        Storage::new(key)
        .load(
            Paths::new(&app,account).settings(chat_id)
        )
        .unwrap_or_else(||{
            json!({
                "version":1,
                "keys":{
                    "current":null,
                    "keys":[],
                    "messages":[]
                },
                "password":null,
                "obfs":null,
                "reader":true
            })
        })
    )
}

#[tauri::command]
pub fn set_chat_settings(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    data: Value,
) -> Result<(), String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);
    storage.save(
        Paths::new(&app, account).settings(chat_id), &data
    )
}

#[tauri::command]
pub fn load_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    time: i64,
    amount: usize,
) -> Result<Vec<Value>, String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);
    let dir = Paths::new(&app, account).messages(chat_id);

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

    let target = format!(
        "1_{}",
        chrono::DateTime::from_timestamp(time / 1000, 0)
        .unwrap()
        .format("%Y-%m-%d")
    );

    let mut index = files.iter().position(|x| {
        x.file_name().unwrap().to_string_lossy().as_ref() >= target.as_str()
    })
    .unwrap_or(files.len());

    if index >= files.len() {
        index = files.len() - 1;
    }
    else if files[index].file_name().unwrap().to_string_lossy() != target {
            if index > 0 {
                index -= 1;
            }
        }

        let mut result: Vec<Value> = Vec::new();

        for file in files[..=index].iter().rev() {
            let mut data: Vec<Value> = storage.load(file)
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
                let _ = storage.save(file.clone(), &Value::Array(data.clone()));
            }

            let mut left = 0;
            let mut right = data.len();

            while left < right {
                let mid = (left + right) / 2;
                let msg_time = data[mid].get("time").and_then(|x| x.as_i64()).unwrap_or(0);

                if msg_time <= time {
                    left = mid + 1;
                }
                else {
                    right = mid;
                }
            }

            result.splice(
                0..0, data[..left].iter().cloned()
            );

            if result.len() > amount {
                let remove = result.len() - amount;
                result.drain(0..remove);
            }

            if result.len() >= amount {
                break;
            }
        }

        Ok(result)
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

#[tauri::command]
pub fn update_messages(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    messages: Vec<Value>,
) -> Result<(), String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);
    let dir = Paths::new(&app, account).messages(chat_id);

    let mut bulks: std::collections::HashMap<String, Vec<Value>> = std::collections::HashMap::new();

    for message in messages {
        let time = message.get("time").and_then(|x| x.as_i64()).unwrap_or(0);
        let day = chrono::DateTime::from_timestamp(time / 1000, 0).unwrap().format("%Y-%m-%d").to_string();
        bulks.entry(day).or_default().push(message);
    }

    for (day, incoming) in bulks {
        let file = dir.join(format!("1_{}", day));
        let mut saved: Vec<Value> = storage.load(&file)
            .and_then(|x| x.as_array().cloned())
            .unwrap_or_default();

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

        for message in incoming {
            let is_sending = message.get("sending").and_then(|x| x.as_bool()).unwrap_or(false)
                || message.get("status").and_then(|x| x.as_i64()) == Some(0)
                || message.get("status").and_then(|x| x.as_str()) == Some("sending");

            if is_sending {
                continue;
            }

            let id = message.get("id").cloned();

            if let Some(id) = id {
                if let Some(old) = saved.iter_mut().find(|x| x.get("id") == Some(&id)) {
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
                } else {
                    saved.push(message);
                }
            }
        }

        saved.sort_by_key(|x| {
            x.get("time")
            .and_then(|x| x.as_i64())
            .unwrap_or(0)
        });

        storage.save(file, &Value::Array(saved))?;
    }

    Ok(())
}

#[tauri::command]
pub fn mark_message_deleted(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    message_id: String,
) -> Result<(), String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);
    let dir = Paths::new(&app, account).messages(chat_id);

    let files = Storage::list(&dir);
    for file in files {
        let mut saved: Vec<Value> = storage
            .load(&file)
            .and_then(|x| x.as_array().cloned())
            .unwrap_or_default();

        let mut modified = false;
        for msg in saved.iter_mut() {
            let mid = msg.get("id").map(|x| x.to_string().replace('"', ""));
            if mid.as_deref() == Some(&message_id) {
                if let Some(obj) = msg.as_object_mut() {
                    obj.insert("deleted".to_string(), json!(true));
                    obj.insert("deleted_at".to_string(), json!(chrono::Utc::now().timestamp_millis()));
                    modified = true;
                }
            }
        }

        if modified {
            storage.save(file, &Value::Array(saved))?;
            break;
        }
    }

    Ok(())
}

fn accounts_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap().join("accounts")
}

fn load_accounts(app: &AppHandle) -> Value {
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
pub fn account_get(
    app: AppHandle,
    id: u64,
) -> Result<Value, String> {
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

    Ok(json!({
        "id": account["id"],
        "encryption": account["encryption"],
        "meta": meta,
        "contact": contact
    }))
}


#[tauri::command]
pub fn account_delete(
    app: AppHandle,
    id: u64,
) -> Result<(), String> {
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
pub fn account_contact(
    app: AppHandle,
    id: u64,
    data: Option<Value>
) -> Result<Value, String> {
    let key = crypto_key(&app, id);

    let storage = Storage::new(key);

    if data.is_some() {
        storage.save(account_path(&app, &id.to_string().as_str(), "self"), &data.unwrap());
    }

    Ok(storage
        .load(account_path(&app, &id.to_string().as_str(), "self"))
        .unwrap_or(Value::Null)
    )
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
pub fn current_account_meta(
    app: AppHandle,
) -> Result<Value, String> {
    let id = current_get(app.clone())?;

    if id.is_null() {
        return Ok(Value::Null);
    }

    account_get(
        app, id.as_u64().expect("Wrong account id")
    )
}

#[tauri::command]
pub fn account_meta(
    app: AppHandle,
    id: u64
) -> Result<Value, String> {
    account_get(
        app, id
    )
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
pub fn decrypt_account(
    app: AppHandle,
    account: u64,
    key: String,
) -> Result<(), String> {
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

    Ok(())
}

fn migrate_encrypt(
    root: &Path,
    key: &[u8;32],
) -> Result<(), String>{
    for entry in walkdir::WalkDir::new(root)
    {
        let entry = entry.map_err(|e|e.to_string())?;

        if !entry.file_type().is_file(){
            continue;
        }

        let path = entry.path();

        let value = Storage::new(None)
            .load(path)
            .ok_or(
                "Cannot read file"
            )?;

        Storage::new(Some(*key)).save(
            path,
            &value
        )?;
    }

    Ok(())
}

fn migrate_decrypt(
    root: &Path,
    key: &[u8;32],
)->Result<(),String>{
    for entry in walkdir::WalkDir::new(root) {
        let entry = entry.map_err(|e|e.to_string())?;

        if !entry.file_type().is_file(){
            continue;
        }

        let path = entry.path();

        let value = Storage::new(Some(*key))
            .load(path)
            .ok_or(
                "Cannot decrypt file"
            )?;

        Storage::new(None).save(
            path,
            &value
        )?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_encryption(
    app: AppHandle,
    account: u64,
    key: String,
    enabled: bool,
) -> Result<(), String>{
    let root = Paths::new(
        &app, account
    ).root;

    let mut store = load_accounts(&app);

    let entry = store["accounts"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|x| x["id"] == account)
        .ok_or("Account not found")?;

    if enabled {
        let salt = generate_salt();

        let derived = derive_key(
            &key, &salt
        )?;

        migrate_encrypt(
            &root, &derived
        )?;

        entry["encryption"] = json!({
            "type": "pin-1",
            "salt": salt,
            "hash": hash_key(&derived)
        });

        save_accounts(
            &app,
            &store
        )?;

        *app.state::<AppState>().crypto.write().unwrap() = Some(
            CryptoSession{
                account,
                key:derived
            }
        );
    } else {
        let encryption = &entry["encryption"];

        let salt = encryption["salt"]
        .as_str()
        .unwrap();

        let derived = derive_key(&key, salt)?;

        if !verify_hash(
            &derived,
            encryption["hash"].as_str().unwrap(),
        ) {
            return Err("Wrong key".into());
        }

        migrate_decrypt(
            &root,
            &derived
        )?;

        entry["encryption"] = Value::Null;

        save_accounts(
            &app,
            &store
        )?;

        *app.state::<AppState>().crypto.write().unwrap() = None;
    }

    Ok(())
}

fn generate_salt() -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    STANDARD.encode(salt)
}

fn derive_key(password: &str, salt: &str) -> Result<[u8; 32], String> {
    let salt = STANDARD.decode(salt).map_err(|e| e.to_string())?;

    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::default(),
    );

    let mut key = [0u8; 32];

    argon
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;

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

/* file cache */

#[tauri::command]
pub fn get_cached_file(
    app: AppHandle,
    account: u64,
    src: String,
) -> Result<Option<String>, String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);

    let paths = Paths::new(&app, account);

    let mut index = storage
        .load(paths.cache_index())
        .unwrap_or(json!({}));

    let Some(entry) = index.get(&src) else {
        return Ok(None);
    };

    let path = entry[0]
        .as_str()
        .ok_or("Invalid cache entry")?;

    let full = PathBuf::from(path);

    if !full.exists() {
        if let Some(map) = index.as_object_mut() {
            map.remove(&src);
        }

        storage.save(paths.cache_index(), &index)?;

        return Ok(None);
    }

    Ok(Some(path.to_string()))
}

#[tauri::command]
pub fn set_cached_file(
    app: AppHandle,
    account: u64,
    src: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    set_cached_file_with_meta(app, account, src, bytes, None, None)
}

pub fn set_cached_file_with_meta(
    app: AppHandle,
    account: u64,
    src: String,
    bytes: Vec<u8>,
    chat_id: Option<i64>,
    media_type: Option<String>,
) -> Result<String, String> {
    let key = crypto_key(&app, account);

    let storage = Storage::new(key);

    let paths = Paths::new(&app, account);

    fs::create_dir_all(paths.cache_files())
        .map_err(|e| e.to_string())?;

    let file = paths.cache_file(&hash(&src));

    if !file.exists() || fs::metadata(&file).map(|m| m.len()).unwrap_or(0) == 0 {
        fs::write(&file, &bytes)
            .map_err(|e| e.to_string())?;
    }

    let mut index = storage
        .load(paths.cache_index())
        .unwrap_or(json!({}));

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

    storage.save(paths.cache_index(), &index)?;

    Ok(file.to_string_lossy().to_string())
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

    let mut index = storage
        .load(paths.cache_index())
        .unwrap_or(json!({}));

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

    storage.save(paths.cache_index(), &index)
}

#[tauri::command]
pub fn delete_chat_cache(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    media_type: Option<String>,
) -> Result<usize, String> {
    let key = crypto_key(&app, account);
    let storage = Storage::new(key);
    let paths = Paths::new(&app, account);

    let mut index = storage
        .load(paths.cache_index())
        .unwrap_or(json!({}));

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

    storage.save(paths.cache_index(), &index)?;
    Ok(deleted_count)
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

// settings

#[tauri::command]
pub fn get_device(app: AppHandle) -> Value {
    Storage::new(None)
    .load(app.path().app_data_dir().unwrap().join("data").join("device"))
    .unwrap_or_else(|| {
        json!(null)
    })
}

#[tauri::command]
pub fn save_device(
    app: AppHandle,
    device: Value,
)->Result<(), String>{
    Storage::new(None)
    .save(app.path().app_data_dir().unwrap().join("data").join("device"), &device)
}

#[tauri::command]
pub fn save_dictionary(
    app: AppHandle,
    data: Value,
) -> Result<(), String> {
    let path = app.path().app_data_dir().unwrap()
    .join("data")
    .join("dictionary");

    let mut store = Storage::new(None)
    .load(&path)
    .unwrap_or_else(|| json!({
        "url": null,
        "data": null
    }));

    store["data"] = data.clone();

    Storage::new(None).save(&path, &store)
}

#[tauri::command]
pub fn load_dictionary(app: AppHandle) -> Value {
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
}

#[tauri::command]
pub fn get_dictionary_url(app: AppHandle) -> Value {
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
}

#[tauri::command]
pub fn set_dictionary_url(
    app: AppHandle,
    url: Value,
) -> Result<(), String> {
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

    store["url"] = url.clone();

    Storage::new(None).save(&path, &store)
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
