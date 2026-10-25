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

    pub fn start(
        &mut self,
        source: NativeVideoSource,
        use_stubs: Arc<AtomicBool>,
    ) -> Result<(), String> {
        if self.running.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.running.store(true, Ordering::SeqCst);
        let running_clone = Arc::clone(&self.running);
        let use_stubs_clone = Arc::clone(&use_stubs);

        let handle = std::thread::spawn(move || {
            let mut camera_opt: Option<Camera> = None;
            let mut seed = 0x12345678u32;

            while running_clone.load(Ordering::SeqCst) {
                if use_stubs_clone.load(Ordering::SeqCst) {
                    let width = 640u32;
                    let height = 360u32;
                    let mut i420 = I420Buffer::new(width, height);
                    let (stride_y, stride_u, stride_v) = i420.strides();
                    let (data_y, data_u, data_v) = i420.data_mut();
                    for row in 0..height {
                        let offset = (row * stride_y) as usize;
                        for col in 0..width {
                            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                            data_y[offset + col as usize] = (seed >> 24) as u8;
                        }
                    }
                    let chroma_w = (width + 1) / 2;
                    let chroma_h = (height + 1) / 2;
                    for row in 0..chroma_h {
                        let offset_u = (row * stride_u) as usize;
                        let offset_v = (row * stride_v) as usize;
                        for col in 0..chroma_w {
                            data_u[offset_u + col as usize] = 128;
                            data_v[offset_v + col as usize] = 128;
                        }
                    }
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
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    continue;
                }

                if camera_opt.is_none() {
                    let index = CameraIndex::Index(0);
                    let requested = RequestedFormat::new::<RgbAFormat>(
                        RequestedFormatType::AbsoluteHighestFrameRate,
                    );
                    let mut cam = match Camera::new(index.clone(), requested) {
                        Ok(c) => c,
                        Err(_) => {
                            let fallback_requested =
                                RequestedFormat::new::<RgbAFormat>(RequestedFormatType::None);
                            match Camera::new(index, fallback_requested) {
                                Ok(c) => c,
                                Err(_) => {
                                    use_stubs_clone.store(true, Ordering::SeqCst);
                                    continue;
                                }
                            }
                        }
                    };
                    if cam.open_stream().is_err() {
                        use_stubs_clone.store(true, Ordering::SeqCst);
                        continue;
                    }
                    camera_opt = Some(cam);
                }

                if let Some(ref mut camera) = camera_opt {
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
            }

            if let Some(mut cam) = camera_opt {
                let _ = cam.stop_stream();
            }
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
