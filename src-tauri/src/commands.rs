use crate::stores::{load_sync_state, save_sync_state, save_user_settings};
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;
use rumax::{Error, TelemetryChat, models::{Identity, FetchHistoryOptions}};
use tauri::{AppHandle, State};

fn p(s: String) -> Result<u64, Value> {
    s.parse().map_err(|_| Error::Other("Invalid ID".into()).to_json())
}

macro_rules! delegate_cmd {
    ($name:ident($($arg:ident: $ty:ty),*) => $client_method:ident($($pass_arg:expr),*)) => {
        #[tauri::command]
        pub async fn $name(state: State<'_, AppState>, $($arg: $ty),*) -> Result<Value, Value> {
            let r = state.client.$client_method($($pass_arg),*).await.map_err(|e| e.to_json())?;
            Ok(r.payload)
        }
    };
}

delegate_cmd!(start_auth(phone: String) => start_auth(phone));
delegate_cmd!(check_code(code: String) => check_code(code));
delegate_cmd!(check_password(password: String, track_id: String) => check_password(password, track_id));
delegate_cmd!(register(first_name: String) => submit_register(first_name, None));
delegate_cmd!(logout() => logout());
delegate_cmd!(fetch_contacts(user_ids: Vec<u64>) => fetch_contacts(user_ids));
delegate_cmd!(get_by_phone(phone: String) => get_by_phone(phone));
delegate_cmd!(add_contact(contact_id: u64, first_name: String) => add_contact(contact_id, first_name));
delegate_cmd!(remove_contact(contact_id: u64) => delete_contact(contact_id));
delegate_cmd!(search_public(query: String, count: i32, type_: String) => search_public(query, count, type_));
delegate_cmd!(search_msg(query: String, count: i32, marker: Option<String>) => search_msg(query, count, marker));
delegate_cmd!(get_chats(chat_ids: Vec<i64>) => get_chats(chat_ids));
delegate_cmd!(get_sessions() => get_sessions());
delegate_cmd!(close_all_sessions() => close_all_sessions());
delegate_cmd!(get_photo_upload(count: i64, profile: bool) => get_photo_upload(count, profile));
delegate_cmd!(get_video_upload(count: i64, profile: bool) => get_video_upload(count, profile));
delegate_cmd!(get_file_upload(count: i64, profile: bool) => get_file_upload(count, profile));
delegate_cmd!(get_audio_upload(count: i64) => get_audio_upload(count));
delegate_cmd!(get_video_note_upload(count: i64) => get_video_note_upload(count));
delegate_cmd!(update_profile(first_name: String, last_name: String, description: Option<String>, avatar_token: Option<String>) =>
    update_profile(first_name, last_name, description, avatar_token));
