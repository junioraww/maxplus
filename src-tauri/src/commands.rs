use crate::stores::{load_user_settings, save_user_settings};
use crate::state::AppState;
use serde_json::{json, Value};
use std::collections::HashMap;
use rumax::{Error, TelemetryChat, models::{Identity, FetchHistoryOptions}};
use tauri::{AppHandle, Manager, State, Window};

fn p(s: String) -> Result<u64, Value> {
    s.parse().map_err(|_| Error::Other("Invalid ID".into()).to_json())
}

macro_rules! delegate_cmd {
    ($name:ident($($arg:ident: $ty:ty),*) => $client_method:ident($($pass_arg:expr),*)) => {
        #[tauri::command]
        pub async fn $name(state: State<'_, AppState>, $($arg: $ty),*) -> Result<Value, Value> {
            let r = state.client().$client_method($($pass_arg),*).await.map_err(|e| e.to_json())?;
            Ok(r.payload)
        }
    };
}

delegate_cmd!(start_auth(phone: String) => start_auth(phone));
delegate_cmd!(resend_auth(phone: String) => resend_auth(phone));
delegate_cmd!(check_code(code: String) => check_code(code));
delegate_cmd!(check_password(password: String, track_id: String) => check_password(password, track_id));
delegate_cmd!(register(first_name: String, last_name: Option<String>) => submit_register(first_name, last_name));
delegate_cmd!(register_full(first_name: String, last_name: Option<String>, photo_id: Option<i64>, avatar_type: Option<String>) => submit_register_with_avatar(first_name, last_name, photo_id, avatar_type));
delegate_cmd!(check_call_status(track_id: String) => check_call_status(track_id));
delegate_cmd!(auth_by_track(track_id: String) => auth_by_track(track_id));
delegate_cmd!(fetch_contacts(user_ids: Vec<u64>) => fetch_contacts(user_ids));
delegate_cmd!(fetch_presence(user_ids: Vec<u64>) => fetch_presence(user_ids));
delegate_cmd!(get_by_phone(phone: String) => get_by_phone(phone));
delegate_cmd!(add_contact(contact_id: u64, first_name: String) => add_contact(contact_id, first_name));
delegate_cmd!(remove_contact(contact_id: u64) => delete_contact(contact_id));

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhonebookImportItem {
    pub phone: String,
    pub first_name: String,
    #[serde(default)]
    pub last_name: Option<String>,
}

