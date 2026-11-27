use crate::state::AppState;
use crate::vpn_bypass;
use rumax::ProxyConfig;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppNetworkSettings {
    #[serde(flatten)]
    pub proxy: ProxyConfig,
    #[serde(default)]
    pub vpn_bypass_enabled: bool,
}

pub fn default_bypass_hosts() -> Vec<String> {
    vec![
        "maxplus.dev".to_string(),
        "*.maxplus.dev".to_string(),
        "localhost".to_string(),
        "127.0.0.1".to_string(),
    ]
}

pub fn ensure_essential_bypass(hosts: &mut Vec<String>) {
    if hosts.is_empty() {
        *hosts = default_bypass_hosts();
        return;
    }
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case("localhost")) {
        hosts.push("localhost".to_string());
    }
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case("127.0.0.1")) {
        hosts.push("127.0.0.1".to_string());
    }
}

impl Default for AppNetworkSettings {
    fn default() -> Self {
        let mut proxy = ProxyConfig::default();
        proxy.bypass_hosts = default_bypass_hosts();
        Self {
            proxy,
            vpn_bypass_enabled: false,
        }
    }
}

#[derive(Serialize)]
pub struct ProxyTestResult {
    pub success: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct VpnStatusResult {
    pub is_vpn: bool,
    pub server_detected: bool,
    pub local_detected: bool,
    pub vpn_bypass_supported: bool,
    pub vpn_bypass_active: bool,
}

static CURRENT_SETTINGS: std::sync::RwLock<Option<AppNetworkSettings>> =
    std::sync::RwLock::new(None);

pub fn load_initial_settings_at(app_dir: &std::path::Path) {
    let path = app_dir.join("data").join("common").join("proxy_settings");
    let storage = crate::stores::storage::Storage::new(None);
    if let Some(val) = storage.load(&path) {
        if let Ok(mut settings) = serde_json::from_value::<AppNetworkSettings>(val) {
            ensure_essential_bypass(&mut settings.proxy.bypass_hosts);
            apply_network_settings(&settings);
            if let Ok(mut lock) = CURRENT_SETTINGS.write() {
                *lock = Some(settings);
            }
        }
    }
}

pub fn load_initial_settings(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        load_initial_settings_at(&dir);
    }
}

pub fn apply_network_settings(settings: &AppNetworkSettings) {
    if settings.proxy.is_enabled() {
        rumax::set_global_proxy_config(Some(settings.proxy.clone()));
    } else {
        rumax::set_global_proxy_config(None);
    }

    if settings.vpn_bypass_enabled {
        let _ = vpn_bypass::apply_physical_network_route();
    } else {
        let _ = vpn_bypass::reset_physical_network_route();
    }
}

#[tauri::command]
pub async fn fetch_proxy_config() -> Result<AppNetworkSettings, String> {
    if let Ok(lock) = CURRENT_SETTINGS.read() {
        if let Some(ref s) = *lock {
            return Ok(s.clone());
        }
    }
    Ok(AppNetworkSettings::default())
}

#[tauri::command]
pub async fn get_proxy_settings() -> Result<AppNetworkSettings, String> {
    fetch_proxy_config().await
}

#[tauri::command]
pub async fn update_proxy_config(
    app: AppHandle,
    _state: State<'_, AppState>,
    settings: AppNetworkSettings,
) -> Result<(), String> {
    let mut settings = settings;
    ensure_essential_bypass(&mut settings.proxy.bypass_hosts);
    apply_network_settings(&settings);

    if settings.proxy.is_enabled() {
        crate::session::manager().set_proxy_all(Some(settings.proxy.clone())).await;
    } else {
        crate::session::manager().set_proxy_all(None).await;
    }

    if let Ok(mut lock) = CURRENT_SETTINGS.write() {
        *lock = Some(settings.clone());
    }

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("data").join("common").join("proxy_settings");
    let val = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        let storage = crate::stores::storage::Storage::new(None);
        let _ = storage.save(&path, &val);
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn set_proxy_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppNetworkSettings,
) -> Result<(), String> {
    update_proxy_config(app, state, settings).await
}

#[tauri::command]
pub async fn ping_proxy_endpoint(settings: ProxyConfig) -> Result<ProxyTestResult, String> {
    if !settings.is_enabled() {
        return Ok(ProxyTestResult {
            success: false,
            latency_ms: None,
            error: Some("Proxy is not configured".into()),
        });
    }

    let start = Instant::now();
    match rumax::transport::proxy::open_proxied_stream(Some(&settings), "max.ru", 443).await {
        Ok(_) => {
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(ProxyTestResult {
                success: true,
                latency_ms: Some(elapsed),
                error: None,
            })
        }
        Err(e) => Ok(ProxyTestResult {
            success: false,
            latency_ms: None,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn test_proxy_connection(settings: ProxyConfig) -> Result<ProxyTestResult, String> {
    ping_proxy_endpoint(settings).await
}

#[tauri::command]
pub async fn query_vpn_condition(state: State<'_, AppState>) -> Result<VpnStatusResult, String> {
    let server_detected = state.client().is_vpn().await;
    let local_detected = vpn_bypass::is_vpn_detected();
    let vpn_bypass_supported = cfg!(target_os = "android");

    let vpn_bypass_active = if let Ok(lock) = CURRENT_SETTINGS.read() {
        lock.as_ref().map(|s| s.vpn_bypass_enabled).unwrap_or(false)
    } else {
        false
    };

    Ok(VpnStatusResult {
        is_vpn: server_detected || local_detected,
        server_detected,
        local_detected,
        vpn_bypass_supported,
        vpn_bypass_active,
    })
}

#[tauri::command]
pub async fn check_vpn_status(state: State<'_, AppState>) -> Result<VpnStatusResult, String> {
    query_vpn_condition(state).await
}

#[tauri::command]
pub async fn switch_vpn_bypass(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let success = if enabled {
        vpn_bypass::apply_physical_network_route()
    } else {
        vpn_bypass::reset_physical_network_route()
    };

    let mut current = fetch_proxy_config().await.unwrap_or_default();
    current.vpn_bypass_enabled = enabled;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = app_dir.join("data").join("common").join("proxy_settings");
    let val = serde_json::to_value(&current).map_err(|e| e.to_string())?;

    if let Ok(mut lock) = CURRENT_SETTINGS.write() {
        *lock = Some(current);
    }

    tokio::task::spawn_blocking(move || {
        let storage = crate::stores::storage::Storage::new(None);
        let _ = storage.save(&path, &val);
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(success)
}

#[tauri::command]
pub async fn set_vpn_bypass(app: AppHandle, enabled: bool) -> Result<bool, String> {
    switch_vpn_bypass(app, enabled).await
}
