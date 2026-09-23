use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::LazyLock;

static OGG_CRC_TABLE: LazyLock<[u32; 256]> = LazyLock::new(|| {
    let mut table = [0u32; 256];
    for i in 0..256 {
        let mut r = (i as u32) << 24;
        for _ in 0..8 {
            if (r & 0x8000_0000) != 0 {
                r = (r << 1) ^ 0x04c1_1db7;
            } else {
                r <<= 1;
            }
        }
        table[i] = r;
    }
    table
});

pub fn calculate_ogg_crc_slice(data: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &b in data {
        let idx = ((crc >> 24) ^ (b as u32)) & 0xff;
        crc = (crc << 8) ^ OGG_CRC_TABLE[idx as usize];
    }
    crc
}

#[tauri::command]
pub fn calculate_ogg_crc(data: Vec<u8>) -> u32 {
    calculate_ogg_crc_slice(&data)
}

pub fn sanitize_mp4_bytes(bytes: &mut [u8]) -> bool {
    let mut sanitized = false;
    if bytes.len() >= 4 {
        for i in 0..=bytes.len() - 4 {
            if &bytes[i..i + 4] == b"edts" {
                bytes[i..i + 4].copy_from_slice(b"free");
                sanitized = true;
            }
        }
    }
    sanitized
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaValidateRequest {
    pub id: String,
    pub media_type: String,
    pub path: Option<String>,
    pub bytes: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaValidateResult {
    pub id: String,
    pub valid: bool,
    pub format: Option<String>,
    pub error: Option<String>,
    pub reason: Option<String>,
    pub channels: Option<u8>,
    pub sample_rate: Option<u32>,
}

pub fn validate_audio_slice(bytes: &[u8]) -> Result<(u8, u32), (String, String)> {
    if bytes.len() < 28 {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "File too small".into()));
    }

    if bytes.len() >= 4 && &bytes[0..4] == b"\x1a\x45\xdf\xa3" {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "WebM format rejected for audio messages".into()));
    }

    if bytes.len() >= 4 && &bytes[0..4] == b"RIFF" {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "WAV format rejected for audio messages".into()));
    }

    if (bytes.len() >= 3 && &bytes[0..3] == b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xff && (bytes[1] & 0xe0) == 0xe0)
    {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "MP3 format rejected for audio messages".into()));
    }

    if bytes.len() < 4 || &bytes[0..4] != b"OggS" {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "Missing OggS signature".into()));
    }

    let header_type = bytes[5];
    if (header_type & 0x02) == 0 {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "First page is not BOS".into()));
    }

    let segment_count = bytes[26] as usize;
    if bytes.len() < 27 + segment_count + 19 {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "Incomplete OpusHead page".into()));
    }

    let head_offset = 27 + segment_count;
    if &bytes[head_offset..head_offset + 8] != b"OpusHead" {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "Missing OpusHead".into()));
    }

    let channels = bytes[head_offset + 9];
    let sample_rate = u32::from_le_bytes([
        bytes[head_offset + 12],
        bytes[head_offset + 13],
        bytes[head_offset + 14],
        bytes[head_offset + 15],
    ]);

    if channels != 1 {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "Audio message must be mono".into()));
    }

    if sample_rate != 48000 {
        return Err(("AUDIO_VALIDATION_FAILED".into(), "Audio message sample rate must be 48000Hz".into()));
    }

    Ok((channels, sample_rate))
}

pub fn validate_video_slice(bytes: &[u8]) -> Result<(), (String, String)> {
    if bytes.len() < 16 {
        return Err(("VIDEO_VALIDATION_FAILED".into(), "File too small".into()));
    }

    if bytes.len() >= 4 && &bytes[0..4] == b"\x1a\x45\xdf\xa3" {
        return Err(("VIDEO_VALIDATION_FAILED".into(), "WebM format rejected for video notes".into()));
    }

    if &bytes[4..8] != b"ftyp" {
        return Err(("VIDEO_VALIDATION_FAILED".into(), "Not an MP4 container".into()));
    }

    for i in 0..=bytes.len().saturating_sub(4) {
        if &bytes[i..i + 4] == b"edts" {
            return Err(("VIDEO_VALIDATION_FAILED".into(), "Video note contains edit list (edts)".into()));
        }
    }

    let mut moov_offset: Option<usize> = None;
    let mut mdat_offset: Option<usize> = None;
    let mut offset = 0;

    while offset + 8 <= bytes.len() {
        let size = u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) as usize;
        let tag = &bytes[offset + 4..offset + 8];
        if tag == b"moov" && moov_offset.is_none() {
            moov_offset = Some(offset);
        }
        if tag == b"mdat" && mdat_offset.is_none() {
            mdat_offset = Some(offset);
        }
        if size == 0 {
            break;
        }
        let actual_size = if size == 1 && offset + 16 <= bytes.len() {
            u64::from_be_bytes([
                bytes[offset + 8], bytes[offset + 9], bytes[offset + 10], bytes[offset + 11],
                bytes[offset + 12], bytes[offset + 13], bytes[offset + 14], bytes[offset + 15],
            ]) as usize
        } else {
            size
        };
        if actual_size < 8 {
            break;
        }
        offset += actual_size;
    }

    let moov = match moov_offset {
        Some(m) => m,
        None => return Err(("VIDEO_VALIDATION_FAILED".into(), "Missing moov box".into())),
    };

    if let Some(mdat) = mdat_offset {
        if moov > mdat {
            return Err(("VIDEO_VALIDATION_FAILED".into(), "moov after mdat (not faststart)".into()));
        }
    }

    let has_video = bytes.windows(4).any(|w| w == b"vide");
    if !has_video {
        return Err(("VIDEO_VALIDATION_FAILED".into(), "Missing video track".into()));
    }

    let has_audio = bytes.windows(4).any(|w| w == b"soun");
    if !has_audio {
        return Err(("VIDEO_VALIDATION_FAILED".into(), "Missing audio track".into()));
    }

    if let Some(tkhd_pos) = bytes.windows(4).position(|w| w == b"tkhd") {
        if tkhd_pos + 88 <= bytes.len() {
            let ver = bytes[tkhd_pos + 4];
            let w_off = tkhd_pos + 4 + if ver == 1 { 84 } else { 76 };
            if w_off + 6 <= bytes.len() {
                let w = u16::from_be_bytes([bytes[w_off], bytes[w_off + 1]]);
                let h = u16::from_be_bytes([bytes[w_off + 4], bytes[w_off + 5]]);
                if w > 0 && h > 0 && w != h {
                    return Err(("VIDEO_VALIDATION_FAILED".into(), "Video note must be square (1:1)".into()));
                }
            }
        }
    }

    Ok(())
}