#[tauri::command]
pub async fn import_phonebook_contacts(
    app: AppHandle,
    state: State<'_, AppState>,
    contacts: Vec<PhonebookImportItem>,
) -> Result<Value, Value> {
    if contacts.is_empty() {
        return Ok(json!({ "contacts": [], "phones": {} }));
    }

    let account_id = crate::stores::accounts::current_get(app.clone())
        .ok()
        .and_then(|v| v.as_u64());

    let mut all_contacts: Vec<Value> = Vec::new();
    let mut all_phones = serde_json::Map::new();

    for chunk in contacts.chunks(100) {
        let mut map = HashMap::with_capacity(chunk.len());
        for item in chunk {
            let phone = item.phone.trim();
            if phone.is_empty() {
                continue;
            }
            let first = if item.first_name.trim().is_empty() {
                phone.to_string()
            } else {
                item.first_name.trim().to_string()
            };
            let mut entry = serde_json::Map::new();
            entry.insert("firstName".to_string(), json!(first));
            if let Some(last) = &item.last_name {
                let last_trimmed = last.trim();
                if !last_trimmed.is_empty() {
                    entry.insert("lastName".to_string(), json!(last_trimmed));
                }
            }
            map.insert(phone.to_string(), Value::Object(entry));
        }

        if map.is_empty() {
            continue;
        }

        let resp = state
            .client()
            .upload_phonebook_contacts(map)
            .await
            .map_err(|e| e.to_json())?;

        if let Some(arr) = resp.payload.get("contacts").and_then(|v| v.as_array()) {
            for c in arr {
                if let (Some(acc), Some(cid)) = (account_id, c.get("id").and_then(|v| v.as_u64())) {
                    let _ = crate::stores::chats::set_contact(app.clone(), acc, cid, c.clone()).await;
                }
                all_contacts.push(c.clone());
            }
        }
        if let Some(obj) = resp.payload.get("phones").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                all_phones.insert(k.clone(), v.clone());
            }
        }
    }

    Ok(json!({
        "contacts": all_contacts,
        "phones": all_phones,
    }))
}
delegate_cmd!(get_contact_photos(contact_id: u64, from: Option<i64>, count: Option<i64>) => get_contact_photos(contact_id, from.unwrap_or(0), count.unwrap_or(50)));
delegate_cmd!(remove_contact_photo(photo_id: u64) => remove_contact_photo(photo_id));
delegate_cmd!(search_public(query: String, count: i32, type_: String) => search_public(query, count, type_));
delegate_cmd!(search_msg(query: String, count: i32, marker: Option<String>) => search_msg(query, count, marker));
delegate_cmd!(search_chat_messages(chat_id: i64, query: String, count: i32, marker: Option<i64>) => search_chat_messages(chat_id, query, count, marker));
delegate_cmd!(get_chats(chat_ids: Vec<i64>) => get_chats(chat_ids));
delegate_cmd!(get_sessions() => get_sessions());
delegate_cmd!(close_all_sessions() => close_all_sessions());
delegate_cmd!(get_photo_upload(count: i64, profile: bool) => get_photo_upload(count, profile));
delegate_cmd!(get_video_upload(count: i64, profile: bool) => get_video_upload(count, profile));
delegate_cmd!(get_file_upload(count: i64, profile: bool) => get_file_upload(count, profile));
delegate_cmd!(get_audio_upload(count: i64) => get_audio_upload(count));
delegate_cmd!(get_video_note_upload(count: i64) => get_video_note_upload(count));
delegate_cmd!(get_story_photo_upload(count: i64) => get_story_photo_upload(count));
delegate_cmd!(get_story_video_upload(count: i64) => get_story_video_upload(count));
delegate_cmd!(get_stories_feed(cursor: Option<String>, count: i64) => get_stories_feed(cursor, count));
delegate_cmd!(get_stories_by_owners(owners: Vec<rumax::models::StoryOwner>) => get_stories_by_owners(owners));
delegate_cmd!(get_stories_by_id(owner: rumax::models::StoryOwner, story_ids: Vec<u64>) => get_stories_by_id(owner, story_ids));
delegate_cmd!(get_story_stats(story_id: u64) => get_story_stats(story_id));
delegate_cmd!(get_story_detailed_stats(story_id: u64, filter: i64, marker: i64) => get_story_detailed_stats(story_id, filter, marker));
delegate_cmd!(react_story(owner: rumax::models::StoryOwner, story_id: u64, reaction: Option<Value>) => react_story(owner, story_id, reaction));
delegate_cmd!(mark_story_read(owner: rumax::models::StoryOwner, story_id: u64) => mark_story_read(owner, story_id));
delegate_cmd!(send_story(stories: Vec<Value>) => send_story(stories));
delegate_cmd!(edit_story(story_id: u64, settings: i64) => edit_story(story_id, settings));
delegate_cmd!(delete_stories(story_ids: Vec<u64>) => delete_stories(story_ids));
delegate_cmd!(update_profile(first_name: String, last_name: String, description: Option<String>, avatar_token: Option<String>) =>
    update_profile(first_name, last_name, description, avatar_token));
