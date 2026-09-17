#[cfg(target_os = "android")]
use jni::{
    jni_sig, jni_str,
    objects::{JObject, JString},
    sys::jboolean,
    EnvUnowned,
};
#[cfg(target_os = "android")]
use std::{collections::HashMap, fs, path::PathBuf, time::Duration};
#[cfg(target_os = "android")]
use serde_json::json;
#[cfg(target_os = "android")]
use tokio::time::timeout;

#[cfg(target_os = "android")]
#[link(name = "log")]
extern "C" {
    pub fn __android_log_write(
        prio: std::os::raw::c_int,
        tag: *const std::os::raw::c_char,
        text: *const std::os::raw::c_char,
    ) -> std::os::raw::c_int;
}

#[cfg(target_os = "android")]
pub fn android_log(level: i32, tag: &str, msg: &str) {
    if let (Ok(tag_c), Ok(msg_c)) = (std::ffi::CString::new(tag), std::ffi::CString::new(msg)) {
        unsafe {
            __android_log_write(level, tag_c.as_ptr(), msg_c.as_ptr());
        }
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_ReplyReceiver_sendReplyNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i64,
    chat_id: i64,
    mid: i64,
    text: JString<'local>,
    app_dir: JString<'local>,
) -> jboolean {
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        android_log(
            3,
            "MaxPlusJNI",
            &format!(
                "sendReplyNative called: account={}, chat_id={}, mid={}",
                account, chat_id, mid
            ),
        );

        let (rust_text, rust_app_dir) =
            match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
                let t = text.try_to_string(_env)?;
                let a = app_dir.try_to_string(_env)?;
                Ok((t, a))
            }).into_outcome() {
                jni::Outcome::Ok(v) => v,
                _ => {
                    android_log(6, "MaxPlusJNI", "sendReplyNative: failed to read strings from JNI");
                    return false;
                }
            };

        let handle = std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(r) => r,
                Err(e) => {
                    android_log(6, "MaxPlusJNI", &format!("sendReplyNative: failed to create runtime: {:?}", e));
                    return false;
                }
            };

            rt.block_on(async {
                let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
                if let Some((local_id, server_user_id, token, identity)) = creds {
                    android_log(
                        3,
                        "MaxPlusJNI",
                        &format!(
                            "sendReplyNative: found credentials: local_id={}, server_user_id={}",
                            local_id, server_user_id
                        ),
                    );

                    let network_task = async {
                        let client = rumax::MaxClient::new();
                        client.set_user_id(server_user_id).await;
                        client.set_token(token).await;

                        android_log(3, "MaxPlusJNI", "sendReplyNative: connecting via mobile transport...");
                        let mut connected = client.connect(identity.clone(), true).await.is_ok();
                        if !connected {
                            android_log(5, "MaxPlusJNI", "sendReplyNative: mobile transport failed, trying websocket fallback...");
                            connected = client.connect(identity, false).await.is_ok();
                        }

                        if connected {
                            android_log(3, "MaxPlusJNI", "sendReplyNative: connected, starting sync...");
                            match client.sync(None).await {
                                Ok(_) => {
                                    android_log(3, "MaxPlusJNI", "sendReplyNative: sync succeeded, preparing message...");
                                    let mut params = None;
                                    if mid != 0 {
                                        let mut map = HashMap::new();
                                        map.insert("replyTo".to_string(), json!(mid.to_string()));
                                        params = Some(map);
                                    }

                                    let send_result = client.send_message(chat_id, rust_text, params).await;
                                    client.disconnect().await;
                                    match send_result {
                                        Ok(_) => {
                                            android_log(4, "MaxPlusJNI", "sendReplyNative: message sent successfully!");
                                            true
                                        }
                                        Err(e) => {
                                            android_log(6, "MaxPlusJNI", &format!("sendReplyNative: send_message failed: {:?}", e));
                                            false
                                        }
                                    }
                                }
                                Err(e) => {
                                    android_log(6, "MaxPlusJNI", &format!("sendReplyNative: sync failed: {:?}", e));
                                    client.disconnect().await;
                                    false
                                }
                            }
                        } else {
                            android_log(6, "MaxPlusJNI", "sendReplyNative: connection failed completely");
                            false
                        }
                    };

                    match timeout(Duration::from_secs(25), network_task).await {
                        Ok(result) => result,
                        Err(_) => {
                            android_log(6, "MaxPlusJNI", "sendReplyNative: timed out after 25s");
                            false
                        }
                    }
                } else {
                    android_log(6, "MaxPlusJNI", &format!("sendReplyNative: credentials not found for account={}", account));
                    false
                }
            })
        });

        let success = handle.join().unwrap_or(false);
        android_log(3, "MaxPlusJNI", &format!("sendReplyNative result: {}", success));
        success
    }));

    res.unwrap_or(false)
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_AvatarHelper_getAvatarPathNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i64,
    id: i64,
    app_dir: JString<'local>,
) -> JString<'local> {
    let res: Result<Option<String>, _> = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let rust_app_dir: String = match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
            let a = app_dir.try_to_string(_env)?;
            Ok(a)
        }).into_outcome() {
            jni::Outcome::Ok(v) => v,
            _ => return None,
        };

        let root = crate::stores::resolve_app_root(&rust_app_dir);
        let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
        let local_id = creds.as_ref().map(|c| c.0).unwrap_or(0);
        let data_dir = root.join("data").join(local_id.to_string());
        let cache_dir = root.join("cache").join(local_id.to_string());
        let cache_files_dir = cache_dir.join("files");
        let _ = fs::create_dir_all(&cache_files_dir);

        let storage = crate::stores::Storage::new(None);
        let mut avatar_url: Option<String> = None;

        let contact_path = data_dir.join("contacts").join(id.to_string());
        if let Some(val) = storage.load(&contact_path) {
            avatar_url = val.get("baseUrl")
                .or_else(|| val.get("avatar"))
                .or_else(|| val.get("iconUrl"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }

        if avatar_url.is_none() {
            let chat_path = data_dir.join("chats").join(id.to_string()).join("info");
            if let Some(val) = storage.load(&chat_path) {
                avatar_url = val.get("baseIconUrl")
                    .or_else(|| val.get("iconUrl"))
                    .or_else(|| val.get("baseUrl"))
                    .or_else(|| val.get("avatar"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }

        if avatar_url.is_none() {
            if let Some((_, server_user_id, token, identity)) = creds {
                let data_dir_clone = data_dir.clone();
                let contact_path_clone = contact_path.clone();
                let fetched_url = std::thread::spawn(move || {
                    let rt = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .ok()?;
                    rt.block_on(async {
                        let client = rumax::MaxClient::new();
                        client.set_user_id(server_user_id).await;
                        client.set_token(token).await;

                        if client.connect(identity, false).await.is_ok() {
                            if client.sync(None).await.is_ok() {
                                let mut found_url = None;
                                if id > 0 {
                                    if let Ok(resp) = client.fetch_contacts(vec![id as u64]).await {
                                        if let Some(contacts) = resp.payload.get("contacts").and_then(|c| c.as_array()) {
                                            if let Some(c) = contacts.first() {
                                                let storage = crate::stores::Storage::new(None);
                                                let _ = fs::create_dir_all(data_dir_clone.join("contacts"));
                                                let _ = storage.save(&contact_path_clone, c);
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
                                                let storage = crate::stores::Storage::new(None);
                                                let chat_dir = data_dir_clone.join("chats").join(id.to_string());
                                                let _ = fs::create_dir_all(&chat_dir);
                                                let _ = storage.save(chat_dir.join("info"), c);
                                                found_url = c.get("baseIconUrl")
                                                    .or_else(|| c.get("iconUrl"))
                                                    .or_else(|| c.get("baseUrl"))
                                                    .or_else(|| c.get("avatar"))
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
                    })
                }).join().ok().flatten();

                if let Some(url) = fetched_url {
                    avatar_url = Some(url);
                }
            }
        }

        let url = avatar_url?;

        if let Some(index) = storage.load(cache_dir.join("index")) {
            if let Some(entry) = index.get(&url) {
                if let Some(p) = entry.get(0).and_then(|v| v.as_str()) {
                    let f = PathBuf::from(p);
                    if f.exists() {
                        return Some(f.to_string_lossy().to_string());
                    }
                }
            }
        }

        let hashed_name = crate::stores::hash(&url);
        let cached_file = cache_files_dir.join(&hashed_name);
        if cached_file.exists() {
            return Some(cached_file.to_string_lossy().to_string());
        }

        let url_clone = url.clone();
        let target_file = cached_file.clone();
        let downloaded = std::thread::spawn(move || {
            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(4))
                .build()
                .ok()?;
            let resp = client.get(&url_clone).send().ok()?;
            if resp.status().is_success() {
                let bytes = resp.bytes().ok()?;
                let _ = fs::create_dir_all(target_file.parent()?);
                fs::write(&target_file, bytes).ok()?;
                Some(target_file.to_string_lossy().to_string())
            } else {
                None
            }
        }).join().ok().flatten();

        downloaded
    }));

    let path_str = match res {
        Ok(Some(p)) => p,
        _ => return JString::default(),
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
    account: i64,
    chat_id: i64,
    app_dir: JString<'local>,
) -> jboolean {
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let rust_app_dir: String = match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
            let a = app_dir.try_to_string(_env)?;
            Ok(a)
        }).into_outcome() {
            jni::Outcome::Ok(v) => v,
            _ => return false,
        };

        let root = crate::stores::resolve_app_root(&rust_app_dir);
        let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
        let local_id = creds.as_ref().map(|c| c.0).unwrap_or(0);
        let chat_info_path = root.join("data").join(local_id.to_string()).join("chats").join(chat_id.to_string()).join("info");

        let storage = crate::stores::Storage::new(None);
        if let Some(val) = storage.load(&chat_info_path) {
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

        false
    }));

    res.unwrap_or(false)
}

#[cfg(target_os = "android")]
static GLOBAL_JVM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();
#[cfg(target_os = "android")]
static GLOBAL_NOTIFICATION_CLASS: std::sync::OnceLock<jni::refs::Global<jni::objects::JClass<'static>>> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MainActivity_initJni<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = unowned_env.with_env(|env| -> Result<(), jni::errors::Error> {
            let vm = env.get_java_vm()?;
            let _ = GLOBAL_JVM.set(vm);
            android_log(4, "MaxPlusJNI", "initJni: JVM saved");

            let helper_class = env.find_class(jni_str!("org/meowkie/max/NotificationHelper"))
                .or_else(|_| env.find_class(jni_str!("ru/oneme/app/NotificationHelper")))?;
            let global_helper = env.new_global_ref(helper_class)?;
            let _ = GLOBAL_NOTIFICATION_CLASS.set(global_helper);
            android_log(4, "MaxPlusJNI", "initJni: NotificationHelper class cached successfully");
            Ok(())
        });
    }));
}

