use rumax::MaxClient;
use std::sync::{Arc, OnceLock, RwLock};

static SHARED_CLIENT: OnceLock<MaxClient> = OnceLock::new();

pub fn shared_client() -> &'static MaxClient {
    SHARED_CLIENT.get_or_init(MaxClient::new)
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