delegate_cmd!(set_profile_photo(photo_token: String) => set_profile_photo(photo_token));
delegate_cmd!(get_calls(count: i64, forward: bool) => get_calls(forward, count));
delegate_cmd!(call(action_id: u16, payload: Value) => call(action_id, payload));
delegate_cmd!(create_group(title: String, participant_ids: Option<Vec<i64>>, notify: Option<bool>) => create_group(title, participant_ids, notify));
delegate_cmd!(create_channel(title: String, participant_ids: Option<Vec<i64>>, notify: Option<bool>) => create_channel(title, participant_ids, notify));
delegate_cmd!(delete_chat(chat_id: i64, last_event_time: Option<i64>, for_all: Option<bool>) => delete_chat(chat_id, last_event_time, for_all));
delegate_cmd!(resolve_channel_by_name(link: String) => resolve_channel_by_name(link));
delegate_cmd!(join_channel(link: String) => join_channel(link));
delegate_cmd!(leave_channel(channel_id: i64) => leave_channel(channel_id));
delegate_cmd!(set_channel_access(chat_id: i64, access: String, link: Option<String>) => set_channel_access(chat_id, access, link));
delegate_cmd!(revoke_channel_invite_link(chat_id: i64) => revoke_channel_invite_link(chat_id));
delegate_cmd!(set_channel_comments(chat_id: i64, enabled: bool) => set_channel_comments(chat_id, enabled));
delegate_cmd!(set_channel_options(chat_id: i64, comments: Option<bool>, signatures: Option<bool>, join_request: Option<bool>) => set_channel_options(chat_id, comments, signatures, join_request));
delegate_cmd!(transfer_channel_ownership(chat_id: i64, new_owner_id: i64) => transfer_channel_ownership(chat_id, new_owner_id));
delegate_cmd!(grant_channel_admin(chat_id: i64, user_id: i64, permissions: i64, alias: Option<String>) => assign_channel_admin(chat_id, user_id, permissions, alias));
delegate_cmd!(revoke_channel_admin(chat_id: i64, user_id: i64) => revoke_channel_admin(chat_id, user_id));
delegate_cmd!(leave_group(chat_id: i64) => leave_group(chat_id));
delegate_cmd!(change_group_profile(chat_id: i64, title: Option<String>, description: Option<String>) => change_group_profile(chat_id, title, description));
delegate_cmd!(set_chat_photo(chat_id: i64, photo_token: String) => set_chat_photo(chat_id, photo_token));
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
delegate_cmd!(begin_call(callee_id: u64, is_video: bool, conversation_id: String, internal_params: String) => start_outgoing_call(callee_id, is_video, conversation_id, internal_params));
delegate_cmd!(begin_group_call(chat_id: i64, is_video: bool, conversation_id: String, internal_params: String) => start_group_call(chat_id, is_video, conversation_id, internal_params));
delegate_cmd!(open_conference(conversation_id: String) => open_conference(conversation_id));
delegate_cmd!(enter_call_by_link(join_link: String, is_video: bool, internal_params: String) => enter_by_link(join_link, is_video, internal_params));
delegate_cmd!(make_call_invite_link(conversation_id: String) => make_invite_link(conversation_id));
delegate_cmd!(erase_call_records(history_ids: Vec<i64>) => erase_call_records(history_ids));
#[tauri::command]
pub async fn purge_chat_history(
    app: AppHandle,
    state: State<'_, AppState>,
    chat_id: i64,
    last_event_time: Option<i64>,
    for_all: Option<bool>,
) -> Result<Value, Value> {
    let r = state
        .client()
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

delegate_cmd!(read_message(chat_id: i64, message_id: String, mark: Option<u64>) => read_message(chat_id, p(message_id)?, mark));
delegate_cmd!(pin_message(chat_id: i64, message_id: String, notify: bool) => pin_message(chat_id, p(message_id)?, notify));
delegate_cmd!(get_pinned_message_states(chat_ids: Vec<i64>) => get_pinned_message_states(chat_ids));
delegate_cmd!(get_pinned_messages(chat_id: i64) => get_pinned_messages(chat_id));
#[tauri::command]
pub async fn update_pinned_messages(
    state: State<'_, AppState>,
    chat_id: i64,
    action: u8,
    message_ids: Vec<String>,
    for_me: bool,
    notify: bool,
) -> Result<Value, Value> {
    let mut ids = Vec::with_capacity(message_ids.len());
    for s in message_ids {
        ids.push(p(s)?);
    }
    let r = state
        .client()
        .update_pinned_messages(chat_id, action, ids, for_me, notify)
        .await
        .map_err(|e| e.to_json())?;
    Ok(r.payload)
}
delegate_cmd!(delete_message(chat_id: i64, message_id: String, for_me: bool) => delete_message(chat_id, p(message_id)?, for_me));
#[tauri::command]
pub async fn delete_messages(
    state: State<'_, AppState>,
    chat_id: i64,
    message_ids: Vec<String>,
    for_me: bool,
) -> Result<Value, Value> {
    let mut ids = Vec::with_capacity(message_ids.len());
    for s in message_ids {
        ids.push(p(s)?);
    }
    let r = state.client().delete_messages(chat_id, ids, for_me).await.map_err(|e| e.to_json())?;
    Ok(r.payload)
}
delegate_cmd!(edit_message(chat_id: i64, message_id: String, text: String, attaches: Option<Vec<Value>>, elements: Option<Vec<Value>>) => edit_message(chat_id, p(message_id)?, text, attaches, elements));
delegate_cmd!(get_detailed_reactions(chat_id: i64, message_id: String, count: Option<i32>) => get_detailed_reactions(chat_id, p(message_id)?, count));
delegate_cmd!(get_video_by_id(chat_id: i64, message_id: String, video_id: i64, token: Option<String>) => get_video_by_id(chat_id, message_id.parse::<u64>().unwrap_or(0), video_id, token));
delegate_cmd!(get_file_by_id(chat_id: i64, message_id: String, file_id: i64) => get_file_by_id(chat_id, message_id.parse::<u64>().unwrap_or(0), file_id));
delegate_cmd!(get_chat_media(chat_id: i64, message_id: Option<String>, attach_types: Vec<String>, forward: i32, backward: i32) => get_chat_media(chat_id, message_id.as_deref().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0), attach_types, forward, backward));
delegate_cmd!(request_transcription(chat_id: i64, message_id: String, media_id: String) => request_transcription(chat_id, p(message_id)?, p(media_id)?));
delegate_cmd!(get_complaint_reasons() => get_complaint_reasons());
#[tauri::command]
pub async fn send_complaint(
    state: State<'_, AppState>,
    reason_id: i64,
    type_id: i64,
    ids: Vec<String>,
    parent_id: Option<i64>,
) -> Result<Value, Value> {
    let mut parsed_ids = Vec::with_capacity(ids.len());
    for s in ids {
        parsed_ids.push(p(s)?);
    }
    let r = state.client().send_complaint(reason_id, type_id, parsed_ids, parent_id).await.map_err(|e| e.to_json())?;
    Ok(r.payload)
}

