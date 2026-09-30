use tauri::{AppHandle, Emitter, Manager};
use crate::AppState;
use serde_json::Value;
use argon2::{Argon2, Algorithm, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use rand::RngCore;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, LazyLock, Mutex, RwLock,
    },
    time::Duration,
};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305,
    Key,
    Nonce,
};

static DERIVE_KEY_CACHE: LazyLock<RwLock<HashMap<(String, String), [u8; 32]>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static PENDING_WRITES: LazyLock<Mutex<HashMap<PathBuf, (Value, Option<[u8; 32]>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static SCHEDULED_PATHS: LazyLock<Mutex<HashSet<PathBuf>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn save_coalesced(path: PathBuf, value: Value, key: Option<[u8; 32]>, delay: Duration) {
    {
        let mut pending = PENDING_WRITES.lock().unwrap();
        pending.insert(path.clone(), (value, key));
    }

    let should_spawn = {
        let mut scheduled = SCHEDULED_PATHS.lock().unwrap();
        scheduled.insert(path.clone())
    };

    if should_spawn {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(delay).await;

                let item = {
                    let mut pending = PENDING_WRITES.lock().unwrap();
                    pending.remove(&path)
                };

                if let Some((val, k)) = item {
                    let path_clone = path.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        Storage::new(k).save_direct(&path_clone, &val)
                    })
                    .await;
                }

                let done = {
                    let pending = PENDING_WRITES.lock().unwrap();
                    if pending.contains_key(&path) {
                        false
                    } else {
                        let mut scheduled = SCHEDULED_PATHS.lock().unwrap();
                        scheduled.remove(&path);
                        true
                    }
                };

                if done {
                    break;
                }
            }
        });
    }
}

pub struct Storage {
    key: Option<[u8; 32]>,
}

impl Storage {
    pub fn new(key: Option<[u8; 32]>) -> Self {
        Self { key }
    }

    pub fn encrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        let cipher = ChaCha20Poly1305::new(&Key::from(*key));
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from(nonce_bytes);

        let encrypted = cipher.encrypt(&nonce, data).map_err(|e| e.to_string())?;
        let mut result = Vec::with_capacity(15 + encrypted.len());
        result.extend_from_slice(b"ENC");
        result.extend_from_slice(&nonce_bytes);
        result.extend_from_slice(&encrypted);

        Ok(result)
    }

    pub fn decrypt(data: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
        if !data.starts_with(b"ENC") {
            return Ok(data.to_vec());
        }

        if data.len() < 15 {
            return Err("Encrypted data too short".into());
        }

        let cipher = ChaCha20Poly1305::new(&Key::from(*key));
        let nonce = Nonce::try_from(&data[3..15]).map_err(|e| e.to_string())?;
        let encrypted = &data[15..];

        cipher.decrypt(&nonce, encrypted).map_err(|e| e.to_string())
    }

    pub fn load(&self, path: impl AsRef<Path>) -> Option<Value> {
        let path_ref = path.as_ref();
        if let Ok(guard) = PENDING_WRITES.lock() {
            if let Some((val, _)) = guard.get(path_ref) {
                return Some(val.clone());
            }
        }

        let bytes = fs::read(path_ref).ok()?;

        let bytes = if bytes.starts_with(b"ENC") {
            let key = self.key?;
            Self::decrypt(&bytes, &key).ok()?
        } else {
            bytes
        };

        rmp_serde::from_slice(&bytes).ok()
    }

    pub fn save_direct(&self, path: impl AsRef<Path>, value: &Value) -> Result<(), String> {
        let path = path.as_ref();
        if let Ok(mut guard) = PENDING_WRITES.lock() {
            guard.remove(path);
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut bytes = rmp_serde::to_vec(value).map_err(|e| e.to_string())?;

        if let Some(key) = &self.key {
            bytes = Self::encrypt(&bytes, key)?;
        }

        fs::write(path, bytes).map_err(|e| e.to_string())
    }

    pub fn save(&self, path: impl AsRef<Path>, value: &Value) -> Result<(), String> {
        self.save_direct(path, value)
    }

    pub fn save_coalesced(&self, path: impl AsRef<Path>, value: &Value) {
        save_coalesced(
            path.as_ref().to_path_buf(),
            value.clone(),
            self.key,
            Duration::from_millis(150),
        );
    }

    pub fn list(dir: impl AsRef<Path>) -> Vec<PathBuf> {
        let mut result = fs::read_dir(dir)
            .ok()
            .into_iter()
            .flat_map(|x| x.flatten())
            .map(|x| x.path())
            .collect::<Vec<_>>();
        result.sort();
        result
    }
}

