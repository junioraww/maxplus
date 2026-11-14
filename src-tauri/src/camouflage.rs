use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Window};
use base64::{engine::general_purpose::STANDARD, Engine as _};

pub const CAMOUFLAGE_CSS: &str = include_str!("../../src/lib/camouflage/camouflage.css");

pub struct CamouflageDescriptor {
    pub rgba: Vec<u8>,
    pub png_base64: Option<String>,
    pub width: u32,
    pub height: u32,
    pub label: Option<String>,
}

pub fn load_cached_icon(app_dir: &Path) -> Option<(Vec<u8>, u32, u32)> {
    let bytes = std::fs::read(app_dir.join("data/common/camouflage_icon.bin")).ok()?;
    if bytes.len() < 8 {
        return None;
    }
    let w = u32::from_le_bytes(bytes[0..4].try_into().ok()?);
    let h = u32::from_le_bytes(bytes[4..8].try_into().ok()?);
    let rgba = bytes[8..].to_vec();
    (rgba.len() == (w * h * 4) as usize).then_some((rgba, w, h))
}

pub fn build_ico_from_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mask_row = ((width + 31) / 32) * 4;
    let mask_size = (mask_row * height) as usize;
    let pixel_size = (width * height * 4) as usize;
    let img_size = 40 + pixel_size + mask_size;
    let mut buf = Vec::with_capacity(22 + img_size);

    buf.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    buf.push(if width >= 256 { 0 } else { width as u8 });
    buf.push(if height >= 256 { 0 } else { height as u8 });
    buf.extend_from_slice(&[0, 0, 1, 0, 32, 0]);
    buf.extend_from_slice(&(img_size as u32).to_le_bytes());
    buf.extend_from_slice(&22u32.to_le_bytes());

    buf.extend_from_slice(&40u32.to_le_bytes());
    buf.extend_from_slice(&(width as i32).to_le_bytes());
    buf.extend_from_slice(&((height as i32) * 2).to_le_bytes());
    buf.extend_from_slice(&[1, 0, 32, 0]);
    buf.extend_from_slice(&[0; 4]);
    buf.extend_from_slice(&(pixel_size as u32).to_le_bytes());
    buf.extend_from_slice(&[0; 16]);

    for y in (0..height).rev() {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            if i + 3 < rgba.len() {
                buf.extend_from_slice(&[rgba[i + 2], rgba[i + 1], rgba[i], rgba[i + 3]]);
            } else {
                buf.extend_from_slice(&[0; 4]);
            }
        }
    }
    buf.resize(buf.len() + mask_size, 0);
    buf
}

pub fn apply_camouflage(
    app: &AppHandle,
    window: &Window,
    desc: CamouflageDescriptor,
) -> Result<(), String> {
    if desc.rgba.len() != (desc.width * desc.height * 4) as usize {
        return Err("Invalid buffer length".into());
    }

    #[cfg(desktop)]
    let _ = window.set_icon(tauri::image::Image::new_owned(desc.rgba.clone(), desc.width, desc.height));
    if let Some(label) = &desc.label {
        let _ = window.set_title(label);
    }

    if let Ok(app_dir) = app.path().app_data_dir() {
        let common_dir = app_dir.join("data/common");
        let _ = std::fs::create_dir_all(&common_dir);

        let mut bin = Vec::with_capacity(8 + desc.rgba.len());
        bin.extend_from_slice(&desc.width.to_le_bytes());
        bin.extend_from_slice(&desc.height.to_le_bytes());
        bin.extend_from_slice(&desc.rgba);
        let _ = std::fs::write(common_dir.join("camouflage_icon.bin"), bin);

        let png = desc.png_base64.as_deref().and_then(|b| STANDARD.decode(b).ok());
        if let Some(bytes) = &png {
            let _ = std::fs::write(common_dir.join("camouflage_icon.png"), bytes);
        }
        apply_platform_integration(&common_dir, &desc);
    }
    Ok(())
}

pub fn restore_camouflage(app: &AppHandle, window: &Window) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(def_icon) = app.default_window_icon() {
        let _ = window.set_icon(def_icon.clone());
    }
    let _ = window.set_title("Max+");

    if let Ok(app_dir) = app.path().app_data_dir() {
        let common_dir = app_dir.join("data/common");
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("maxplus"));
        restore_platform_integration(&common_dir, &exe);
    }
    Ok(())
}

pub fn save_camouflage_shell(app: &AppHandle, html: String) -> Result<(), String> {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let common = app_dir.join("data/common");
        let _ = std::fs::create_dir_all(&common);
        let _ = std::fs::write(common.join("camouflage_shell.html"), html);
    }
    Ok(())
}

pub fn load_cached_shell(app_dir: &Path) -> Option<String> {
    std::fs::read_to_string(app_dir.join("data/common/camouflage_shell.html")).ok()
}

