use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex;
use crate::state::AppState;

static IN_FLIGHT_CACHE: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Notify>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn unwrap_media_source(raw: &str) -> (Option<String>, Option<String>) {
    let mut s = raw.to_string();
    if let Some(idx) = s.find("127.0.0.1:11447/") {
        let after = &s[idx + 16..];
        if let Ok(dec) = urlencoding::decode(after) {
            s = dec.into_owned();
        }
    } else if let Some(idx) = s.find("proxy?url=") {
        let after = &s[idx + 10..];
        if let Ok(dec) = urlencoding::decode(after) {
            s = dec.into_owned();
        }
    }
    if s.starts_with("http://asset.localhost/") {
        let path = s.trim_start_matches("http://asset.localhost/");
        let path = urlencoding::decode(path).map(|c| c.into_owned()).unwrap_or_else(|_| path.to_string());
        #[cfg(not(target_os = "windows"))]
        let path = if path.starts_with('/') { path } else { format!("/{}", path) };
        return (Some(path), None);
    }
    if s.starts_with("asset://localhost/") {
        let path = s.trim_start_matches("asset://localhost/");
        let path = urlencoding::decode(path).map(|c| c.into_owned()).unwrap_or_else(|_| path.to_string());
        #[cfg(not(target_os = "windows"))]
        let path = if path.starts_with('/') { path } else { format!("/{}", path) };
        return (Some(path), None);
    }
    if s.starts_with("asset://") {
        let path = s.trim_start_matches("asset://");
        let path = urlencoding::decode(path).map(|c| c.into_owned()).unwrap_or_else(|_| path.to_string());
        #[cfg(not(target_os = "windows"))]
        let path = if path.starts_with('/') { path } else { format!("/{}", path) };
        return (Some(path), None);
    }
    if s.starts_with('/') {
        return (Some(s), None);
    }
    if s.starts_with("file://") {
        return (Some(s.trim_start_matches("file://").to_string()), None);
    }
    (None, Some(s))
}

#[tauri::command]
pub async fn download(
    app: tauri::AppHandle,
    url: String,
    name: String,
) -> Result<String, String> {
    let (local_src, remote_url) = unwrap_media_source(&url);
    let bytes = if let Some(local_path) = local_src {
        tokio::fs::read(&local_path)
            .await
            .map_err(|e| e.to_string())?
    } else {
        let target = remote_url.unwrap_or(url);
        let client = rumax::create_http_client();
        client.get(&target)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map_err(|e| e.to_string())?
            .to_vec()
    };

    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::{AndroidFsExt, PublicGeneralPurposeDir, Result, Error};

        let api = app.android_fs_async();

        if !api.public_storage().request_permission().await.map_err(|e| e.to_string())? {
            return Err("Permission denied".into());
        }

        let uri = api
        .public_storage()
        .create_new_file_with_pending(
            None,
            PublicGeneralPurposeDir::Download,
            &name,
            None,
        )
        .await
        .map_err(|e| e.to_string())?;

        let mut file = api
        .open_file_writable(&uri)
        .await
        .map_err(|e| e.to_string())?;

        use std::io::Write;
        file.write_all(&bytes).map_err(|e| e.to_string())?;

        api.public_storage()
        .set_pending(&uri, false)
        .await
        .map_err(|e| e.to_string())?;

        api.public_storage().scan(&uri).await.ok();

        Ok(uri.uri.as_str().to_string())
    }

    #[cfg(not(target_os = "android"))]
    {
        use std::io::Write;

        let mut path = dirs::download_dir()
        .ok_or("Cannot find download dir")?;

        path.push(name);

        let mut file = std::fs::File::create(&path)
        .map_err(|e| e.to_string())?;

        file.write_all(&bytes)
        .map_err(|e| e.to_string())?;

        Ok(path.to_string_lossy().to_string())
    }
}

