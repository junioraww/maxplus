#[cfg(target_os = "android")]
use jni::{
    jni_sig, jni_str,
    objects::{JObject, JString},
    sys::jboolean,
    Env, EnvUnowned,
};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Notify;

static DAEMON_RUNNING: AtomicBool = AtomicBool::new(false);
static APP_IN_FOREGROUND: AtomicBool = AtomicBool::new(false);
static DAEMON_RECONNECT_NOTIFY: std::sync::OnceLock<Arc<Notify>> = std::sync::OnceLock::new();

fn get_reconnect_notify() -> &'static Arc<Notify> {
    DAEMON_RECONNECT_NOTIFY.get_or_init(|| Arc::new(Notify::new()))
}

pub fn set_app_foreground(in_foreground: bool) {
    APP_IN_FOREGROUND.store(in_foreground, Ordering::SeqCst);
}

pub fn trigger_daemon_reconnect() {
    get_reconnect_notify().notify_waiters();
}

#[cfg(target_os = "android")]
fn get_app_context<'a>(env: &mut Env<'a>) -> Result<JObject<'a>, jni::errors::Error> {
    let main_class = env.find_class(jni_str!("me/junioraww/max/MainActivity"))
        .or_else(|_| env.find_class(jni_str!("org/meowkie/max/MainActivity")))?;
    let ctx_obj = env.call_static_method(
        main_class,
        jni_str!("getApplicationContextStatic"),
        jni_sig!("()Landroid/content/Context;"),
        &[],
    )?.l()?;
    Ok(ctx_obj)
}

#[cfg(target_os = "android")]
fn dispatch_incoming_message_to_jni(
    chat_id: i64,
    mid: &str,
    text: &str,
    sender_id: i64,
    account: i64,
    sender_name: &str,
    chat_title: &str,
    is_group: bool,
) {
    if let Some(vm) = crate::notifications::GLOBAL_JVM.get() {
        let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
            let dispatcher_class = env.find_class(jni_str!("me/junioraww/max/NotificationDispatcher"))
                .or_else(|_| env.find_class(jni_str!("org/meowkie/max/NotificationDispatcher")))?;

            let app_ctx = get_app_context(env)?;
            if app_ctx.is_null() {
                return Ok(());
            }

            let j_mid = env.new_string(mid)?;
            let j_text = env.new_string(text)?;
            let j_sender_id = env.new_string(&sender_id.to_string())?;
            let j_sender_name = env.new_string(sender_name)?;
            let j_chat_title = env.new_string(chat_title)?;

            let j_mid_obj = JObject::from(j_mid);
            let j_text_obj = JObject::from(j_text);
            let j_sender_id_obj = JObject::from(j_sender_id);
            let j_sender_name_obj = JObject::from(j_sender_name);
            let j_chat_title_obj = JObject::from(j_chat_title);

            let res = env.call_static_method(
                &dispatcher_class,
                jni_str!("dispatchMessage"),
                jni_sig!("(Landroid/content/Context;JLjava/lang/String;Ljava/lang/String;Ljava/lang/String;JLjava/lang/String;Ljava/lang/String;Z)V"),
                &[
                    jni::objects::JValue::Object(&app_ctx),
                    jni::objects::JValue::Long(chat_id),
                    jni::objects::JValue::Object(&j_mid_obj),
                    jni::objects::JValue::Object(&j_text_obj),
                    jni::objects::JValue::Object(&j_sender_id_obj),
                    jni::objects::JValue::Long(account),
                    jni::objects::JValue::Object(&j_sender_name_obj),
                    jni::objects::JValue::Object(&j_chat_title_obj),
                    jni::objects::JValue::Bool(is_group),
                ],
            );

            if res.is_err() {
                env.call_static_method(
                    &dispatcher_class,
                    jni_str!("dispatchMessage"),
                    jni_sig!("(Landroid/content/Context;JLjava/lang/String;Ljava/lang/String;Ljava/lang/String;JLjava/lang/String;Z)V"),
                    &[
                        jni::objects::JValue::Object(&app_ctx),
                        jni::objects::JValue::Long(chat_id),
                        jni::objects::JValue::Object(&j_mid_obj),
                        jni::objects::JValue::Object(&j_text_obj),
                        jni::objects::JValue::Object(&j_sender_id_obj),
                        jni::objects::JValue::Long(account),
                        jni::objects::JValue::Object(&j_sender_name_obj),
                        jni::objects::JValue::Bool(is_group),
                    ],
                )?;
            }

            Ok(())
        });
    }
}

