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
fn extract_contact_name(val: &serde_json::Value) -> Option<String> {
    if let Some(names) = val.get("names").and_then(|n| n.as_array()) {
        if let Some(first) = names.first() {
            let fn_str = first.get("firstName").and_then(|v| v.as_str()).unwrap_or("").trim();
            let ln_str = first.get("lastName").and_then(|v| v.as_str()).unwrap_or("").trim();
            let full = format!("{} {}", fn_str, ln_str).trim().to_string();
            if !full.is_empty() {
                return Some(full);
            }
        }
    }
    if let Some(name) = val.get("name").and_then(|v| v.as_str()) {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(first) = val.get("firstName").and_then(|v| v.as_str()) {
        let last = val.get("lastName").and_then(|v| v.as_str()).unwrap_or("");
        let full = format!("{} {}", first, last).trim().to_string();
        if !full.is_empty() {
            return Some(full);
        }
    }
    if let Some(title) = val.get("title").and_then(|v| v.as_str()) {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

#[cfg(target_os = "android")]
fn extract_avatar_url(val: &serde_json::Value) -> Option<String> {
    val.get("baseRawUrl")
        .or_else(|| val.get("baseUrl"))
        .or_else(|| val.get("avatar"))
        .or_else(|| val.get("photo"))
        .or_else(|| val.get("baseIconUrl"))
        .or_else(|| val.get("baseRawIconUrl"))
        .or_else(|| val.get("iconUrl"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[cfg(target_os = "android")]
pub fn resolve_contact_info_internal(
    account: i64,
    id: i64,
    rust_app_dir: &str,
) -> (Option<String>, Option<String>) {
    let root = crate::stores::resolve_app_root(rust_app_dir);
    let creds = crate::stores::get_background_creds(rust_app_dir, account as u64);
    let local_id = creds.as_ref().map(|c| c.0).unwrap_or(0);
    let data_dir = root.join("data").join(local_id.to_string());
    let cache_dir = root.join("cache").join(local_id.to_string());
    let cache_files_dir = cache_dir.join("files");
    let _ = fs::create_dir_all(&cache_files_dir);

    let storage = crate::stores::Storage::new(None);
    let mut resolved_name: Option<String> = None;
    let mut avatar_url: Option<String> = None;

    let contact_path = data_dir.join("contacts").join(id.to_string());
    if let Some(val) = storage.load(&contact_path) {
        resolved_name = extract_contact_name(&val);
        avatar_url = extract_avatar_url(&val);
    }

    if resolved_name.is_none() || avatar_url.is_none() {
        let chat_path = data_dir.join("chats").join(id.to_string()).join("info");
        if let Some(val) = storage.load(&chat_path) {
            if resolved_name.is_none() {
                resolved_name = extract_contact_name(&val);
            }
            if avatar_url.is_none() {
                avatar_url = extract_avatar_url(&val);
            }
        }
    }

    if (resolved_name.is_none() || avatar_url.is_none()) && id > 0 {
        if let Some((_, server_user_id, token, identity)) = creds {
            let data_dir_clone = data_dir.clone();
            let contact_path_clone = contact_path.clone();
            let fetched = std::thread::spawn(move || {
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
                            let mut found_name = None;
                            let mut found_url = None;
                            if let Ok(resp) = client.fetch_contacts(vec![id as u64]).await {
                                if let Some(contacts) = resp.payload.get("contacts").and_then(|c| c.as_array()) {
                                    if let Some(c) = contacts.first() {
                                        let storage = crate::stores::Storage::new(None);
                                        let _ = fs::create_dir_all(data_dir_clone.join("contacts"));
                                        let _ = storage.save(&contact_path_clone, c);
                                        found_name = extract_contact_name(c);
                                        found_url = extract_avatar_url(c);
                                    }
                                }
                            }
                            client.disconnect().await;
                            return Some((found_name, found_url));
                        }
                        client.disconnect().await;
                    }
                    None
                })
            }).join().ok().flatten();

            if let Some((name, url)) = fetched {
                if resolved_name.is_none() {
                    resolved_name = name;
                }
                if avatar_url.is_none() {
                    avatar_url = url;
                }
            }
        }
    }

    let mut local_avatar_path: Option<String> = None;
    if let Some(ref url) = avatar_url {
        if let Some(index) = storage.load(cache_dir.join("index")) {
            if let Some(entry) = index.get(url) {
                if let Some(p) = entry.get(0).and_then(|v| v.as_str()) {
                    let f = PathBuf::from(p);
                    if f.exists() {
                        local_avatar_path = Some(f.to_string_lossy().to_string());
                    }
                }
            }
        }

        if local_avatar_path.is_none() {
            let hashed_name = crate::stores::hash(url);
            let cached_file = cache_files_dir.join(&hashed_name);
            if cached_file.exists() {
                local_avatar_path = Some(cached_file.to_string_lossy().to_string());
            } else {
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
                local_avatar_path = downloaded;
            }
        }
    }

    (resolved_name, local_avatar_path)
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

        let (_, avatar_path) = resolve_contact_info_internal(account, id, &rust_app_dir);
        avatar_path
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
pub extern "system" fn Java_org_meowkie_max_ContactHelper_getContactInfoNative<'local>(
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

        let (name, avatar_path) = resolve_contact_info_internal(account, id, &rust_app_dir);
        let out = json!({
            "name": name,
            "avatarPath": avatar_path
        });
        Some(out.to_string())
    }));

    let out_str = match res {
        Ok(Some(s)) => s,
        _ => return JString::default(),
    };

    match unowned_env.with_env(|_env| _env.new_string(&out_str)).into_outcome() {
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
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_NotificationHelper_isNotificationsEnabledNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    account: i64,
    app_dir: JString<'local>,
) -> jboolean {
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let rust_app_dir: String = match unowned_env.with_env(|_env| -> Result<_, jni::errors::Error> {
            let a = app_dir.try_to_string(_env)?;
            Ok(a)
        }).into_outcome() {
            jni::Outcome::Ok(v) => v,
            _ => return true,
        };

        let root = crate::stores::resolve_app_root(&rust_app_dir);
        let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
        let local_id = creds.as_ref().map(|c| c.0).unwrap_or(account as u64);
        let user_settings_path = root.join("data").join(local_id.to_string()).join("user_settings");

        let storage = crate::stores::Storage::new(None);
        if let Some(val) = storage.load(&user_settings_path) {
            if let Some(val_str) = val.get("CHATS_PUSH_NOTIFICATION").and_then(|v| v.as_str()) {
                if val_str == "OFF" {
                    return false;
                }
            }
        }
        true
    }));

    res.unwrap_or(true)
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_NotificationHelper_isChatGroupNative<'local>(
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
            _ => return chat_id < 0,
        };

        let root = crate::stores::resolve_app_root(&rust_app_dir);
        let creds = crate::stores::get_background_creds(&rust_app_dir, account as u64);
        let local_id = creds.as_ref().map(|c| c.0).unwrap_or(account as u64);
        let chat_info_path = root.join("data").join(local_id.to_string()).join("chats").join(chat_id.to_string()).join("info");

        let storage = crate::stores::Storage::new(None);
        if let Some(val) = storage.load(&chat_info_path) {
            if let Some(t) = val.get("type").and_then(|v| v.as_str()) {
                if t == "DIALOG" {
                    return false;
                }
                return true;
            }
        }

        chat_id < 0
    }));

    res.unwrap_or(chat_id < 0)
}

