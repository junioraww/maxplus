use tauri::AppHandle;
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

use super::storage::{crypto_key, Paths, Storage};

const MAX_CHUNK_MESSAGES: usize = 100;

pub fn compute_tokens_diff(old_text: &str, new_text: &str) -> Vec<Value> {
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

pub fn compute_attaches_diff(old_attaches: &[Value], new_attaches: &[Value]) -> Value {
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

pub fn clean_sending_and_cids(saved: &mut Vec<Value>, incoming: &[Value]) {
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

pub fn merge_single_message(old: &mut Value, message: &Value) {
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

            if let Some(ref id) = id {
                for file in day_files.iter().rev() {
                    let mut saved: Vec<Value> = storage
                        .load(file)
                        .and_then(|x| x.as_array().cloned())
                        .unwrap_or_default();

                    let orig_len = saved.len();
                    clean_sending_and_cids(&mut saved, std::slice::from_ref(&message));

                    if let Some(old) = saved.iter_mut().find(|x| x.get("id") == Some(id)) {
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
                if let Some(ref id) = id {
                    let other_files: Vec<PathBuf> = Storage::list(&dir)
                        .into_iter()
                        .filter(|p| !day_files.contains(p))
                        .collect();
                    for file in other_files {
                        let mut saved: Vec<Value> = storage
                            .load(&file)
                            .and_then(|x| x.as_array().cloned())
                            .unwrap_or_default();
                        let orig_len = saved.len();
                        clean_sending_and_cids(&mut saved, std::slice::from_ref(&message));
                        if let Some(old) = saved.iter_mut().find(|x| x.get("id") == Some(id)) {
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

fn modify_message_file<F>(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    mut modify: F,
) -> Result<(), String>
where
    F: FnMut(&mut Vec<Value>) -> bool,
{
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

        if modify(&mut saved) {
            storage.save_coalesced(file, &Value::Array(saved));
            break;
        }
    }

    Ok(())
}

pub fn mark_message_deleted_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    message_id: &str,
) -> Result<(), String> {
    modify_message_file(app, account, chat_id, |saved| {
        for msg in saved.iter_mut() {
            let mid = msg.get("id").map(|x| x.to_string().replace('"', ""));
            if mid.as_deref() == Some(message_id) {
                if let Some(obj) = msg.as_object_mut() {
                    obj.insert("deleted".to_string(), json!(true));
                    obj.insert("deleted_at".to_string(), json!(chrono::Utc::now().timestamp_millis()));
                    return true;
                }
            }
        }
        false
    })
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

pub fn remove_message_from_storage_sync(
    app: &AppHandle,
    account: u64,
    chat_id: i64,
    message_id: &str,
) -> Result<(), String> {
    modify_message_file(app, account, chat_id, |saved| {
        let initial_len = saved.len();
        saved.retain(|msg| {
            let mid = msg.get("id").map(|x| x.to_string().replace('"', ""));
            mid.as_deref() != Some(message_id)
        });
        saved.len() != initial_len
    })
}

#[tauri::command]
pub async fn remove_message_from_storage(
    app: AppHandle,
    account: u64,
    chat_id: i64,
    message_id: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        remove_message_from_storage_sync(&app, account, chat_id, &message_id)
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