fn ensure_mp4_faststart_and_strip_edts(path: &str) {
    let clean_path = path.strip_prefix("file://").unwrap_or(path);
    let mut bytes = match std::fs::read(clean_path) {
        Ok(b) => b,
        Err(_) => return,
    };
    if bytes.len() < 16 {
        return;
    }

    struct Atom {
        tag: [u8; 4],
        offset: usize,
        size: usize,
    }

    let mut atoms = Vec::new();
    let mut offset = 0;
    while offset + 8 <= bytes.len() {
        let size = u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) as usize;
        let mut tag = [0u8; 4];
        tag.copy_from_slice(&bytes[offset + 4..offset + 8]);
        let actual_size = if size == 0 {
            bytes.len() - offset
        } else if size == 1 && offset + 16 <= bytes.len() {
            u64::from_be_bytes([
                bytes[offset + 8], bytes[offset + 9], bytes[offset + 10], bytes[offset + 11],
                bytes[offset + 12], bytes[offset + 13], bytes[offset + 14], bytes[offset + 15],
            ]) as usize
        } else {
            size
        };
        if actual_size < 8 || offset + actual_size > bytes.len() {
            break;
        }
        atoms.push(Atom { tag, offset, size: actual_size });
        offset += actual_size;
    }

    let mdat_pos = atoms.iter().position(|a| &a.tag == b"mdat");
    let moov_pos = atoms.iter().position(|a| &a.tag == b"moov");

    if let (Some(m_idx), Some(v_idx)) = (mdat_pos, moov_pos) {
        let moov_atom = &atoms[v_idx];
        let moov_len = moov_atom.size;
        let mut moov_bytes = bytes[moov_atom.offset..moov_atom.offset + moov_len].to_vec();

        for i in 0..moov_bytes.len().saturating_sub(4) {
            if &moov_bytes[i..i + 4] == b"edts" {
                moov_bytes[i..i + 4].copy_from_slice(b"free");
            }
        }

        if m_idx < v_idx {
            for i in 0..moov_bytes.len().saturating_sub(16) {
                if &moov_bytes[i..i + 4] == b"stco" {
                    let entry_count = u32::from_be_bytes([
                        moov_bytes[i + 12], moov_bytes[i + 13], moov_bytes[i + 14], moov_bytes[i + 15],
                    ]) as usize;
                    let table_start = i + 16;
                    let table_end = table_start + entry_count * 4;
                    if table_end <= moov_bytes.len() {
                        for c in (table_start..table_end).step_by(4) {
                            let curr = u32::from_be_bytes([
                                moov_bytes[c], moov_bytes[c + 1], moov_bytes[c + 2], moov_bytes[c + 3],
                            ]);
                            let shifted = curr.saturating_add(moov_len as u32);
                            moov_bytes[c..c + 4].copy_from_slice(&shifted.to_be_bytes());
                        }
                    }
                } else if &moov_bytes[i..i + 4] == b"co64" {
                    let entry_count = u32::from_be_bytes([
                        moov_bytes[i + 12], moov_bytes[i + 13], moov_bytes[i + 14], moov_bytes[i + 15],
                    ]) as usize;
                    let table_start = i + 16;
                    let table_end = table_start + entry_count * 8;
                    if table_end <= moov_bytes.len() {
                        for c in (table_start..table_end).step_by(8) {
                            let curr = u64::from_be_bytes([
                                moov_bytes[c], moov_bytes[c + 1], moov_bytes[c + 2], moov_bytes[c + 3],
                                moov_bytes[c + 4], moov_bytes[c + 5], moov_bytes[c + 6], moov_bytes[c + 7],
                            ]);
                            let shifted = curr.saturating_add(moov_len as u64);
                            moov_bytes[c..c + 8].copy_from_slice(&shifted.to_be_bytes());
                        }
                    }
                }
            }

            let mut reordered = Vec::with_capacity(bytes.len());
            for (idx, atom) in atoms.iter().enumerate() {
                if idx == m_idx {
                    reordered.extend_from_slice(&moov_bytes);
                }
                if idx != v_idx {
                    reordered.extend_from_slice(&bytes[atom.offset..atom.offset + atom.size]);
                }
            }
            let _ = std::fs::write(clean_path, reordered);
            return;
        } else {
            bytes[moov_atom.offset..moov_atom.offset + moov_len].copy_from_slice(&moov_bytes);
            let _ = std::fs::write(clean_path, bytes);
            return;
        }
    }
}

async fn convert_media_if_needed(path: &str, is_video: bool) -> String {
    if is_video {
        ensure_mp4_faststart_and_strip_edts(path);
    }
    path.to_string()
}



