use sha2::{Digest, Sha256};

pub const EMOJI_TABLE: [&str; 256] = [
    "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
    "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
    "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺",
    "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞",
    "🐜", "🦟", "🐢", "🐍", "🦎", "🐙", "🦑", "🦐",
    "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "鲨",
    "🐊", "🐅", "🐆", "🦓", "🦍", "🐘", "🦛", "🦏",
    "🐪", "🐫", "🦒", "🦘", "🐃", "🐂", "🐄", "🐎",
    "🐖", "🐏", "🐑", "🐐", "🦌", "🐕", "🐩", "🐈",
    "🐓", "🦃", "🦚", "🦜", "🦢", "🦩", "🕊", "🐇",
    "🦝", "🦨", "🦡", "🦦", "🦥", "🐁", "🐀", "🐿",
    "🦔", "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉",
    "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍",
    "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒",
    "🌶", "🌽", "🥕", "🧄", "🧅", "🥔", "🍠", "🥐",
    "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈",
    "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔",
    "🍟", "🍕", "🥪", "🥙", "🧆", "🌮", "🌯", "🥗",
    "🥘", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟",
    "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🍢",
    "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂",
    "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰",
    "🥜", "🍯", "🥛", "☕", "🍵", "🧃", "🥤", "🧊",
    "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉",
    "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🥍", "🏏",
    "🥊", "🥋", "🥅", "⛳", "🏹", "🎣", "🤿", "🎽",
    "🛹", "🛼", "🛷", "⛸", "🎯", "🪄", "🪅", "🎮",
    "🚀", "🛸", "🚁", "⛵", "🛶", "🚤", "⚓", "⚡",
    "🌙", "⭐", "🌟", "✨", "💥", "🔥", "🌈", "☀️",
    "💎", "🔔", "🔑", "🗝", "🎸", "🎷", "🎺", "🎻",
    "🥁", "🎹", "🎙", "📻", "🎨", "🎭", "🎬", "🎪",
    "🧭", "⏰", "⏱", "⌛", "💡", "🔦", "🕯", "🪔",
];

pub fn generate_fingerprint(shared_secret: &[u8; 32]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(shared_secret);
    let hash = hasher.finalize();

    format!(
        "{} {} {} {}",
        EMOJI_TABLE[hash[0] as usize],
        EMOJI_TABLE[hash[1] as usize],
        EMOJI_TABLE[hash[2] as usize],
        EMOJI_TABLE[hash[3] as usize]
    )
}

pub fn derive_call_fingerprint(dh_secret_hex: Option<&str>, password: Option<&str>) -> Option<String> {
    let mut hasher = Sha256::new();
    let dh_bytes = dh_secret_hex.and_then(|h| hex::decode(h).ok());
    let clean_pwd = password.filter(|p| !p.trim().is_empty());

    match (dh_bytes, clean_pwd) {
        (Some(dh), Some(pwd)) => {
            hasher.update(&dh);
            hasher.update(b":");
            hasher.update(pwd.as_bytes());
            let hash: [u8; 32] = hasher.finalize().into();
            Some(generate_fingerprint(&hash))
        }
        (Some(dh), None) => {
            if dh.len() == 32 {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&dh);
                Some(generate_fingerprint(&arr))
            } else {
                hasher.update(&dh);
                let hash: [u8; 32] = hasher.finalize().into();
                Some(generate_fingerprint(&hash))
            }
        }
        (None, Some(pwd)) => {
            hasher.update(pwd.as_bytes());
            let hash: [u8; 32] = hasher.finalize().into();
            Some(generate_fingerprint(&hash))
        }
        (None, None) => None,
    }
}

