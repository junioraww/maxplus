use rand::RngCore;
use std::sync::{Arc, OnceLock, RwLock};
use tiny_http::Request;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ProxyConfig {
    pub video_port: u16,
    pub video_token: String,
    pub webapp_port: u16,
    pub webapp_token: String,
}

static PROXY_CONFIG: OnceLock<Arc<RwLock<ProxyConfig>>> = OnceLock::new();

fn get_config_lock() -> &'static Arc<RwLock<ProxyConfig>> {
    PROXY_CONFIG.get_or_init(|| {
        Arc::new(RwLock::new(ProxyConfig {
            video_port: 0,
            video_token: generate_token(),
            webapp_port: 0,
            webapp_token: generate_token(),
        }))
    })
}

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn set_video_proxy_info(port: u16, token: String) {
    if let Ok(mut lock) = get_config_lock().write() {
        lock.video_port = port;
        lock.video_token = token;
    }
}

pub fn set_webapp_proxy_info(port: u16, token: String) {
    if let Ok(mut lock) = get_config_lock().write() {
        lock.webapp_port = port;
        lock.webapp_token = token;
    }
}

pub fn get_proxy_config() -> ProxyConfig {
    get_config_lock()
        .read()
        .map(|c| c.clone())
        .unwrap_or(ProxyConfig {
            video_port: 0,
            video_token: String::new(),
            webapp_port: 0,
            webapp_token: String::new(),
        })
}

pub fn get_video_token() -> String {
    get_config_lock()
        .read()
        .map(|c| c.video_token.clone())
        .unwrap_or_default()
}

pub fn get_webapp_token() -> String {
    get_config_lock()
        .read()
        .map(|c| c.webapp_token.clone())
        .unwrap_or_default()
}

pub fn validate_and_strip_token(request: &Request, expected_token: &str) -> Option<String> {
    if expected_token.is_empty() {
        return Some(request.url().to_string());
    }

    let url = request.url();
    let prefix = format!("/{}", expected_token);

    if url == prefix {
        return Some("/".to_string());
    }

    if let Some(rest) = url.strip_prefix(&format!("{}/", prefix)) {
        return Some(format!("/{}", rest));
    }

    if let Some(rest) = url.strip_prefix(&format!("{}?", prefix)) {
        return Some(format!("/?{}", rest));
    }

    for header in request.headers() {
        let name = header.field.as_str().as_str();
        let value = header.value.as_str().trim();

        if name.eq_ignore_ascii_case("x-proxy-token") || name.eq_ignore_ascii_case("x-maxplus-token") {
            if value == expected_token {
                return Some(url.to_string());
            }
        }

        if name.eq_ignore_ascii_case("authorization") {
            if let Some(bearer) = value.strip_prefix("Bearer ") {
                if bearer.trim() == expected_token {
                    return Some(url.to_string());
                }
            }
        }

        if name.eq_ignore_ascii_case("cookie") {
            for item in value.split(';') {
                let mut parts = item.trim().splitn(2, '=');
                if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                    if (k == "__mp_token" || k == "__mp_proxy_token") && v == expected_token {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }

    if let Some((_, query)) = url.split_once('?') {
        for pair in query.split('&') {
            let mut parts = pair.splitn(2, '=');
            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                if (k == "token" || k == "secret" || k == "_token") && v == expected_token {
                    return Some(url.to_string());
                }
            }
        }
    }

    None
}
