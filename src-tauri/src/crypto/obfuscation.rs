use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const ZH_BASE: u32 = 0x4E00;
const ZH_COUNT: usize = 2048;

pub struct ChineseObfuscator;

impl ChineseObfuscator {
    pub fn detect(text: &str) -> bool {
        let chars: Vec<char> = text.chars().take(5).collect();
        if chars.len() < 5 {
            return false;
        }

        for c in chars {
            let cp = c as u32;
            if cp < ZH_BASE || cp >= ZH_BASE + ZH_COUNT as u32 {
                return false;
            }
            let idx = cp - ZH_BASE;
            if (idx & 1) != 0 {
                return false;
            }
        }

        true
    }

    pub fn obfuscate(bytes: &[u8]) -> String {
        let mut rng = rand::thread_rng();
        let mut marker = String::with_capacity(5);
        let max_even = (ZH_COUNT - 1) / 2;
        for _ in 0..5 {
            let r = rng.gen_range(0..=max_even);
            let idx = (r * 2) as u32;
            if let Some(ch) = char::from_u32(ZH_BASE + idx) {
                marker.push(ch);
            }
        }

        let len = bytes.len() as u16;
        let mut payload_bytes = Vec::with_capacity(2 + bytes.len());
        payload_bytes.extend_from_slice(&len.to_be_bytes());
        payload_bytes.extend_from_slice(bytes);

        let bits_per = 11;
        let mut bit_buffer: u64 = 0;
        let mut bit_count = 0;
        let mut out = marker;

        for &b in &payload_bytes {
            bit_buffer = (bit_buffer << 8) | (b as u64);
            bit_count += 8;
            while bit_count >= bits_per {
                bit_count -= bits_per;
                let idx = ((bit_buffer >> bit_count) & ((1 << bits_per) - 1)) as u32;
                if let Some(ch) = char::from_u32(ZH_BASE + idx) {
                    out.push(ch);
                }
                bit_buffer &= (1 << bit_count) - 1;
            }
        }

        if bit_count > 0 {
            let idx = ((bit_buffer << (bits_per - bit_count)) & ((1 << bits_per) - 1)) as u32;
            if let Some(ch) = char::from_u32(ZH_BASE + idx) {
                out.push(ch);
            }
        }

        out
    }