#[cfg(target_os = "android")]
use tauri::Emitter;

pub static GLOBAL_APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();
static PENDING_OPEN_CHAT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(handle);
}

#[tauri::command]
pub fn check_pending_open_chat() -> Option<i64> {
    let chat_id = PENDING_OPEN_CHAT.swap(0, std::sync::atomic::Ordering::SeqCst);
    if chat_id != 0 {
        Some(chat_id)
    } else {
        None
    }
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MainActivity_notifyChatClickedNative<'local>(
    _unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    chat_id: i64,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        PENDING_OPEN_CHAT.store(chat_id, std::sync::atomic::Ordering::SeqCst);
        if let Some(app) = GLOBAL_APP_HANDLE.get() {
            let _ = app.emit("open_chat", chat_id);
        }
    }));
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MainActivity_notifyCallActionNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    action: JString<'local>,
    payload: JString<'local>,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let (action_str, payload_str) = match unowned_env.with_env(|env| -> Result<_, jni::errors::Error> {
            let a = action.try_to_string(env)?;
            let p = payload.try_to_string(env)?;
            Ok((a, p))
        }).into_outcome() {
            jni::Outcome::Ok(pair) => pair,
            _ => return,
        };

        if let Some(app) = GLOBAL_APP_HANDLE.get() {
            let _ = app.emit("native_call_action", serde_json::json!({
                "action": action_str,
                "payload": payload_str
            }));
        }
    }));
}