#[cfg(target_os = "android")]
fn dispatch_incoming_call_to_jni(
    conversation_id: &str,
    caller_id: i64,
    user_name: &str,
    vcp: &str,
    is_video: bool,
    account: i64,
) {
    if let Some(vm) = crate::notifications::GLOBAL_JVM.get() {
        let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
            let dispatcher_class = env.find_class(jni_str!("me/junioraww/max/NotificationDispatcher"))
                .or_else(|_| env.find_class(jni_str!("org/meowkie/max/NotificationDispatcher")))?;

            let app_ctx = get_app_context(env)?;
            if app_ctx.is_null() {
                return Ok(());
            }

            let j_cid = env.new_string(conversation_id)?;
            let j_name = env.new_string(user_name)?;
            let j_vcp = env.new_string(vcp)?;

            let j_cid_obj = JObject::from(j_cid);
            let j_name_obj = JObject::from(j_name);
            let j_vcp_obj = JObject::from(j_vcp);

            env.call_static_method(
                dispatcher_class,
                jni_str!("dispatchIncomingCallDirect"),
                jni_sig!("(Landroid/content/Context;Ljava/lang/String;JLjava/lang/String;Ljava/lang/String;ZJ)V"),
                &[
                    jni::objects::JValue::Object(&app_ctx),
                    jni::objects::JValue::Object(&j_cid_obj),
                    jni::objects::JValue::Long(caller_id),
                    jni::objects::JValue::Object(&j_name_obj),
                    jni::objects::JValue::Object(&j_vcp_obj),
                    jni::objects::JValue::Bool(is_video),
                    jni::objects::JValue::Long(account),
                ],
            )?;
            Ok(())
        });
    }
}

#[cfg(target_os = "android")]
fn dispatch_message_removed_to_jni(chat_id: i64, mid: &str) {
    if let Some(vm) = crate::notifications::GLOBAL_JVM.get() {
        let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
            let dispatcher_class = env.find_class(jni_str!("me/junioraww/max/NotificationDispatcher"))
                .or_else(|_| env.find_class(jni_str!("org/meowkie/max/NotificationDispatcher")))?;

            let app_ctx = get_app_context(env)?;
            if app_ctx.is_null() {
                return Ok(());
            }

            let j_mid = env.new_string(mid)?;
            let j_mid_obj = JObject::from(j_mid);

            env.call_static_method(
                dispatcher_class,
                jni_str!("dispatchMessageRemoved"),
                jni_sig!("(Landroid/content/Context;JLjava/lang/String;)V"),
                &[
                    jni::objects::JValue::Object(&app_ctx),
                    jni::objects::JValue::Long(chat_id),
                    jni::objects::JValue::Object(&j_mid_obj),
                ],
            )?;
            Ok(())
        });
    }
}

