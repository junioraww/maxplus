use std::io::{Read, Seek, SeekFrom, Write};

const OGG_CRC_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut r = (i as u32) << 24;
        let mut j = 0;
        while j < 8 {
            if (r & 0x80000000) != 0 {
                r = (r << 1) ^ 0x04C11DB7;
            } else {
                r <<= 1;
            }
            j += 1;
        }
        table[i] = r;
        i += 1;
    }
    table
};

pub fn calculate_ogg_crc(data: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &b in data {
        let idx = ((crc >> 24) ^ (b as u32)) & 0xff;
        crc = (crc << 8) ^ OGG_CRC_TABLE[idx as usize];
    }
    crc
}

pub fn build_ogg_page(
    header_type: u8,
    granule_pos: u64,
    serial: u32,
    page_seq: u32,
    packets: &[&[u8]],
) -> Vec<u8> {
    let mut seg_table = Vec::new();
    let mut body = Vec::new();
    for pkt in packets {
        let mut l = pkt.len();
        while l >= 255 {
            seg_table.push(255u8);
            l -= 255;
        }
        seg_table.push(l as u8);
        body.extend_from_slice(pkt);
    }
    let mut header = Vec::with_capacity(27 + seg_table.len());
    header.extend_from_slice(b"OggS");
    header.push(0);
    header.push(header_type);
    header.extend_from_slice(&granule_pos.to_le_bytes());
    header.extend_from_slice(&serial.to_le_bytes());
    header.extend_from_slice(&page_seq.to_le_bytes());
    header.extend_from_slice(&[0u8; 4]);
    header.push(seg_table.len() as u8);
    header.extend_from_slice(&seg_table);

    let mut page = Vec::with_capacity(header.len() + body.len());
    page.extend_from_slice(&header);
    page.extend_from_slice(&body);

    let crc = calculate_ogg_crc(&page);
    let crc_bytes = crc.to_le_bytes();
    page[22..26].copy_from_slice(&crc_bytes);
    page
}