#[cfg(target_os = "android")]
pub static GLOBAL_JVM: std::sync::OnceLock<jni::JavaVM> = std::sync::OnceLock::new();
#[cfg(target_os = "android")]
static GLOBAL_NOTIFICATION_CLASS: std::sync::OnceLock<jni::refs::Global<jni::objects::JClass<'static>>> = std::sync::OnceLock::new();
#[cfg(target_os = "android")]
pub static GLOBAL_MAIN_ACTIVITY_CLASS: std::sync::OnceLock<jni::refs::Global<jni::objects::JClass<'static>>> = std::sync::OnceLock::new();

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

            if let Ok(main_activity_class) = env.find_class(jni_str!("org/meowkie/max/MainActivity")) {
                if let Ok(global_main) = env.new_global_ref(main_activity_class) {
                    let _ = GLOBAL_MAIN_ACTIVITY_CLASS.set(global_main);
                }
            }

            android_log(4, "MaxPlusJNI", "initJni: NotificationHelper class cached successfully");
            Ok(())
        });
    }));
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MainActivity_notifyScreenCaptureResultNative<'local>(
    mut _unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    success: jboolean,
    port: i32,
    width: i32,
    height: i32,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::screen_capture::on_screen_capture_result(success, port, width, height);
    }));
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MainActivity_notifyScreenCaptureStoppedNative<'local>(
    mut _unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        crate::screen_capture::on_screen_capture_stopped();
    }));
}

#[tauri::command]
pub async fn show_notification(
    chat_id: i64,
    title: String,
    text: String,
    sender_id: String,
    account: i64,
    sender_name: Option<String>,
    is_group: Option<bool>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let sender_name_val = sender_name.unwrap_or_else(|| title.clone());
        let is_group_val = is_group.unwrap_or_else(|| chat_id < 0);
        android_log(
            3,
            "MaxPlusJNI",
            &format!(
                "show_notification: chat_id={}, title={}, sender_id={}, account={}, sender_name={}, is_group={}",
                chat_id, title, sender_id, account, sender_name_val, is_group_val
            ),
        );
        if let (Some(vm), Some(global_class)) = (GLOBAL_JVM.get(), GLOBAL_NOTIFICATION_CLASS.get()) {
            let res = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                let j_title = env.new_string(&title)?;
                let j_text = env.new_string(&text)?;
                let j_sender = env.new_string(&sender_id)?;
                let j_sender_name = env.new_string(&sender_name_val)?;

                let j_title_obj = JObject::from(j_title);
                let j_text_obj = JObject::from(j_text);
                let j_sender_obj = JObject::from(j_sender);
                let j_sender_name_obj = JObject::from(j_sender_name);

                let call_result = env.call_static_method(
                    global_class,
                    jni_str!("showNotificationDirect"),
                    jni_sig!("(JLjava/lang/String;Ljava/lang/String;Ljava/lang/String;JLjava/lang/String;Z)V"),
                    &[
                        jni::objects::JValue::Long(chat_id),
                        jni::objects::JValue::Object(&j_title_obj),
                        jni::objects::JValue::Object(&j_text_obj),
                        jni::objects::JValue::Object(&j_sender_obj),
                        jni::objects::JValue::Long(account),
                        jni::objects::JValue::Object(&j_sender_name_obj),
                        jni::objects::JValue::Bool(is_group_val),
                    ],
                );

                if call_result.is_err() {
                    env.exception_clear();
                    env.call_static_method(
                        global_class,
                        jni_str!("showNotificationDirect"),
                        jni_sig!("(JLjava/lang/String;Ljava/lang/String;Ljava/lang/String;JLjava/lang/String;)V"),
                        &[
                            jni::objects::JValue::Long(chat_id),
                            jni::objects::JValue::Object(&j_title_obj),
                            jni::objects::JValue::Object(&j_text_obj),
                            jni::objects::JValue::Object(&j_sender_obj),
                            jni::objects::JValue::Long(account),
                            jni::objects::JValue::Object(&j_sender_name_obj),
                        ],
                    )?;
                }
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

#[tauri::command]
pub async fn update_call_notification_config(sound: bool, vibration: bool, enabled: Option<bool>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _ = enabled;
        if let Some(vm) = GLOBAL_JVM.get() {
            let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                let mgr_class = env.find_class(jni_str!("org/meowkie/max/CallNotificationManager"))?;
                env.call_static_method(
                    mgr_class,
                    jni_str!("syncCallSettings"),
                    jni_sig!("(ZZ)V"),
                    &[jni::objects::JValue::Bool(sound), jni::objects::JValue::Bool(vibration)],
                )?;
                Ok(())
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_call_notification() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        if let Some(vm) = GLOBAL_JVM.get() {
            let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                let mgr_class = env.find_class(jni_str!("org/meowkie/max/CallNotificationManager"))?;
                env.call_static_method(
                    mgr_class,
                    jni_str!("cancelCallNotificationFromNative"),
                    jni_sig!("()V"),
                    &[],
                )?;
                Ok(())
            });
        }
    }
    Ok(())
}