#[cfg(target_os = "android")]
fn format_message_preview(msg: &Value, sender_name: &str) -> String {
    let text = msg.get("text").and_then(|v| v.as_str()).unwrap_or("").trim();
    let attaches = msg.get("attaches").and_then(|v| v.as_array());

    if let Some(att_list) = attaches {
        for att in att_list {
            let t = att.get("_type").and_then(|v| v.as_str()).unwrap_or("");
            if t == "CONTROL" {
                let event = att.get("event").and_then(|v| v.as_str()).unwrap_or("");
                let msg_opt = att.get("message").or_else(|| att.get("title")).and_then(|v| v.as_str());
                match event {
                    "add" => return format!("{} добавил(а) нового участника", sender_name),
                    "remove" | "kick" => return format!("{} исключил(а) участника", sender_name),
                    "leave" => return format!("{} покинул(а) чат", sender_name),
                    "joinByLink" => return format!("{} присоединился(-ась) к чату по ссылке", sender_name),
                    "pin" => return format!("{} закрепил(а) сообщение", sender_name),
                    "botStarted" => return format!("{} запустил(а) бота", sender_name),
                    "new" => return format!("{} создал(а) чат", sender_name),
                    "icon" => return format!("{} обновил(а) фото чата", sender_name),
                    "title" => {
                        if let Some(title) = att.get("title").and_then(|v| v.as_str()) {
                            return format!("{} изменил(а) название чата на {}", sender_name, title);
                        }
                        return format!("{} изменил(а) название чата", sender_name);
                    }
                    "system" => {
                        if let Some(m) = msg_opt {
                            return m.to_string();
                        }
                        if !text.is_empty() {
                            return text.to_string();
                        }
                        return "Системное сообщение".to_string();
                    }
                    _ => {
                        if let Some(m) = msg_opt {
                            return m.to_string();
                        }
                    }
                }
            }
        }

        let mut attach_label = None;
        let photos_count = att_list.iter().filter(|x| {
            x.get("_type").and_then(|v| v.as_str()) == Some("PHOTO")
        }).count();

        if photos_count > 1 {
            attach_label = Some("Изображения");
        } else if photos_count == 1 {
            attach_label = Some("Изображение");
        } else {
            for att in att_list {
                let t = att.get("_type").and_then(|v| v.as_str()).unwrap_or("");
                match t {
                    "VIDEO" => {
                        let is_round = att.get("videoType").map_or(false, |v| v == "ROUND" || v == 1)
                            || att.get("isRound").and_then(|v| v.as_bool()) == Some(true);
                        if is_round {
                            attach_label = Some("Видео-сообщение");
                        } else {
                            attach_label = Some("Видео");
                        }
                        break;
                    }
                    "AUDIO" => {
                        attach_label = Some("Голосовое сообщение");
                        break;
                    }
                    "FILE" => {
                        attach_label = Some("Файл");
                        break;
                    }
                    "STICKER" => {
                        attach_label = Some("Стикер");
                        break;
                    }
                    "SHARE" => {
                        attach_label = Some("Ссылка");
                        break;
                    }
                    "POLL" => {
                        attach_label = Some("Опрос");
                        break;
                    }
                    "LOCATION" => {
                        attach_label = Some("Геопозиция");
                        break;
                    }
                    "CONTACT" => {
                        attach_label = Some("Контакт");
                        break;
                    }
                    "CALL" => {
                        let hang = att.get("hangupType").and_then(|v| v.as_str()).unwrap_or("");
                        if hang.eq_ignore_ascii_case("MISSED") || hang.eq_ignore_ascii_case("CANCELED") {
                            attach_label = Some("Пропущенный звонок");
                        } else {
                            attach_label = Some("Звонок");
                        }
                        break;
                    }
                    _ => {}
                }
            }
        }

        if let Some(label) = attach_label {
            if !text.is_empty() {
                return format!("{}, {}", label, text);
            }
            return label.to_string();
        }
    }

    if !text.is_empty() {
        return text.to_string();
    }

    "Новое сообщение".to_string()
}