pub fn crypto_key(app: &AppHandle, account: u64) -> Option<[u8; 32]> {
    app.state::<AppState>()
        .crypto
        .read()
        .unwrap()
        .as_ref()
        .filter(|x| x.account == account)
        .map(|x| x.key)
}

pub struct Paths {
    pub root: PathBuf,
    pub cache: PathBuf,
}

impl Paths {
    pub fn new(app: &AppHandle, account: u64) -> Self {
        Self {
            root: app.path().app_data_dir().unwrap().join("data").join(account.to_string()),
            cache: app.path().app_data_dir().unwrap().join("cache").join(account.to_string()),
        }
    }

    pub fn contacts(&self) -> PathBuf {
        self.root.join("contacts")
    }

    pub fn contact(&self, id: u64) -> PathBuf {
        self.contacts().join(format!("{id}"))
    }

    pub fn chats(&self) -> PathBuf {
        self.root.join("chats")
    }

    pub fn chat(&self, id: i64) -> PathBuf {
        self.chats().join(id.to_string())
    }

    pub fn info(&self, chat: i64) -> PathBuf {
        self.chat(chat).join("info")
    }

    pub fn settings(&self, chat: i64) -> PathBuf {
        self.chat(chat).join("settings")
    }

    pub fn messages(&self, chat: i64) -> PathBuf {
        self.chat(chat).join("messages")
    }

    pub fn cache_index(&self) -> PathBuf {
        self.cache.join("index")
    }

    pub fn cache_files(&self) -> PathBuf {
        self.cache.join("files")
    }

    pub fn cache_file(&self, name: &str) -> PathBuf {
        self.cache_files().join(name)
    }

    pub fn sync_state(&self) -> PathBuf {
        self.root.join("sync_state")
    }

    pub fn user_settings(&self) -> PathBuf {
        self.root.join("user_settings")
    }

    pub fn webapps(&self) -> PathBuf {
        self.root.join("webapps")
    }

    pub fn webapp(&self, bot_id: &str) -> PathBuf {
        let safe_name: String = bot_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect();
        let name = if safe_name.is_empty() {
            "default".to_string()
        } else {
            safe_name
        };
        self.webapps().join(name)
    }
}

pub fn generate_salt() -> String {
    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    STANDARD.encode(salt)
}

pub fn derive_key(password: &str, salt: &str) -> Result<[u8; 32], String> {
    let cache_key = (password.to_string(), salt.to_string());
    if let Ok(guard) = DERIVE_KEY_CACHE.read() {
        if let Some(cached) = guard.get(&cache_key) {
            return Ok(*cached);
        }
    }

    let salt_bytes = STANDARD.decode(salt).map_err(|e| e.to_string())?;

    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::default(),
    );

    let mut key = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), &salt_bytes, &mut key)
        .map_err(|e| e.to_string())?;

    if let Ok(mut guard) = DERIVE_KEY_CACHE.write() {
        guard.insert(cache_key, key);
    }

    Ok(key)
}

pub fn hash_key(key: &[u8; 32]) -> String {
    let first = Sha256::digest(key);
    let second = Sha256::digest(first);
    STANDARD.encode(second)
}

pub fn verify_hash(key: &[u8; 32], hash: &str) -> bool {
    hash_key(key) == hash
}

pub fn collect_db_files(root: &Path) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if !name.contains(".tmp") {
                    files.push(path.to_path_buf());
                }
            }
        }
    }
    files.sort();
    files
}

