use rumax::MaxClient;
use std::sync::{Arc, OnceLock, RwLock};

static SHARED_SESSION_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub fn shared_session_lock() -> &'static tokio::sync::Mutex<()> {
    SHARED_SESSION_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[derive(Clone)]
pub struct CryptoSession {
    pub account: u64,
    pub key: [u8; 32],
}

#[derive(Clone)]
pub struct AppState {
    pub crypto: Arc<RwLock<Option<CryptoSession>>>,
}

impl AppState {
    pub fn client(&self) -> MaxClient {
        crate::session::manager().active_client()
    }
}
