use std::fs;
use std::path::{Path, PathBuf};

pub fn init_ssl_certificates() {
    #[cfg(not(target_os = "android"))]
    {
        setup_ca_bundle();
    }
}

#[cfg(not(target_os = "android"))]
fn setup_ca_bundle() {
    let candidate_paths = [
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/ca-bundle.pem",
        "/etc/ssl/cert.pem",
    ];

    let mut system_bundle = Vec::new();
    for p in &candidate_paths {
        if Path::new(p).exists() {
            if let Ok(bytes) = fs::read(p) {
                if !bytes.is_empty() {
                    system_bundle = bytes;
                    break;
                }
            }
        }
    }

    let mintsifry_ca = rumax::MINTSIFRY_ROOT_CA;
    let mut merged = system_bundle;
    if !merged.is_empty() && !merged.ends_with(b"\n") {
        merged.push(b'\n');
    }
    merged.extend_from_slice(mintsifry_ca);
    if !merged.ends_with(b"\n") {
        merged.push(b'\n');
    }

    let bundle_path = get_ca_bundle_path();
    if let Some(parent) = bundle_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(()) = fs::write(&bundle_path, &merged) {
        let path_str = bundle_path.to_string_lossy().to_string();
        std::env::set_var("SSL_CERT_FILE", &path_str);
        if std::env::var_os("SSL_CERT_DIR").is_none() {
            std::env::set_var("SSL_CERT_DIR", "/etc/ssl/certs");
        }

        #[cfg(target_os = "linux")]
        setup_linux_tls(&path_str);
    }
}

fn get_ca_bundle_path() -> PathBuf {
    if let Some(cache_dir) = dirs::cache_dir() {
        return cache_dir.join("maxplus").join("ca-bundle-mintsifry.crt");
    }
    std::env::temp_dir().join("maxplus_ca_bundle_mintsifry.crt")
}

#[cfg(target_os = "linux")]
fn setup_linux_tls(bundle_path: &str) {
    unsafe {
        extern "C" {
            fn dlopen(filename: *const std::os::raw::c_char, flag: std::os::raw::c_int) -> *mut std::ffi::c_void;
            fn dlsym(handle: *mut std::ffi::c_void, symbol: *const std::os::raw::c_char) -> *mut std::ffi::c_void;
        }

        let gio = dlopen(b"libgio-2.0.so.0\0".as_ptr() as *const _, 1);
        if !gio.is_null() {
            type GetDefault = unsafe extern "C" fn() -> *mut std::ffi::c_void;
            type FileDbNew = unsafe extern "C" fn(*const std::os::raw::c_char, *mut *mut std::ffi::c_void) -> *mut std::ffi::c_void;
            type SetDefaultDb = unsafe extern "C" fn(*mut std::ffi::c_void, *mut std::ffi::c_void);

            let get_default: Option<GetDefault> = std::mem::transmute(dlsym(gio, b"g_tls_backend_get_default\0".as_ptr() as *const _));
            let file_db_new: Option<FileDbNew> = std::mem::transmute(dlsym(gio, b"g_tls_file_database_new\0".as_ptr() as *const _));
            let set_default_db: Option<SetDefaultDb> = std::mem::transmute(dlsym(gio, b"g_tls_backend_set_default_database\0".as_ptr() as *const _));

            if let (Some(gd), Some(fdb_new), Some(sdd)) = (get_default, file_db_new, set_default_db) {
                let c_path = match std::ffi::CString::new(bundle_path) {
                    Ok(p) => p,
                    Err(_) => return,
                };
                let backend = gd();
                if !backend.is_null() {
                    let mut err = std::ptr::null_mut();
                    let db = fdb_new(c_path.as_ptr(), &mut err);
                    if !db.is_null() {
                        sdd(backend, db);
                    }
                }
            }
        }

        let wk = dlopen(b"libwebkit2gtk-4.1.so.0\0".as_ptr() as *const _, 1);
        if !wk.is_null() {
            type WebContextGetDefault = unsafe extern "C" fn() -> *mut std::ffi::c_void;
            type SetTlsErrorsPolicy = unsafe extern "C" fn(*mut std::ffi::c_void, std::os::raw::c_int);

            let get_default: Option<WebContextGetDefault> = std::mem::transmute(dlsym(wk, b"webkit_web_context_get_default\0".as_ptr() as *const _));
            let set_policy: Option<SetTlsErrorsPolicy> = std::mem::transmute(dlsym(wk, b"webkit_web_context_set_tls_errors_policy\0".as_ptr() as *const _));

            if let (Some(gd), Some(sp)) = (get_default, set_policy) {
                let ctx = gd();
                if !ctx.is_null() {
                    sp(ctx, 0);
                }
            }
        }
    }
}