pub fn remux_webm_opus_to_ogg(webm_path: &str, ogg_path: &str) -> Result<(), String> {
    let mut in_file = std::fs::File::open(webm_path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    in_file.read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() < 16 {
        return Err("File too small".into());
    }

    let mut track_num: u8 = 1;
    let tracks_id = [0x16, 0x54, 0xAE, 0x6B];
    if let Some(tpos) = data.windows(4).position(|w| w == tracks_id) {
        if let Some(opus_offset) = data[tpos..].windows(6).position(|w| w == b"A_OPUS") {
            let opus_pos = tpos + opus_offset;
            if let Some(entry_rel) = data[tpos..opus_pos].windows(1).rposition(|w| w == [0xAE]) {
                let entry_pos = tpos + entry_rel;
                if let Some(tn_rel) = data[entry_pos..opus_pos].windows(1).position(|w| w == [0xD7]) {
                    let tn_pos = entry_pos + tn_rel;
                    if tn_pos + 2 < opus_pos {
                        let tn_size = (data[tn_pos + 1] & 0x0F) as usize;
                        if tn_size > 0 && tn_pos + 2 + tn_size <= opus_pos {
                            track_num = data[tn_pos + 1 + tn_size];
                        }
                    }
                }
            }
        }
    }

    let mut audio_packets = Vec::new();
    let mut pos = 0;
    while pos + 4 < data.len() {
        if data[pos] == 0xA3 {
            let sb_pos = pos + 1;
            let first_b = data[sb_pos];
            let (size, sb_data_pos) = if (first_b & 0x80) != 0 {
                ((first_b & 0x7F) as usize, sb_pos + 1)
            } else if (first_b & 0x40) != 0 && sb_pos + 1 < data.len() {
                ((((first_b & 0x3F) as usize) << 8) | (data[sb_pos + 1] as usize), sb_pos + 2)
            } else if (first_b & 0x20) != 0 && sb_pos + 2 < data.len() {
                ((((first_b & 0x1F) as usize) << 16) | ((data[sb_pos + 1] as usize) << 8) | (data[sb_pos + 2] as usize), sb_pos + 3)
            } else {
                pos += 1;
                continue;
            };

            if sb_data_pos + size <= data.len() && size > 4 {
                let t_byte = data[sb_data_pos];
                let t_num = t_byte & 0x0F;
                if t_num == track_num {
                    audio_packets.push(&data[sb_data_pos + 4..sb_data_pos + size]);
                }
            }
            pos = sb_data_pos + size;
        } else {
            pos += 1;
        }
    }

    if audio_packets.is_empty() {
        return Err("No Opus audio packets found in WebM".into());
    }

    let serial: u32 = 0x58414D2B;
    let mut out_file = std::fs::File::create(ogg_path).map_err(|e| e.to_string())?;

    let mut opus_head = Vec::with_capacity(19);
    opus_head.extend_from_slice(b"OpusHead");
    opus_head.push(1);
    opus_head.push(2);
    opus_head.extend_from_slice(&312u16.to_le_bytes());
    opus_head.extend_from_slice(&48000u32.to_le_bytes());
    opus_head.extend_from_slice(&0i16.to_le_bytes());
    opus_head.push(0);

    let page0 = build_ogg_page(0x02, 0, serial, 0, &[&opus_head]);
    out_file.write_all(&page0).map_err(|e| e.to_string())?;

    let mut opus_tags = Vec::with_capacity(20);
    opus_tags.extend_from_slice(b"OpusTags");
    opus_tags.extend_from_slice(&7u32.to_le_bytes());
    opus_tags.extend_from_slice(b"maxplus");
    opus_tags.extend_from_slice(&0u32.to_le_bytes());

    let page1 = build_ogg_page(0x00, 0, serial, 1, &[&opus_tags]);
    out_file.write_all(&page1).map_err(|e| e.to_string())?;

    let mut granule: u64 = 0;
    let mut page_seq: u32 = 2;
    let total_pkts = audio_packets.len();
    for (i, pkt) in audio_packets.iter().enumerate() {
        granule += 960;
        let is_last = i == total_pkts - 1;
        let flag = if is_last { 0x04 } else { 0x00 };
        let page = build_ogg_page(flag, granule, serial, page_seq, &[pkt]);
        out_file.write_all(&page).map_err(|e| e.to_string())?;
        page_seq += 1;
    }

    out_file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_ebml_vint(data: &[u8], pos: usize) -> Option<(usize, usize)> {
    if pos >= data.len() {
        return None;
    }
    let first = data[pos];
    let len = first.leading_zeros() as usize + 1;
    if len > 8 || pos + len > data.len() {
        return None;
    }
    let mask = (1 << (8 - len)) - 1;
    let mut val = (first & mask) as usize;
    for &b in &data[pos + 1..pos + len] {
        val = (val << 8) | (b as usize);
    }
    Some((val, len))
}

pub fn normalize_webm_cluster_timestamps_in_place(path: &str) {
    let mut file = match std::fs::OpenOptions::new().read(true).write(true).open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut data = Vec::new();
    if file.read_to_end(&mut data).is_err() || data.len() < 16 {
        return;
    }
    let cluster_id = [0x1F, 0x43, 0xB6, 0x75];
    let mut clusters = Vec::new();
    let mut i = 0;
    while i + 4 <= data.len() {
        if &data[i..i + 4] == &cluster_id {
            let search_limit = (i + 32).min(data.len());
            for j in (i + 4)..search_limit {
                if data[j] == 0xE7 && j + 1 < data.len() {
                    let size_byte = data[j + 1];
                    let size = (size_byte & 0x0F) as usize;
                    if size > 0 && size <= 8 && j + 2 + size <= data.len() {
                        let mut val: u64 = 0;
                        for b in &data[j + 2..j + 2 + size] {
                            val = (val << 8) | (*b as u64);
                        }
                        clusters.push((j + 2, size, val));
                        break;
                    }
                }
            }
        }
        i += 1;
    }
    if clusters.is_empty() {
        return;
    }
    let mut jump_offset = 0u64;
    let mut jump_index = 0usize;
    for idx in 1..clusters.len() {
        let prev = clusters[idx - 1].2;
        let curr = clusters[idx].2;
        if curr > prev + 60_000 {
            jump_offset = curr.saturating_sub(prev);
            jump_index = idx;
            break;
        }
    }
    if jump_offset > 0 {
        for &(pos, size, val) in &clusters[jump_index..] {
            let new_val = val.saturating_sub(jump_offset);
            let be_bytes = new_val.to_be_bytes();
            let slice = &be_bytes[8 - size..];
            if file.seek(SeekFrom::Start(pos as u64)).is_ok() {
                let _ = file.write_all(slice);
            }
        }
    } else if clusters[0].2 > 5_000 {
        let first_ts = clusters[0].2;
        for &(pos, size, val) in &clusters {
            let new_val = val.saturating_sub(first_ts);
            let be_bytes = new_val.to_be_bytes();
            let slice = &be_bytes[8 - size..];
            if file.seek(SeekFrom::Start(pos as u64)).is_ok() {
                let _ = file.write_all(slice);
            }
        }
    }
}

pub fn patch_ebml_duration_in_place(path: &str, duration_ms: f64) {
    let mut file = match std::fs::OpenOptions::new().read(true).write(true).open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut data = Vec::new();
    if file.read_to_end(&mut data).is_err() || data.len() < 16 {
        return;
    }
    let dur_id = [0x44, 0x89];
    let search_limit = data.len().min(65536);
    if let Some(pos) = data[..search_limit].windows(2).position(|w| w == dur_id) {
        if pos + 3 < data.len() {
            let size_byte = data[pos + 2];
            let len = (size_byte & 0x0F) as usize;
            let offset = pos + 3;
            if offset + len <= data.len() {
                if len == 4 {
                    let val = (duration_ms as f32).to_be_bytes();
                    if file.seek(SeekFrom::Start(offset as u64)).is_ok() {
                        let _ = file.write_all(&val);
                    }
                    return;
                } else if len == 8 {
                    let val = duration_ms.to_be_bytes();
                    if file.seek(SeekFrom::Start(offset as u64)).is_ok() {
                        let _ = file.write_all(&val);
                    }
                    return;
                }
            }
        }
    }

    let info_header = [0x15, 0x49, 0xA9, 0x66];
    if let Some(info_pos) = data.windows(4).position(|w| w == info_header) {
        let search_start = info_pos + 4;
        if let Some((info_payload_size, info_header_size)) = read_ebml_vint(&data, search_start) {
            let payload_start = search_start + info_header_size;
            let payload_end = (payload_start + info_payload_size).min(data.len());
            let mut new_elem = Vec::with_capacity(7);
            new_elem.extend_from_slice(&dur_id);
            new_elem.push(0x84);
            new_elem.extend_from_slice(&(duration_ms as f32).to_be_bytes());

            let mut new_data = Vec::with_capacity(data.len() + 7);
            new_data.extend_from_slice(&data[..payload_end]);
            new_data.extend_from_slice(&new_elem);
            new_data.extend_from_slice(&data[payload_end..]);

            let new_size = info_payload_size + 7;
            if info_header_size == 1 && new_size < 128 {
                new_data[search_start] = (0x80 | new_size) as u8;
            } else if info_header_size == 2 && new_size < 16384 {
                let be = (new_size as u16 | 0x4000).to_be_bytes();
                new_data[search_start..search_start + 2].copy_from_slice(&be);
            } else if info_header_size == 4 {
                let be = (new_size as u32 | 0x10000000).to_be_bytes();
                new_data[search_start..search_start + 4].copy_from_slice(&be);
            } else if info_header_size == 8 {
                let be = (new_size as u64).to_be_bytes();
                new_data[search_start + 1..search_start + 8].copy_from_slice(&be[1..8]);
            }
            drop(file);
            let _ = std::fs::write(path, &new_data);
        }
    }
}

pub fn strip_duplicate_ebml_header_in_place(path: &str) {
    let mut file = match std::fs::OpenOptions::new().read(true).write(true).open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut data = Vec::new();
    if file.read_to_end(&mut data).is_err() || data.len() < 16 {
        return;
    }
    let ebml_id = [0x1A, 0x45, 0xDF, 0xA3];
    if data.starts_with(&ebml_id) {
        if let Some((header_payload_size, vint_len)) = read_ebml_vint(&data, 4) {
            let first_header_len = 4 + vint_len + header_payload_size;
            if first_header_len + 4 <= data.len() && &data[first_header_len..first_header_len + 4] == &ebml_id {
                let stripped = data[first_header_len..].to_vec();
                drop(file);
                let _ = std::fs::write(path, stripped);
            }
        }
    }
}

pub fn normalize_audio_simple_block_timestamps_in_place(path: &str) {
    let mut file = match std::fs::OpenOptions::new().read(true).write(true).open(path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mut data = Vec::new();
    if file.read_to_end(&mut data).is_err() || data.len() < 16 {
        return;
    }

    let mut audio_track: u8 = 2;
    let tracks_id = [0x16, 0x54, 0xAE, 0x6B];
    if let Some(tpos) = data.windows(4).position(|w| w == tracks_id) {
        if let Some(opus_offset) = data[tpos..].windows(6).position(|w| w == b"A_OPUS") {
            let opus_pos = tpos + opus_offset;
            if let Some(entry_rel) = data[tpos..opus_pos].windows(1).rposition(|w| w == [0xAE]) {
                let entry_pos = tpos + entry_rel;
                if let Some(tn_rel) = data[entry_pos..opus_pos].windows(1).position(|w| w == [0xD7]) {
                    let tn_pos = entry_pos + tn_rel;
                    if tn_pos + 2 < opus_pos {
                        let tn_size = (data[tn_pos + 1] & 0x0F) as usize;
                        if tn_size > 0 && tn_pos + 2 + tn_size <= opus_pos {
                            audio_track = data[tn_pos + 1 + tn_size];
                        }
                    }
                }
            }
        }
    }

    let cluster_id = [0x1F, 0x43, 0xB6, 0x75];
    let first_cluster = match data.windows(4).position(|w| w == cluster_id) {
        Some(pos) => pos,
        None => return,
    };

    let mut needs_fix = false;
    let mut audio_seq: i16 = 0;
    let mut p = first_cluster;
    while p + 4 < data.len() {
        if data[p] == 0xA3 {
            let sb_pos = p + 1;
            if let Some((size, vint_len)) = read_ebml_vint(&data, sb_pos) {
                let sb_data_pos = sb_pos + vint_len;
                if sb_data_pos + size <= data.len() && size > 4 {
                    let t_byte = data[sb_data_pos];
                    let t_num = t_byte & 0x0F;
                    if t_num == audio_track {
                        let rel_tc = i16::from_be_bytes([data[sb_data_pos + 1], data[sb_data_pos + 2]]);
                        if audio_seq == 0 && rel_tc > 10_000 {
                            needs_fix = true;
                        }
                        if rel_tc < 0 {
                            needs_fix = true;
                        }
                        audio_seq = audio_seq.saturating_add(1);
                    }
                }
                p = sb_data_pos + size;
                continue;
            }
        }
        p += 1;
    }

    if needs_fix {
        audio_seq = 0;
        p = first_cluster;
        while p + 4 < data.len() {
            if data[p] == 0xA3 {
                let sb_pos = p + 1;
                if let Some((size, vint_len)) = read_ebml_vint(&data, sb_pos) {
                    let sb_data_pos = sb_pos + vint_len;
                    if sb_data_pos + size <= data.len() && size > 4 {
                        let t_byte = data[sb_data_pos];
                        let t_num = t_byte & 0x0F;
                        if t_num == audio_track {
                            let new_tc = audio_seq.saturating_mul(20);
                            let tc_bytes = new_tc.to_be_bytes();
                            data[sb_data_pos + 1] = tc_bytes[0];
                            data[sb_data_pos + 2] = tc_bytes[1];
                            audio_seq = audio_seq.saturating_add(1);
                        }
                    }
                    p = sb_data_pos + size;
                    continue;
                }
            }
            p += 1;
        }
        drop(file);
        let _ = std::fs::write(path, &data);
    }
}

pub fn normalize_webm_and_patch_duration(path: &str, duration_sec: Option<f64>) {
    strip_duplicate_ebml_header_in_place(path);
    normalize_webm_cluster_timestamps_in_place(path);
    normalize_audio_simple_block_timestamps_in_place(path);
    if let Some(dur) = duration_sec {
        if dur > 0.0 {
            patch_ebml_duration_in_place(path, dur * 1000.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ogg_page_crc_validity() {
        let dummy_payload = b"SyntheticTestAudioPayload";
        let page = build_ogg_page(0x02, 0, 0x12345678, 0, &[dummy_payload]);
        assert_eq!(&page[0..4], b"OggS");
        assert_eq!(page[4], 0);
        assert_eq!(page[5], 0x02);
        let stored_crc = u32::from_le_bytes([page[22], page[23], page[24], page[25]]);
        assert_ne!(stored_crc, 0);

        let mut verify_page = page.clone();
        verify_page[22..26].copy_from_slice(&[0u8; 4]);
        let calculated_crc = calculate_ogg_crc(&verify_page);
        assert_eq!(calculated_crc, stored_crc);
    }

    #[test]
    fn test_normalize_webm_cluster_timestamps() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("synth_test_clusters.webm");
        let mut synth_data = Vec::new();
        synth_data.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x00]);
        synth_data.extend_from_slice(&[0x1F, 0x43, 0xB6, 0x75, 0x01, 0x00]);
        synth_data.extend_from_slice(&[0xE7, 0x82, 0x00, 0x64]);
        synth_data.extend_from_slice(&[0x00; 20]);
        synth_data.extend_from_slice(&[0x1F, 0x43, 0xB6, 0x75, 0x01, 0x00]);
        synth_data.extend_from_slice(&[0xE7, 0x84, 0x00, 0xA2, 0x59, 0x93]);
        synth_data.extend_from_slice(&[0x00; 20]);

        std::fs::write(&file_path, &synth_data).unwrap();
        normalize_webm_cluster_timestamps_in_place(file_path.to_str().unwrap());

        let modified = std::fs::read(&file_path).unwrap();
        let _ = std::fs::remove_file(&file_path);

        let c2_pos = modified.windows(4).rposition(|w| w == [0x1F, 0x43, 0xB6, 0x75]).unwrap();
        let tc2_pos = modified[c2_pos..].windows(1).position(|w| w == [0xE7]).unwrap() + c2_pos;
        let c2_val = u32::from_be_bytes([
            modified[tc2_pos + 2],
            modified[tc2_pos + 3],
            modified[tc2_pos + 4],
            modified[tc2_pos + 5],
        ]);
        assert_eq!(c2_val, 100);
    }

    #[test]
    fn test_patch_ebml_duration_in_place() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("synth_test_duration.webm");
        let mut synth_data = Vec::new();
        synth_data.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x00, 0x00, 0x00, 0x00]);
        synth_data.extend_from_slice(&[0x15, 0x49, 0xA9, 0x66, 0x8A]);
        synth_data.extend_from_slice(&[0x2A, 0xD7, 0xB1, 0x83, 0x0F, 0x42, 0x40]);
        synth_data.extend_from_slice(&[0x4D, 0x80, 0x83, 0x66, 0x6F, 0x6F]);

        std::fs::write(&file_path, &synth_data).unwrap();
        patch_ebml_duration_in_place(file_path.to_str().unwrap(), 12500.0);

        let modified = std::fs::read(&file_path).unwrap();
        let _ = std::fs::remove_file(&file_path);

        let dur_pos = modified.windows(2).position(|w| w == [0x44, 0x89]).unwrap();
        assert_eq!(modified[dur_pos + 2], 0x84);
        let val_bytes = [
            modified[dur_pos + 3],
            modified[dur_pos + 4],
            modified[dur_pos + 5],
            modified[dur_pos + 6],
        ];
        let val = f32::from_be_bytes(val_bytes);
        assert!((val - 12500.0).abs() < 0.001);
    }

    #[test]
    fn test_remux_webm_opus_to_ogg_synthetic() {
        let temp_dir = std::env::temp_dir();
        let webm_path = temp_dir.join("synth_input.webm");
        let ogg_path = temp_dir.join("synth_output.ogg");

        let mut synth_webm = Vec::new();
        synth_webm.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x00, 0x00, 0x00, 0x00]);
        synth_webm.extend_from_slice(&[0x16, 0x54, 0xAE, 0x6B, 0x8C]);
        synth_webm.extend_from_slice(&[0xAE, 0x8A]);
        synth_webm.extend_from_slice(&[0xD7, 0x81, 0x01]);
        synth_webm.extend_from_slice(&[0x86, 0x86]);
        synth_webm.extend_from_slice(b"A_OPUS");

        let synth_opus_frame = vec![0xF8, 0xFF, 0xFE, 0x00, 0x01, 0x02];
        let sb_size = (1 + 2 + 1 + synth_opus_frame.len()) as u8;
        synth_webm.extend_from_slice(&[0xA3, 0x80 | sb_size]);
        synth_webm.extend_from_slice(&[0x81]);
        synth_webm.extend_from_slice(&[0x00, 0x00]);
        synth_webm.extend_from_slice(&[0x80]);
        synth_webm.extend_from_slice(&synth_opus_frame);

        std::fs::write(&webm_path, &synth_webm).unwrap();
        let res = remux_webm_opus_to_ogg(webm_path.to_str().unwrap(), ogg_path.to_str().unwrap());
        assert!(res.is_ok());

        let ogg_data = std::fs::read(&ogg_path).unwrap();
        let _ = std::fs::remove_file(&webm_path);
        let _ = std::fs::remove_file(&ogg_path);

        assert_eq!(&ogg_data[0..4], b"OggS");
        assert!(ogg_data.windows(8).any(|w| w == b"OpusHead"));
        assert!(ogg_data.windows(8).any(|w| w == b"OpusTags"));
    }

    #[test]
    fn test_strip_duplicate_ebml_header() {
        let temp_dir = std::env::temp_dir();
        let p = temp_dir.join("synth_dup_ebml.webm");
        let mut synth = Vec::new();
        synth.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x82, 0x42, 0x82]);
        synth.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x00, 0x00, 0x00, 0x00]);
        synth.extend_from_slice(&[0x18, 0x53, 0x80, 0x67, 0x80]);

        std::fs::write(&p, &synth).unwrap();
        strip_duplicate_ebml_header_in_place(p.to_str().unwrap());

        let res = std::fs::read(&p).unwrap();
        let _ = std::fs::remove_file(&p);

        assert_eq!(res.len(), 14);
        assert_eq!(&res[0..4], &[0x1A, 0x45, 0xDF, 0xA3]);
        assert_eq!(&res[9..13], &[0x18, 0x53, 0x80, 0x67]);
    }

    #[test]
    fn test_normalize_audio_timestamps() {
        let temp_dir = std::env::temp_dir();
        let p = temp_dir.join("synth_audio_ts.webm");
        let mut synth = Vec::new();
        synth.extend_from_slice(&[0x1A, 0x45, 0xDF, 0xA3, 0x84, 0x00, 0x00, 0x00, 0x00]);
        synth.extend_from_slice(&[0x16, 0x54, 0xAE, 0x6B, 0x8C]);
        synth.extend_from_slice(&[0xAE, 0x8A]);
        synth.extend_from_slice(&[0xD7, 0x81, 0x02]);
        synth.extend_from_slice(&[0x86, 0x86]);
        synth.extend_from_slice(b"A_OPUS");
        synth.extend_from_slice(&[0x1F, 0x43, 0xB6, 0x75, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

        let p1 = vec![0x00; 4];
        let sb_size = (1 + 2 + 1 + p1.len()) as u8;
        synth.extend_from_slice(&[0xA3, 0x80 | sb_size]);
        synth.extend_from_slice(&[0x82]);
        synth.extend_from_slice(&[0x7B, 0x1B]);
        synth.extend_from_slice(&[0x80]);
        synth.extend_from_slice(&p1);

        std::fs::write(&p, &synth).unwrap();
        normalize_audio_simple_block_timestamps_in_place(p.to_str().unwrap());

        let res = std::fs::read(&p).unwrap();
        let _ = std::fs::remove_file(&p);

        let sb_idx = res.windows(1).position(|w| w == [0xA3]).unwrap();
        assert_eq!(res[sb_idx + 3], 0x00);
        assert_eq!(res[sb_idx + 4], 0x00);
    }
}