delegate_cmd!(send_message(
    chat_id: i64,
    message: String,
    params: Option<HashMap<String, serde_json::Value>>
) => send_message(chat_id, message, params));
delegate_cmd!(send_button_callback(chat_id: i64, message_id: String, callback_id: String, payload: Option<String>) => send_button_callback(chat_id, p(message_id)?, callback_id, payload));
delegate_cmd!(send_bot_start(chat_id: i64, start_payload: Option<String>) => send_bot_start(chat_id, start_payload));
delegate_cmd!(get_bot_info(bot_id: u64) => get_bot_info(bot_id));
delegate_cmd!(get_chat_bot_commands(chat_id: i64) => get_chat_bot_commands(chat_id));
delegate_cmd!(suspend_bot(bot_id: u64, value: Option<bool>) => suspend_bot(bot_id, value));
delegate_cmd!(set_chat_mute(chat_id: i64, dont_disturb_until: i64) => set_chat_mute(chat_id, dont_disturb_until));
delegate_cmd!(get_folders(folder_sync: Option<i64>) => get_folders(folder_sync));
delegate_cmd!(get_folder_by_id(folder_ids: Vec<String>) => get_folder_by_id(folder_ids));
delegate_cmd!(update_folder(id: String, title: String, include: Vec<i64>, filters: Vec<i64>, options: Vec<i64>, favorites: Vec<i64>) => update_folder(id, title, include, filters, options, favorites));
delegate_cmd!(reorder_folders(folders_order: Vec<String>) => reorder_folders(folders_order));
delegate_cmd!(delete_folders(folder_ids: Vec<String>) => delete_folders(folder_ids));
delegate_cmd!(get_sticker_sections(sync: i64) => get_sticker_sections(sync));
delegate_cmd!(get_favorite_stickers(sync: i64) => get_favorite_stickers(sync));
delegate_cmd!(get_animoji_sets(sync: i64) => get_animoji_sets(sync));
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
delegate_cmd!(vote_poll(chat_id: i64, message_id: String, poll_id: i64, answer_ids: Vec<i64>) => vote_poll(chat_id, p(message_id)?, poll_id, answer_ids));
delegate_cmd!(get_poll_updates(chat_id: i64, message_id: String, poll_id: i64) => get_poll_updates(chat_id, p(message_id)?, poll_id));
delegate_cmd!(get_poll_voters(chat_id: i64, message_id: String, poll_id: i64, answer_id: i64, from: Option<i64>, count: Option<i32>) => get_poll_voters(chat_id, p(message_id)?, poll_id, answer_id, from, count));

