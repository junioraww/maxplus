use std::sync::Mutex;

#[cfg(target_os = "linux")]
use std::process::{Child, Command};
#[cfg(target_os = "linux")]
use std::path::PathBuf;

#[cfg(target_os = "linux")]
static DAEMON_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

#[cfg(target_os = "linux")]
fn find_script() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from("src-tauri/src/linux_webrtc.py"),
        PathBuf::from("src/linux_webrtc.py"),
        PathBuf::from("linux_webrtc.py"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p1 = parent.join("linux_webrtc.py");
            if p1.exists() {
                return Some(p1);
            }
            let p2 = parent.join("src/linux_webrtc.py");
            if p2.exists() {
                return Some(p2);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
pub fn start_linux_webrtc_daemon() {
    let port = 14230;
    if let Some(script) = find_script() {
        if let Ok(child) = Command::new("python3")
            .arg(script)
            .arg("--port")
            .arg(port.to_string())
            .spawn()
        {
            crate::proxy_auth::set_webrtc_proxy_port(port);
            if let Ok(mut lock) = DAEMON_PROCESS.lock() {
                *lock = Some(child);
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub fn start_linux_webrtc_daemon() {}

#[tauri::command]
pub fn get_linux_webrtc_port() -> u16 {
    crate::proxy_auth::get_proxy_config().webrtc_port
}
