use libwebrtc::{
    native::yuv_helper,
    video_frame::{I420Buffer, VideoFrame, VideoRotation},
    video_source::native::NativeVideoSource,
};
use nokhwa::{
    pixel_format::RgbAFormat,
    utils::{CameraIndex, RequestedFormat, RequestedFormatType},
    Camera,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct CameraCapturer {
    running: Arc<AtomicBool>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

impl CameraCapturer {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            thread_handle: None,
        }
    }

    pub fn start(&mut self, source: NativeVideoSource) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        let running_clone = Arc::clone(&self.running);

        let handle = std::thread::spawn(move || {
            let index = CameraIndex::Index(0);
            let requested = RequestedFormat::new::<RgbAFormat>(
                RequestedFormatType::AbsoluteHighestFrameRate,
            );

            let mut camera = match Camera::new(index.clone(), requested) {
                Ok(cam) => cam,
                Err(e) => {
                    eprintln!("[webrtc:camera] Camera::new high framerate failed: {:?}, trying fallback", e);
                    let fallback_requested = RequestedFormat::new::<RgbAFormat>(RequestedFormatType::None);
                    match Camera::new(index, fallback_requested) {
                        Ok(cam) => cam,
                        Err(e2) => {
                            eprintln!("[webrtc:camera] Camera::new fallback failed: {:?}", e2);
                            running_clone.store(false, Ordering::SeqCst);
                            return;
                        }
                    }
                }
            };

            if let Err(e) = camera.open_stream() {
                eprintln!("[webrtc:camera] camera.open_stream error: {:?}", e);
                running_clone.store(false, Ordering::SeqCst);
                return;
            }

            while running_clone.load(Ordering::SeqCst) {
                let frame = match camera.frame() {
                    Ok(f) => f,
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(33));
                        continue;
                    }
                };

                let res = frame.resolution();
                let width = res.width();
                let height = res.height();

                let rgba_buf = match frame.decode_image::<RgbAFormat>() {
                    Ok(img) => img,
                    Err(_) => continue,
                };

                let mut i420 = I420Buffer::new(width, height);
                let (stride_y, stride_u, stride_v) = i420.strides();
                let (data_y, data_u, data_v) = i420.data_mut();

                yuv_helper::abgr_to_i420(
                    rgba_buf.as_raw(),
                    width * 4,
                    data_y,
                    stride_y,
                    data_u,
                    stride_u,
                    data_v,
                    stride_v,
                    width as i32,
                    height as i32,
                );

                let timestamp_us = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_micros() as i64;

                let video_frame = VideoFrame {
                    rotation: VideoRotation::VideoRotation0,
                    timestamp_us,
                    frame_metadata: None,
                    buffer: i420,
                };

                source.capture_frame(&video_frame);
            }

            let _ = camera.stop_stream();
        });

        self.thread_handle = Some(handle);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread_handle.take() {
            std::thread::spawn(move || {
                let _ = handle.join();
            });
        }
    }
}

impl Drop for CameraCapturer {
    fn drop(&mut self) {
        self.stop();
    }
}