#[tauri::command]
pub fn generate_device(is_mobile: Option<bool>) -> Identity {
    if is_mobile.unwrap_or(true) {
        Identity::generate_mobile()
    } else {
        Identity::generate_web()
    }
}

#[tauri::command]
pub async fn set_presence(state: State<'_, AppState>, online: bool) -> Result<(), ()> {
    state.client().set_presence(online).await;
    Ok(())
}

#[tauri::command]
pub async fn attach_ui_session(
    app: AppHandle,
    account_id: Option<u64>,
) -> Result<Value, Value> {
    let mgr = crate::session::manager();
    mgr.set_app_handle(app.clone());
    mgr.set_ui_attached(true);
    mgr.set_suppress_reconnect(false).await;
    mgr.clear_token_invalid().await;

    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| json!({ "error": e.to_string() }))?;
    let (reused, snapshot) = mgr
        .ensure_session_for_account(&root, account_id, true)
        .await?;

    let bg_root = root.clone();
    tauri::async_runtime::spawn(async move {
        crate::session::manager().sync_background_accounts(&bg_root).await;
    });

    Ok(json!({
        "reused": reused,
        "snapshot": snapshot,
    }))
}

#[tauri::command]
pub async fn refresh_background_sessions(app: AppHandle) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::session::manager().sync_background_accounts(&root).await;
    Ok(())
}

#[tauri::command]
pub async fn detach_ui_session() -> Result<(), String> {
    crate::session::manager().set_ui_attached(false);
    Ok(())
}

#[tauri::command]
pub async fn register_plugin_opcode_hooks(opcodes: Vec<u16>) -> Result<(), String> {
    crate::session::manager().set_hooked_opcodes(opcodes);
    Ok(())
}

#[tauri::command]
pub async fn resolve_opcode_hook(
    hook_id: u64,
    action: String,
    payload: Option<Value>,
) -> Result<(), String> {
    crate::session::manager().resolve_hook(hook_id, action, payload);
    Ok(())
}

