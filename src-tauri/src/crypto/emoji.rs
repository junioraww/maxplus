use aws_lc_rs::digest::{digest, SHA3_256};

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
    let hash_val = digest(&SHA3_256, shared_secret);
    let hash = hash_val.as_ref();

    format!(
        "{} {} {} {}",
        EMOJI_TABLE[hash[0] as usize],
        EMOJI_TABLE[hash[1] as usize],
        EMOJI_TABLE[hash[2] as usize],
        EMOJI_TABLE[hash[3] as usize]
    )
}

pub fn derive_call_fingerprint(dh_secret_hex: Option<&str>, password: Option<&str>) -> Option<String> {
    let dh_bytes = dh_secret_hex.and_then(|h| hex::decode(h).ok());
    let clean_pwd = password.filter(|p| !p.trim().is_empty());

    match (dh_bytes, clean_pwd) {
        (Some(dh), Some(pwd)) => {
            let mut input = Vec::with_capacity(dh.len() + 1 + pwd.len());
            input.extend_from_slice(&dh);
            input.push(b':');
            input.extend_from_slice(pwd.as_bytes());
            let d = digest(&SHA3_256, &input);
            let mut arr = [0u8; 32];
            arr.copy_from_slice(d.as_ref());
            Some(generate_fingerprint(&arr))
        }
        (Some(dh), None) => {
            if dh.len() == 32 {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&dh);
                Some(generate_fingerprint(&arr))
            } else {
                let d = digest(&SHA3_256, &dh);
                let mut arr = [0u8; 32];
                arr.copy_from_slice(d.as_ref());
                Some(generate_fingerprint(&arr))
            }
        }
        (None, Some(pwd)) => {
            let d = digest(&SHA3_256, pwd.as_bytes());
            let mut arr = [0u8; 32];
            arr.copy_from_slice(d.as_ref());
            Some(generate_fingerprint(&arr))
        }
        (None, None) => None,
    }
}