#[tauri::command]
pub async fn show_notification(
    chat_id: i64,
    title: String,
    text: String,
    sender_id: String,
    account: i64,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_log(
            3,
            "MaxPlusJNI",
            &format!(
                "show_notification: chat_id={}, title={}, sender_id={}, account={}",
                chat_id, title, sender_id, account
            ),
        );
        if let (Some(vm), Some(global_class)) = (GLOBAL_JVM.get(), GLOBAL_NOTIFICATION_CLASS.get()) {
            let res = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                let j_title = env.new_string(&title)?;
                let j_text = env.new_string(&text)?;
                let j_sender = env.new_string(&sender_id)?;

                let j_title_obj = JObject::from(j_title);
                let j_text_obj = JObject::from(j_text);
                let j_sender_obj = JObject::from(j_sender);

                env.call_static_method(
                    global_class,
                    jni_str!("showNotificationDirect"),
                    jni_sig!("(JLjava/lang/String;Ljava/lang/String;Ljava/lang/String;J)V"),
                    &[
                        jni::objects::JValue::Long(chat_id),
                        jni::objects::JValue::Object(&j_title_obj),
                        jni::objects::JValue::Object(&j_text_obj),
                        jni::objects::JValue::Object(&j_sender_obj),
                        jni::objects::JValue::Long(account),
                    ],
                )?;
                Ok(())
            });
            match res {
                Ok(()) => {
                    android_log(3, "MaxPlusJNI", "showNotificationDirect succeeded");
                }
                Err(e) => {
                    android_log(6, "MaxPlusJNI", &format!("showNotificationDirect JNI call error: {:?}", e));
                }
            }
        } else {
            android_log(5, "MaxPlusJNI", "show_notification: GLOBAL_JVM or GLOBAL_NOTIFICATION_CLASS is None");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_notification(chat_id: i64) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_log(3, "MaxPlusJNI", &format!("cancel_notification: chat_id={}", chat_id));
        if let (Some(vm), Some(global_class)) = (GLOBAL_JVM.get(), GLOBAL_NOTIFICATION_CLASS.get()) {
            let res = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                env.call_static_method(
                    global_class,
                    jni_str!("cancelNotificationDirect"),
                    jni_sig!("(J)V"),
                    &[jni::objects::JValue::Long(chat_id)],
                )?;
                Ok(())
            });
            match res {
                Ok(()) => {
                    android_log(3, "MaxPlusJNI", "cancelNotificationDirect succeeded");
                }
                Err(e) => {
                    android_log(6, "MaxPlusJNI", &format!("cancelNotificationDirect JNI call error: {:?}", e));
                }
            }
        } else {
            android_log(5, "MaxPlusJNI", "cancel_notification: GLOBAL_JVM or GLOBAL_NOTIFICATION_CLASS is None");
        }
    }
    Ok(())
}