fn apply_platform_integration(common_dir: &Path, desc: &CamouflageDescriptor) {
    #[cfg(target_os = "linux")]
    {
        modify_linux_desktop(Some(&common_dir.join("camouflage_icon.png")), desc.label.as_deref());
    }
    #[cfg(target_os = "windows")]
    {
        let ico_path = common_dir.join("camouflage_icon.ico");
        let _ = std::fs::write(&ico_path, build_ico_from_rgba(desc.width, desc.height, &desc.rgba));
        modify_windows_shortcuts(&ico_path.to_string_lossy(), desc.label.as_deref().unwrap_or("Max+"));
    }
    #[cfg(target_os = "macos")]
    {
        update_macos_dock(&common_dir.join("camouflage_icon.png"));
    }
    #[cfg(target_os = "android")]
    {
        update_android_launcher(true, desc.label.as_deref());
    }
    let _ = (common_dir, desc);
}

fn restore_platform_integration(common_dir: &Path, current_exe: &Path) {
    #[cfg(target_os = "linux")]
    {
        modify_linux_desktop(None, None);
    }
    #[cfg(target_os = "windows")]
    {
        modify_windows_shortcuts(&format!("{},0", current_exe.to_string_lossy()), "Max+");
    }
    #[cfg(target_os = "macos")]
    {
        restore_macos_dock();
    }
    #[cfg(target_os = "android")]
    {
        update_android_launcher(false, None);
    }
    let _ = (common_dir, current_exe);
}

#[cfg(target_os = "linux")]
fn modify_linux_desktop(png_path: Option<&Path>, label: Option<&str>) {
    let Some(home) = std::env::var_os("HOME") else { return };
    let apps_dir = PathBuf::from(home).join(".local/share/applications");
    let Ok(entries) = std::fs::read_dir(&apps_dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("desktop") { continue; }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.to_lowercase().contains("max") { continue; }
        if let Ok(content) = std::fs::read_to_string(&path) {
            let lines: Vec<String> = content.lines().map(|line| {
                if line.starts_with("Name=") {
                    format!("Name={}", label.unwrap_or("Max+"))
                } else if line.starts_with("Icon=") {
                    png_path.map_or("Icon=maxplus".to_string(), |p| format!("Icon={}", p.display()))
                } else {
                    line.to_string()
                }
            }).collect();
            let _ = std::fs::write(&path, lines.join("\n") + "\n");
        }
    }
}

#[cfg(target_os = "windows")]
fn modify_windows_shortcuts(icon_loc: &str, desc: &str) {
    use std::os::windows::process::CommandExt;
    let ico = icon_loc.replace('\'', "''");
    let lbl = desc.replace('\'', "''");
    let script = format!(
        "$sh=New-Object -ComObject WScript.Shell;\
         @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))|\
         Where-Object {{ Test-Path $_ }}|\
         ForEach-Object {{ Get-ChildItem -Path $_ -Filter '*max*.lnk' -Recurse -ErrorAction SilentlyContinue }}|\
         ForEach-Object {{ $s=$sh.CreateShortcut($_.FullName); $s.IconLocation='{ico}'; $s.Description='{lbl}'; $s.Save() }}"
    );
    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .spawn();
}

#[cfg(target_os = "macos")]
fn update_macos_dock(png_path: &Path) {
    let script = format!(
        "import AppKit\nif let img = NSImage(contentsOfFile: \"{}\") {{\n    NSApplication.shared.applicationIconImage = img\n}}",
        png_path.display()
    );
    let _ = std::process::Command::new("swift").args(["-e", &script]).spawn();
}

#[cfg(target_os = "macos")]
fn restore_macos_dock() {
    let _ = std::process::Command::new("swift").args(["-e", "import AppKit\nNSApplication.shared.applicationIconImage = nil"]).spawn();
}

#[cfg(target_os = "android")]
fn update_android_launcher(active: bool, label: Option<&str>) {
    use jni::{jni_sig, jni_str};
    if let Some(vm) = crate::notifications::GLOBAL_JVM.get() {
        let _ = vm.attach_current_thread(|env| -> Result<(), jni::errors::Error> {
            let main_class = env.find_class(jni_str!("me/junioraww/max/MainActivity"))
                .or_else(|_| env.find_class(jni_str!("org/meowkie/max/MainActivity")))?;
            let j_label = env.new_string(label.unwrap_or(""))?;
            env.call_static_method(
                main_class,
                jni_str!("setCamouflageState"),
                jni_sig!("(ZLjava/lang/String;)V"),
                &[jni::objects::JValue::Bool(active), jni::objects::JValue::Object(&j_label)],
            )?;
            Ok(())
        });
    }
}