async fn handle_daemon_packet(val: &Value, account: i64, app_dir: &str, client: &rumax::MaxClient) {
    if val.get("type").and_then(|v| v.as_str()) != Some("rx") {
        return;
    }

    let resp = match val.get("response") {
        Some(r) => r,
        None => return,
    };

    let opcode = resp.get("opcode").and_then(|v| v.as_u64()).unwrap_or(0);
    let payload = match resp.get("payload") {
        Some(p) => p,
        None => return,
    };

    match opcode {
        128 => {
            let chat_id = payload.get("chatId").and_then(|v| v.as_i64()).unwrap_or(0);
            let msg = match payload.get("message") {
                Some(m) => m,
                None => return,
            };

            #[cfg(target_os = "android")]
            let mid = msg.get("id").and_then(|v| {
                v.as_i64().map(|i| i.to_string()).or_else(|| v.as_str().map(|s| s.to_string()))
            }).unwrap_or_default();

            let status = msg.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status == "REMOVED" {
                #[cfg(target_os = "android")]
                dispatch_message_removed_to_jni(chat_id, &mid);
                return;
            }

            let sender_id = msg.get("sender").and_then(|v| v.as_i64()).unwrap_or(0);

            let root = crate::stores::resolve_app_root(app_dir);
            let creds = crate::stores::get_background_creds(app_dir, account as u64);
            let local_id = creds.as_ref().map(|c| c.0).unwrap_or(0);
            let is_encrypted = crate::stores::is_account_encrypted_disk(app_dir, local_id);
            let key = crate::stores::get_crypto_key(local_id);

            if is_encrypted && key.is_none() {
                #[cfg(target_os = "android")]
                dispatch_incoming_message_to_jni(
                    chat_id,
                    &mid,
                    "Новое сообщение",
                    sender_id,
                    account,
                    "Новое сообщение",
                    "Чат",
                    false,
                );
                return;
            }

            let data_dir = root.join("data").join(local_id.to_string());
            let cache_dir = root.join("cache").join(local_id.to_string());
            let storage = crate::stores::Storage::new(key);

            let contact_path = data_dir.join("contacts").join(sender_id.to_string());
            let mut sender_name = storage.load(&contact_path).as_ref().and_then(crate::notifications::extract_contact_name);
            let mut sender_avatar_url = storage.load(&contact_path).as_ref().and_then(crate::notifications::extract_avatar_url);

            let chat_path = data_dir.join("chats").join(chat_id.to_string()).join("info");
            let mut chat_title = storage.load(&chat_path).as_ref().and_then(crate::notifications::extract_contact_name);
            let mut chat_avatar_url = storage.load(&chat_path).as_ref().and_then(crate::notifications::extract_avatar_url);
            #[cfg(target_os = "android")]
            let mut is_group = storage.load(&chat_path).as_ref().map(|c| {
                c.get("type").and_then(|t| t.as_str()) == Some("CHAT") || c.get("type").and_then(|t| t.as_str()) == Some("GROUP")
            }).unwrap_or(false);

            if sender_name.is_none() && sender_id > 0 {
                if let Ok(resp) = client.fetch_contacts(vec![sender_id as u64]).await {
                    if let Some(contacts) = resp.payload.get("contacts").and_then(|c| c.as_array()) {
                        if let Some(c) = contacts.first() {
                            let _ = std::fs::create_dir_all(data_dir.join("contacts"));
                            let _ = storage.save(&contact_path, c);
                            sender_name = crate::notifications::extract_contact_name(c);
                            sender_avatar_url = crate::notifications::extract_avatar_url(c);
                        }
                    }
                }
            }

            if chat_title.is_none() && chat_id != 0 {
                if let Ok(resp) = client.get_chats(vec![chat_id]).await {
                    if let Some(chats) = resp.payload.get("chats").and_then(|c| c.as_array()) {
                        if let Some(c) = chats.first() {
                            let chat_dir = data_dir.join("chats").join(chat_id.to_string());
                            let _ = std::fs::create_dir_all(&chat_dir);
                            let _ = storage.save(chat_dir.join("info"), c);
                            chat_title = crate::notifications::extract_contact_name(c);
                            chat_avatar_url = crate::notifications::extract_avatar_url(c);
                            #[cfg(target_os = "android")]
                            {
                                is_group = c.get("type").and_then(|t| t.as_str()) == Some("CHAT") || c.get("type").and_then(|t| t.as_str()) == Some("GROUP");
                            }
                        }
                    }
                }
            }

            if let Some(ref url) = sender_avatar_url {
                let _ = crate::notifications::ensure_avatar_cached(url, &cache_dir, key).await;
            }
            if let Some(ref url) = chat_avatar_url {
                let _ = crate::notifications::ensure_avatar_cached(url, &cache_dir, key).await;
            }

            #[cfg(target_os = "android")]
            {
                let effective_sender = sender_name.unwrap_or_else(|| {
                    if sender_id > 0 {
                        format!("Пользователь {}", sender_id)
                    } else {
                        "Собеседник".to_string()
                    }
                });

                let effective_chat_title = chat_title.unwrap_or_else(|| {
                    if is_group || chat_id < 0 {
                        "Чат".to_string()
                    } else {
                        effective_sender.clone()
                    }
                });

                let preview_text = format_message_preview(msg, &effective_sender);

                dispatch_incoming_message_to_jni(
                    chat_id,
                    &mid,
                    &preview_text,
                    sender_id,
                    account,
                    &effective_sender,
                    &effective_chat_title,
                    is_group,
                );
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (sender_name, chat_title);
            }
        }
        #[cfg(target_os = "android")]
        137 => {
            let conversation_id = payload.get("conversationId").and_then(|v| v.as_str()).unwrap_or("");
            let caller_id = payload.get("callerId").and_then(|v| v.as_i64()).unwrap_or(0);
            let user_name = payload.get("userName").and_then(|v| v.as_str()).unwrap_or("Входящий вызов");
            let vcp = payload.get("vcp").and_then(|v| v.as_str()).unwrap_or("");
            let is_video = payload.get("type").and_then(|v| v.as_str()) == Some("VIDEO");

            dispatch_incoming_call_to_jni(conversation_id, caller_id, user_name, vcp, is_video, account);
        }
        #[cfg(target_os = "android")]
        142 => {
            let chat_id = payload.get("chatId").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(ids) = payload.get("messageIds").and_then(|v| v.as_array()) {
                for id_val in ids {
                    let mid = id_val.as_i64().map(|i| i.to_string()).or_else(|| id_val.as_str().map(|s| s.to_string())).unwrap_or_default();
                    if !mid.is_empty() {
                        dispatch_message_removed_to_jni(chat_id, &mid);
                    }
                }
            }
        }
        _ => {}
    }
}