    pub fn deobfuscate(text: &str) -> Result<Vec<u8>, String> {
        let chars: Vec<char> = text.chars().collect();
        if chars.len() < 5 {
            return Err("Text too short for Chinese deobfuscation".into());
        }

        let payload_chars = &chars[5..];
        let bits_per = 11;
        let mut bit_buffer: u64 = 0;
        let mut bit_count = 0;
        let mut raw_bytes = Vec::new();

        for &ch in payload_chars {
            let cp = ch as u32;
            if cp < ZH_BASE || cp >= ZH_BASE + ZH_COUNT as u32 {
                continue;
            }
            let idx = cp - ZH_BASE;
            bit_buffer = (bit_buffer << bits_per) | (idx as u64);
            bit_count += bits_per;
            while bit_count >= 8 {
                bit_count -= 8;
                let byte = ((bit_buffer >> bit_count) & 0xFF) as u8;
                raw_bytes.push(byte);
                bit_buffer &= (1 << bit_count) - 1;
            }
        }

        if raw_bytes.len() < 2 {
            return Err("Payload too short".into());
        }

        let expected_len = u16::from_be_bytes([raw_bytes[0], raw_bytes[1]]) as usize;
        let content = &raw_bytes[2..];
        if content.len() < expected_len {
            return Err("Corrupted payload length".into());
        }

        Ok(content[..expected_len].to_vec())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DictionaryData {
    pub dict_sha256: String,
    pub punct: Vec<(String, u32)>,
    pub dict8: Vec<String>,
    pub dict16: Vec<String>,
}

pub struct WordsObfuscator;

impl WordsObfuscator {
    pub fn build_dictionary(text: &str) -> Result<DictionaryData, String> {
        let mut punct_count: HashMap<char, u32> = HashMap::new();
        let punctuation = ['.', ',', '?', '!', '—', ':'];
        for c in text.chars() {
            if punctuation.contains(&c) {
                *punct_count.entry(c).or_insert(0) += 1;
            }
        }

        let re = regex::Regex::new(r"[А-Яа-яЁё]+").map_err(|e| e.to_string())?;
        let mut normalized: Vec<String> = re
            .find_iter(text)
            .map(|m| m.as_str().to_lowercase())
            .collect();
        normalized.sort();

        let mut unique = Vec::new();
        let mut seen = HashSet::new();
        for w in normalized {
            if seen.insert(w.clone()) {
                unique.push(w);
            }
        }

        let min_size = 65536 + 256;
        if unique.len() < min_size {
            return Err(format!(
                "Not enough unique words: have {}, need {}",
                unique.len(),
                min_size
            ));
        }

        let mut dict8 = Vec::with_capacity(256);
        let mut dict16 = Vec::with_capacity(65536);

        for (i, word) in unique.into_iter().enumerate() {
            if i % 257 == 0 && dict8.len() < 256 {
                dict8.push(word);
            } else if dict16.len() < 65536 {
                dict16.push(word);
            }
        }

        if dict8.len() < 256 || dict16.len() < 65536 {
            return Err("Failed to construct complete dictionary tables".into());
        }

        let dict_concat = format!("{} {}", dict8.join(" "), dict16.join(" "));
        let mut hasher = Sha256::new();
        hasher.update(dict_concat.as_bytes());
        let dict_sha256 = hex::encode(hasher.finalize());

        let words_gross = text.split_whitespace().count().max(1) as u32;
        let mut punct = Vec::new();
        for &p in &punctuation {
            let count = punct_count.get(&p).copied().unwrap_or(0);
            let prob = (count * 10000) / words_gross;
            punct.push((p.to_string(), prob));
        }

        Ok(DictionaryData {
            dict_sha256,
            punct,
            dict8,
            dict16,
        })
    }

    pub fn detect(text: &str, dict: &DictionaryData) -> bool {
        if text.contains('\n') || !text.contains(' ') {
            return false;
        }

        let words: Vec<&str> = text.split_whitespace().collect();
        if words.len() < 2 {
            return false;
        }

        let clean_first = clean_word(words[0]);
        let clean_second = clean_word(words[1]);

        let dict8_map: HashMap<&str, usize> = dict
            .dict8
            .iter()
            .enumerate()
            .map(|(i, w)| (w.as_str(), i))
            .collect();

        let first_idx = match dict8_map.get(clean_first.as_str()) {
            Some(&idx) => idx,
            None => return false,
        };

        let second_idx = match dict8_map.get(clean_second.as_str()) {
            Some(&idx) => idx,
            None => return false,
        };

        let mini_hash = match u8::from_str_radix(&dict.dict_sha256[..1], 16) {
            Ok(h) => (h & 0x0F) as usize,
            Err(_) => return false,
        };

        let expected_hash = first_idx & 0x0F;
        if expected_hash != mini_hash {
            return false;
        }

        let seed = (first_idx >> 4) & 0x0F;
        let expected_second = ((seed ^ mini_hash ^ 0x5A) & 0xFF) % dict.dict8.len();

        second_idx == expected_second
    }

    pub fn obfuscate(bytes: &[u8], dict: &DictionaryData) -> Result<String, String> {
        let mut rng = rand::thread_rng();
        let seed = rng.gen_range(0..16) as usize;
        let mini_hash = u8::from_str_radix(&dict.dict_sha256[..1], 16).map_err(|e| e.to_string())? as usize & 0x0F;

        let prefix_0 = (seed << 4) | mini_hash;
        let first_word = &dict.dict8[prefix_0 % dict.dict8.len()];

        let prefix_1 = ((seed ^ mini_hash ^ 0x5A) & 0xFF) % dict.dict8.len();
        let second_word = &dict.dict8[prefix_1];

        let mut out = Vec::new();
        out.push(capitalize(first_word));
        out.push(capitalize(second_word));

        let len16 = dict.dict16.len();
        let len8 = dict.dict8.len();

        let mut i = 0;
        let mut sentence_start = false;

        let mut punct_ranges = Vec::new();
        let mut cumulative = 0;
        for (char_str, prob) in &dict.punct {
            let start = cumulative;
            cumulative += prob;
            if let Some(ch) = char_str.chars().next() {
                punct_ranges.push((start, cumulative.saturating_sub(1), ch));
            }
        }

        while i < bytes.len() {
            let mut word = if i + 1 < bytes.len() {
                let idx = ((bytes[i] as usize) << 8) | (bytes[i + 1] as usize);
                i += 2;
                dict.dict16[(idx + seed) % len16].clone()
            } else {
                let idx = bytes[i] as usize;
                i += 1;
                dict.dict8[(idx + seed) % len8].clone()
            };

            if sentence_start {
                word = capitalize(&word);
                sentence_start = false;
            }

            out.push(word);

            let roll: u32 = rng.gen_range(0..10000);
            for &(start, end, ch) in &punct_ranges {
                if roll >= start && roll <= end {
                    if ch == '—' {
                        out.push("—".to_string());
                    } else {
                        if let Some(last) = out.last_mut() {
                            last.push(ch);
                        }
                        if ch == '.' || ch == '!' || ch == '?' {
                            sentence_start = true;
                        }
                    }
                    break;
                }
            }
        }

        let mut text = out.join(" ");
        if !text.ends_with('.') && !text.ends_with('!') && !text.ends_with('?') {
            text.push('.');
        }

        Ok(text)
    }

    pub fn deobfuscate(text: &str, dict: &DictionaryData) -> Result<Vec<u8>, String> {
        let tokens: Vec<&str> = text.split_whitespace().collect();
        if tokens.len() < 2 {
            return Err("Too few tokens for word deobfuscation".into());
        }

        let dict8_map: HashMap<&str, usize> = dict
            .dict8
            .iter()
            .enumerate()
            .map(|(i, w)| (w.as_str(), i))
            .collect();
        let dict16_map: HashMap<&str, usize> = dict
            .dict16
            .iter()
            .enumerate()
            .map(|(i, w)| (w.as_str(), i))
            .collect();

        let first = clean_word(tokens[0]);
        let prefix_0 = dict8_map
            .get(first.as_str())
            .copied()
            .ok_or_else(|| format!("Unknown prefix word: {first}"))?;
        let seed = (prefix_0 >> 4) & 0x0F;

        let len16 = dict.dict16.len();
        let len8 = dict.dict8.len();

        let mut bytes = Vec::new();

        for &tok in &tokens[2..] {
            let cleaned = clean_word(tok);
            if cleaned.is_empty() || cleaned == "—" {
                continue;
            }

            if let Some(&idx16) = dict16_map.get(cleaned.as_str()) {
                let real_idx = (idx16 + len16 - (seed % len16)) % len16;
                bytes.push(((real_idx >> 8) & 0xFF) as u8);
                bytes.push((real_idx & 0xFF) as u8);
                continue;
            }

            if let Some(&idx8) = dict8_map.get(cleaned.as_str()) {
                let real_idx = (idx8 + len8 - (seed % len8)) % len8;
                bytes.push(real_idx as u8);
                continue;
            }

            return Err(format!("Word not found in dictionary: {cleaned}"));
        }

        Ok(bytes)
    }
}

fn clean_word(s: &str) -> String {
    s.chars()
        .filter(|&c| c != '.' && c != ',' && c != '?' && c != '!' && c != ':' && c != '—' && c != '-')
        .collect::<String>()
        .to_lowercase()
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chinese_roundtrip_various_lengths() {
        for len in [1, 2, 3, 5, 7, 10, 11, 16, 22, 33, 64, 128] {
            let original: Vec<u8> = (0..len).map(|i| (i * 17) as u8).collect();
            let obfuscated = ChineseObfuscator::obfuscate(&original);
            assert!(ChineseObfuscator::detect(&obfuscated));

            let deobfuscated = ChineseObfuscator::deobfuscate(&obfuscated).unwrap();
            assert_eq!(deobfuscated, original, "Failed for length {}", len);
        }
    }

    #[test]
    fn test_chinese_detect_rejects_plain_text() {
        assert!(!ChineseObfuscator::detect("Hello world"));
        assert!(!ChineseObfuscator::detect("Привет мир"));
        assert!(!ChineseObfuscator::detect(""));
    }
}
