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

pub struct AudioSender {
    channel: Channel<InvokeResponseBody>,
}

impl AudioSender {
    pub fn new(channel: Channel<InvokeResponseBody>) -> Self {
        Self { channel }
    }

    pub fn send_pcm(
        &self,
        sample_rate: u32,
        num_channels: u32,
        pcm: &[i16],
    ) -> Result<(), String> {
        let mut buf = Vec::with_capacity(8 + pcm.len() * 2);
        buf.extend_from_slice(&sample_rate.to_le_bytes());
        buf.extend_from_slice(&num_channels.to_le_bytes());
        for &sample in pcm {
            buf.extend_from_slice(&sample.to_le_bytes());
        }
        self.channel
            .send(InvokeResponseBody::Raw(buf))
            .map_err(|e| e.to_string())
    }
}
