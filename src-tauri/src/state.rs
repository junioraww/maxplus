use rumax::MaxClient;
use std::sync::{Arc, OnceLock, RwLock};

static SHARED_CLIENT: OnceLock<MaxClient> = OnceLock::new();
static SHARED_SESSION_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub fn shared_client() -> &'static MaxClient {
    SHARED_CLIENT.get_or_init(MaxClient::new)
}

pub fn shared_session_lock() -> &'static tokio::sync::Mutex<()> {
    SHARED_SESSION_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

#[derive(Clone)]
pub struct CryptoSession {
    pub account: u64,
    pub key: [u8;32],
}

#[derive(Clone)]
pub struct AppState {
    pub client: MaxClient,
    pub crypto: Arc<RwLock<Option<CryptoSession>>>,
}