delegate_cmd!(get_calls(count: i64, forward: bool) => get_calls(forward, count));
delegate_cmd!(call(action_id: u16, payload: Value) => call(action_id, payload));
delegate_cmd!(create_group(title: String, participant_ids: Option<Vec<i64>>, notify: Option<bool>) => create_group(title, participant_ids, notify));
delegate_cmd!(delete_chat(chat_id: i64, last_event_time: Option<i64>, for_all: Option<bool>) => delete_chat(chat_id, last_event_time, for_all));
delegate_cmd!(resolve_channel_by_name(link: String) => resolve_channel_by_name(link));
delegate_cmd!(join_channel(link: String) => join_channel(link));
delegate_cmd!(leave_channel(channel_id: i64) => leave_channel(channel_id));
delegate_cmd!(leave_group(chat_id: i64) => leave_group(chat_id));
delegate_cmd!(change_group_profile(chat_id: i64, title: Option<String>, description: Option<String>) => change_group_profile(chat_id, title, description));
delegate_cmd!(fetch_history(chat_id: i64, options: Option<FetchHistoryOptions>) => fetch_history(chat_id, options));
delegate_cmd!(refresh_invite_link(chat_id: i64) => refresh_invite_link(chat_id));
delegate_cmd!(fetch_group_members(chat_id: i64, count: Option<i64>, marker: Option<i64>) => get_members(chat_id, count.unwrap_or(50), marker));
delegate_cmd!(search_group_members(chat_id: i64, query: String) => find_members(chat_id, query));
delegate_cmd!(add_group_members(chat_id: i64, user_ids: Vec<i64>, show_history: Option<bool>) => invite_users_to_group(chat_id, user_ids, show_history));
delegate_cmd!(kick_group_member(chat_id: i64, user_ids: Vec<i64>, clean_msg_period: Option<i64>) => remove_users_from_group(chat_id, user_ids, clean_msg_period.unwrap_or(0)));
delegate_cmd!(grant_group_admin(chat_id: i64, user_id: i64, permissions: Vec<String>, alias: Option<String>) => assign_admin(chat_id, user_id, permissions, alias));
delegate_cmd!(revoke_group_admin(chat_id: i64, user_id: i64) => revoke_admin(chat_id, user_id));
delegate_cmd!(set_group_options(chat_id: i64, all_can_pin_message: Option<bool>, only_owner_can_change_icon_title: Option<bool>, only_admin_can_add_member: Option<bool>, only_admin_can_call: Option<bool>, members_can_see_private_link: Option<bool>) => change_group_settings(chat_id, all_can_pin_message, only_owner_can_change_icon_title, only_admin_can_add_member, only_admin_can_call, members_can_see_private_link));
delegate_cmd!(fetch_join_requests(chat_id: i64) => get_join_requests(chat_id));
delegate_cmd!(confirm_join_requests(chat_id: i64, user_ids: Vec<i64>, show_history: Option<bool>) => confirm_join_requests(chat_id, user_ids, show_history));
delegate_cmd!(decline_join_requests(chat_id: i64, user_ids: Vec<i64>) => decline_join_requests(chat_id, user_ids));
#[tauri::command]
pub async fn purge_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: i64,
    last_event_time: Option<i64>,
    for_all: Option<bool>,
) -> Result<Value, Value> {
    let r = state
        .client
        .clear_chat_history(chat_id, last_event_time, for_all)
        .await
        .map_err(|e| e.to_json())?;

    if let Ok(curr_id) = crate::stores::current_get(app.clone()) {
        if let Some(account_id) = curr_id.as_u64() {
            let _ = crate::stores::clear_local_messages(app, account_id, chat_id);
        }
    }

    Ok(r.payload)
}
delegate_cmd!(sync_contacts() => sync_contacts());

delegate_cmd!(add_reaction(chat_id: i64, message_id: String, reaction: String) => add_reaction(chat_id, p(message_id)?, reaction));
delegate_cmd!(remove_reaction(chat_id: i64, message_id: String) => remove_reaction(chat_id, p(message_id)?));
delegate_cmd!(read_message(chat_id: i64, message_id: String) => read_message(chat_id, p(message_id)?));
delegate_cmd!(pin_message(chat_id: i64, message_id: String, notify: bool) => pin_message(chat_id, p(message_id)?, notify));
delegate_cmd!(delete_message(chat_id: i64, message_id: String, for_me: bool) => delete_message(chat_id, p(message_id)?, for_me));
delegate_cmd!(edit_message(chat_id: i64, message_id: String, text: String, attaches: Option<Vec<Value>>, elements: Option<Vec<Value>>) => edit_message(chat_id, p(message_id)?, text, attaches, elements));
delegate_cmd!(get_video_by_id(chat_id: i64, message_id: String, video_id: i64, token: Option<String>) => get_video_by_id(chat_id, message_id.parse::<u64>().unwrap_or(0), video_id, token));
delegate_cmd!(get_file_by_id(chat_id: i64, message_id: String, file_id: i64) => get_file_by_id(chat_id, message_id.parse::<u64>().unwrap_or(0), file_id));
delegate_cmd!(get_chat_media(chat_id: i64, message_id: Option<String>, attach_types: Vec<String>, forward: i32, backward: i32) => get_chat_media(chat_id, message_id.as_deref().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0), attach_types, forward, backward));
delegate_cmd!(request_transcription(chat_id: i64, message_id: String, media_id: String) => request_transcription(chat_id, p(message_id)?, p(media_id)?));

