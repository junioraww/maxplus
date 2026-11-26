use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const RU_CHARS: [char; 64] = [
    'а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'й', 'к', 'л', 'м', 'н', 'о', 'п',
    'р', 'с', 'т', 'у', 'ф', 'х', 'ц', 'ч', 'ш', 'щ', 'ъ', 'ы', 'ь', 'э', 'ю', 'я',
    'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П',
    'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
];

#[inline]
fn ru_char_index(c: char) -> Option<usize> {
    let cp = c as u32;
    if (0x0430..=0x044F).contains(&cp) {
        Some((cp - 0x0430) as usize)
    } else if (0x0410..=0x042F).contains(&cp) {
        Some((cp - 0x0410 + 32) as usize)
    } else {
        None
    }
}

#[inline]
fn keystream_block(seed: &[u8; 4], block_idx: u32) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"ru-obf-ws-v1");
    hasher.update(seed);
    hasher.update(block_idx.to_le_bytes());
    let digest = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

pub struct RussianObfuscator;

impl RussianObfuscator {
    pub fn detect(text: &str) -> bool {
        let mut count = 0usize;
        for c in text.chars() {
            if c == ' ' {
                continue;
            }
            let Some(idx) = ru_char_index(c) else {
                return false;
            };
            if count < 4 && (idx & 1) != 0 {
                return false;
            }
            count += 1;
        }
        count >= 6
    }

    pub fn obfuscate(bytes: &[u8]) -> String {
        let mut rng = rand::thread_rng();
        let total_chars = 4 + (bytes.len() * 8 + 5) / 6;
        let mut raw_letters = Vec::with_capacity(total_chars);

        let mut seed = [0u8; 4];
        for s in &mut seed {
            let idx = rng.gen_range(0..32) * 2;
            *s = idx as u8;
            raw_letters.push(RU_CHARS[idx]);
        }

        let mut bit_buffer: u32 = 0;
        let mut bit_count = 0;
        let mut ks_block = [0u8; 32];

        for (i, &b) in bytes.iter().enumerate() {
            let pos_in_block = i & 31;
            if pos_in_block == 0 {
                ks_block = keystream_block(&seed, (i >> 5) as u32);
            }
            let wb = b ^ ks_block[pos_in_block];
            bit_buffer = (bit_buffer << 8) | (wb as u32);
            bit_count += 8;
            while bit_count >= 6 {
                bit_count -= 6;
                let idx = ((bit_buffer >> bit_count) & 0x3F) as usize;
                raw_letters.push(RU_CHARS[idx]);
                bit_buffer &= (1 << bit_count) - 1;
            }
        }

        if bit_count > 0 {
            let idx = ((bit_buffer << (6 - bit_count)) & 0x3F) as usize;
            raw_letters.push(RU_CHARS[idx]);
        }

        let mut out = String::with_capacity(raw_letters.len() * 2 + raw_letters.len() / 4);
        let mut pos = 0;
        while pos < raw_letters.len() {
            if pos > 0 {
                out.push(' ');
            }
            let word_len = rng.gen_range(3..=8).min(raw_letters.len() - pos);
            for &ch in &raw_letters[pos..pos + word_len] {
                out.push(ch);
            }
            pos += word_len;
        }
        out
    }

    pub fn deobfuscate(text: &str) -> Result<Vec<u8>, String> {
        let mut seed = [0u8; 4];
        let mut seed_len = 0usize;
        let mut bit_buffer: u32 = 0;
        let mut bit_count = 0;
        let mut raw_bytes = Vec::with_capacity(text.len() / 2);
        let mut ks_block = [0u8; 32];

        for c in text.chars() {
            if c == ' ' {
                continue;
            }
            let idx = ru_char_index(c).ok_or("Invalid character in Russian obfuscated text")?;
            if seed_len < 4 {
                seed[seed_len] = idx as u8;
                seed_len += 1;
                continue;
            }
            bit_buffer = (bit_buffer << 6) | (idx as u32);
            bit_count += 6;
            if bit_count >= 8 {
                bit_count -= 8;
                let wb = ((bit_buffer >> bit_count) & 0xFF) as u8;
                bit_buffer &= (1 << bit_count) - 1;
                let byte_idx = raw_bytes.len();
                let pos_in_block = byte_idx & 31;
                if pos_in_block == 0 {
                    ks_block = keystream_block(&seed, (byte_idx >> 5) as u32);
                }
                raw_bytes.push(wb ^ ks_block[pos_in_block]);
            }
        }

        if seed_len < 4 || raw_bytes.is_empty() {
            return Err("Text too short for Russian deobfuscation".into());
        }

        Ok(raw_bytes)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DictionaryData {
    pub dict_sha256: String,
    pub punct: Vec<(String, u32)>,
    pub dict8: Vec<String>,
    pub dict16: Vec<String>,
    #[serde(skip)]
    pub dict8_map: HashMap<String, usize>,
    #[serde(skip)]
    pub dict16_map: HashMap<String, usize>,
}

impl DictionaryData {
    pub fn init_maps(&mut self) {
        if self.dict8_map.is_empty() {
            self.dict8_map = self.dict8.iter().enumerate().map(|(i, w)| (w.clone(), i)).collect();
        }
        if self.dict16_map.is_empty() {
            self.dict16_map = self.dict16.iter().enumerate().map(|(i, w)| (w.clone(), i)).collect();
        }
    }
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

        let mut dict_data = DictionaryData {
            dict_sha256,
            punct,
            dict8,
            dict16,
            dict8_map: HashMap::new(),
            dict16_map: HashMap::new(),
        };
        dict_data.init_maps();
        Ok(dict_data)
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

        let first_idx = match dict.dict8_map.get(clean_first.as_str()) {
            Some(&idx) => idx,
            None => return false,
        };

        let second_idx = match dict.dict8_map.get(clean_second.as_str()) {
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

        let first = clean_word(tokens[0]);
        let prefix_0 = dict
            .dict8_map
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

            if let Some(&idx16) = dict.dict16_map.get(cleaned.as_str()) {
                let real_idx = (idx16 + len16 - (seed % len16)) % len16;
                bytes.push(((real_idx >> 8) & 0xFF) as u8);
                bytes.push((real_idx & 0xFF) as u8);
                continue;
            }

            if let Some(&idx8) = dict.dict8_map.get(cleaned.as_str()) {
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
    fn test_russian_roundtrip_various_lengths() {
        for len in [1, 2, 3, 5, 7, 10, 11, 16, 22, 33, 64, 128] {
            let original: Vec<u8> = (0..len).map(|i| (i * 17) as u8).collect();
            let obfuscated = RussianObfuscator::obfuscate(&original);
            assert!(RussianObfuscator::detect(&obfuscated));

            let deobfuscated = RussianObfuscator::deobfuscate(&obfuscated).unwrap();
            assert_eq!(deobfuscated, original, "Failed for length {}", len);
        }
    }

    #[test]
    fn test_russian_detect_rejects_plain_text() {
        assert!(!RussianObfuscator::detect("Hello world"));
        assert!(!RussianObfuscator::detect("Привет мир, как дела?"));
        assert!(!RussianObfuscator::detect(""));
    }
}