#[tauri::command]
pub async fn upload(
    #[allow(unused_variables)] app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    upload_url: String,
    path: String,
    attach_type: String,
    file_id: Option<u64>,
    video_id: Option<u64>,
    token: Option<String>,
    mime: Option<String>,
    video_type: Option<i64>,
    file_name: Option<String>,
) -> Result<serde_json::Value, String> {
    use tokio::fs::File;

    let is_video = attach_type == "VIDEO";
    let is_audio = attach_type == "AUDIO";
    let effective_path = if is_audio {
        convert_media_if_needed(&path, false).await
    } else if is_video {
        convert_media_if_needed(&path, true).await
    } else {
        path.clone()
    };

    #[cfg(target_os = "android")]
    let file: File = {
        if effective_path.starts_with("content://") {
            use tauri_plugin_android_fs::{ AndroidFsExt, FsUri };
            let api = app.android_fs_async();
            let uri = FsUri::from_uri(effective_path.clone());
            let std_file = api.open_file_readable(&uri).await.map_err(|e| e.to_string())?;
            tokio::fs::File::from_std(std_file)
        } else {
            let std_file = std::fs::File::open(&effective_path).map_err(|e| e.to_string())?;
            tokio::fs::File::from_std(std_file)
        }
    };

    #[cfg(not(target_os = "android"))]
    let file: File = {
        let std_file = std::fs::File::open(&effective_path).map_err(|e| e.to_string())?;
        tokio::fs::File::from_std(std_file)
    };

    let upload_name = file_name.unwrap_or_else(|| {
        std::path::Path::new(&effective_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string()
    });

    match attach_type.as_str() {
        "PHOTO" => Ok(state.client.upload_photo(upload_url, file, upload_name, mime).await),
        "VIDEO" | "AUDIO" => {
            let video_id = video_id.ok_or("No video_id")?;
            let token = token.ok_or("No token")?;
            Ok(state.client.upload_video(upload_url, video_id, token, file, upload_name).await)
        }
        "FILE" => {
            let file_id = file_id.ok_or("No file_id")?;
            Ok(state.client.upload_file(upload_url, file_id, file, upload_name).await)
        }
        _ => Err("Wrong type".into()),
    }
}

#[tauri::command]
pub async fn pick(
    app: tauri::AppHandle,
    r#type: Option<String>,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::AndroidFsExt;
        use serde_json::json;
        use std::path::PathBuf;
        use tauri::Manager;
        use tokio::fs;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let api = app.android_fs_async();

        let mime_filter: Vec<&str> = match r#type.as_deref() {
            Some("PHOTO") => vec!["image/*"],
            Some("VIDEO") => vec!["video/*"],
            Some("AUDIO") => vec!["audio/*"],
            Some("JSON") => vec!["application/json"],
            _ => vec!["*/*"],
        };

        let files = api
        .picker()
        .pick_files(None, &mime_filter, false)
        .await
        .map_err(|e| e.to_string())?;

        if files.is_empty() {
            return Err("CANCEL".into());
        }

        let file = files.into_iter().next().unwrap();

        let mime_type = api
        .get_mime_type(&file)
        .await
        .map_err(|e| e.to_string())?;

        // cache/local/<uuid>
        let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("local");

        fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;

        let id = uuid::Uuid::new_v4().to_string();
        let dst = cache_dir.join(&id);

        let mut reader = api
        .open_file_readable(&file)
        .await
        .map_err(|e| e.to_string())?;

        let dst_clone = dst.clone();

        tokio::task::spawn_blocking(move || -> Result<(), std::io::Error> {
            let mut writer = std::fs::File::create(dst_clone)?;
            std::io::copy(&mut reader, &mut writer)?;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

        Ok(json!({
            "uri": dst.to_string_lossy(),
            "mime_type": mime_type
        }))
    }

    #[cfg(not(target_os = "android"))]
    {
        use tauri_plugin_dialog::{DialogExt};
        use serde_json::json;

        let dialog = app.dialog().file();

        let dialog = match r#type.as_deref() {
            Some("PHOTO") => dialog.add_filter("Изображения", &["png", "jpeg", "jpg", "gif", "webp", "bmp"]),
            Some("VIDEO") => dialog.add_filter("Видео", &["mp4", "avi", "mov", "mkv", "webm", "3gp", "ts"]),
            Some("AUDIO") => dialog.add_filter("Аудио", &["mp3", "ogg", "wav", "m4a", "aac", "flac", "opus", "wma"]),
            Some("JSON") => dialog.add_filter("Конфиг", &["json"]),
            _ => dialog,
        };

        let file = dialog.blocking_pick_file();

        let Some(file_path) = file else {
            return Err("CANCEL".into());
        };

        let path_str = file_path.to_string();

        let mime_type = mime_guess::from_path(&path_str)
        .first_or_octet_stream()
        .to_string();

        Ok(json!({
            "uri": path_str,
            "mime_type": mime_type
        }))
    }
}

