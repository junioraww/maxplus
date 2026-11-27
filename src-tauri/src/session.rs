use crate::stores::{
    get_contacts_at, get_crypto_key, has_message_at, load_chats_at, load_sync_state_at,
    load_user_settings_at, mark_message_deleted_at, resolve_account_creds_at, resolve_app_root,
    save_chats_at, save_contact_at, save_sync_state_at, save_user_settings_at, update_messages_at,
    Paths, Storage,
};
use rumax::{Error, MaxClient, ProxyConfig, SyncState};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Mutex as TokioMutex, Notify, RwLock as TokioRwLock};

#[derive(Clone, Debug)]
pub struct HookResolution {
    pub action: String,
    pub payload: Option<Value>,
}

#[derive(Default)]
struct SessionRuntime {
    server_user_id: Option<u64>,
    presence_map: Map<String, Value>,
    folders: Value,
    server_config: Value,
    last_sync_snapshot: Option<Value>,
    token_invalid: bool,
}

impl SessionRuntime {
    fn new() -> Self {
        Self {
            folders: Value::Array(Vec::new()),
            server_config: json!({}),
            ..Default::default()
        }
    }
}

pub struct SessionManager {
    clients: RwLock<HashMap<u64, MaxClient>>,
    pre_auth_client: RwLock<Option<MaxClient>>,
    runtimes: TokioRwLock<HashMap<u64, SessionRuntime>>,
    active_local_id: TokioRwLock<Option<u64>>,
    account_locks: Mutex<HashMap<u64, Arc<TokioMutex<()>>>>,
    reconnect_loops: Mutex<HashSet<u64>>,
    suppress_auto_reconnect: AtomicBool,
    ui_attached: AtomicBool,
    app_handle: RwLock<Option<AppHandle>>,
    app_dir_override: RwLock<Option<String>>,
    hooked_opcodes: RwLock<HashSet<u16>>,
    next_hook_id: AtomicU64,
    pending_hooks: Mutex<HashMap<u64, oneshot::Sender<HookResolution>>>,
    reconnect_notify: Notify,
}

static SESSION_MANAGER: OnceLock<SessionManager> = OnceLock::new();

pub fn manager() -> &'static SessionManager {
    SESSION_MANAGER.get_or_init(|| SessionManager {
        clients: RwLock::new(HashMap::new()),
        pre_auth_client: RwLock::new(None),
        runtimes: TokioRwLock::new(HashMap::new()),
        active_local_id: TokioRwLock::new(None),
        account_locks: Mutex::new(HashMap::new()),
        reconnect_loops: Mutex::new(HashSet::new()),
        suppress_auto_reconnect: AtomicBool::new(false),
        ui_attached: AtomicBool::new(false),
        app_handle: RwLock::new(None),
        app_dir_override: RwLock::new(None),
        hooked_opcodes: RwLock::new(HashSet::new()),
        next_hook_id: AtomicU64::new(1),
        pending_hooks: Mutex::new(HashMap::new()),
        reconnect_notify: Notify::new(),
    })
}

fn as_i64(v: Option<&Value>) -> Option<i64> {
    v.and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse::<i64>().ok())))
}

fn as_u64(v: Option<&Value>) -> Option<u64> {
    v.and_then(|x| x.as_u64().or_else(|| x.as_str().and_then(|s| s.parse::<u64>().ok())))
}

fn id_str(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| {
        x.as_str()
            .map(str::to_string)
            .or_else(|| x.as_i64().map(|n| n.to_string()))
            .or_else(|| x.as_u64().map(|n| n.to_string()))
    })
}

fn is_fatal_token_error(err: &Error) -> bool {
    let Error::ApiResponse(payload) = err else {
        return false;
    };
    let code = payload.get("error").and_then(|v| v.as_str()).unwrap_or("");
    code.contains("login.token")
        || code.contains("FAIL_LOGIN_TOKEN")
        || code.contains("login.blocked")
        || code.contains("auth.failed")
}

