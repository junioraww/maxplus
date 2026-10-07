#[cfg(target_os = "linux")]
use crate::webrtc_engine::session::{
    IceCandidatePayload, IceServerConfig, NativeWebRtcSession, SessionDescriptionPayload,
};
use tauri::ipc::{Channel, InvokeResponseBody};

#[cfg(not(target_os = "linux"))]
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SessionDescriptionPayload {
    pub sdp_type: String,
    pub sdp: String,
}

#[cfg(not(target_os = "linux"))]
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct IceCandidatePayload {
    pub candidate: String,
    pub sdp_mid: Option<String>,
    pub sdp_mline_index: Option<i32>,
}

#[cfg(not(target_os = "linux"))]
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct IceServerConfig {
    pub urls: Vec<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

#[tauri::command]
pub async fn webrtc_create(ice_servers: Vec<IceServerConfig>) -> Result<u32, String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::create(ice_servers).await?;
        Ok(session.id)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = ice_servers;
        Ok(0)
    }
}

#[tauri::command]
pub async fn webrtc_create_offer(
    session_id: u32,
    ice_restart: Option<bool>,
) -> Result<SessionDescriptionPayload, String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.create_offer(ice_restart.unwrap_or(false)).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, ice_restart);
        Ok(SessionDescriptionPayload {
            sdp_type: "offer".to_string(),
            sdp: String::new(),
        })
    }
}

#[tauri::command]
pub async fn webrtc_create_answer(session_id: u32) -> Result<SessionDescriptionPayload, String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.create_answer().await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = session_id;
        Ok(SessionDescriptionPayload {
            sdp_type: "answer".to_string(),
            sdp: String::new(),
        })
    }
}

#[tauri::command]
pub async fn webrtc_set_local_description(
    session_id: u32,
    sdp_type: String,
    sdp: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_local_description(sdp_type, sdp).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, sdp_type, sdp);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_set_remote_description(
    session_id: u32,
    sdp_type: String,
    sdp: String,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_remote_description(sdp_type, sdp).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, sdp_type, sdp);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_add_ice_candidate(
    session_id: u32,
    candidate: IceCandidatePayload,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.add_ice_candidate(candidate).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, candidate);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_set_camera_enabled(session_id: u32, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_camera_enabled(enabled).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, enabled);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_set_mic_muted(session_id: u32, muted: bool) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_mic_muted(muted).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, muted);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_listen_video(
    session_id: u32,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_video_channel(channel).await;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, channel);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_listen_candidates(
    session_id: u32,
    channel: Channel<serde_json::Value>,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_candidates_channel(channel).await;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, channel);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_listen_state(
    session_id: u32,
    channel: Channel<String>,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.set_state_channel(channel).await;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, channel);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_create_data_channel(session_id: u32, label: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let session = NativeWebRtcSession::get(session_id).await?;
        session.create_data_channel(&label)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (session_id, label);
        Ok(())
    }
}

#[tauri::command]
pub async fn webrtc_close(session_id: u32) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        NativeWebRtcSession::remove(session_id).await;
        Ok(())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = session_id;
        Ok(())
    }
}
