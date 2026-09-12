use crate::stores::{load_sync_state, save_sync_state};
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;
use rumax::{Error, models::{Identity, FetchHistoryOptions}};
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

delegate_cmd!(add_reaction(chat_id: i64, message_id: String, reaction: String) => add_reaction(chat_id, p(message_id)?, reaction));
delegate_cmd!(remove_reaction(chat_id: i64, message_id: String) => remove_reaction(chat_id, p(message_id)?));
delegate_cmd!(read_message(chat_id: i64, message_id: String) => read_message(chat_id, p(message_id)?));
delegate_cmd!(pin_message(chat_id: i64, message_id: String, notify: bool) => pin_message(chat_id, p(message_id)?, notify));
delegate_cmd!(delete_message(chat_id: i64, message_id: String, for_me: bool) => delete_message(chat_id, p(message_id)?, for_me));
delegate_cmd!(get_video_by_id(chat_id: i64, message_id: String, video_id: i64) => get_video_by_id(chat_id, p(message_id)?, video_id));
delegate_cmd!(get_file_by_id(chat_id: i64, message_id: String, file_id: i64) => get_file_by_id(chat_id, p(message_id)?, file_id));

delegate_cmd!(send_message(
    chat_id: i64,
    message: String,
    params: Option<HashMap<String, serde_json::Value>>
) => send_message(chat_id, message, params));

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

    Ok(final_payload)
}

#[tauri::command]
pub async fn set_token(state: State<'_, AppState>, token: String) -> Result<String, String> {
    state.client.set_token(token).await;
    Ok("Set".into())
}

#[tauri::command]
pub async fn get_video_secret(secret: tauri::State<'_, String>) -> Result<String, String> {
    Ok(secret.inner().clone())
}
