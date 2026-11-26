#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
fn setup_linux_environment() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let has_plugins = |path: &std::path::Path| -> bool {
        if !path.is_dir() {
            return false;
        }
        std::fs::read_dir(path)
            .map(|mut entries| {
                entries.any(|e| {
                    e.map(|entry| {
                        entry.path().extension().and_then(|s| s.to_str()) == Some("so")
                    })
                    .unwrap_or(false)
                })
            })
            .unwrap_or(false)
    };

    let current_path = std::env::var("GST_PLUGIN_SYSTEM_PATH_1_0").unwrap_or_default();
    let current_dirs: Vec<&str> = current_path
        .split(':')
        .filter(|s| !s.is_empty())
        .collect();

    let current_valid = current_dirs
        .iter()
        .any(|d| has_plugins(std::path::Path::new(d)));

    if !current_valid {
        let candidates = [
            "/usr/lib/gstreamer-1.0",
            "/usr/lib64/gstreamer-1.0",
            "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
            "/usr/local/lib/gstreamer-1.0",
        ];
        let found: Vec<&str> = candidates
            .iter()
            .copied()
            .filter(|c| has_plugins(std::path::Path::new(c)))
            .collect();

        if !found.is_empty() {
            std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", found.join(":"));
        } else if !current_dirs.is_empty() {
            std::env::remove_var("GST_PLUGIN_SYSTEM_PATH_1_0");
        }
    }

    if let Ok(scanner) = std::env::var("GST_PLUGIN_SCANNER") {
        if !std::path::Path::new(&scanner).exists() {
            std::env::remove_var("GST_PLUGIN_SCANNER");
        }
    }

    if std::env::var_os("GST_PLUGIN_SCANNER").is_none() {
        let scanner_candidates = [
            "/usr/lib/gstreamer-1.0/gst-plugin-scanner",
            "/usr/lib64/gstreamer-1.0/gst-plugin-scanner",
            "/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner",
            "/usr/libexec/gstreamer-1.0/gst-plugin-scanner",
        ];
        for candidate in scanner_candidates {
            if std::path::Path::new(candidate).exists() {
                std::env::set_var("GST_PLUGIN_SCANNER", candidate);
                break;
            }
        }
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    setup_linux_environment();

    maxplus_lib::run();
}