#[tauri::command]
pub async fn call_opcode(
    state: State<'_, AppState>,
    opcode: u16,
    payload: Value,
) -> Result<Value, Value> {
    let r = state
        .client()
        .call(opcode, payload)
        .await
        .map_err(|e| e.to_json())?;
    Ok(r.payload)
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<Value, Value> {
    let _session_guard = crate::state::shared_session_lock().lock().await;
    let mgr = crate::session::manager();
    let res = state.client().logout().await.map_err(|e| e.to_json())?;
    mgr.reset_session_state().await;
    Ok(res.payload)
}

#[tauri::command]
pub async fn init(
    app: AppHandle,
    state: State<'_, AppState>,
    identity: Identity,
    user_id: Option<u64>,
    token: Option<String>,
) -> Result<Value, Value> {
    let mgr = crate::session::manager();
    mgr.set_app_handle(app);
    mgr.set_ui_attached(true);
    mgr.set_suppress_reconnect(false).await;
    let _session_guard = crate::state::shared_session_lock().lock().await;

    if user_id.is_some()
        && token.is_some()
        && state.client().get_user_id().await == user_id
        && state.client().get_token().await == token
        && state.client().probe_liveness().await
    {
        return Ok(json!({
            "reused": true,
            "alreadySynced": state.client().is_synced().await,
        }));
    }

    state.client().disconnect().await;

    if let Some(uid) = user_id {
        state.client().set_user_id(uid).await;
    }

    if let Some(t) = token {
        state.client().set_token(t).await;
    }

    if let Ok(settings) = crate::proxy_manager::fetch_proxy_config().await {
        if settings.vpn_bypass_enabled {
            let _ = crate::vpn_bypass::apply_physical_network_route();
        }
    }

    let r = state
        .client()
        .connect(identity, true)
        .await
        .map_err(|e| e.to_json())?;

    Ok(r.payload)
}

#[tauri::command]
pub async fn disconnect(_state: State<'_, AppState>) -> Result<(), String> {
    let _session_guard = crate::state::shared_session_lock().lock().await;
    let mgr = crate::session::manager();
    mgr.set_suppress_reconnect(true).await;
    mgr.reset_session_state().await;
    Ok(())
}

#[tauri::command]
pub async fn set_chats_for_telemetry(state: State<'_, AppState>, chats: Vec<TelemetryChat>) -> Result<String, String> {
    state.client().set_telemetry_chats(chats).await;
    Ok("Set".into())
}

#[tauri::command]
pub async fn update_user_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: u64,
    settings: HashMap<String, serde_json::Value>,
) -> Result<Value, Value> {
    let r = state.client().update_user_settings(settings.clone()).await.map_err(|e| e.to_json())?;
    let settings_val = serde_json::to_value(&settings).unwrap_or(json!({}));
    let _ = save_user_settings(&app, account_id, &settings_val);
    Ok(r.payload)
}

#[tauri::command]
pub async fn get_user_settings(
    app: AppHandle,
    account_id: u64,
) -> Result<Value, String> {
    load_user_settings(&app, account_id)
}

#[tauri::command]
pub async fn get_blacklist(
    state: State<'_, AppState>,
    from: Option<i64>,
    count: Option<i64>,
) -> Result<Value, Value> {
    let r = state.client().get_blacklist(from.unwrap_or(0), count.unwrap_or(100)).await.map_err(|e| e.to_json())?;
    Ok(r.payload)
}

#[tauri::command]
pub async fn add_to_blacklist(
    state: State<'_, AppState>,
    contact_id: u64,
) -> Result<Value, Value> {
    let r = state.client().add_to_blacklist(contact_id).await.map_err(|e| e.to_json())?;
    Ok(r.payload)
}

#[tauri::command]
pub async fn remove_from_blacklist(
    state: State<'_, AppState>,
    contact_id: u64,
) -> Result<Value, Value> {
    let r = state.client().remove_from_blacklist(contact_id).await.map_err(|e| e.to_json())?;
    Ok(r.payload)
}

