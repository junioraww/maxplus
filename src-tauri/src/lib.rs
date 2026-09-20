mod commands;
mod files;
mod notifications;
mod ssl;
mod state;
mod stores;
mod video;
mod webapp_proxy;

use state::AppState;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ssl::init_ssl_certificates();
    video::start_video_proxy();
    webapp_proxy::start_webapp_proxy();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notifications::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder
        .plugin(tauri_plugin_biometric::init())
        .plugin(tauri_plugin_barcode_scanner::init());

    #[cfg(target_os = "ios")]
    let builder = builder
        .plugin(tauri_plugin_safe_area_insets_css::init())
        .plugin(tauri_plugin_ios_webview_insets::init());

    #[cfg(any(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_android_fs::init());

    builder
        .setup(|app| {
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

            tauri::async_runtime::spawn(async move {
                while let Ok(msg) = event_stream.recv().await {
                    let _ = handle.emit("max", msg);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_video_secret,
            commands::init,
            commands::start_auth,
            commands::check_code,
            commands::check_password,
            commands::logout,
            commands::sync_client,
            commands::send_message,
            commands::add_reaction,
            commands::remove_reaction,
            commands::pin_message,
            commands::delete_message,
            commands::edit_message,
            commands::set_token,
            commands::fetch_contacts,
            commands::fetch_history,
            commands::get_by_phone,
            commands::add_contact,
            commands::remove_contact,
            commands::get_video_by_id,
            commands::get_file_by_id,
            commands::request_transcription,
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
            commands::create_group,
            commands::resolve_channel_by_name,
            commands::join_channel,
            commands::leave_channel,
            commands::leave_group,
            commands::change_group_profile,
            commands::refresh_invite_link,
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
            files::save_temp_media,
            files::prepare_video_for_preview,
            files::crop_video_note,
            files::cache_url,
            files::fetch_url_text,
            files::fetch_url_bytes,
            files::download_to_path,
            stores::accounts_get,
            stores::accounts_add,
            stores::account_get,
            stores::account_meta,
            stores::account_delete,
            stores::account_delete_by_uid,
            stores::account_contact,
            stores::current_get,
            stores::current_set,
            stores::current_account,
            stores::current_account_meta,
            stores::current_account_set,
            stores::get_contact,
            stores::set_contact,
            stores::get_contacts,
            stores::save_chats,
            stores::load_chats,
            stores::get_chat_settings,
            stores::set_chat_settings,
            stores::load_messages,
            stores::update_messages,
            stores::mark_message_deleted,
            stores::set_encryption,
            stores::decrypt_account,
            stores::get_cached_file,
            stores::set_cached_file,
            stores::load_dictionary,
            stores::save_dictionary,
            stores::set_dictionary_url,
            stores::get_dictionary_url,
            stores::get_device,
            stores::save_device,
            notifications::show_notification,
            notifications::cancel_notification,
            notifications::check_pending_open_chat,
            webapp_proxy::set_webapp_filter_rules,
            webapp_proxy::get_webapp_filter_rules,
            webapp_proxy::get_webapp_ram_logs,
            webapp_proxy::clear_webapp_ram_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