delegate_cmd!(send_message(
    chat_id: i64,
    message: String,
    params: Option<HashMap<String, serde_json::Value>>
) => send_message(chat_id, message, params));
delegate_cmd!(send_button_callback(chat_id: i64, message_id: String, callback_id: String, payload: Option<String>) => send_button_callback(chat_id, p(message_id)?, callback_id, payload));
delegate_cmd!(send_bot_start(chat_id: i64, start_payload: Option<String>) => send_bot_start(chat_id, start_payload));
delegate_cmd!(get_bot_info(bot_id: u64) => get_bot_info(bot_id));
delegate_cmd!(get_chat_bot_commands(chat_id: i64) => get_chat_bot_commands(chat_id));
delegate_cmd!(suspend_bot(bot_id: u64) => suspend_bot(bot_id));
delegate_cmd!(set_chat_mute(chat_id: i64, dont_disturb_until: i64) => set_chat_mute(chat_id, dont_disturb_until));
delegate_cmd!(get_folders(folder_sync: Option<i64>) => get_folders(folder_sync));
delegate_cmd!(get_folder_by_id(folder_ids: Vec<String>) => get_folder_by_id(folder_ids));
delegate_cmd!(update_folder(id: String, title: String, include: Vec<i64>, filters: Vec<i64>, options: Vec<i64>, favorites: Vec<i64>) => update_folder(id, title, include, filters, options, favorites));
delegate_cmd!(reorder_folders(folders_order: Vec<String>) => reorder_folders(folders_order));
delegate_cmd!(delete_folders(folder_ids: Vec<String>) => delete_folders(folder_ids));
delegate_cmd!(get_sticker_sections(sync: i64) => get_sticker_sections(sync));
delegate_cmd!(get_favorite_stickers(sync: i64) => get_favorite_stickers(sync));
delegate_cmd!(get_assets_section(section_id: String, from: i64, count: i32) => get_assets_section(section_id, from, count));
delegate_cmd!(get_assets_by_ids(asset_type: String, ids: Vec<i64>) => get_assets_by_ids(asset_type, ids));
delegate_cmd!(add_favorite_sticker_set(set_id: i64) => add_favorite_sticker_set(set_id));
delegate_cmd!(remove_favorite_sticker_set(set_id: i64) => remove_favorite_sticker_set(set_id));
delegate_cmd!(move_asset(asset_type: String, id: i64, position: i32) => move_asset(asset_type, id, position));
delegate_cmd!(resolve_link(link: String) => resolve_link(link));
delegate_cmd!(send_sticker_message(chat_id: i64, sticker_id: i64, notify: Option<bool>) => send_sticker_message(chat_id, sticker_id, notify));
delegate_cmd!(open_web_app(bot_id: u64, start_param: Option<String>, chat_id: Option<i64>) => open_web_app(bot_id, start_param, chat_id));
delegate_cmd!(share_phone_with_bot(bot_id: u64) => share_phone_with_bot(bot_id));
delegate_cmd!(submit_external_callback(url: String) => submit_external_callback(url));

#[tauri::command]
pub async fn init(
    state: State<'_, AppState>,
    identity: Identity,
    user_id: Option<u64>,
    token: Option<String>,
) -> Result<Value, Value> {
    state.client.disconnect().await;

    if let Some(uid) = user_id {
        state.client.set_user_id(uid).await;
    }

    if let Some(t) = token {
        state.client.set_token(t).await;
    }

    let r = state
        .client
        .connect(identity, true)
        .await
        .map_err(|e| e.to_json())?;

    Ok(r.payload)
}

#[tauri::command]
pub async fn sync_client(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: u64,
) -> Result<Value, Value> {
    let initial_sync_state = load_sync_state(&app, account_id).unwrap_or_default();

    let (sync_resp, sync2_opt, new_sync_state) = match state.client.sync(initial_sync_state).await {
        Ok(res) => res,
        Err(e) => return Err(e.to_json()),
    };

    let user_id = sync2_opt
    .as_ref()
    .and_then(|r| r.payload.pointer("/profile/contact/id"))
    .or_else(|| sync_resp.payload.pointer("/profile/contact/id"))
    .and_then(|id| id.as_u64());

    let user_id = match user_id {
        Some(id) => id,
        None => return Err(json!({ "error": "User ID not found in sync response" })),
    };

    state.client.set_user_id(user_id).await;
    state.client.spawn_telemetry_task().await;

    if let Err(e) = save_sync_state(&app, account_id, &new_sync_state) {
        return Err(json!({ "error": format!("Failed to save sync state: {}", e) }));
    }

    let mut final_payload = sync_resp.payload;

    if let Some(sync2) = sync2_opt {
        if let (Value::Object(ref mut map1), Value::Object(map2)) = (&mut final_payload, sync2.payload) {
            map1.extend(map2);
        }
    }

    if let Some(user_config) = final_payload.get("config").and_then(|c| c.get("user")) {
        let _ = save_user_settings(&app, account_id, user_config);
    }

    Ok(final_payload)
}

