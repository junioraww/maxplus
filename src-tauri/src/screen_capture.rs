use serde_json::json;
use std::sync::Mutex;
use tauri::Emitter;

static PENDING_SCREEN_CAPTURE: Mutex<Option<tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>>> = Mutex::new(None);

pub fn on_screen_capture_result(success: bool, port: i32, width: i32, height: i32) {
    if let Ok(mut lock) = PENDING_SCREEN_CAPTURE.lock() {
        if let Some(tx) = lock.take() {
            if success {
                let _ = tx.send(Ok(json!({
                    "port": port,
                    "width": width,
                    "height": height
                })));
            } else {
                let _ = tx.send(Err("Screen capture cancelled or denied".to_string()));
            }
        }
    }
}

pub fn on_screen_capture_stopped() {
    if let Some(app) = crate::notifications::GLOBAL_APP_HANDLE.get() {
        let _ = app.emit("screen_capture_stopped", ());
    }
}

#[tauri::command]
pub async fn start_android_screen_capture() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut lock = PENDING_SCREEN_CAPTURE.lock().map_err(|e| e.to_string())?;
            *lock = Some(tx);
        }

        if let (Some(vm), Some(main_class)) = (
            crate::notifications::GLOBAL_JVM.get(),
            crate::notifications::GLOBAL_MAIN_ACTIVITY_CLASS.get(),
        ) {
            let res = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                let _ = env.call_static_method(
                    main_class,
                    jni::jni_str!("startScreenCaptureStatic"),
                    jni::jni_sig!("()V"),
                    &[],
                )?;
                Ok(())
            });
            if res.is_err() {
                return Err("Failed to launch screen capture intent".to_string());
            }
        } else {
            return Err("Android JVM not initialized".to_string());
        }

        match tokio::time::timeout(std::time::Duration::from_secs(60), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("Screen capture cancelled".to_string()),
            Err(_) => Err("Screen capture timed out waiting for permission".to_string()),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("Android screen capture not supported on desktop".to_string())
    }
}

#[tauri::command]
pub async fn stop_android_screen_capture() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        if let (Some(vm), Some(main_class)) = (
            crate::notifications::GLOBAL_JVM.get(),
            crate::notifications::GLOBAL_MAIN_ACTIVITY_CLASS.get(),
        ) {
            let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
                let _ = env.call_static_method(
                    main_class,
                    jni::jni_str!("stopScreenCaptureStatic"),
                    jni::jni_sig!("()V"),
                    &[],
                )?;
                Ok(())
            });
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}
