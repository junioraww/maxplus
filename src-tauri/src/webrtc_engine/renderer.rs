use tauri::ipc::{Channel, InvokeResponseBody};

pub struct FrameSender {
    channel: Channel<InvokeResponseBody>,
}

impl FrameSender {
    pub fn new(channel: Channel<InvokeResponseBody>) -> Self {
        Self { channel }
    }

    pub fn send_i420(
        &self,
        width: u32,
        height: u32,
        y: &[u8],
        u: &[u8],
        v: &[u8],
    ) -> Result<(), String> {
        let total_size = 8 + y.len() + u.len() + v.len();
        let mut buf = Vec::with_capacity(total_size);
        buf.extend_from_slice(&width.to_le_bytes());
        buf.extend_from_slice(&height.to_le_bytes());
        buf.extend_from_slice(y);
        buf.extend_from_slice(u);
        buf.extend_from_slice(v);
        self.channel
            .send(InvokeResponseBody::Raw(buf))
            .map_err(|e| e.to_string())
    }
}
