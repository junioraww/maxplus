use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_OK, MB_YESNO, SW_SHOWNORMAL,
};

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

pub fn is_webview2_error(err: &tauri::Error) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("webview2")
        || msg.contains("0x80040154")
        || msg.contains("0x80070002")
        || msg.contains("createwebview")
        || msg.contains("edge")
}

pub fn show_missing_webview_dialog() {
    let title = to_wide("Необходим компонент WebView2");
    let text = to_wide(
        "Для работы приложения Max требуется Microsoft Edge WebView2 Runtime, \
        который отсутствует или повреждён в вашей системе.\n\n\
        Хотите перейти на официальный сайт и скачать установщик?",
    );

    let res = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONERROR,
        )
    };

    if res == IDYES {
        let url = to_wide("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
        let open = to_wide("open");
        unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                open.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
        }
    }
}

pub fn show_fatal_error_dialog(err: &tauri::Error) {
    let title = to_wide("Ошибка запуска приложения");
    let text = to_wide(&format!("Не удалось запустить Max:\n\n{}", err));

    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

pub fn handle_startup_error(err: &tauri::Error) {
    if is_webview2_error(err) {
        show_missing_webview_dialog();
    } else {
        show_fatal_error_dialog(err);
    }
}
