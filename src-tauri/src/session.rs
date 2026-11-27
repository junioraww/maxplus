use crate::state::{shared_client, shared_session_lock};
use crate::stores::{
    get_contacts_at, get_crypto_key, load_chats_at, load_sync_state_at, load_user_settings_at,
    mark_message_deleted_at, resolve_account_creds_at, resolve_app_root, save_chats_at,
    save_contact_at, save_sync_state_at, save_user_settings_at, update_messages_at, Paths,
    Storage,
};
use rumax::{Error, SyncState};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock, RwLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, Notify, RwLock as TokioRwLock};

#[derive(Clone, Debug)]
pub struct HookResolution {
    pub action: String,
    pub payload: Option<Value>,
}

#[derive(Default)]
struct SessionRuntime {
    active_local_id: Option<u64>,
    server_user_id: Option<u64>,
    presence_map: Map<String, Value>,
    folders: Value,
    server_config: Value,
    last_sync_snapshot: Option<Value>,
    token_invalid: bool,
    suppress_auto_reconnect: bool,
}

pub struct SessionManager {
    runtime: TokioRwLock<SessionRuntime>,
    ui_attached: AtomicBool,
    app_handle: RwLock<Option<AppHandle>>,
    app_dir_override: RwLock<Option<String>>,
    hooked_opcodes: RwLock<HashSet<u16>>,
    next_hook_id: AtomicU64,
    pending_hooks: Mutex<HashMap<u64, oneshot::Sender<HookResolution>>>,
    loop_started: AtomicBool,
    reconnect_loop_running: AtomicBool,
    reconnect_notify: Notify,
}

static SESSION_MANAGER: OnceLock<SessionManager> = OnceLock::new();

