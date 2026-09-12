mod commands;
mod files;
mod state;
mod stores;
mod video;

use state::AppState;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    video::start_video_proxy();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
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
            commands::set_token,
            commands::fetch_contacts,
            commands::fetch_history,
            commands::get_by_phone,
            commands::add_contact,
            commands::remove_contact,
            commands::get_video_by_id,
            commands::get_file_by_id,
            commands::read_message,
            commands::search_public,
            commands::search_msg,
            commands::get_chats,
            commands::get_sessions,
            commands::close_all_sessions,
            commands::get_photo_upload,
            commands::get_video_upload,
            commands::get_file_upload,
            commands::update_profile,
            commands::create_group,
            commands::resolve_channel_by_name,
            commands::join_channel,
            commands::leave_channel,
            commands::leave_group,
            commands::change_group_profile,
            commands::refresh_invite_link,
            commands::get_calls,
            commands::call,
            files::download,
            files::upload,
            files::pick,
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
            stores::read_file,
            stores::write_file_string,
            stores::write_file_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
