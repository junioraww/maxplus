use crate::state::AppState;

#[tauri::command]
pub async fn download(
    app: tauri::AppHandle,
    url: String,
    name: String,
) -> Result<String, String> {
    let client = rumax::create_http_client();
    let bytes = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

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

#[tauri::command]
pub async fn upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    upload_url: String,
    path: String,
    attach_type: String,
    file_id: Option<u64>,
    video_id: Option<u64>,
    token: Option<String>,
    mime: Option<String>,
) -> Result<serde_json::Value, String> {
    use tokio::fs::File;

    #[cfg(target_os = "android")]
    let file: File = {
        use tauri_plugin_android_fs::{ AndroidFsExt, FsUri };
        let api = app.android_fs_async();
        let uri = FsUri::from_uri(path.clone());
        let std_file = api.open_file_readable(&uri).await.map_err(|e| e.to_string())?;
        tokio::fs::File::from_std(std_file)
    };

    #[cfg(not(target_os = "android"))]
    let file: File = {
        let std_file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        tokio::fs::File::from_std(std_file)
    };

    match attach_type.as_str() {
        "PHOTO" => Ok(state.client.upload_photo(upload_url, file, path, mime).await),
        "VIDEO" => {
            let video_id = video_id.ok_or("No video_id")?;
            let token = token.ok_or("No token")?;
            Ok(state.client.upload_video(upload_url, video_id, token, file, path).await)
        }
        "FILE" => {
            let file_id = file_id.ok_or("No file_id")?;
            Ok(state.client.upload_file(upload_url, file_id, file, path).await)
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
            Some("VIDEO") => dialog.add_filter("Видео", &["mp4", "avi", "mov", "mvk"]),
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
    let client = rumax::shared_http_client();
    let resp = client.get(&url)
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
