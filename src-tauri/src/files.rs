use crate::state::AppState;

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

async fn convert_media_if_needed(path: &str, is_video: bool) -> String {
    if is_video && path.ends_with("_converted.mp4") {
        return path.to_string();
    }
    if !is_video && path.ends_with("_converted.ogg") {
        return path.to_string();
    }
    let target_ext = if is_video { "mp4" } else { "ogg" };
    let p = std::path::Path::new(path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(path);
    let parent = p.parent().unwrap_or(std::path::Path::new(""));
    let out_path = parent.join(format!("{}_converted.{}", stem, target_ext)).to_string_lossy().to_string();
    let status = if is_video {
        let s1 = tokio::process::Command::new("ffmpeg")
            .args(&[
                "-y",
                "-i", path,
                "-vf", "setpts=PTS-STARTPTS,crop=min(iw\\,ih):min(iw\\,ih),scale=480:480,setsar=1",
                "-af", "asetpts=PTS-STARTPTS",
                "-fps_mode", "passthrough",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-b:v", "1500k",
                "-maxrate", "2000k",
                "-bufsize", "3000k",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "64k",
                "-shortest",
                "-movflags", "+faststart",
                &out_path,
            ])
            .status()
            .await;
        match s1 {
            Ok(s) if s.success() && std::path::Path::new(&out_path).exists() => Ok(s),
            _ => {
                tokio::process::Command::new("ffmpeg")
                    .args(&[
                        "-y",
                        "-i", path,
                        "-f", "lavfi",
                        "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
                        "-vf", "setpts=PTS-STARTPTS,crop=min(iw\\,ih):min(iw\\,ih),scale=480:480,setsar=1",
                        "-fps_mode", "passthrough",
                        "-c:v", "libx264",
                        "-preset", "ultrafast",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "aac",
                        "-b:a", "64k",
                        "-shortest",
                        "-movflags", "+faststart",
                        &out_path,
                    ])
                    .status()
                    .await
            }
        }
    } else {
        tokio::process::Command::new("ffmpeg")
            .args(&[
                "-y",
                "-i", path,
                "-vn",
                "-af", "asetpts=PTS-STARTPTS",
                "-c:a", "libopus",
                "-b:a", "32k",
                "-ar", "48000",
                "-ac", "1",
                &out_path,
            ])
            .status()
            .await
    };

    match status {
        Ok(s) if s.success() && std::path::Path::new(&out_path).exists() => out_path,
        _ => path.to_string(),
    }
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
) -> Result<serde_json::Value, String> {
    use tokio::fs::File;

    let is_video = attach_type == "VIDEO";
    let is_audio = attach_type == "AUDIO";
    let effective_path = if is_audio {
        convert_media_if_needed(&path, false).await
    } else if is_video && video_type == Some(1) {
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

    match attach_type.as_str() {
        "PHOTO" => Ok(state.client.upload_photo(upload_url, file, effective_path, mime).await),
        "VIDEO" | "AUDIO" => {
            let video_id = video_id.ok_or("No video_id")?;
            let token = token.ok_or("No token")?;
            Ok(state.client.upload_video(upload_url, video_id, token, file, effective_path).await)
        }
        "FILE" => {
            let file_id = file_id.ok_or("No file_id")?;
            Ok(state.client.upload_file(upload_url, file_id, file, effective_path).await)
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
    app: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    let lower = source_path.to_lowercase();
    if (lower.ends_with(".mp4") || lower.ends_with(".webm") || lower.ends_with(".mov")) && !lower.ends_with(".avi") {
        return Ok(source_path);
    }
    use tauri::Manager;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("temp_media");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;

    let out_path = cache_dir.join(format!("{}_preview.mp4", uuid::Uuid::new_v4()));
    let out_str = out_path.to_string_lossy().to_string();

    let s1 = tokio::process::Command::new("ffmpeg")
        .args(&[
            "-y",
            "-i", &source_path,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "64k",
            "-movflags", "+faststart",
            &out_str,
        ])
        .status()
        .await;

    if let Ok(s) = s1 {
        if s.success() && std::path::Path::new(&out_str).exists() {
            return Ok(out_str);
        }
    }

    let s2 = tokio::process::Command::new("ffmpeg")
        .args(&[
            "-y",
            "-i", &source_path,
            "-an",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            &out_str,
        ])
        .status()
        .await;

    if let Ok(s) = s2 {
        if s.success() && std::path::Path::new(&out_str).exists() {
            return Ok(out_str);
        }
    }

    Ok(source_path)
}

#[tauri::command]
pub async fn crop_video_note(
    app: tauri::AppHandle,
    source_path: String,
    crop_x: u32,
    crop_y: u32,
    crop_size: u32,
    start_sec: f64,
    end_sec: f64,
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

    let safe_crop_size = crop_size.max(48);
    let vf_filter = format!(
        "crop={}:{}:{}:{},scale=480:480,setsar=1",
        safe_crop_size, safe_crop_size, crop_x, crop_y
    );

    let start_str = format!("{:.3}", start_sec.max(0.0));
    let dur_sec = (end_sec - start_sec).max(0.1);
    let dur_str = format!("{:.3}", dur_sec);

    let status = tokio::process::Command::new("ffmpeg")
        .args(&[
            "-y",
            "-i", &source_path,
            "-ss", &start_str,
            "-t", &dur_str,
            "-vf", &vf_filter,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-b:v", "1500k",
            "-maxrate", "2000k",
            "-bufsize", "3000k",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "64k",
            "-shortest",
            "-movflags", "+faststart",
            &out_str,
        ])
        .status()
        .await;

    match status {
        Ok(s) if s.success() && std::path::Path::new(&out_str).exists() => Ok(out_str),
        _ => {
            let status2 = tokio::process::Command::new("ffmpeg")
                .args(&[
                    "-y",
                    "-i", &source_path,
                    "-f", "lavfi",
                    "-i", "anullsrc=channel_layout=mono:sample_rate=48000",
                    "-ss", &start_str,
                    "-t", &dur_str,
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                    "-vf", &vf_filter,
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-b:v", "1500k",
                    "-maxrate", "2000k",
                    "-bufsize", "3000k",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "64k",
                    "-shortest",
                    "-movflags", "+faststart",
                    &out_str,
                ])
                .status()
                .await;
            match status2 {
                Ok(s) if s.success() && std::path::Path::new(&out_str).exists() => Ok(out_str),
                Err(e) => Err(e.to_string()),
                _ => Err("ffmpeg crop failed".into()),
            }
        }
    }
}


#[tauri::command]
pub async fn cache_url(
    app: tauri::AppHandle,
    account: Option<u64>,
    src: String,
) -> Result<String, String> {
    let acc = account.unwrap_or(0);
    if let Ok(Some(existing_path)) = crate::stores::get_cached_file(app.clone(), acc, src.clone()) {
        if std::path::Path::new(&existing_path).exists() {
            return Ok(existing_path);
        }
    }

    let client = rumax::shared_http_client();
    let resp = client.get(&src)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    crate::stores::set_cached_file(app, acc, src, bytes)
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

#[tauri::command]
pub async fn download_to_path(url: String, path: String) -> Result<(), String> {
    let (local_src, remote_url) = unwrap_media_source(&url);
    if let Some(src) = local_src {
        tokio::fs::copy(&src, &path)
            .await
            .map_err(|e| e.to_string())?;
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

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