#[tauri::command]
pub async fn set_chats_for_telemetry(state: State<'_, AppState>, chats: Vec<TelemetryChat>) -> Result<String, String> {
    state.client.set_telemetry_chats(chats).await;
    Ok("Set".into())
}

#[tauri::command]
pub async fn update_user_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: u64,
    settings: HashMap<String, serde_json::Value>,
) -> Result<Value, Value> {
    let r = state.client.update_user_settings(settings.clone()).await.map_err(|e| e.to_json())?;
    let settings_val = serde_json::to_value(&settings).unwrap_or(json!({}));
    let _ = save_user_settings(&app, account_id, &settings_val);
    Ok(r.payload)
}

#[tauri::command]
pub async fn set_token(state: State<'_, AppState>, token: String) -> Result<String, String> {
    state.client.set_token(token).await;
    Ok("Set".into())
}

#[tauri::command]
pub async fn get_video_secret() -> Result<String, String> {
    Ok(crate::proxy_auth::get_video_token())
}

#[tauri::command]
pub async fn get_proxy_config() -> Result<crate::proxy_auth::ProxyConfig, String> {
    Ok(crate::proxy_auth::get_proxy_config())
}

#[tauri::command]
pub async fn get_system_trace_info(app: AppHandle) -> Result<Value, String> {
    let os_name = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let family = std::env::consts::FAMILY;
    let cpu_cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let app_version = app.package_info().version.to_string();

    let local_ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string());

    let public_ip = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(client) => match client.get("https://api.ipify.org?format=json").send().await {
            Ok(resp) => resp
                .json::<Value>()
                .await
                .ok()
                .and_then(|v| v["ip"].as_str().map(|s| s.to_string())),
            Err(_) => None,
        },
        Err(_) => None,
    };

    let mut os_details = serde_json::Map::new();
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = tokio::fs::read_to_string("/etc/os-release").await {
            for line in content.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    os_details.insert(k.to_string(), Value::String(v.trim_matches('"').to_string()));
                }
            }
        }
    }

    Ok(json!({
        "os": os_name,
        "arch": arch,
        "family": family,
        "cpu_cores": cpu_cores,
        "app_version": app_version,
        "local_ip": local_ip,
        "public_ip": public_ip,
        "os_details": os_details,
    }))
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExtApiResponse {
    pub status: u16,
    pub ok: bool,
    pub data: Value,
}

#[tauri::command]
pub async fn ext_api_request(
    method: String,
    path: String,
    headers: Option<HashMap<String, String>>,
    body: Option<Value>,
) -> Result<ExtApiResponse, String> {
    let base_url = "https://ext-api.max.ru";
    let url = if path.starts_with("https://") || path.starts_with("http://") {
        path
    } else if path.starts_with('/') {
        format!("{}{}", base_url, path)
    } else {
        format!("{}/{}", base_url, path)
    };

    let client = rumax::shared_http_client();
    let req_method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        _ => return Err(format!("Unsupported method: {}", method)),
    };

    let mut req = client.request(req_method, &url);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            let header_val = reqwest::header::HeaderValue::from_str(&v)
                .or_else(|_| reqwest::header::HeaderValue::from_bytes(v.as_bytes()));
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                header_val,
            ) {
                req = req.header(name, val);
            }
        }
    }

    if let Some(b) = body {
        req = req.json(&b);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let text = res.text().await.map_err(|e| e.to_string())?;

    let data = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text))
    };

    Ok(ExtApiResponse { status, ok, data })
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}