pub fn collect_all_account_files(paths: &Paths) -> Vec<PathBuf> {
    let mut files = collect_db_files(&paths.root);
    files.extend(collect_db_files(&paths.cache));
    files.sort();
    files
}

pub fn migrate_file_encrypt(path: &Path, key: &[u8; 32]) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.starts_with(b"ENC") {
        return Ok(());
    }
    let encrypted = Storage::encrypt(&bytes, key)?;
    let tmp_path = path.with_extension("tmp_enc");
    if fs::write(&tmp_path, &encrypted).is_ok() && fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }
    let _ = fs::remove_file(&tmp_path);
    fs::write(path, encrypted).map_err(|e| e.to_string())
}

pub fn migrate_file_decrypt(path: &Path, key: &[u8; 32]) -> Result<(), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"ENC") {
        return Ok(());
    }
    let decrypted = Storage::decrypt(&bytes, key)?;
    let tmp_path = path.with_extension("tmp_dec");
    if fs::write(&tmp_path, &decrypted).is_ok() && fs::rename(&tmp_path, path).is_ok() {
        return Ok(());
    }
    let _ = fs::remove_file(&tmp_path);
    fs::write(path, decrypted).map_err(|e| e.to_string())
}

pub fn migrate_all_files(
    app: &AppHandle,
    files: Vec<PathBuf>,
    key: &[u8; 32],
    encrypt: bool,
) -> Result<(), String> {
    let total = files.len();
    let phase = if encrypt { "encrypt" } else { "decrypt" };

    if total == 0 {
        let _ = app.emit(
            "encryption-migration-progress",
            serde_json::json!({
                "current": 0,
                "total": 0,
                "percent": 100,
                "phase": phase
            }),
        );
        return Ok(());
    }

    let _ = app.emit(
        "encryption-migration-progress",
        serde_json::json!({
            "current": 0,
            "total": total,
            "percent": 0,
            "phase": phase
        }),
    );

    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let num_workers = cpus.min(total).clamp(1, 16);

    let files = Arc::new(files);
    let next_idx = Arc::new(AtomicUsize::new(0));
    let done_counter = Arc::new(AtomicUsize::new(0));
    let error_slot = Arc::new(std::sync::Mutex::new(None::<String>));
    let key = *key;

    let mut handles = Vec::with_capacity(num_workers);

    for _ in 0..num_workers {
        let files = Arc::clone(&files);
        let next_idx = Arc::clone(&next_idx);
        let done_counter = Arc::clone(&done_counter);
        let error_slot = Arc::clone(&error_slot);
        let app = app.clone();

        handles.push(std::thread::spawn(move || {
            loop {
                if error_slot.lock().unwrap().is_some() {
                    break;
                }

                let idx = next_idx.fetch_add(1, Ordering::Relaxed);
                if idx >= total {
                    break;
                }

                let path = &files[idx];
                let res = if encrypt {
                    migrate_file_encrypt(path, &key)
                } else {
                    migrate_file_decrypt(path, &key)
                };

                if let Err(err) = res {
                    *error_slot.lock().unwrap() = Some(err);
                    break;
                }

                let done = done_counter.fetch_add(1, Ordering::Relaxed) + 1;
                let percent = ((done as f64 / total as f64) * 100.0).round() as usize;
                let step = (total / 50).max(1);
                if done == total || done == 1 || done % step == 0 {
                    let _ = app.emit(
                        "encryption-migration-progress",
                        serde_json::json!({
                            "current": done,
                            "total": total,
                            "percent": percent,
                            "phase": phase
                        }),
                    );
                }
            }
        }));
    }

    for handle in handles {
        let _ = handle.join();
    }

    if let Some(err) = error_slot.lock().unwrap().take() {
        return Err(err);
    }

    let _ = app.emit(
        "encryption-migration-progress",
        serde_json::json!({
            "current": total,
            "total": total,
            "percent": 100,
            "phase": phase
        }),
    );

    Ok(())
}
