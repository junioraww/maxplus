#[cfg(target_os = "android")]
use jni::{
    objects::{JObject, JString},
    sys::jboolean,
    EnvUnowned,
};
#[cfg(target_os = "android")]
use std::{collections::HashMap, fs, path::PathBuf, time::Duration};
#[cfg(target_os = "android")]
use serde_json::{json, Value};
#[cfg(target_os = "android")]
use tokio::{runtime::Runtime, time::timeout};
#[cfg(target_os = "android")]
use sha2::{Sha256, Digest};

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_ReplyReceiver_sendReplyNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i32,
    chat_id: i64,
    mid: i64,
    text: JString<'local>,
    app_dir: JString<'local>,
) -> jboolean {
    let (rust_text, rust_app_dir) =
        match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
            let t: String = _env.get_string(&text)?.into();
            let a: String = _env.get_string(&app_dir)?.into();
            Ok((t, a))
        }).into_outcome() {
            jni::Outcome::Ok(v) => v,
            _ => return false,
        };

    let rt = match Runtime::new() {
        Ok(r) => r,
        Err(_) => return false,
    };

    let success = rt.block_on(async {
        if let Some((_local_id, server_user_id, token, identity)) =
            crate::stores::get_background_creds(&rust_app_dir, account as u64)
        {
            let network_task = async {
                let mut client = rumax::MaxClient::new();
                client.set_user_id(server_user_id).await;
                client.set_token(token).await;

                if client.connect(identity, false).await.is_ok() {
                    if client.sync(None).await.is_ok() {
                        let mut params = None;
                        if mid != 0 {
                            let mut map = HashMap::new();
                            map.insert("replyTo".to_string(), json!(mid.to_string()));
                            params = Some(map);
                        }

                        let send_result = client.send_message(chat_id, rust_text, params).await;
                        client.disconnect().await;
                        return send_result.is_ok();
                    }
                    client.disconnect().await;
                }
                false
            };

            match timeout(Duration::from_secs(10), network_task).await {
                Ok(result) => result,
                Err(_) => false,
            }
        } else {
            false
        }
    });

    success
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_AvatarHelper_getAvatarPathNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i32,
    id: i64,
    app_dir: JString<'local>,
) -> JString<'local> {
    let rust_app_dir: String = match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
        let a: String = _env.get_string(&app_dir)?.into();
        Ok(a)
    }).into_outcome() {
        jni::Outcome::Ok(v) => v,
        _ => return JString::default(),
    };

    let rt = match Runtime::new() {
        Ok(r) => r,
        Err(_) => return JString::default(),
    };

    let cached_path: Option<String> = rt.block_on(async {
        let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
        let local_id = creds.as_ref().map(|c| c.0).unwrap_or(0);
        let root = PathBuf::from(&rust_app_dir);
        let data_dir = root.join("data").join(local_id.to_string());
        let cache_files_dir = root.join("cache").join(local_id.to_string()).join("files");
        let _ = fs::create_dir_all(&cache_files_dir);

        let mut avatar_url: Option<String> = None;

        let contact_path = data_dir.join("contacts").join(id.to_string());
        if let Ok(bytes) = fs::read(&contact_path) {
            if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
                avatar_url = val.get("baseUrl")
                    .or_else(|| val.get("avatar"))
                    .or_else(|| val.get("iconUrl"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }

        if avatar_url.is_none() {
            let chat_path = data_dir.join("chats").join(id.to_string()).join("info");
            if let Ok(bytes) = fs::read(&chat_path) {
                if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
                    avatar_url = val.get("baseIconUrl")
                        .or_else(|| val.get("iconUrl"))
                        .or_else(|| val.get("baseUrl"))
                        .or_else(|| val.get("avatar"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }

        if avatar_url.is_none() {
            if let Some((_, server_user_id, token, identity)) = creds {
                let fetch_task = async {
                    let mut client = rumax::MaxClient::new();
                    client.set_user_id(server_user_id).await;
                    client.set_token(token).await;

                    if client.connect(identity, false).await.is_ok() {
                        if client.sync(None).await.is_ok() {
                            let mut found_url = None;
                            if id > 0 {
                                if let Ok(resp) = client.fetch_contacts(vec![id as u64]).await {
                                    if let Some(contacts) = resp.payload.get("contacts").and_then(|c| c.as_array()) {
                                        if let Some(c) = contacts.first() {
                                            let _ = fs::create_dir_all(data_dir.join("contacts"));
                                            let _ = fs::write(&contact_path, serde_json::to_vec(c).unwrap_or_default());
                                            found_url = c.get("baseUrl")
                                                .or_else(|| c.get("avatar"))
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string());
                                        }
                                    }
                                }
                            } else {
                                if let Ok(resp) = client.get_chats(vec![id]).await {
                                    if let Some(chats) = resp.payload.get("chats").and_then(|c| c.as_array()) {
                                        if let Some(c) = chats.first() {
                                            let chat_dir = data_dir.join("chats").join(id.to_string());
                                            let _ = fs::create_dir_all(&chat_dir);
                                            let _ = fs::write(chat_dir.join("info"), serde_json::to_vec(c).unwrap_or_default());
                                            found_url = c.get("baseIconUrl")
                                                .or_else(|| c.get("iconUrl"))
                                                .or_else(|| c.get("baseUrl"))
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string());
                                        }
                                    }
                                }
                            }
                            client.disconnect().await;
                            return found_url;
                        }
                        client.disconnect().await;
                    }
                    None
                };

                if let Ok(Some(url)) = timeout(Duration::from_secs(4), fetch_task).await {
                    avatar_url = Some(url);
                }
            }
        }

        let url = avatar_url?;
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let hash_str: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
        let file_path = cache_files_dir.join(format!("{}.jpg", &hash_str[..16]));

        if file_path.exists() {
            return Some(file_path.to_string_lossy().to_string());
        }

        let download_task = async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(4))
                .build()
                .ok()?;
            let resp = client.get(&url).send().await.ok()?;
            if resp.status().is_success() {
                let bytes = resp.bytes().await.ok()?;
                fs::write(&file_path, bytes).ok()?;
                Some(file_path.to_string_lossy().to_string())
            } else {
                None
            }
        };

        timeout(Duration::from_secs(4), download_task).await.ok().flatten()
    });

    let path_str = match cached_path {
        Some(p) => p,
        None => return JString::default(),
    };

    match unowned_env.with_env(|_env| _env.new_string(&path_str)).into_outcome() {
        jni::Outcome::Ok(jstr) => jstr,
        _ => JString::default(),
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_NotificationHelper_isChatMutedNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i32,
    chat_id: i64,
    app_dir: JString<'local>,
) -> jboolean {
    let rust_app_dir: String = match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
        let a: String = _env.get_string(&app_dir)?.into();
        Ok(a)
    }).into_outcome() {
        jni::Outcome::Ok(v) => v,
        _ => return false,
    };

    let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
    let local_id = creds.as_ref().map(|c| c.0).unwrap_or(0);
    let root = PathBuf::from(&rust_app_dir);
    let chat_info_path = root.join("data").join(local_id.to_string()).join("chats").join(chat_id.to_string()).join("info");

    if let Ok(bytes) = fs::read(&chat_info_path) {
        if let Ok(val) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(ddu) = val.get("dontDisturbUntil") {
                if let Some(num) = ddu.as_i64() {
                    if num == -1 {
                        return true;
                    }
                    if num > 0 {
                        let now = chrono::Utc::now().timestamp_millis();
                        if num > now {
                            return true;
                        }
                    }
                }
            }
        }
    }

    false
}