pub fn start_daemon(app_dir: String, account_id: i64) {
    if DAEMON_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(r) => r,
            Err(_) => {
                DAEMON_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        rt.block_on(async move {
            let reconnect_notify = get_reconnect_notify();

            while DAEMON_RUNNING.load(Ordering::SeqCst) {
                let target_id = if account_id != 0 {
                    account_id as u64
                } else {
                    0
                };
                let creds = crate::stores::get_background_creds(&app_dir, target_id);
                let (server_user_id, token, identity) = match creds {
                    Some((_, uid, t, id)) => (uid, t, id),
                    None => {
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                };

                let client = rumax::MaxClient::new();
                client.set_user_id(server_user_id).await;
                client.set_token(token).await;

                let mut connected = client.connect(identity.clone(), true).await.is_ok();
                if !connected {
                    connected = client.connect(identity, false).await.is_ok();
                }

                if !connected {
                    tokio::select! {
                        _ = reconnect_notify.notified() => {}
                        _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                    }
                    continue;
                }

                let _ = client.sync(None).await;
                let mut rx = client.subscribe();

                loop {
                    if !DAEMON_RUNNING.load(Ordering::SeqCst) {
                        break;
                    }

                    tokio::select! {
                        _ = reconnect_notify.notified() => {
                            break;
                        }
                        event = rx.recv() => {
                            match event {
                                Ok(val) => {
                                    handle_daemon_packet(&val, server_user_id as i64, &app_dir, &client).await;
                                }
                                Err(_) => {
                                    break;
                                }
                            }
                        }
                    }
                }

                client.disconnect().await;
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
    });
}

pub fn stop_daemon() {
    DAEMON_RUNNING.store(false, Ordering::SeqCst);
    trigger_daemon_reconnect();
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_me_junioraww_max_MaxBackgroundService_startDaemonNative<'local>(
    mut unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    app_dir: JString<'local>,
    account: i64,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = unowned_env.with_env(|env| -> Result<(), jni::errors::Error> {
            let vm = env.get_java_vm()?;
            let _ = crate::notifications::GLOBAL_JVM.set(vm);
            Ok(())
        });

        let rust_app_dir: String = match unowned_env.with_env(|env| {
            app_dir.try_to_string(env)
        }).into_outcome() {
            jni::Outcome::Ok(v) => v,
            _ => return,
        };

        start_daemon(rust_app_dir, account);
    }));
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_me_junioraww_max_MaxBackgroundService_stopDaemonNative<'local>(
    _unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
) {
    stop_daemon();
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_me_junioraww_max_MaxBackgroundService_onNetworkChangedNative<'local>(
    _unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
) {
    trigger_daemon_reconnect();
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_me_junioraww_max_AppState_notifyAppStateNative<'local>(
    _unowned_env: EnvUnowned<'local>,
    _this: JObject<'local>,
    in_foreground: jboolean,
) {
    set_app_foreground(in_foreground);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MaxBackgroundService_startDaemonNative<'local>(
    unowned_env: EnvUnowned<'local>,
    this: JObject<'local>,
    app_dir: JString<'local>,
    account: i64,
) {
    Java_me_junioraww_max_MaxBackgroundService_startDaemonNative(unowned_env, this, app_dir, account);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MaxBackgroundService_stopDaemonNative<'local>(
    unowned_env: EnvUnowned<'local>,
    this: JObject<'local>,
) {
    Java_me_junioraww_max_MaxBackgroundService_stopDaemonNative(unowned_env, this);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_MaxBackgroundService_onNetworkChangedNative<'local>(
    unowned_env: EnvUnowned<'local>,
    this: JObject<'local>,
) {
    Java_me_junioraww_max_MaxBackgroundService_onNetworkChangedNative(unowned_env, this);
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_meowkie_max_AppState_notifyAppStateNative<'local>(
    unowned_env: EnvUnowned<'local>,
    this: JObject<'local>,
    in_foreground: jboolean,
) {
    Java_me_junioraww_max_AppState_notifyAppStateNative(unowned_env, this, in_foreground);
}