pub fn is_notify_when_inactive_at(root: &Path, local_id: u64) -> bool {
    let paths = Paths::from_root(root, local_id);
    let key = get_crypto_key(local_id);
    Storage::new(key)
        .load(paths.root.join("meta"))
        .and_then(|m| m.get("notify_when_inactive").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

fn is_chat_muted_at(paths: &Paths, key: Option<[u8; 32]>, chat_id: i64) -> bool {
    let Some(val) = Storage::new(key).load(paths.info(chat_id)) else {
        return false;
    };
    let Some(num) = val.get("dontDisturbUntil").and_then(|v| v.as_i64()) else {
        return false;
    };
    if num == -1 {
        return true;
    }
    num > 0 && num > chrono::Utc::now().timestamp_millis()
}

fn merge_chat_config(chats: Vec<Value>, config: Option<&Value>) -> Vec<Value> {
    let Some(config_chats) = config.and_then(|c| c.get("chats")).and_then(|v| v.as_object()) else {
        return chats;
    };
    chats
        .into_iter()
        .map(|mut chat| {
            if let Some(chat_cfg) = id_str(chat.get("id")).and_then(|id| config_chats.get(&id)) {
                let ddu = chat_cfg
                    .get("dontDisturbUntil")
                    .or_else(|| chat_cfg.pointer("/chatSettings/dontDisturbUntil"))
                    .or_else(|| chat_cfg.pointer("/options/sound/dontDisturbUntil"))
                    .or_else(|| chat.get("dontDisturbUntil"))
                    .or_else(|| chat.pointer("/chatSettings/dontDisturbUntil"))
                    .or_else(|| chat.pointer("/options/sound/dontDisturbUntil"))
                    .cloned();
                if let (Some(ddu_val), Some(obj)) = (ddu, chat.as_object_mut()) {
                    obj.insert("dontDisturbUntil".to_string(), ddu_val);
                }
            }
            chat
        })
        .collect()
}

fn update_chat_info_at<F>(paths: &Paths, key: Option<[u8; 32]>, chat_id: i64, f: F)
where
    F: FnOnce(&mut Map<String, Value>),
{
    let storage = Storage::new(key);
    let info_path = paths.info(chat_id);
    if let Some(mut chat_obj) = storage.load(&info_path) {
        if let Some(obj) = chat_obj.as_object_mut() {
            f(obj);
            let _ = storage.save(info_path, &chat_obj);
        }
    }
}

fn spawn_bg<F>(fut: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(fut);
    } else {
        tauri::async_runtime::spawn(fut);
    }
}

impl SessionManager {
    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(dir) = app.path().app_data_dir() {
            if let Ok(mut dir_guard) = self.app_dir_override.write() {
                if dir_guard.is_none() {
                    *dir_guard = Some(dir.to_string_lossy().to_string());
                }
            }
        }
        if let Ok(mut guard) = self.app_handle.write() {
            *guard = Some(app);
        }
    }

    pub fn set_app_dir(&self, app_dir: String) {
        if let Ok(mut guard) = self.app_dir_override.write() {
            *guard = Some(app_dir);
        }
    }

    pub fn set_ui_attached(&self, attached: bool) {
        self.ui_attached.store(attached, Ordering::SeqCst);
    }

    pub fn is_ui_attached(&self) -> bool {
        self.ui_attached.load(Ordering::SeqCst)
    }

    pub fn set_hooked_opcodes(&self, opcodes: Vec<u16>) {
        if let Ok(mut guard) = self.hooked_opcodes.write() {
            *guard = opcodes.into_iter().collect();
        }
    }

    pub fn resolve_hook(&self, hook_id: u64, action: String, payload: Option<Value>) {
        let sender = self
            .pending_hooks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&hook_id);
        if let Some(tx) = sender {
            let _ = tx.send(HookResolution { action, payload });
        }
    }

    pub fn notify_reconnect(&self) {
        self.reconnect_notify.notify_one();
    }

    pub fn emit_to_ui(&self, event: &str, payload: Value) {
        if !self.is_ui_attached() {
            return;
        }
        if let Some(app) = self.app_handle.read().ok().and_then(|g| g.clone()) {
            let _ = app.emit(event, payload);
        }
    }

    pub async fn clear_token_invalid(&self) {
        if let Some(lid) = *self.active_local_id.read().await {
            if let Some(rt) = self.runtimes.write().await.get_mut(&lid) {
                rt.token_invalid = false;
            }
        }
    }

    pub async fn clear_token_invalid_for(&self, local_id: u64) {
        if let Some(rt) = self.runtimes.write().await.get_mut(&local_id) {
            rt.token_invalid = false;
        }
    }

    pub async fn set_suppress_reconnect(&self, suppress: bool) {
        self.suppress_auto_reconnect.store(suppress, Ordering::SeqCst);
    }

    pub async fn is_suppress_reconnect(&self) -> bool {
        self.suppress_auto_reconnect.load(Ordering::SeqCst)
    }

    pub async fn is_token_invalid(&self) -> bool {
        let Some(lid) = *self.active_local_id.read().await else {
            return false;
        };
        self.runtimes
            .read()
            .await
            .get(&lid)
            .map(|rt| rt.token_invalid)
            .unwrap_or(false)
    }

    pub fn client_for(&self, local_id: u64) -> Option<MaxClient> {
        self.clients
            .read()
            .ok()
            .and_then(|map| map.get(&local_id).cloned())
    }

    pub fn all_clients(&self) -> Vec<(u64, MaxClient)> {
        self.clients
            .read()
            .ok()
            .map(|map| map.iter().map(|(&id, c)| (id, c.clone())).collect())
            .unwrap_or_default()
    }

    pub fn active_client(&self) -> MaxClient {
        if let Ok(lid_guard) = self.active_local_id.try_read() {
            if let Some(lid) = *lid_guard {
                if let Some(c) = self.client_for(lid) {
                    return c;
                }
            }
        }
        if let Ok(guard) = self.pre_auth_client.read() {
            if let Some(ref c) = *guard {
                return c.clone();
            }
        }
        let mut guard = self.pre_auth_client.write().unwrap_or_else(|e| e.into_inner());
        if let Some(ref c) = *guard {
            return c.clone();
        }
        let c = MaxClient::new();
        *guard = Some(c.clone());
        let mut rx = c.subscribe();
        spawn_bg(async move {
            let mgr = manager();
            loop {
                match rx.recv().await {
                    Ok(val) => {
                        if mgr.active_local_id.read().await.is_none() {
                            mgr.emit_to_ui("max", val);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        c
    }

    pub async fn set_proxy_all(&self, proxy: Option<ProxyConfig>) {
        if let Some(pre) = self.pre_auth_client.read().ok().and_then(|g| g.clone()) {
            pre.set_proxy(proxy.clone()).await;
        }
        for (_, client) in self.all_clients() {
            client.set_proxy(proxy.clone()).await;
        }
    }

    fn account_lock(&self, local_id: u64) -> Arc<TokioMutex<()>> {
        let mut map = self.account_locks.lock().unwrap_or_else(|e| e.into_inner());
        map.entry(local_id)
            .or_insert_with(|| Arc::new(TokioMutex::new(())))
            .clone()
    }

    fn spawn_client_event_loop(&self, local_id: u64, client: MaxClient) {
        let mut rx = client.subscribe();
        spawn_bg(async move {
            let mgr = manager();
            loop {
                match rx.recv().await {
                    Ok(val) => {
                        let still_registered = mgr
                            .clients
                            .read()
                            .ok()
                            .map(|m| m.contains_key(&local_id))
                            .unwrap_or(false);
                        if !still_registered {
                            break;
                        }
                        mgr.handle_client_event(local_id, &client, val).await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    async fn get_or_create_client(&self, local_id: u64, token: &str) -> MaxClient {
        if let Some(existing) = self.client_for(local_id) {
            return existing;
        }

        let promoted = {
            let pre_opt = self.pre_auth_client.read().ok().and_then(|g| g.clone());
            if let Some(pre) = pre_opt {
                if pre.is_connected().await
                    && !pre.is_synced().await
                    && pre.get_token().await.as_deref() == Some(token)
                {
                    let mut guard = self.pre_auth_client.write().unwrap_or_else(|e| e.into_inner());
                    guard.take()
                } else {
                    None
                }
            } else {
                None
            }
        };

        let client = promoted.unwrap_or_else(MaxClient::new);
        let inserted = {
            let mut map = self.clients.write().unwrap_or_else(|e| e.into_inner());
            if let Some(c) = map.get(&local_id) {
                return c.clone();
            }
            map.insert(local_id, client.clone());
            client.clone()
        };
        self.spawn_client_event_loop(local_id, inserted.clone());
        inserted
    }

    pub async fn reset_session_state(&self) {
        let lid = *self.active_local_id.write().await;
        if let Some(id) = lid {
            self.disconnect_account(id).await;
        }
        let pre_opt = self.pre_auth_client.write().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(pre) = pre_opt {
            pre.disconnect().await;
        }
    }

    pub async fn disconnect_account(&self, local_id: u64) {
        {
            let mut active = self.active_local_id.write().await;
            if *active == Some(local_id) {
                *active = None;
            }
        }
        let client = self
            .clients
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&local_id);
        self.runtimes.write().await.remove(&local_id);
        if let Some(c) = client {
            c.disconnect().await;
        }
    }

    pub fn resolve_root(&self) -> Option<PathBuf> {
        if let Some(dir) = self
            .app_handle
            .read()
            .ok()
            .and_then(|g| g.as_ref().and_then(|app| app.path().app_data_dir().ok()))
        {
            return Some(dir);
        }
        self.app_dir_override
            .read()
            .ok()
            .and_then(|g| g.as_ref().map(|d| resolve_app_root(d)))
    }

    async fn run_incoming_hook(&self, opcode: u16, payload: Value) -> Option<Value> {
        if !self.is_ui_attached() {
            return Some(payload);
        }
        #[cfg(target_os = "android")]
        if !crate::daemon::is_app_foreground() {
            return Some(payload);
        }
        let is_hooked = self
            .hooked_opcodes
            .read()
            .map(|set| set.contains(&opcode))
            .unwrap_or(false);
        if !is_hooked {
            return Some(payload);
        }
        let app = self.app_handle.read().ok().and_then(|g| g.clone())?;
        let hook_id = self.next_hook_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending_hooks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(hook_id, tx);
        if app
            .emit(
                "max:opcode-hook",
                json!({ "hookId": hook_id, "opcode": opcode, "payload": payload }),
            )
            .is_err()
        {
            self.pending_hooks
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&hook_id);
            return Some(payload);
        }
        match tokio::time::timeout(Duration::from_millis(600), rx).await {
            Ok(Ok(res)) if res.action == "drop" => None,
            Ok(Ok(res)) => Some(res.payload.unwrap_or(payload)),
            _ => {
                self.pending_hooks
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&hook_id);
                Some(payload)
            }
        }
    }

    async fn handle_client_event(&self, local_id: u64, client: &MaxClient, mut val: Value) {
        let is_active = *self.active_local_id.read().await == Some(local_id);
        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if msg_type == "rx" {
            let opcode = val.pointer("/response/opcode").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            let payload = val.pointer("/response/payload").cloned().unwrap_or(Value::Null);
            let filtered_payload = if is_active {
                let Some(p) = self.run_incoming_hook(opcode, payload).await else {
                    return;
                };
                p
            } else {
                payload
            };
            if let Some(resp_obj) = val.get_mut("response").and_then(|v| v.as_object_mut()) {
                resp_obj.insert("payload".to_string(), filtered_payload.clone());
            }

            let server_uid = {
                self.runtimes
                    .read()
                    .await
                    .get(&local_id)
                    .and_then(|rt| rt.server_user_id)
            };
            let root_opt = self.resolve_root();
            let should_notify = if let Some(ref root) = root_opt {
                self.apply_incoming_push(root, local_id, server_uid, opcode, &filtered_payload, client)
                    .await
            } else {
                opcode == 137
            };

            let allow_bg_notify = is_active
                || root_opt
                    .as_ref()
                    .map(|r| is_notify_when_inactive_at(r, local_id))
                    .unwrap_or(true);

            #[cfg(target_os = "android")]
            if should_notify && allow_bg_notify && (!crate::daemon::is_app_foreground() || !is_active) {
                let dir_opt = self
                    .app_dir_override
                    .read()
                    .ok()
                    .and_then(|g| g.clone())
                    .or_else(|| root_opt.as_ref().map(|p| p.to_string_lossy().to_string()));
                if let Some(dir) = dir_opt {
                    crate::daemon::handle_daemon_packet(&val, local_id as i64, &dir, client).await;
                }
            }

            #[cfg(not(target_os = "android"))]
            if should_notify && !is_active && allow_bg_notify && (opcode == 128 || opcode == 137) && self.is_ui_attached() {
                if let (Some(ref root), Some(app)) = (
                    &root_opt,
                    self.app_handle.read().ok().and_then(|g| g.clone()),
                ) {
                    let key = get_crypto_key(local_id);
                    let is_encrypted = crate::stores::is_account_encrypted_disk(
                        &root.to_string_lossy(),
                        local_id,
                    );
                    let can_persist = !is_encrypted || key.is_some();
                    let paths = Paths::from_root(root, local_id);
                    let chat_id = as_i64(filtered_payload.get("chatId")).unwrap_or(0);
                    let sender = as_u64(filtered_payload.pointer("/message/sender"));
                    let sender_id = sender.unwrap_or(0);
                    let is_self = sender.is_some() && sender == server_uid;
                    if !is_self && (opcode == 137 || !is_chat_muted_at(&paths, key, chat_id)) {
                        let client = client.clone();
                        let root = root.clone();
                        let filtered_payload = filtered_payload.clone();
                        tokio::spawn(async move {
                            let storage = Storage::new(key);
                            let contact_val = if sender_id > 0 {
                                storage.load(paths.contact(sender_id))
                            } else {
                                None
                            };
                            let mut sender_name = contact_val
                                .as_ref()
                                .and_then(crate::notifications::extract_contact_name);
                            let mut sender_avatar_url = contact_val
                                .as_ref()
                                .and_then(crate::notifications::extract_avatar_url);

                            let chat_val = storage.load(paths.info(chat_id));
                            let mut chat_title = chat_val
                                .as_ref()
                                .and_then(crate::notifications::extract_contact_name);
                            let mut chat_avatar_url = chat_val
                                .as_ref()
                                .and_then(crate::notifications::extract_avatar_url);
                            let mut is_group = chat_val
                                .as_ref()
                                .and_then(|c| c.get("type").and_then(|t| t.as_str()))
                                .is_some_and(|t| t == "CHAT" || t == "GROUP");

                            if sender_name.is_none() && sender_id > 0 {
                                if let Ok(resp) = client.fetch_contacts(vec![sender_id]).await {
                                    if let Some(c) = resp
                                        .payload
                                        .get("contacts")
                                        .and_then(|v| v.as_array())
                                        .and_then(|a| a.first())
                                    {
                                        if can_persist {
                                            let _ = storage.save(paths.contact(sender_id), c);
                                        }
                                        sender_name = crate::notifications::extract_contact_name(c);
                                        sender_avatar_url = crate::notifications::extract_avatar_url(c);
                                    }
                                }
                            }

                            if chat_title.is_none() && chat_id != 0 {
                                if let Ok(resp) = client.get_chats(vec![chat_id]).await {
                                    if let Some(c) = resp
                                        .payload
                                        .get("chats")
                                        .and_then(|v| v.as_array())
                                        .and_then(|a| a.first())
                                    {
                                        if can_persist {
                                            let _ = storage.save(paths.info(chat_id), c);
                                        }
                                        chat_title = crate::notifications::extract_contact_name(c);
                                        chat_avatar_url = crate::notifications::extract_avatar_url(c);
                                        is_group = c
                                            .get("type")
                                            .and_then(|t| t.as_str())
                                            .is_some_and(|t| t == "CHAT" || t == "GROUP");
                                    }
                                }
                            }

                            let chosen_url = if is_group {
                                chat_avatar_url.as_deref().or(sender_avatar_url.as_deref())
                            } else {
                                sender_avatar_url.as_deref().or(chat_avatar_url.as_deref())
                            };
                            let avatar_path = if key.is_none() && !is_encrypted {
                                if let Some(url) = chosen_url {
                                    let cache_dir = root.join("cache").join(local_id.to_string());
                                    crate::notifications::ensure_avatar_cached(url, &cache_dir, None).await
                                } else {
                                    None
                                }
                            } else {
                                None
                            };

                            let effective_sender = sender_name.unwrap_or_else(|| {
                                if sender_id > 0 {
                                    format!("Пользователь {}", sender_id)
                                } else {
                                    "Собеседник".to_string()
                                }
                            });
                            let effective_title = chat_title.unwrap_or_else(|| {
                                if is_group || chat_id < 0 {
                                    "Чат".to_string()
                                } else {
                                    effective_sender.clone()
                                }
                            });
                            let is_actually_group = is_group && effective_title != effective_sender;
                            let preview_text = if opcode == 137 {
                                "Входящий вызов".to_string()
                            } else if let Some(msg) = filtered_payload.get("message") {
                                crate::daemon::format_message_preview(msg, &effective_sender)
                            } else {
                                "Новое сообщение".to_string()
                            };

                            let _ = app.emit(
                                "session:background-notify",
                                json!({
                                    "accountId": local_id,
                                    "opcode": opcode,
                                    "chatId": chat_id,
                                    "senderId": sender_id,
                                    "title": effective_title,
                                    "senderName": effective_sender,
                                    "previewText": preview_text,
                                    "avatarPath": avatar_path,
                                    "avatarUrl": chosen_url,
                                    "isEncrypted": is_encrypted,
                                    "isGroup": is_actually_group,
                                    "payload": filtered_payload,
                                }),
                            );
                        });
                    }
                }
            }

            if is_active {
                self.emit_to_ui("max", val);
            } else {
                self.emit_to_ui(
                    "session:trace",
                    json!({ "accountId": local_id, "event": val }),
                );
            }
            return;
        }

        if msg_type == "log" && val.get("response").and_then(|v| v.as_str()) == Some("closed") {
            let token_invalid = self
                .runtimes
                .read()
                .await
                .get(&local_id)
                .map(|rt| rt.token_invalid)
                .unwrap_or(false);
            let bg_wanted = self
                .resolve_root()
                .map(|r| is_notify_when_inactive_at(&r, local_id))
                .unwrap_or(false);
            let should_reconnect =
                !token_invalid && !self.is_suppress_reconnect().await && (is_active || bg_wanted);

            if should_reconnect {
                self.reconnect_notify.notify_one();
                #[cfg(target_os = "android")]
                let daemon_active = crate::daemon::is_daemon_running();
                #[cfg(not(target_os = "android"))]
                let daemon_active = false;
                if !daemon_active {
                    self.spawn_reconnect_loop(local_id, is_active);
                }
            }
        }

        if is_active {
            self.emit_to_ui("max", val);
        }
    }

    fn spawn_reconnect_loop(&self, local_id: u64, interactive: bool) {
        {
            let mut set = self.reconnect_loops.lock().unwrap_or_else(|e| e.into_inner());
            if !set.insert(local_id) {
                return;
            }
        }
        spawn_bg(async move {
            let mgr = manager();
            let mut delay_ms = 1000u64;
            loop {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                let is_active = *mgr.active_local_id.read().await == Some(local_id);
                let token_invalid = mgr
                    .runtimes
                    .read()
                    .await
                    .get(&local_id)
                    .map(|rt| rt.token_invalid)
                    .unwrap_or(false);
                let stop = token_invalid
                    || mgr.is_suppress_reconnect().await
                    || (is_active && !mgr.is_ui_attached());
                if stop {
                    break;
                }
                let Some(root) = mgr.resolve_root() else {
                    break;
                };
                match mgr
                    .ensure_session_for_account(&root, Some(local_id), is_active && interactive)
                    .await
                {
                    Ok((reused, snapshot)) => {
                        if is_active {
                            mgr.emit_to_ui(
                                "session:online",
                                json!({ "reused": reused, "snapshot": snapshot }),
                            );
                        }
                        break;
                    }
                    Err(_) => {
                        let invalid = mgr
                            .runtimes
                            .read()
                            .await
                            .get(&local_id)
                            .map(|rt| rt.token_invalid)
                            .unwrap_or(false);
                        if invalid {
                            if is_active {
                                mgr.emit_to_ui("session:expired", json!({}));
                            }
                            break;
                        }
                        delay_ms = (delay_ms.saturating_mul(2)).min(15000);
                    }
                }
            }
            mgr.reconnect_loops
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&local_id);
        });
    }

    async fn apply_incoming_push(
        &self,
        root: &PathBuf,
        local_id: u64,
        server_user_id: Option<u64>,
        opcode: u16,
        payload: &Value,
        client: &MaxClient,
    ) -> bool {
        let key = get_crypto_key(local_id);
        let paths = Paths::from_root(root, local_id);

        match opcode {
            128 => {
                let (Some(chat_id), Some(msg)) =
                    (as_i64(payload.get("chatId")), payload.get("message").cloned())
                else {
                    return false;
                };
                let status = msg.get("status").and_then(|v| v.as_str()).unwrap_or("");
                if status == "REMOVED" {
                    if let Some(mid) = id_str(msg.get("id")) {
                        let _ = mark_message_deleted_at(&paths, key, chat_id, &mid);
                    }
                    return true;
                }
                let is_edited = status == "EDITED" || msg.get("edited").is_some();
                let is_comment_push = payload.get("postId").is_some()
                    || msg.get("postId").is_some()
                    || msg.pointer("/link/postId").is_some();
                let already_cached = msg
                    .get("id")
                    .map(|mid| has_message_at(&paths, key, chat_id, mid, as_i64(msg.get("time"))))
                    .unwrap_or(false);
                let _ = update_messages_at(&paths, key, chat_id, vec![msg.clone()]);
                let info_path = paths.info(chat_id);
                if !is_edited && !is_comment_push && !info_path.exists() {
                    if let Ok(resp) = client.get_chats(vec![chat_id]).await {
                        if let Some(c) = resp
                            .payload
                            .get("chats")
                            .and_then(|v| v.as_array())
                            .and_then(|arr| arr.first())
                            .cloned()
                        {
                            let _ = save_chats_at(&paths, key, vec![c]);
                        }
                    }
                    if !info_path.exists() {
                        let _ = Storage::new(key).save(
                            &info_path,
                            &json!({ "id": chat_id, "type": "DIALOG" }),
                        );
                    }
                }
                update_chat_info_at(&paths, key, chat_id, |obj| {
                    let msg_id = id_str(msg.get("id"));
                    let last_id = id_str(obj.get("lastMessage").and_then(|m| m.get("id")));
                    let already_has_msg = msg_id.is_some() && msg_id == last_id;
                    if !is_edited || already_has_msg {
                        obj.insert("lastMessage".to_string(), msg.clone());
                    }
                    if !is_edited && !already_has_msg && !already_cached {
                        let msg_time = as_i64(msg.get("time")).unwrap_or(0);
                        if msg_time >= as_i64(obj.get("lastEventTime")).unwrap_or(0) {
                            obj.insert("lastEventTime".to_string(), json!(msg_time));
                        }
                        let sender = as_u64(msg.get("sender"));
                        if sender.is_some() && sender != server_user_id {
                            let unread = obj.get("newMessages").and_then(|v| v.as_i64()).unwrap_or(0);
                            obj.insert("newMessages".to_string(), json!(unread + 1));
                        }
                    }
                });
                return !is_edited && !is_comment_push && !already_cached;
            }
            130 => {
                if let (Some(chat_id), Some(uid), Some(mark)) = (
                    as_i64(payload.get("chatId")),
                    id_str(payload.get("userId")),
                    as_i64(payload.get("mark")),
                ) {
                    update_chat_info_at(&paths, key, chat_id, |obj| {
                        if let Some(parts) = obj.get_mut("participants").and_then(|p| p.as_object_mut()) {
                            parts.insert(uid.clone(), json!(mark));
                        }
                        if server_user_id.map(|s| s.to_string()) != Some(uid)
                            && mark > as_i64(obj.get("otherReadTime")).unwrap_or(0)
                        {
                            obj.insert("otherReadTime".to_string(), json!(mark));
                        }
                    });
                }
            }
            131 => {
                if let Some(contact) = payload.get("contact") {
                    if let Some(cid) = as_u64(contact.get("id")) {
                        let _ = save_contact_at(&paths, key, cid, contact);
                        if Some(cid) == server_user_id {
                            let _ = Storage::new(key).save(paths.self_contact(), contact);
                        }
                    }
                }
            }
            132 => {
                if let Some(presence) = payload.get("presence").and_then(|v| v.as_object()) {
                    let mut runtimes = self.runtimes.write().await;
                    let rt = runtimes.entry(local_id).or_insert_with(SessionRuntime::new);
                    for (k, v) in presence {
                        rt.presence_map.insert(k.clone(), v.clone());
                    }
                }
            }
            134 => {
                if let Some(cfg) = payload.get("config") {
                    if let Some(user_cfg) = cfg.get("user") {
                        let _ = save_user_settings_at(&paths, key, user_cfg);
                    }
                    if let Some(chats_cfg) = cfg.get("chats").and_then(|v| v.as_object()) {
                        let affected: Vec<Value> = load_chats_at(&paths, key)
                            .into_iter()
                            .filter(|c| id_str(c.get("id")).map(|id| chats_cfg.contains_key(&id)).unwrap_or(false))
                            .collect();
                        let updated = merge_chat_config(affected, Some(cfg));
                        if !updated.is_empty() {
                            let _ = save_chats_at(&paths, key, updated);
                        }
                    }
                }
            }
            135 => {
                if let Some(chat) = payload.get("chat").cloned() {
                    let _ = save_chats_at(&paths, key, vec![chat]);
                }
            }
            140 | 142 => {
                if let (Some(chat_id), Some(ids)) = (
                    as_i64(payload.get("chatId")),
                    payload.get("messageIds").and_then(|v| v.as_array()),
                ) {
                    for id_val in ids {
                        if let Some(mid) = id_str(Some(id_val)) {
                            let _ = mark_message_deleted_at(&paths, key, chat_id, &mid);
                        }
                    }
                }
            }
            155 | 156 => {
                if let Some(chat_id) = as_i64(payload.get("chatId")) {
                    let r_info = payload.get("reactionInfo").unwrap_or(payload);
                    let total = payload
                        .get("totalCount")
                        .or_else(|| r_info.get("totalCount"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let counters = payload
                        .get("counters")
                        .or_else(|| r_info.get("counters"))
                        .and_then(|v| v.as_array());
                    let your_reaction = payload
                        .get("yourReaction")
                        .or_else(|| r_info.get("yourReaction"));
                    let is_self =
                        opcode == 156 || (your_reaction.map(|v| !v.is_null()).unwrap_or(false) && total > 0);
                    update_chat_info_at(&paths, key, chat_id, |obj| {
                        if is_self || total == 0 {
                            obj.insert("hasReaction".to_string(), json!(false));
                            obj.insert("unreadReactions".to_string(), json!(0));
                            obj.insert("lastReaction".to_string(), Value::Null);
                        } else {
                            let emoji = counters
                                .and_then(|c| c.first())
                                .and_then(|r| r.get("reaction"))
                                .and_then(|r| r.as_str().or_else(|| r.get("id").and_then(|id| id.as_str())))
                                .unwrap_or("❤️");
                            obj.insert("hasReaction".to_string(), json!(true));
                            obj.insert("unreadReactions".to_string(), json!(1));
                            obj.insert("lastReaction".to_string(), json!(emoji));
                        }
                    });
                }
            }
            159 => {
                if let Some(contact) = payload.pointer("/profile/contact").or_else(|| payload.get("contact")) {
                    let _ = Storage::new(key).save(paths.self_contact(), contact);
                    if let Some(cid) = as_u64(contact.get("id")) {
                        let _ = save_contact_at(&paths, key, cid, contact);
                    }
                }
            }
            277 => {
                if let Some(f) = payload.get("folders").or_else(|| payload.pointer("/folderSync/folders")).cloned() {
                    let _ = Storage::new(key).save(paths.folders(), &f);
                    let mut runtimes = self.runtimes.write().await;
                    let rt = runtimes.entry(local_id).or_insert_with(SessionRuntime::new);
                    rt.folders = f;
                }
            }
            _ => {}
        }
        matches!(opcode, 137 | 142)
    }

    async fn sync_and_persist(
        &self,
        root: &PathBuf,
        local_id: u64,
        meta: &Value,
        client: &MaxClient,
        interactive: bool,
    ) -> Result<Value, Error> {
        let key = get_crypto_key(local_id);
        let paths = Paths::from_root(root, local_id);

        let initial_sync_state: SyncState = load_sync_state_at(&paths, key).unwrap_or_default();
        let (sync_resp, sync2_opt, new_sync_state) = client.sync(Some(initial_sync_state)).await?;

        let mut merged = sync_resp.payload;
        if let Some(sync2) = sync2_opt {
            if let (Value::Object(ref mut m1), Value::Object(m2)) = (&mut merged, sync2.payload) {
                m1.extend(m2);
            }
        }

        let user_id = merged
            .pointer("/profile/contact/id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| Error::Other("User ID not found in sync response".to_string()))?;

        client.set_user_id(user_id).await;
        let telemetry_mode = meta.get("telemetry").and_then(|v| v.as_str()).unwrap_or_else(|| {
            if meta.get("sendTelemetry").and_then(|v| v.as_bool()) == Some(false) {
                "disabled"
            } else {
                "fake"
            }
        });
        client.set_telemetry_mode(telemetry_mode.to_string()).await;
        let presence_val = if interactive {
            meta.get("presence").and_then(|v| v.as_bool()).unwrap_or(true)
        } else {
            false
        };
        client.set_presence(presence_val).await;
        client.spawn_telemetry_task().await;

        let storage = Storage::new(key);
        if let Some(profile_contact) = merged.pointer("/profile/contact").cloned() {
            let mut full_contact = profile_contact;
            if let Some(opts) = merged.pointer("/profile/profileOptions").cloned() {
                if let Some(obj) = full_contact.as_object_mut() {
                    obj.entry("profileOptions".to_string()).or_insert(opts);
                }
            }
            let _ = storage.save(paths.self_contact(), &full_contact);
            let _ = save_contact_at(&paths, key, user_id, &full_contact);
        }

        let cfg_val = merged.get("config").cloned();
        if let Some(chats_arr) = merged.get("chats").and_then(|v| v.as_array()) {
            let _ = save_chats_at(&paths, key, merge_chat_config(chats_arr.clone(), cfg_val.as_ref()));
        }
        if let Some(contacts_arr) = merged.get("contacts").and_then(|v| v.as_array()) {
            for c in contacts_arr {
                if let Some(cid) = as_u64(c.get("id")) {
                    let _ = save_contact_at(&paths, key, cid, c);
                }
            }
        }
        if let Some(ref cfg) = cfg_val {
            if let Some(user_cfg) = cfg.get("user") {
                let _ = save_user_settings_at(&paths, key, user_cfg);
            }
            if let Some(folders_val) = cfg.get("chatFolders").cloned() {
                let _ = storage.save(paths.folders(), &folders_val);
            }
            if let Some(server_cfg) = cfg.get("server").cloned() {
                let _ = storage.save(paths.server_config(), &server_cfg);
            }
        }

        let _ = save_sync_state_at(&paths, key, &new_sync_state);

        let mut runtimes = self.runtimes.write().await;
        let rt = runtimes.entry(local_id).or_insert_with(SessionRuntime::new);
        rt.server_user_id = Some(user_id);
        rt.token_invalid = false;
        if let Some(presence) = merged.get("presence").and_then(|v| v.as_object()) {
            for (k, v) in presence {
                rt.presence_map.insert(k.clone(), v.clone());
            }
        }
        if let Some(folders_val) = cfg_val.as_ref().and_then(|c| c.get("chatFolders")).cloned() {
            rt.folders = folders_val;
        }
        if let Some(server_cfg) = cfg_val.as_ref().and_then(|c| c.get("server")).cloned() {
            rt.server_config = server_cfg;
        }
        rt.last_sync_snapshot = Some(merged.clone());

        Ok(merged)
    }

    pub async fn ensure_session_for_account(
        &self,
        root: &PathBuf,
        target_account_id: Option<u64>,
        interactive: bool,
    ) -> Result<(bool, Value), Value> {
        let (local_id, server_uid, token, identity, meta) =
            resolve_account_creds_at(root, target_account_id).map_err(|e| json!({ "error": e }))?;

        let lock = self.account_lock(local_id);
        let _guard = lock.lock().await;

        if interactive {
            let prev = {
                let mut active = self.active_local_id.write().await;
                let prev = *active;
                *active = Some(local_id);
                prev
            };
            if let Some(prev_id) = prev {
                if prev_id != local_id {
                    if let Some(prev_client) = self.client_for(prev_id) {
                        prev_client.set_presence(false).await;
                    }
                }
            }
        } else {
            let mut active = self.active_local_id.write().await;
            if active.is_none() {
                *active = Some(local_id);
            }
        }

        let client = self.get_or_create_client(local_id, &token).await;

        if client.is_connected().await && client.is_synced().await {
            if interactive {
                let p = meta.get("presence").and_then(|v| v.as_bool()).unwrap_or(true);
                client.set_presence(p).await;
            } else {
                client.set_presence(false).await;
            }
            if client.probe_liveness().await {
                return Ok((true, self.build_ui_snapshot(root, local_id).await));
            }
        }

        let needs_connect = !client.is_connected().await;
        if let Some(uid) = server_uid {
            client.set_user_id(uid).await;
        }
        client.set_token(token).await;
        client.set_presence(interactive).await;

        if needs_connect {
            if let Ok(settings) = crate::proxy_manager::fetch_proxy_config().await {
                if settings.vpn_bypass_enabled {
                    let _ = crate::vpn_bypass::apply_physical_network_route();
                }
            }
            client.connect(identity, true).await.map_err(|e| e.to_json())?;
        }

        match self.sync_and_persist(root, local_id, &meta, &client, interactive).await {
            Ok(_) => Ok((false, self.build_ui_snapshot(root, local_id).await)),
            Err(e) => {
                if is_fatal_token_error(&e) {
                    let mut runtimes = self.runtimes.write().await;
                    let rt = runtimes.entry(local_id).or_insert_with(SessionRuntime::new);
                    rt.token_invalid = true;
                }
                client.disconnect().await;
                Err(e.to_json())
            }
        }
    }

    pub async fn sync_background_accounts(&self, root: &PathBuf) {
        if self.is_suppress_reconnect().await {
            return;
        }
        let accounts_path = root.join("accounts");
        let Some(store) = Storage::new(None).load(&accounts_path) else {
            return;
        };
        let Some(accounts) = store.get("accounts").and_then(|a| a.as_array()) else {
            return;
        };
        let active_id = *self.active_local_id.read().await;
        for acc in accounts {
            let Some(lid) = acc.get("id").and_then(|v| v.as_u64()) else {
                continue;
            };
            if Some(lid) == active_id {
                continue;
            }
            if is_notify_when_inactive_at(root, lid) {
                let already_ok = match self.client_for(lid) {
                    Some(c) => c.is_connected().await && c.is_synced().await,
                    None => false,
                };
                if !already_ok {
                    let _ = self.ensure_session_for_account(root, Some(lid), false).await;
                }
            } else if self.client_for(lid).is_some() {
                self.disconnect_account(lid).await;
            }
        }
    }

    pub async fn probe_and_repair_all(&self, root: &PathBuf) {
        if self.is_suppress_reconnect().await {
            return;
        }
        let active_id = *self.active_local_id.read().await;
        for (lid, client) in self.all_clients() {
            let is_active = Some(lid) == active_id;
            if !is_active && !is_notify_when_inactive_at(root, lid) {
                self.disconnect_account(lid).await;
                continue;
            }
            if !client.is_connected().await || !client.is_synced().await || !client.probe_liveness().await {
                let _ = self.ensure_session_for_account(root, Some(lid), false).await;
            }
        }
        self.sync_background_accounts(root).await;
    }

    pub async fn wait_for_reconnect_signal(&self) {
        self.reconnect_notify.notified().await;
    }

    pub async fn build_ui_snapshot(&self, root: &PathBuf, local_id: u64) -> Value {
        let key = get_crypto_key(local_id);
        let paths = Paths::from_root(root, local_id);
        let storage = Storage::new(key);

        let runtimes = self.runtimes.read().await;
        let rt = runtimes.get(&local_id);
        let last_sync = rt.and_then(|r| r.last_sync_snapshot.as_ref());
        let folders = rt
            .map(|r| r.folders.clone())
            .filter(|f| f.as_array().map(|a| !a.is_empty()).unwrap_or(false))
            .unwrap_or_else(|| storage.load(paths.folders()).unwrap_or_else(|| Value::Array(Vec::new())));
        let server_config = rt
            .map(|r| r.server_config.clone())
            .filter(|s| s.as_object().map(|o| !o.is_empty()).unwrap_or(false))
            .unwrap_or_else(|| storage.load(paths.server_config()).unwrap_or_else(|| json!({})));
        let profile = last_sync
            .and_then(|s| s.get("profile").cloned())
            .or_else(|| storage.load(paths.self_contact()).map(|c| json!({ "contact": c })));

        json!({
            "localAccountId": local_id,
            "serverUserId": rt.and_then(|r| r.server_user_id),
            "profile": profile,
            "chats": load_chats_at(&paths, key),
            "contacts": get_contacts_at(&paths, key),
            "folders": folders,
            "serverConfig": server_config,
            "userSettings": load_user_settings_at(&paths, key),
            "presence": rt.map(|r| Value::Object(r.presence_map.clone())).unwrap_or_else(|| json!({})),
            "time": last_sync.and_then(|s| s.get("time").cloned()),
            "videoChatHistory": last_sync.and_then(|s| s.get("videoChatHistory").cloned()),
        })
    }
}
