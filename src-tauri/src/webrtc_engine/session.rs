use crate::webrtc_engine::media::CameraCapturer;
use crate::webrtc_engine::renderer::FrameSender;
use libwebrtc::{
    ice_candidate::IceCandidate,
    media_stream_track::MediaStreamTrack,
    peer_connection::{
        AnswerOptions, IceGatheringState, OfferOptions, PeerConnection, PeerConnectionState, TrackEvent,
    },
    peer_connection_factory::{
        native::PeerConnectionFactoryExt, ContinualGatheringPolicy, IceServer, IceTransportsType,
        PeerConnectionFactory, RtcConfiguration,
    },
    rtp_sender::RtpSender,
    rtp_transceiver::{RtpTransceiverDirection, RtpTransceiverInit},
    session_description::{SdpType, SessionDescription},
    video_frame::VideoBuffer,
    video_source::native::NativeVideoSource,
    video_stream::native::NativeVideoStream,
    video_track::RtcVideoTrack,
    MediaType,
};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::Mutex;
use tokio_stream::StreamExt;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SessionDescriptionPayload {
    #[serde(alias = "sdpType")]
    pub sdp_type: String,
    pub sdp: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct IceCandidatePayload {
    pub candidate: String,
    #[serde(alias = "sdpMid")]
    pub sdp_mid: Option<String>,
    #[serde(alias = "sdpMLineIndex")]
    pub sdp_mline_index: Option<i32>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct IceServerConfig {
    pub urls: Vec<String>,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

pub struct NativeWebRtcSession {
    pub id: u32,
    factory: PeerConnectionFactory,
    pc: PeerConnection,
    capturer: Mutex<CameraCapturer>,
    video_source: NativeVideoSource,
    video_track: Mutex<Option<RtcVideoTrack>>,
    video_sender: Mutex<Option<RtpSender>>,
    camera_enabled: AtomicBool,
    mic_muted: AtomicBool,
    audio_sender: Mutex<Option<RtpSender>>,
    video_channel: Arc<Mutex<Option<FrameSender>>>,
    candidate_channel: Arc<Mutex<Option<Channel<serde_json::Value>>>>,
    state_channel: Arc<Mutex<Option<Channel<String>>>>,
    pending_candidates: Arc<Mutex<Vec<IceCandidate>>>,
}

static NEXT_SESSION_ID: AtomicU32 = AtomicU32::new(1);
static SESSIONS: std::sync::OnceLock<Arc<Mutex<HashMap<u32, Arc<NativeWebRtcSession>>>>> =
    std::sync::OnceLock::new();

fn get_sessions() -> &'static Arc<Mutex<HashMap<u32, Arc<NativeWebRtcSession>>>> {
    SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

impl NativeWebRtcSession {
    pub async fn create(ice_servers: Vec<IceServerConfig>) -> Result<Arc<Self>, String> {
        let factory = PeerConnectionFactory::default();

        let mut servers = Vec::new();
        for s in ice_servers {
            let is_turn = s.urls.iter().any(|u| u.starts_with("turn:") || u.starts_with("turns:"));
            if is_turn && (s.username.is_empty() || s.password.is_empty()) {
                continue;
            }
            servers.push(IceServer {
                urls: s.urls,
                username: s.username,
                password: s.password,
            });
        }

        println!("[webrtc] Creating peer connection with {} valid ice servers", servers.len());

        let mut config = RtcConfiguration::default();
        config.ice_servers = servers;
        config.continual_gathering_policy = ContinualGatheringPolicy::GatherContinually;
        config.ice_transport_type = IceTransportsType::All;
        config.enable_sctp_snap = false;

        let pc = match factory.create_peer_connection(config) {
            Ok(pc) => pc,
            Err(e) => {
                eprintln!("[webrtc:err] create_peer_connection failed: {:?}", e);
                return Err(e.to_string());
            }
        };

        let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);
        let candidate_channel: Arc<Mutex<Option<Channel<serde_json::Value>>>> = Arc::new(Mutex::new(None));
        let state_channel: Arc<Mutex<Option<Channel<String>>>> = Arc::new(Mutex::new(None));
        let video_channel: Arc<Mutex<Option<FrameSender>>> = Arc::new(Mutex::new(None));
        let pending_candidates = Arc::new(Mutex::new(Vec::new()));

        factory.acquire_platform_adm();
        factory.set_adm_playout_enabled(true);
        factory.set_adm_recording_enabled(true);
        let _ = factory.init_recording();
        let _ = factory.start_recording();
        let _ = factory.init_playout();
        let _ = factory.start_playout();

        let video_source = NativeVideoSource::new(
            libwebrtc::video_source::VideoResolution {
                width: 1280,
                height: 720,
            },
            false,
        );

        let audio_track = factory.create_device_audio_track("audio0");

        let audio_sender = pc
            .add_track(
                MediaStreamTrack::Audio(audio_track),
                &["default_stream".to_string()],
            )
            .ok();

        let video_transceiver = pc
            .add_transceiver_for_media(
                MediaType::Video,
                RtpTransceiverInit {
                    direction: RtpTransceiverDirection::SendRecv,
                    stream_ids: vec!["maxplus_video".to_string()],
                    send_encodings: vec![],
                },
            )
            .ok();
        let video_sender = video_transceiver.map(|t| t.sender());

        let handle = tokio::runtime::Handle::current();

        let cand_chan_clone = Arc::clone(&candidate_channel);
        let pending_clone = Arc::clone(&pending_candidates);
        let h1 = handle.clone();
        pc.on_ice_candidate(Some(Box::new(move |cand: IceCandidate| {
            let chan = cand_chan_clone.clone();
            let pending = pending_clone.clone();
            h1.spawn(async move {
                let payload = serde_json::json!({
                    "candidate": cand.candidate(),
                    "sdpMid": cand.sdp_mid(),
                    "sdpMLineIndex": cand.sdp_mline_index(),
                });
                let lock = chan.lock().await;
                if let Some(ch) = lock.as_ref() {
                    let _ = ch.send(payload);
                } else {
                    pending.lock().await.push(cand);
                }
            });
        })));

        let cand_chan_clone2 = Arc::clone(&candidate_channel);
        let h_gather = handle.clone();
        pc.on_ice_gathering_state_change(Some(Box::new(move |state: IceGatheringState| {
            if state == IceGatheringState::Complete {
                let chan = cand_chan_clone2.clone();
                h_gather.spawn(async move {
                    let lock = chan.lock().await;
                    if let Some(ch) = lock.as_ref() {
                        let _ = ch.send(serde_json::json!({
                            "candidate": null,
                        }));
                    }
                });
            }
        })));

        let state_chan_clone = Arc::clone(&state_channel);
        let h2 = handle.clone();
        pc.on_connection_state_change(Some(Box::new(move |state: PeerConnectionState| {
            let chan = state_chan_clone.clone();
            h2.spawn(async move {
                let s_str = match state {
                    PeerConnectionState::New => "new",
                    PeerConnectionState::Connecting => "connecting",
                    PeerConnectionState::Connected => "connected",
                    PeerConnectionState::Disconnected => "disconnected",
                    PeerConnectionState::Failed => "failed",
                    PeerConnectionState::Closed => "closed",
                };
                let lock = chan.lock().await;
                if let Some(ch) = lock.as_ref() {
                    let _ = ch.send(s_str.to_string());
                }
            });
        })));

        let video_chan_clone = Arc::clone(&video_channel);
        let h3 = handle.clone();
        pc.on_track(Some(Box::new(move |ev: TrackEvent| {
            if let MediaStreamTrack::Video(vtrack) = ev.track {
                let vchan = video_chan_clone.clone();
                h3.spawn(async move {
                    let mut stream = NativeVideoStream::new(vtrack);
                    while let Some(frame) = stream.next().await {
                        let lock = vchan.lock().await;
                        if let Some(sender) = lock.as_ref() {
                            let buffer = frame.buffer.to_i420();
                            let width = buffer.width();
                            let height = buffer.height();
                            let (stride_y, stride_u, stride_v) = buffer.strides();
                            let (data_y, data_u, data_v) = buffer.data();

                            let mut y_plane = Vec::with_capacity((width * height) as usize);
                            for row in 0..height {
                                let start = (row * stride_y) as usize;
                                let end = start + width as usize;
                                if end <= data_y.len() {
                                    y_plane.extend_from_slice(&data_y[start..end]);
                                }
                            }

                            let chroma_w = (width + 1) / 2;
                            let chroma_h = (height + 1) / 2;

                            let mut u_plane = Vec::with_capacity((chroma_w * chroma_h) as usize);
                            for row in 0..chroma_h {
                                let start = (row * stride_u) as usize;
                                let end = start + chroma_w as usize;
                                if end <= data_u.len() {
                                    u_plane.extend_from_slice(&data_u[start..end]);
                                }
                            }

                            let mut v_plane = Vec::with_capacity((chroma_w * chroma_h) as usize);
                            for row in 0..chroma_h {
                                let start = (row * stride_v) as usize;
                                let end = start + chroma_w as usize;
                                if end <= data_v.len() {
                                    v_plane.extend_from_slice(&data_v[start..end]);
                                }
                            }

                            let _ = sender.send_i420(width, height, &y_plane, &u_plane, &v_plane);
                        }
                    }
                });
            }
        })));

        let session = Arc::new(Self {
            id: session_id,
            factory,
            pc,
            capturer: Mutex::new(CameraCapturer::new()),
            video_source,
            video_track: Mutex::new(None),
            video_sender: Mutex::new(video_sender),
            camera_enabled: AtomicBool::new(false),
            mic_muted: AtomicBool::new(false),
            audio_sender: Mutex::new(audio_sender),
            video_channel,
            candidate_channel,
            state_channel,
            pending_candidates,
        });

        get_sessions().lock().await.insert(session_id, Arc::clone(&session));
        Ok(session)
    }

    pub async fn get(id: u32) -> Result<Arc<Self>, String> {
        get_sessions()
            .lock()
            .await
            .get(&id)
            .cloned()
            .ok_or_else(|| format!("Session {} not found", id))
    }

    pub async fn remove(id: u32) {
        if let Some(session) = get_sessions().lock().await.remove(&id) {
            session.close().await;
        }
    }

    pub async fn create_offer(&self, ice_restart: bool) -> Result<SessionDescriptionPayload, String> {
        let options = OfferOptions {
            ice_restart,
            offer_to_receive_audio: true,
            offer_to_receive_video: true,
        };

        let desc = self.pc.create_offer(options).await.map_err(|e| {
            eprintln!("[webrtc:err] create_offer failed: {:?}", e);
            e.to_string()
        })?;

        let sdp = prioritize_vp8(desc.to_string());
        println!("[webrtc] create_offer sdp len={}", sdp.len());

        Ok(SessionDescriptionPayload {
            sdp_type: "offer".to_string(),
            sdp,
        })
    }

    pub async fn create_answer(&self) -> Result<SessionDescriptionPayload, String> {
        let desc = self
            .pc
            .create_answer(AnswerOptions::default())
            .await
            .map_err(|e| {
                eprintln!("[webrtc:err] create_answer failed: {:?}", e);
                e.to_string()
            })?;

        let sdp = prioritize_vp8(desc.to_string());
        println!("[webrtc] create_answer sdp len={}", sdp.len());

        Ok(SessionDescriptionPayload {
            sdp_type: "answer".to_string(),
            sdp,
        })
    }

    pub async fn set_local_description(&self, sdp_type: String, sdp: String) -> Result<(), String> {
        let t = match sdp_type.to_lowercase().as_str() {
            "offer" => SdpType::Offer,
            "answer" => SdpType::Answer,
            "pranswer" => SdpType::PrAnswer,
            "rollback" => SdpType::Rollback,
            _ => return Err(format!("Unknown SDP type: {}", sdp_type)),
        };

        if t == SdpType::Rollback {
            println!("[webrtc] set_local_description rollback");
            let desc = SessionDescription::parse("", SdpType::Rollback).map_err(|e| e.to_string())?;
            return self.pc.set_local_description(desc).await.map_err(|e| e.to_string());
        }

        let normalized = normalize_sdp(&sdp);
        println!("[webrtc] set_local_description type={} len={}", sdp_type, normalized.len());

        let desc = SessionDescription::parse(&normalized, t).map_err(|e| {
            eprintln!("[webrtc:err] SessionDescription::parse local failed: {} - {}", e.line, e.description);
            e.to_string()
        })?;
        self.pc.set_local_description(desc).await.map_err(|e| {
            eprintln!("[webrtc:err] pc.set_local_description failed: {:?}", e);
            e.to_string()
        })
    }

    pub async fn set_remote_description(&self, sdp_type: String, sdp: String) -> Result<(), String> {
        let normalized = normalize_sdp(&sdp);
        println!("[webrtc] set_remote_description type={} len={}", sdp_type, normalized.len());

        let t = match sdp_type.to_lowercase().as_str() {
            "offer" => SdpType::Offer,
            "answer" => SdpType::Answer,
            "pranswer" => SdpType::PrAnswer,
            "rollback" => SdpType::Rollback,
            _ => return Err(format!("Unknown SDP type: {}", sdp_type)),
        };

        let desc = SessionDescription::parse(&normalized, t).map_err(|e| {
            eprintln!("[webrtc:err] SessionDescription::parse remote failed: {} - {}", e.line, e.description);
            e.to_string()
        })?;
        self.pc.set_remote_description(desc).await.map_err(|e| {
            eprintln!("[webrtc:err] pc.set_remote_description failed: {:?}", e);
            e.to_string()
        })
    }

    pub async fn add_ice_candidate(&self, payload: IceCandidatePayload) -> Result<(), String> {
        let clean_cand = payload.candidate.trim();
        if clean_cand.is_empty() {
            return Ok(());
        }
        let mid = payload.sdp_mid.unwrap_or_else(|| "0".to_string());
        let mline = payload.sdp_mline_index.unwrap_or(0);
        let cand = IceCandidate::parse(&mid, mline, clean_cand).map_err(|e| {
            eprintln!("[webrtc:err] IceCandidate::parse failed: {} - {}", e.line, e.description);
            e.to_string()
        })?;
        self.pc.add_ice_candidate(cand).await.map_err(|e| {
            eprintln!("[webrtc:err] pc.add_ice_candidate failed: {:?}", e);
            e.to_string()
        })
    }

    pub fn create_data_channel(&self, label: &str) -> Result<(), String> {
        println!("[webrtc] create_data_channel: {}", label);
        let _ = self.pc.create_data_channel(label, libwebrtc::data_channel::DataChannelInit::default())
            .map_err(|e| {
                eprintln!("[webrtc:err] pc.create_data_channel failed: {:?}", e);
                e.to_string()
            })?;
        Ok(())
    }

    pub async fn set_camera_enabled(&self, enabled: bool) -> Result<(), String> {
        if enabled {
            if !self.camera_enabled.swap(true, Ordering::SeqCst) {
                let mut capturer = self.capturer.lock().await;
                capturer.start(self.video_source.clone())?;

                let mut track_lock = self.video_track.lock().await;
                if let Some(track) = track_lock.as_ref() {
                    track.set_enabled(true);
                } else {
                    let track = self.factory.create_video_track("camera0", self.video_source.clone());
                    let sender_lock = self.video_sender.lock().await;
                    if let Some(sender) = sender_lock.as_ref() {
                        let _ = sender.set_track(Some(MediaStreamTrack::Video(track.clone())));
                    }
                    *track_lock = Some(track);
                }
            }
        } else if self.camera_enabled.swap(false, Ordering::SeqCst) {
            let mut capturer = self.capturer.lock().await;
            capturer.stop();
            let track_lock = self.video_track.lock().await;
            if let Some(track) = track_lock.as_ref() {
                track.set_enabled(false);
            }
        }
        Ok(())
    }

    pub async fn set_mic_muted(&self, muted: bool) -> Result<(), String> {
        self.mic_muted.store(muted, Ordering::SeqCst);
        let sender_lock = self.audio_sender.lock().await;
        if let Some(sender) = sender_lock.as_ref() {
            if let Some(track) = sender.track() {
                track.set_enabled(!muted);
            }
        }
        Ok(())
    }

    pub async fn set_video_channel(&self, channel: Channel<InvokeResponseBody>) {
        let sender = FrameSender::new(channel);
        *self.video_channel.lock().await = Some(sender);
    }

    pub async fn set_candidates_channel(&self, channel: Channel<serde_json::Value>) {
        let pending = {
            let mut lock = self.pending_candidates.lock().await;
            std::mem::take(&mut *lock)
        };
        for c in pending {
            let _ = channel.send(serde_json::json!({
                "candidate": c.candidate(),
                "sdpMid": c.sdp_mid(),
                "sdpMLineIndex": c.sdp_mline_index(),
            }));
        }
        *self.candidate_channel.lock().await = Some(channel);
    }

    pub async fn set_state_channel(&self, channel: Channel<String>) {
        *self.state_channel.lock().await = Some(channel);
    }

    pub async fn close(&self) {
        let mut capturer = self.capturer.lock().await;
        capturer.stop();
        let _ = self.factory.stop_recording();
        let _ = self.factory.stop_playout();
        self.factory.release_platform_adm();
        let _ = self.pc.close();
    }
}

fn prioritize_vp8(sdp: String) -> String {
    let mut lines: Vec<String> = sdp
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut vp8_pt = None;

    for line in &lines {
        if line.starts_with("a=rtpmap:") && line.to_uppercase().contains("VP8/90000") {
            if let Some(pt_str) = line.strip_prefix("a=rtpmap:").and_then(|s| s.split_whitespace().next()) {
                vp8_pt = Some(pt_str.to_string());
                break;
            }
        }
    }

    if let Some(pt) = vp8_pt {
        for line in &mut lines {
            if line.starts_with("m=video ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() > 3 {
                    let mut new_pts = Vec::new();
                    new_pts.push(pt.as_str());
                    for p in &parts[3..] {
                        if *p != pt.as_str() {
                            new_pts.push(*p);
                        }
                    }
                    *line = format!("{} {} {} {}", parts[0], parts[1], parts[2], new_pts.join(" "));
                }
                break;
            }
        }
    }

    let mut result = lines.join("\r\n");
    if !result.is_empty() {
        result.push_str("\r\n");
    }
    result
}

fn normalize_sdp(sdp: &str) -> String {
    let lines: Vec<&str> = sdp
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    let mut result = lines.join("\r\n");
    if !result.is_empty() {
        result.push_str("\r\n");
    }
    result
}