fn process_single_item(req: MediaValidateRequest) -> MediaValidateResult {
    let data = if let Some(bytes) = req.bytes {
        Some(bytes)
    } else if let Some(path) = req.path {
        let clean = path.strip_prefix("file://").unwrap_or(&path);
        fs::read(clean).ok()
    } else {
        None
    };

    let bytes = match data {
        Some(b) => b,
        None => {
            return MediaValidateResult {
                id: req.id,
                valid: false,
                format: None,
                error: Some("VALIDATION_FAILED".into()),
                reason: Some("Failed to load media bytes".into()),
                channels: None,
                sample_rate: None,
            };
        }
    };

    match req.media_type.as_str() {
        "audio" => match validate_audio_slice(&bytes) {
            Ok((channels, sample_rate)) => MediaValidateResult {
                id: req.id,
                valid: true,
                format: Some("ogg/opus".into()),
                error: None,
                reason: None,
                channels: Some(channels),
                sample_rate: Some(sample_rate),
            },
            Err((error, reason)) => MediaValidateResult {
                id: req.id,
                valid: false,
                format: None,
                error: Some(error),
                reason: Some(reason),
                channels: None,
                sample_rate: None,
            },
        },
        "video" => match validate_video_slice(&bytes) {
            Ok(()) => MediaValidateResult {
                id: req.id,
                valid: true,
                format: Some("mp4".into()),
                error: None,
                reason: None,
                channels: None,
                sample_rate: None,
            },
            Err((error, reason)) => MediaValidateResult {
                id: req.id,
                valid: false,
                format: None,
                error: Some(error),
                reason: Some(reason),
                channels: None,
                sample_rate: None,
            },
        },
        _ => MediaValidateResult {
            id: req.id,
            valid: false,
            format: None,
            error: Some("INVALID_TYPE".into()),
            reason: Some("Unknown media type".into()),
            channels: None,
            sample_rate: None,
        },
    }
}

#[tauri::command]
pub async fn validate_media_batch(items: Vec<MediaValidateRequest>) -> Vec<MediaValidateResult> {
    let tasks: Vec<_> = items
        .into_iter()
        .map(|item| tokio::task::spawn_blocking(move || process_single_item(item)))
        .collect();

    join_all(tasks)
        .await
        .into_iter()
        .filter_map(|res| res.ok())
        .collect()
}

#[tauri::command]
pub async fn sanitize_mp4_edit_list(mut bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        sanitize_mp4_bytes(&mut bytes);
        bytes
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ogg_crc_calculation() {
        let synthetic_data = b"OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00";
        let crc = calculate_ogg_crc_slice(synthetic_data);
        assert_ne!(crc, 0);
    }

    #[test]
    fn test_mp4_edts_sanitization() {
        let mut data = b"moovedtsfree".to_vec();
        let changed = sanitize_mp4_bytes(&mut data);
        assert!(changed);
        assert_eq!(&data[4..8], b"free");
    }

    #[test]
    fn test_audio_validation_rejection() {
        let invalid_riff = b"RIFF\x00\x00\x00\x00WAVE".to_vec();
        let res = validate_audio_slice(&invalid_riff);
        assert!(res.is_err());

        let invalid_webm = b"\x1a\x45\xdf\xa3dummy".to_vec();
        let res2 = validate_audio_slice(&invalid_webm);
        assert!(res2.is_err());
    }

    #[test]
    fn test_video_validation_rejection() {
        let too_short = b"short".to_vec();
        let res = validate_video_slice(&too_short);
        assert!(res.is_err());

        let not_mp4 = b"\x00\x00\x00\x18webmdatahere".to_vec();
        let res2 = validate_video_slice(&not_mp4);
        assert!(res2.is_err());
    }
}