pub fn manager() -> &'static SessionManager {
    SESSION_MANAGER.get_or_init(|| SessionManager {
        runtime: TokioRwLock::new(SessionRuntime {
            folders: Value::Array(Vec::new()),
            server_config: json!({}),
            ..Default::default()
        }),
        ui_attached: AtomicBool::new(false),
        app_handle: RwLock::new(None),
        app_dir_override: RwLock::new(None),
        hooked_opcodes: RwLock::new(HashSet::new()),
        next_hook_id: AtomicU64::new(1),
        pending_hooks: Mutex::new(HashMap::new()),
        loop_started: AtomicBool::new(false),
        reconnect_loop_running: AtomicBool::new(false),
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

impl SessionManager {
    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut guard) = self.app_handle.write() {
            *guard = Some(app);
        }
        self.ensure_event_loop();
    }

    pub fn set_app_dir(&self, app_dir: String) {
        if let Ok(mut guard) = self.app_dir_override.write() {
            *guard = Some(app_dir);
        }
        self.ensure_event_loop();
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
        self.runtime.write().await.token_invalid = false;
    }

    pub async fn set_suppress_reconnect(&self, suppress: bool) {
        self.runtime.write().await.suppress_auto_reconnect = suppress;
    }

    pub async fn reset_session_state(&self) {
        let mut rt = self.runtime.write().await;
        rt.active_local_id = None;
        rt.server_user_id = None;
        rt.presence_map.clear();
        rt.folders = Value::Array(Vec::new());
        rt.server_config = json!({});
        rt.last_sync_snapshot = None;
        rt.token_invalid = false;
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

    pub fn ensure_event_loop(&self) {
        if self.loop_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut rx = shared_client().subscribe();
        let spawn_fn = async move {
            let mgr = manager();
            loop {
                match rx.recv().await {
                    Ok(val) => mgr.handle_client_event(val).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(spawn_fn);
        } else {
            tauri::async_runtime::spawn(spawn_fn);
        }
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
            .emit("max:opcode-hook", json!({ "hookId": hook_id, "opcode": opcode, "payload": payload }))
            .is_err()
        {
            self.pending_hooks.lock().unwrap_or_else(|e| e.into_inner()).remove(&hook_id);
            return Some(payload);
        }
        match tokio::time::timeout(Duration::from_millis(600), rx).await {
            Ok(Ok(res)) if res.action == "drop" => None,
            Ok(Ok(res)) => Some(res.payload.unwrap_or(payload)),
            _ => {
                self.pending_hooks.lock().unwrap_or_else(|e| e.into_inner()).remove(&hook_id);
                Some(payload)
            }
        }
    }

    async fn handle_client_event(&self, mut val: Value) {
        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if msg_type == "rx" {
            let opcode = val.pointer("/response/opcode").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            let payload = val.pointer("/response/payload").cloned().unwrap_or(Value::Null);
            let Some(filtered_payload) = self.run_incoming_hook(opcode, payload).await else {
                return;
            };
            if let Some(resp_obj) = val.get_mut("response").and_then(|v| v.as_object_mut()) {
                resp_obj.insert("payload".to_string(), filtered_payload.clone());
            }
            let (local_id, server_uid) = {
                let rt = self.runtime.read().await;
                (rt.active_local_id, rt.server_user_id)
            };
            if let (Some(root), Some(lid)) = (self.resolve_root(), local_id) {
                self.apply_incoming_push(&root, lid, server_uid, opcode, &filtered_payload).await;
            }
            #[cfg(target_os = "android")]
            if !crate::daemon::is_app_foreground() {
                if let Some(dir) = self.app_dir_override.read().ok().and_then(|g| g.clone()) {
                    crate::daemon::handle_daemon_packet(&val, server_uid.unwrap_or(0) as i64, &dir, shared_client()).await;
                }
            }
            self.emit_to_ui("max", val);
            return;
        }

        if msg_type == "log" && val.get("response").and_then(|v| v.as_str()) == Some("closed") {
            let (target_local_id, should_reconnect) = {
                let rt = self.runtime.read().await;
                (
                    rt.active_local_id,
                    rt.active_local_id.is_some() && !rt.token_invalid && !rt.suppress_auto_reconnect,
                )
            };
            if should_reconnect {
                self.reconnect_notify.notify_one();
                #[cfg(target_os = "android")]
                let daemon_active = crate::daemon::is_daemon_running();
                #[cfg(not(target_os = "android"))]
                let daemon_active = false;
                if !daemon_active {
                    self.spawn_reconnect_loop(target_local_id);
                }
            }
        }
        self.emit_to_ui("max", val);
    }

    fn spawn_reconnect_loop(&self, target_local_id: Option<u64>) {
        if self.reconnect_loop_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let spawn_task = async move {
            let mgr = manager();
            let mut delay_ms = 1000u64;
            loop {
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                let (active_id, stop) = {
                    let rt = mgr.runtime.read().await;
                    (
                        rt.active_local_id.or(target_local_id),
                        rt.token_invalid || rt.suppress_auto_reconnect || !mgr.is_ui_attached(),
                    )
                };
                if stop {
                    break;
                }
                let Some(root) = mgr.resolve_root() else {
                    break;
                };
                match mgr.ensure_session_for_account(&root, active_id, true).await {
                    Ok((reused, snapshot)) => {
                        mgr.emit_to_ui("session:online", json!({ "reused": reused, "snapshot": snapshot }));
                        break;
                    }
                    Err(_) => {
                        if mgr.is_token_invalid().await {
                            mgr.emit_to_ui("session:expired", json!({}));
                            break;
                        }
                        delay_ms = (delay_ms.saturating_mul(2)).min(15000);
                    }
                }
            }
            mgr.reconnect_loop_running.store(false, Ordering::SeqCst);
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(spawn_task);
        } else {
            tauri::async_runtime::spawn(spawn_task);
        }
    }

    async fn apply_incoming_push(
        &self,
        root: &PathBuf,
        local_id: u64,
        server_user_id: Option<u64>,
        opcode: u16,
        payload: &Value,
    ) {
        let key = get_crypto_key(local_id);
        let paths = Paths::from_root(root, local_id);

        match opcode {
            128 => {
                let (Some(chat_id), Some(msg)) = (as_i64(payload.get("chatId")), payload.get("message").cloned()) else {
                    return;
                };
                let status = msg.get("status").and_then(|v| v.as_str()).unwrap_or("");
                if status == "REMOVED" {
                    if let Some(mid) = id_str(msg.get("id")) {
                        let _ = mark_message_deleted_at(&paths, key, chat_id, &mid);
                    }
                    return;
                }
                let is_edited = status == "EDITED" || msg.get("edited").is_some();
                let _ = update_messages_at(&paths, key, chat_id, vec![msg.clone()]);
                let info_path = paths.info(chat_id);
                if !is_edited && !info_path.exists() {
                    if let Ok(resp) = shared_client().get_chats(vec![chat_id]).await {
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
                    if !is_edited && !already_has_msg {
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
                    let mut rt = self.runtime.write().await;
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
                    let is_self = opcode == 156 || (your_reaction.map(|v| !v.is_null()).unwrap_or(false) && total > 0);
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
                    self.runtime.write().await.folders = f;
                }
            }
            _ => {}
        }
    }

    async fn sync_and_persist(&self, root: &PathBuf, local_id: u64, meta: &Value) -> Result<Value, Error> {
        let client = shared_client();
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
        client.set_presence(meta.get("presence").and_then(|v| v.as_bool()).unwrap_or(true)).await;
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

        if let Some(new_token) = merged
            .get("token")
            .and_then(|t| t.as_str())
            .or_else(|| merged.pointer("/tokenAttrs/LOGIN/token").and_then(|t| t.as_str()))
        {
            let meta_path = paths.root.join("meta");
            if let Some(mut m) = storage.load(&meta_path) {
                if let Some(obj) = m.as_object_mut() {
                    obj.insert("token".to_string(), json!(new_token));
                    let _ = storage.save(meta_path, &m);
                }
            }
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

        let mut rt = self.runtime.write().await;
        rt.active_local_id = Some(local_id);
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
        self.ensure_event_loop();
        let _guard = shared_session_lock().lock().await;

        let (local_id, server_uid, token, identity, meta) =
            resolve_account_creds_at(root, target_account_id).map_err(|e| json!({ "error": e }))?;

        let client = shared_client();
        let same_account = self.runtime.read().await.active_local_id == Some(local_id);

        if same_account && client.is_connected().await && client.is_synced().await {
            client.set_presence(interactive).await;
            if client.probe_liveness().await {
                return Ok((true, self.build_ui_snapshot(root, local_id).await));
            }
        }

        if !same_account && client.is_connected().await {
            client.disconnect().await;
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

        match self.sync_and_persist(root, local_id, &meta).await {
            Ok(_) => Ok((false, self.build_ui_snapshot(root, local_id).await)),
            Err(e) => {
                if is_fatal_token_error(&e) {
                    self.runtime.write().await.token_invalid = true;
                }
                client.disconnect().await;
                Err(e.to_json())
            }
        }
    }

    pub async fn wait_for_reconnect_signal(&self) {
        self.reconnect_notify.notified().await;
    }

    pub async fn is_token_invalid(&self) -> bool {
        self.runtime.read().await.token_invalid
    }

    pub async fn is_suppress_reconnect(&self) -> bool {
        self.runtime.read().await.suppress_auto_reconnect
    }

    pub async fn build_ui_snapshot(&self, root: &PathBuf, local_id: u64) -> Value {
        let key = get_crypto_key(local_id);
        let paths = Paths::from_root(root, local_id);
        let storage = Storage::new(key);

        let rt = self.runtime.read().await;
        let last_sync = rt.last_sync_snapshot.as_ref();
        let folders = if rt.folders.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            rt.folders.clone()
        } else {
            storage.load(paths.folders()).unwrap_or_else(|| Value::Array(Vec::new()))
        };
        let server_config = if rt.server_config.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
            rt.server_config.clone()
        } else {
            storage.load(paths.server_config()).unwrap_or_else(|| json!({}))
        };
        let profile = last_sync
            .and_then(|s| s.get("profile").cloned())
            .or_else(|| storage.load(paths.self_contact()).map(|c| json!({ "contact": c })));

        json!({
            "localAccountId": local_id,
            "serverUserId": rt.server_user_id,
            "profile": profile,
            "chats": load_chats_at(&paths, key),
            "contacts": get_contacts_at(&paths, key),
            "folders": folders,
            "serverConfig": server_config,
            "userSettings": load_user_settings_at(&paths, key),
            "presence": Value::Object(rt.presence_map.clone()),
            "videoChatHistory": last_sync.and_then(|s| s.get("videoChatHistory")).cloned(),
            "time": last_sync.and_then(|s| s.get("time")).cloned(),
        })
    }
}
