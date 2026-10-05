mod proxy_auth;
mod commands;
mod crypto;
mod files;
mod media_validator;
mod notifications;
mod ssl;
mod state;
mod stores;
mod video;
mod webapp_proxy;

use state::AppState;
use std::sync::Arc;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::webview::{PermissionKind, PermissionResponse};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ssl::init_ssl_certificates();
    video::start_video_proxy();
    webapp_proxy::start_webapp_proxy();

    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        let _ = app.get_webview_window("main").map(|w| {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        });
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notifications::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder
        .plugin(tauri_plugin_barcode_scanner::init());

    #[cfg(target_os = "ios")]
    let builder = builder
        .plugin(tauri_plugin_safe_area_insets_css::init())
        .plugin(tauri_plugin_ios_webview_insets::init());

    #[cfg(any(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    #[cfg(desktop)]
    let builder = builder.on_permission_request(|_, kind| match kind {
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::DisplayCapture => {
            PermissionResponse::Allow
        }
        _ => PermissionResponse::Default,
    });

    builder
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            let (client, mut event_stream) = tauri::async_runtime::block_on(async {
                let client = rumax::MaxClient::new();
                let stream = client.subscribe();
                (client, stream)
            });

            app.manage(AppState {
                crypto: Arc::new(
                    std::sync::RwLock::new(None::<state::CryptoSession>)
                ),
                client,
            });

            let handle = app.handle().clone();
            notifications::set_app_handle(handle.clone());
            webapp_proxy::set_app_handle(handle.clone());
            video::set_app_handle(handle.clone());

            tauri::async_runtime::spawn(async move {
                while let Ok(msg) = event_stream.recv().await {
                    let _ = handle.emit("max", msg);
                }
            });

            let p_cfg = proxy_auth::get_proxy_config();
            if let Some(w) = app.get_webview_window("main") {
                let script = format!(
                    "window.__MAXPLUS_PROXY__ = {{ videoPort: {}, videoToken: '{}', webappPort: {}, webappToken: '{}' }};",
                    p_cfg.video_port, p_cfg.video_token, p_cfg.webapp_port, p_cfg.webapp_token
                );
                let _ = w.eval(&script);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ext_api_request,
            commands::get_system_trace_info,
            commands::get_video_secret,
            commands::get_proxy_config,
            commands::init,
            commands::start_auth,
            commands::resend_auth,
            commands::check_code,
            commands::check_password,
            commands::register,
            commands::logout,
            commands::disconnect,
            commands::sync_client,
            commands::send_message,
            commands::add_reaction,
            commands::remove_reaction,
            commands::pin_message,
            commands::delete_message,
            commands::delete_messages,
            commands::edit_message,
            commands::get_detailed_reactions,
            commands::set_token,
            commands::fetch_contacts,
            commands::fetch_history,
            commands::get_by_phone,
            commands::add_contact,
            commands::remove_contact,
            commands::get_contact_photos,
            commands::remove_contact_photo,
            commands::get_video_by_id,
            commands::get_file_by_id,
            commands::request_transcription,
            commands::get_complaint_reasons,
            commands::send_complaint,
            commands::read_message,
            commands::search_public,
            commands::search_msg,
            commands::get_chats,
            commands::get_chat_media,
            commands::get_sessions,
            commands::close_all_sessions,
            commands::get_photo_upload,
            commands::get_video_upload,
            commands::get_file_upload,
            commands::get_audio_upload,
            commands::get_video_note_upload,
            commands::update_profile,
            commands::set_profile_photo,
            commands::create_group,
            commands::resolve_channel_by_name,
            commands::join_channel,
            commands::leave_channel,
            commands::leave_group,
            commands::change_group_profile,
            commands::set_chat_photo,
            commands::refresh_invite_link,
            commands::fetch_group_members,
            commands::search_group_members,
            commands::add_group_members,
            commands::kick_group_member,
            commands::grant_group_admin,
            commands::revoke_group_admin,
            commands::set_group_options,
            commands::fetch_join_requests,
            commands::confirm_join_requests,
            commands::decline_join_requests,
            commands::purge_chat_history,
            commands::get_calls,
            commands::sync_contacts,
            commands::call,
            commands::set_chats_for_telemetry,
            commands::send_button_callback,
            commands::send_bot_start,
            commands::get_bot_info,
            commands::get_chat_bot_commands,
            commands::suspend_bot,
            commands::set_chat_mute,
            commands::update_user_settings,
            commands::get_folders,
            commands::get_folder_by_id,
            commands::update_folder,
            commands::reorder_folders,
            commands::delete_folders,
            commands::get_sticker_sections,
            commands::get_favorite_stickers,
            commands::get_animoji_sets,
            commands::get_assets_section,
            commands::get_assets_by_ids,
            commands::add_favorite_sticker_set,
            commands::remove_favorite_sticker_set,
            commands::move_asset,
            commands::resolve_link,
            commands::send_sticker_message,
            commands::open_web_app,
            commands::share_phone_with_bot,
            commands::submit_external_callback,
            files::download,
            files::upload,
            files::pick,
            files::read_file,
            files::write_file_string,
            files::write_file_bytes,
            files::save_trace_zip,
            files::save_trace_archive,
            files::save_temp_media,
            files::prepare_video_for_preview,
            files::crop_video_note,
            files::cache_url,
            files::fetch_url_text,
            files::fetch_url_bytes,
            files::download_to_path,
            media_validator::validate_media_batch,
            media_validator::sanitize_mp4_edit_list,
            media_validator::calculate_ogg_crc,
            stores::accounts::accounts_get,
            stores::accounts::accounts_add,
            stores::accounts::account_get,
            stores::accounts::account_delete,
            stores::accounts::account_contact,
            stores::accounts::current_get,
            stores::accounts::current_set,
            stores::accounts::current_account_meta,
            stores::accounts::set_encryption,
            stores::accounts::get_database_files_count,
            stores::accounts::decrypt_account,
            stores::accounts::account_update_token,
            stores::chats::get_contact,
            stores::chats::set_contact,
            stores::chats::get_contacts,
            stores::chats::save_chats,
            stores::chats::load_chats,
            stores::chats::get_chat_settings,
            stores::chats::set_chat_settings,
            stores::messages::load_messages,
            stores::messages::update_messages,
            stores::messages::mark_message_deleted,
            stores::messages::remove_message_from_storage,
            stores::messages::clear_local_messages,
            stores::cache::get_cached_file,
            stores::cache::set_cached_file,
            stores::cache::delete_chat_cache,
            stores::generic::common_store_load,
            stores::generic::common_store_save,
            stores::generic::webapp_storage_save_key,
            stores::generic::webapp_storage_get_key,
            stores::generic::webapp_storage_clear,
            stores::generic::webapp_storage_get_keys,
            stores::generic::webapp_biometry_get,
            stores::generic::webapp_biometry_set,
            stores::generic::plugin_storage_set,
            stores::generic::plugin_storage_get,
            stores::generic::plugin_storage_get_all,
            stores::generic::plugin_storage_clear,
            notifications::show_notification,
            notifications::cancel_notification,
            notifications::update_call_notification_config,
            notifications::check_pending_open_chat,
            webapp_proxy::set_webapp_filter_rules,
            webapp_proxy::get_webapp_filter_rules,
            webapp_proxy::get_webapp_ram_logs,
            webapp_proxy::clear_webapp_ram_logs,
            crypto::commands::batch_decrypt_messages,
            crypto::commands::encrypt_message,
            crypto::commands::init_e2e_handshake,
            crypto::commands::accept_e2e_handshake,
            crypto::commands::process_e2e_accept,
            crypto::commands::get_chat_encryption_info,
            crypto::commands::make_dictionary,
            crypto::commands::encrypt_media_file,
            crypto::commands::decrypt_media_file,
            crypto::commands::cache_encrypted_media,
            crypto::commands::register_media_cache,
            commands::exit_app,
            commands::parse_mxp,
            commands::begin_call,
            commands::open_conference,
            commands::enter_call_by_link,
            commands::make_call_invite_link,
            commands::erase_call_records,
            commands::decode_call_push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