#[tauri::command]
pub async fn set_token(state: State<'_, AppState>, token: String) -> Result<String, String> {
    state.client().set_token(token).await;
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

    let public_ip = match rumax::shared_http_client().get("https://api.ipify.org?format=json").send().await {
        Ok(resp) => resp
            .json::<Value>()
            .await
            .ok()
            .and_then(|v| v["ip"].as_str().map(|s| s.to_string())),
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

#[derive(serde::Serialize)]
pub struct ProxyHttpResponse {
    pub status: u16,
    pub ok: bool,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body_base64: String,
}

#[tauri::command]
pub async fn proxy_http_request(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<Vec<u8>>,
) -> Result<ProxyHttpResponse, String> {
    let client = rumax::shared_http_client();
    let method_str = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let req_method = match method_str.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(req_method, &url);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            if let (Ok(name), Ok(val)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v)
                    .or_else(|_| reqwest::header::HeaderValue::from_bytes(v.as_bytes())),
            ) {
                req = req.header(name, val);
            }
        }
    }

    if let Some(b) = body {
        req = req.body(b);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let ok = res.status().is_success();
    let status_text = res.status().canonical_reason().unwrap_or("").to_string();

    let mut resp_headers = HashMap::new();
    for (k, v) in res.headers() {
        if let Ok(v_str) = v.to_str() {
            resp_headers.insert(k.as_str().to_string(), v_str.to_string());
        }
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    use base64::Engine;
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    Ok(ProxyHttpResponse {
        status,
        ok,
        status_text,
        headers: resp_headers,
        body_base64,
    })
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn parse_mxp(bytes: Vec<u8>) -> Result<Value, String> {
    use std::io::{Cursor, Read};

    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid zip: {e}"))?;

    let mut files: HashMap<String, String> = HashMap::new();

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Zip read error: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut raw_bytes = Vec::new();
        entry.read_to_end(&mut raw_bytes).unwrap_or(0);
        let content = if name.ends_with(".png")
            || name.ends_with(".jpg")
            || name.ends_with(".jpeg")
            || name.ends_with(".webp")
            || name.ends_with(".gif")
            || name.ends_with(".ico")
        {
            use base64::Engine;
            let mime = if name.ends_with(".png") {
                "image/png"
            } else if name.ends_with(".jpg") || name.ends_with(".jpeg") {
                "image/jpeg"
            } else if name.ends_with(".webp") {
                "image/webp"
            } else if name.ends_with(".gif") {
                "image/gif"
            } else {
                "image/x-icon"
            };
            let b64 = base64::engine::general_purpose::STANDARD.encode(&raw_bytes);
            format!("data:{mime};base64,{b64}")
        } else {
            String::from_utf8(raw_bytes).unwrap_or_default()
        };
        files.insert(name, content);
    }

    let manifest_str = files
        .get("manifest.json")
        .ok_or_else(|| "manifest.json not found in archive".to_string())?;

    let manifest: Value = serde_json::from_str(manifest_str)
        .map_err(|e| format!("Invalid manifest.json: {e}"))?;

    let files_value: serde_json::Map<String, Value> = files
        .into_iter()
        .map(|(k, v)| (k, Value::String(v)))
        .collect();

    Ok(json!({
        "manifest": manifest,
        "files": files_value,
    }))
}

#[tauri::command]
pub fn decode_call_push(blob: String) -> Result<Value, String> {
    use base64::Engine;
    let colon = blob.find(':').ok_or("Invalid vcp: no colon separator")?;
    let raw_len_str = &blob[..colon];
    let raw_len: usize = raw_len_str.parse().map_err(|_| "Invalid vcp: bad rawLen")?;
    if raw_len == 0 || raw_len > 1_000_000 {
        return Err("Invalid vcp: empty or excessive length".to_string());
    }
    let b64 = &blob[colon + 1..];
    let compressed = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("vcp base64 decode: {e}"))?;
    let decompressed = lz4_flex::decompress(&compressed, raw_len)
        .or_else(|_| lz4_flex::decompress_size_prepended(&compressed))
        .map_err(|e| format!("vcp lz4 decompress: {e}"))?;
    let valid_slice = if decompressed.len() > raw_len {
        &decompressed[..raw_len]
    } else {
        &decompressed[..]
    };
    let parsed: Value = serde_json::from_slice(valid_slice)
        .map_err(|e| format!("vcp json parse: {e}"))?;
    Ok(parsed)
}

trait ValueExt {
    fn str(&self, key: &str) -> Option<&str>;
    fn str_or<'a>(&'a self, key: &str, default: &'a str) -> &'a str;
}

impl ValueExt for Value {
    fn str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(|v| v.as_str())
    }

    fn str_or<'a>(&'a self, key: &str, default: &'a str) -> &'a str {
        self.str(key).unwrap_or(default)
    }
}

