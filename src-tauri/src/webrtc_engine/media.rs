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

pub struct ScreenCapturer {
    running: Arc<AtomicBool>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

impl ScreenCapturer {
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
            let mut x11_failed = false;

            while running_clone.load(Ordering::SeqCst) {
                let frame_start = std::time::Instant::now();

                if !use_stubs_clone.load(Ordering::SeqCst) && !x11_failed {
                    if let Some((w, h, mut rgba)) = capture_x11_screen() {
                        push_rgba_frame(&source, w, h, &mut rgba);
                        let elapsed = frame_start.elapsed();
                        let target = std::time::Duration::from_millis(66);
                        if elapsed < target {
                            std::thread::sleep(target - elapsed);
                        }
                        continue;
                    } else {
                        x11_failed = true;
                    }
                }

                if !use_stubs_clone.load(Ordering::SeqCst) {
                    if let Some((w, h, mut rgba)) = capture_grim_screen() {
                        push_rgba_frame(&source, w, h, &mut rgba);
                        let elapsed = frame_start.elapsed();
                        let target = std::time::Duration::from_millis(66);
                        if elapsed < target {
                            std::thread::sleep(target - elapsed);
                        }
                        continue;
                    }
                }

                // Fallback placeholder frame if neither X11 nor Wayland grim is available
                let width = 1280u32;
                let height = 720u32;
                let mut i420 = I420Buffer::new(width, height);
                let (stride_y, stride_u, stride_v) = i420.strides();
                let (data_y, data_u, data_v) = i420.data_mut();
                for row in 0..height {
                    let offset = (row * stride_y) as usize;
                    for col in 0..width {
                        data_y[offset + col as usize] = 16;
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
                std::thread::sleep(std::time::Duration::from_millis(100));
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

impl Drop for ScreenCapturer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn push_rgba_frame(source: &NativeVideoSource, width: u32, height: u32, rgba: &[u8]) {
    if width == 0 || height == 0 || rgba.len() < (width * height * 4) as usize {
        return;
    }
    let mut i420 = I420Buffer::new(width, height);
    let (stride_y, stride_u, stride_v) = i420.strides();
    let (data_y, data_u, data_v) = i420.data_mut();

    yuv_helper::abgr_to_i420(
        rgba,
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

fn capture_x11_screen() -> Option<(u32, u32, Vec<u8>)> {
    use x11::xlib;
    unsafe {
        let display = xlib::XOpenDisplay(std::ptr::null());
        if display.is_null() {
            return None;
        }
        let root = xlib::XDefaultRootWindow(display);
        let mut attrs: xlib::XWindowAttributes = std::mem::zeroed();
        if xlib::XGetWindowAttributes(display, root, &mut attrs) == 0
            || attrs.width <= 0
            || attrs.height <= 0
        {
            xlib::XCloseDisplay(display);
            return None;
        }
        let w = attrs.width as u32;
        let h = attrs.height as u32;
        let image = xlib::XGetImage(
            display,
            root,
            0,
            0,
            w,
            h,
            xlib::XAllPlanes(),
            xlib::ZPixmap,
        );
        if image.is_null() {
            xlib::XCloseDisplay(display);
            return None;
        }

        let img_ref = &*image;
        let result = if img_ref.bits_per_pixel == 32 && !img_ref.data.is_null() {
            let bpl = img_ref.bytes_per_line as usize;
            let row_bytes = (w * 4) as usize;
            let mut rgba = vec![0u8; row_bytes * h as usize];
            let src = std::slice::from_raw_parts(img_ref.data as *const u8, bpl * h as usize);
            for y in 0..h as usize {
                let s_row = &src[y * bpl..y * bpl + row_bytes];
                let d_row = &mut rgba[y * row_bytes..(y + 1) * row_bytes];
                for x in 0..w as usize {
                    let i = x * 4;
                    d_row[i] = s_row[i + 2];
                    d_row[i + 1] = s_row[i + 1];
                    d_row[i + 2] = s_row[i];
                    d_row[i + 3] = 255;
                }
            }
            Some((w, h, rgba))
        } else {
            None
        };

        xlib::XDestroyImage(image);
        xlib::XCloseDisplay(display);
        result
    }
}

fn capture_grim_screen() -> Option<(u32, u32, Vec<u8>)> {
    let output = std::process::Command::new("grim")
        .args(["-t", "ppm", "-"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let data = &output.stdout;
    if !data.starts_with(b"P6") {
        return None;
    }
    let mut idx = 2;
    let mut tokens = Vec::with_capacity(3);
    while tokens.len() < 3 && idx < data.len() {
        while idx < data.len() && data[idx].is_ascii_whitespace() {
            idx += 1;
        }
        if idx < data.len() && data[idx] == b'#' {
            while idx < data.len() && data[idx] != b'\n' {
                idx += 1;
            }
            continue;
        }
        let start = idx;
        while idx < data.len() && !data[idx].is_ascii_whitespace() {
            idx += 1;
        }
        if start < idx {
            let s = std::str::from_utf8(&data[start..idx]).ok()?;
            tokens.push(s.parse::<u32>().ok()?);
        }
    }
    if tokens.len() != 3 || idx >= data.len() {
        return None;
    }
    idx += 1; // skip single whitespace after maxval
    let (w, h) = (tokens[0], tokens[1]);
    let rgb_len = (w * h * 3) as usize;
    if data.len() < idx + rgb_len {
        return None;
    }
    let rgb = &data[idx..idx + rgb_len];
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for chunk in rgb.chunks_exact(3) {
        rgba.push(chunk[0]);
        rgba.push(chunk[1]);
        rgba.push(chunk[2]);
        rgba.push(255);
    }
    Some((w, h, rgba))
}