// TODO !!! currently unsafe, add wrappers
#[tauri::command]
pub async fn read_file(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file_string(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(path, content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file_bytes(path: String, content: Vec<u8>) -> Result<(), String> {
    tokio::fs::write(path, content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_trace_zip(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_android_fs::{AndroidFsExt, PublicGeneralPurposeDir};
        let api = app.android_fs_async();
        if !api.public_storage().request_permission().await.map_err(|e| e.to_string())? {
            return Err("Permission denied".into());
        }
        let uri = api
            .public_storage()
            .create_new_file_with_pending(
                None,
                PublicGeneralPurposeDir::Download,
                &name,
                Some("application/zip"),
            )
            .await
            .map_err(|e| e.to_string())?;

        use std::io::Write;
        let mut file = api
            .open_file_writable(&uri)
            .await
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        api.public_storage().set_pending(&uri, false).await.map_err(|e| e.to_string())?;
        api.public_storage().scan(&uri).await.ok();
        Ok(uri.uri.as_str().to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        use std::io::Write;
        let mut path = dirs::download_dir().ok_or("Cannot find download dir")?;
        path.push(&name);
        let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub async fn save_trace_archive(
    app: tauri::AppHandle,
    name: String,
    files: HashMap<String, Vec<u8>>,
) -> Result<String, String> {
    let zip_bytes = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        use std::io::{Cursor, Write};
        let mut buffer = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut buffer);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            for (filename, content) in files {
                writer.start_file(filename, options).map_err(|e| e.to_string())?;
                writer.write_all(&content).map_err(|e| e.to_string())?;
            }
            writer.finish().map_err(|e| e.to_string())?;
        }
        Ok(buffer.into_inner())
    })
    .await
    .map_err(|e| e.to_string())??;

    save_trace_zip(app, name, zip_bytes).await
}

#[tauri::command]
pub async fn save_temp_media(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    extension: String,
    is_video: Option<bool>,
) -> Result<String, String> {
    use tauri::Manager;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("temp_media");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;
    let filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
    let path = cache_dir.join(filename);
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();
    if let Some(video) = is_video {
        let converted = convert_media_if_needed(&path_str, video).await;
        if converted != path_str {
            return Ok(converted);
        }
    }
    Ok(path_str)
}

#[tauri::command]
pub async fn prepare_video_for_preview(
    _app: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    Ok(source_path)
}

#[tauri::command]
pub async fn crop_video_note(
    app: tauri::AppHandle,
    source_path: String,
    _crop_x: u32,
    _crop_y: u32,
    _crop_size: u32,
    _start_sec: f64,
    _end_sec: f64,
) -> Result<String, String> {
    use tauri::Manager;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("temp_media");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;

    let out_path = cache_dir.join(format!("{}_cropped.mp4", uuid::Uuid::new_v4()));
    let out_str = out_path.to_string_lossy().to_string();

    tokio::fs::copy(&source_path, &out_path)
        .await
        .map_err(|e| e.to_string())?;

    ensure_mp4_faststart_and_strip_edts(&out_str);
    Ok(out_str)
}


#[tauri::command]
pub async fn cache_url(
    app: tauri::AppHandle,
    account: Option<u64>,
    src: String,
    chat_id: Option<i64>,
    media_type: Option<String>,
    key: Option<String>,
) -> Result<String, String> {
    let acc = account.unwrap_or(0);
    let cache_key = key.unwrap_or_else(|| src.clone());

    if let Ok(Some(existing_path)) = crate::stores::get_cached_file(app.clone(), acc, cache_key.clone()) {
        if std::path::Path::new(&existing_path).exists() {
            return Ok(existing_path);
        }
    }
    if let Ok(Some(existing_path)) = crate::stores::get_cached_file(app.clone(), acc, src.clone()) {
        if std::path::Path::new(&existing_path).exists() {
            return Ok(existing_path);
        }
    }

    let notify = {
        let mut map = IN_FLIGHT_CACHE.lock().await;
        if let Some(n) = map.get(&cache_key) {
            Some(Arc::clone(n))
        } else {
            let n = Arc::new(tokio::sync::Notify::new());
            map.insert(cache_key.clone(), Arc::clone(&n));
            None
        }
    };

    if let Some(n) = notify {
        n.notified().await;
        if let Ok(Some(existing_path)) = crate::stores::get_cached_file(app.clone(), acc, cache_key.clone()) {
            if std::path::Path::new(&existing_path).exists() {
                return Ok(existing_path);
            }
        }
        if let Ok(Some(existing_path)) = crate::stores::get_cached_file(app.clone(), acc, src.clone()) {
            if std::path::Path::new(&existing_path).exists() {
                return Ok(existing_path);
            }
        }
    }

    struct CacheCleanupGuard(String);
    impl Drop for CacheCleanupGuard {
        fn drop(&mut self) {
            let k = self.0.clone();
            tokio::spawn(async move {
                let mut map = IN_FLIGHT_CACHE.lock().await;
                if let Some(n) = map.remove(&k) {
                    n.notify_waiters();
                }
            });
        }
    }

    let _guard = CacheCleanupGuard(cache_key.clone());

    let client = rumax::shared_http_client();
    let resp = client.get(&src)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    let size_kb = (bytes.len() + 1023) / 1024;
    let saved_path = crate::stores::set_cached_file_with_meta(app.clone(), acc, cache_key.clone(), bytes, chat_id, media_type.clone())?;
    if cache_key != src {
        let _ = crate::stores::add_cache_index_alias(app, acc, src, saved_path.clone(), size_kb, chat_id, media_type);
    }
    Ok(saved_path)
}

#[tauri::command]
pub async fn fetch_url_text(url: String) -> Result<String, String> {
    let client = rumax::shared_http_client();
    let resp = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_url_bytes(url: String) -> Result<Vec<u8>, String> {
    let client = rumax::shared_http_client();
    let resp = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub progress: usize,
    pub total: usize,
}

#[tauri::command]
pub async fn download_to_path(
    app: tauri::AppHandle,
    url: String,
    path: String,
    on_progress: tauri::ipc::Channel<DownloadProgress>,
) -> Result<(), String> {
    let _ = &app;
    let (local_src, remote_url) = unwrap_media_source(&url);
    if let Some(src) = local_src {
        tokio::fs::copy(&src, &path)
            .await
            .map_err(|e| e.to_string())?;
        let len = tokio::fs::metadata(&path).await.map(|m| m.len() as usize).unwrap_or(0);
        let _ = on_progress.send(DownloadProgress { progress: len, total: len });
        return Ok(());
    }

    let target = remote_url.unwrap_or(url);
    let client = rumax::shared_http_client();
    let resp = client.get(&target)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0) as usize;
    let mut downloaded = 0usize;

    #[cfg(target_os = "android")]
    if path.starts_with("content://") {
        use tauri_plugin_android_fs::AndroidFsExt;
        let api = app.android_fs_async();
        let uri = tauri_plugin_android_fs::FsUri::from_uri(&path);
        let mut file = api.open_file_writable(&uri).await.map_err(|e| e.to_string())?;
        use futures_util::StreamExt;
        use std::io::Write;
        let mut stream = resp.bytes_stream();
        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| e.to_string())?;
            file.write_all(&chunk).map_err(|e| e.to_string())?;
            downloaded += chunk.len();
            let _ = on_progress.send(DownloadProgress { progress: downloaded, total });
        }
        return Ok(());
    }

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&path).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len();
        let _ = on_progress.send(DownloadProgress { progress: downloaded, total });
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}