#[tauri::command]
pub async fn two_factor(
    state: State<'_, AppState>,
    action: String,
    payload: Option<Value>,
) -> Result<Value, Value> {
    let p = payload.unwrap_or(Value::Null);
    let resp = match action.as_str() {
        "status" => state.client().fetch_2fa_status().await,
        "request_email" => {
            let track = p.str("trackId").map(String::from);
            state.client().request_2fa_email_code(track, p.str_or("email", "")).await
        }
        "setup" => {
            let track = p.str("trackId").map(String::from);
            state.client().setup_2fa(
                p.str_or("password", ""),
                p.str("hint"),
                p.str("email"),
                p.str("code"),
                track,
            ).await
        }
        "change" => {
            state.client().change_2fa(
                p.str_or("currentPassword", ""),
                p.str_or("newPassword", ""),
                p.str("newHint"),
            ).await
        }
        "disable" => {
            state.client().disable_2fa(p.str_or("currentPassword", "")).await
        }
        "verify_email" => {
            let track = p.str_or("trackId", "");
            state.client().verify_2fa_email(track, p.str_or("code", "")).await
        }
        _ => return Err(json!({ "error": "unknown_action" })),
    };
    let payload = resp.map(|r| r.payload).map_err(|e| e.to_json())?;
    if let Some(err) = payload.get("error") {
        return Err(json!({ "type": "Error", "text": err }));
    }
    Ok(payload)
}

#[tauri::command]
pub async fn set_camouflage_icon(
    app: AppHandle,
    window: Window,
    rgba: Vec<u8>,
    png_base64: Option<String>,
    width: u32,
    height: u32,
    label: Option<String>,
    alias_index: Option<i32>,
) -> Result<(), String> {
    crate::camouflage::apply_camouflage(
        &app,
        &window,
        crate::camouflage::CamouflageDescriptor {
            rgba,
            png_base64,
            width,
            height,
            label,
            alias_index,
        },
    )
}

#[tauri::command]
pub async fn restore_camouflage_icon(
    app: AppHandle,
    window: Window,
) -> Result<(), String> {
    crate::camouflage::restore_camouflage(&app, &window)
}

#[tauri::command]
pub async fn save_camouflage_shell(
    app: AppHandle,
    html: String,
) -> Result<(), String> {
    crate::camouflage::save_camouflage_shell(&app, html)
}

#[derive(serde::Serialize, serde::Deserialize, Default, Clone, Debug)]
pub struct SystemInsets {
    pub top: i32,
    pub bottom: i32,
    pub left: i32,
    pub right: i32,
}

#[tauri::command]
pub fn get_system_insets() -> SystemInsets {
    #[cfg(target_os = "android")]
    {
        if let (Some(vm), Some(main_class)) = (
            crate::notifications::GLOBAL_JVM.get(),
            crate::notifications::GLOBAL_MAIN_ACTIVITY_CLASS.get(),
        ) {
            let res = vm.attach_current_thread(|env| -> Result<SystemInsets, jni::errors::Error> {
                let arr_obj = env.call_static_method(
                    main_class,
                    jni::jni_str!("getInsetsStatic"),
                    jni::jni_sig!("()[I"),
                    &[],
                )?.l()?;
                let int_arr = env.cast_local::<jni::objects::JIntArray>(arr_obj)?;
                let mut buf = [0i32; 4];
                int_arr.get_region(env, 0, &mut buf)?;
                Ok(SystemInsets {
                    top: buf[0],
                    bottom: buf[1],
                    left: buf[2],
                    right: buf[3],
                })
            });
            match res {
                Ok(insets) => return insets,
                Err(e) => eprintln!("MaxPlus: get_system_insets error: {e:?}"),
            }
        } else {
            eprintln!("MaxPlus: get_system_insets error: GLOBAL_JVM or GLOBAL_MAIN_ACTIVITY_CLASS not initialized");
        }
    }
    SystemInsets::default()
}

#[tauri::command]
pub fn set_screen_brightness(brightness: f32) {
    #[cfg(target_os = "android")]
    {
        if let (Some(vm), Some(main_class)) = (
            crate::notifications::GLOBAL_JVM.get(),
            crate::notifications::GLOBAL_MAIN_ACTIVITY_CLASS.get(),
        ) {
            let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                env.call_static_method(
                    main_class,
                    jni::jni_str!("setScreenBrightnessStatic"),
                    jni::jni_sig!("(F)V"),
                    &[jni::objects::JValue::Float(brightness)],
                )?;
                Ok(())
            });
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = brightness;
    }
}
