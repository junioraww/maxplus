use regex::Regex;
use reqwest::header::CONTENT_TYPE;
use std::collections::VecDeque;
use std::io::{Cursor, Read};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tiny_http::{Header, Method, Response, Server};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct WebAppFilterRule {
    pub id: String,
    pub name: String,
    pub pattern: String,
    pub is_regex: bool,
    pub target: String,
    pub enabled: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct WebAppLogEntry {
    pub id: u64,
    pub timestamp: String,
    pub time_epoch: u64,
    pub method: String,
    pub url: String,
    pub origin: String,
    pub status: u16,
    pub status_text: String,
    pub duration_ms: u64,
    pub request_headers: serde_json::Value,
    pub request_body: Option<String>,
    pub response_headers: serde_json::Value,
    pub response_body: Option<String>,
    pub content_type: String,
    pub content_length: usize,
    pub blocked: bool,
    pub block_reason: Option<String>,
    pub host_ip: Option<String>,
}

static PROXY_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static FILTER_RULES: RwLock<Vec<WebAppFilterRule>> = RwLock::new(Vec::new());
static RAM_LOG_BUFFER: Mutex<VecDeque<WebAppLogEntry>> = Mutex::new(VecDeque::new());
static LOG_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = PROXY_APP_HANDLE.set(handle);
}

pub fn set_filter_rules(rules: Vec<WebAppFilterRule>) {
    if let Ok(mut lock) = FILTER_RULES.write() {
        *lock = rules;
    }
}

pub fn get_filter_rules() -> Vec<WebAppFilterRule> {
    FILTER_RULES.read().map(|r| r.clone()).unwrap_or_default()
}

pub fn get_ram_logs() -> Vec<WebAppLogEntry> {
    RAM_LOG_BUFFER.lock().map(|b| b.iter().cloned().collect()).unwrap_or_default()
}

pub fn clear_ram_logs() {
    if let Ok(mut b) = RAM_LOG_BUFFER.lock() {
        b.clear();
    }
}

fn emit_log(entry: WebAppLogEntry) {
    if let Ok(mut buf) = RAM_LOG_BUFFER.lock() {
        if buf.len() >= 1000 {
            buf.pop_front();
        }
        buf.push_back(entry.clone());
    }
    if let Some(handle) = PROXY_APP_HANDLE.get() {
        let _ = handle.emit("webapp_network_log", entry);
    }
}

fn check_blocked(url: &str) -> Option<String> {
    let Ok(rules) = FILTER_RULES.read() else { return None; };
    let host = get_origin_from_url(url);
    for rule in rules.iter() {
        if !rule.enabled || rule.pattern.is_empty() {
            continue;
        }
        let check_target = match rule.target.as_str() {
            "host" => &host,
            _ => url,
        };
        if rule.is_regex {
            if let Ok(re) = Regex::new(&rule.pattern) {
                if re.is_match(check_target) {
                    return Some(rule.name.clone());
                }
            }
        } else if check_target.contains(&rule.pattern) {
            return Some(rule.name.clone());
        }
    }
    None
}

struct ProxyState {
    last_origin: Mutex<String>,
}

const SHIM_SCRIPT: &str = concat!(
    r#"<meta name="referrer" content="unsafe-url">"#,
    r#"<script>(function(){if(window.__mpwb)return;window.__mpwb=true;"#,
    r#"var q=[];function flush(){for(var i=0;i<q.length;){var b=q[i][2]?window.PrivateWebApp:window.WebApp;"#,
    r#"if(b&&typeof b.sendEvent==='function'){try{b.sendEvent(q[i][0],q[i][1]);}catch(e){}q.splice(i,1);}else{i++;}}}setInterval(flush,50);"#,
    r#"function deliver(n,d,p){q.push([n,d,!!p]);flush();}window.__mpDeliver=deliver;"#,
    r#"function toParent(n,d){var o={};try{o=typeof d==='string'?JSON.parse(d):(d||{});}catch(e){}"#,
    r#"var m=Object.assign({},o);m.type=n;try{window.parent.postMessage(JSON.stringify(m),'*');}catch(e){}}"#,
    r#"window.WebViewHandler={postEvent:function(n,d){toParent(n,d);},resolveShare:function(){}};"#,
    r#"window.PrivateWebViewHandler={postEvent:function(n,d){toParent(n,d);}};if(!window.AndroidPerf){window.AndroidPerf={trackFcp:function(){}};}"#,
    r#"window.addEventListener('message',function(e){if(!e.data)return;var d;try{d=typeof e.data==='string'?JSON.parse(e.data):e.data;}catch(x){return;}"#,
    r#"if(d&&d.__mpDeliver&&typeof d.name==='string'){deliver(d.name,d.data,!!d.priv);}});"#,
    r#"function resolveTarget(u){"#,
    r#"if(!u||typeof u!=='string')return '';"#,
    r#"if(u.indexOf('data:')===0||u.indexOf('blob:')===0)return '';"#,
    r#"if(u.indexOf('http://127.0.0.1:11448/proxy')===0||u.indexOf('http://localhost:11448/proxy')===0)return '';"#,
    r#"if(u.indexOf('https://')===0||u.indexOf('http://')===0){"#,
    r#"if(u.indexOf('http://127.0.0.1:11448')===0||u.indexOf('http://localhost:11448')===0){"#,
    r#"var path=u.replace(/^http:\/\/(127\.0\.0\.1|localhost):11448/,'');"#,
    r#"return window.__mpOrigin?window.__mpOrigin+path:'';"#,
    r#"}return u;}"#,
    r#"if(window.__mpOrigin){return window.__mpOrigin+(u.charAt(0)==='/'?'':'/')+u;}"#,
    r#"return '';}"#,
    r#"var of=window.fetch;if(of){window.fetch=function(u,i){try{"#,
    r#"var s=typeof u==='string'?u:(u&&u.url?u.url:'');"#,
    r#"var t=resolveTarget(s);"#,
    r#"if(t){var p='http://127.0.0.1:11448/proxy?url='+encodeURIComponent(t);"#,
    r#"if(typeof u==='string'){u=p;}else if(u&&typeof u==='object'){"#,
    r#"try{u=new Request(p,u);}catch(x){u=p;}}}"#,
    r#"}catch(e){}return of.call(this,u,i);};}"#,
    r#"var ox=XMLHttpRequest.prototype.open;if(ox){XMLHttpRequest.prototype.open=function(m,u){try{"#,
    r#"if(typeof u==='string'){"#,
    r#"var t=resolveTarget(u);"#,
    r#"if(t){u='http://127.0.0.1:11448/proxy?url='+encodeURIComponent(t);}"#,
    r#"}}catch(e){}var a=Array.prototype.slice.call(arguments);a[1]=u;return ox.apply(this,a);};}"#,
    r#"}());</script>"#
);

fn extract_query_param(query: &str, param: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let Some(key) = parts.next() {
            if key == param {
                if let Some(val) = parts.next() {
                    return urlencoding::decode(val).ok().map(|s| s.into_owned());
                }
            }
        }
    }
    None
}

fn get_origin_from_url(u: &str) -> String {
    if let Some(pos) = u.find("://") {
        let rest = &u[pos + 3..];
        let host = match rest.find('/') {
            Some(p) => &rest[..p],
            None => rest,
        };
        format!("{}://{}", &u[..pos], host)
    } else {
        String::new()
    }
}

fn handle_request(
    mut request: tiny_http::Request,
    client: &reqwest::blocking::Client,
    state: &ProxyState,
) {
    if request.method() == &Method::Options {
        let headers = vec![
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
            Header::from_bytes(
                &b"Access-Control-Allow-Methods"[..],
                b"GET, POST, PUT, DELETE, OPTIONS, HEAD",
            )
            .unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Headers"[..], b"*").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Credentials"[..], b"true").unwrap(),
            Header::from_bytes(&b"Access-Control-Max-Age"[..], b"86400").unwrap(),
        ];
        let res = Response::new(200.into(), headers, Cursor::new(Vec::new()), Some(0), None);
        let _ = request.respond(res);
        return;
    }

    let req_url = request.url().to_string();
    let query_str = req_url.split_once('?').map(|x| x.1).unwrap_or("");

    let mut direct_target = extract_query_param(query_str, "url")
        .or_else(|| extract_query_param(query_str, "target"));

    let mut caller_origin = String::new();
    for h in request.headers() {
        let name = h.field.as_str().as_str();
        if name.eq_ignore_ascii_case("Referer") {
            let ref_val = h.value.as_str();
            if let Some((_, ref_q)) = ref_val.split_once('?') {
                if let Some(u) = extract_query_param(ref_q, "url")
                    .or_else(|| extract_query_param(ref_q, "target"))
                {
                    caller_origin = get_origin_from_url(&u);
                }
            }
            if caller_origin.is_empty() {
                caller_origin = get_origin_from_url(ref_val);
                if caller_origin.contains("127.0.0.1") || caller_origin.contains("localhost") {
                    caller_origin.clear();
                }
            }
        } else if name.eq_ignore_ascii_case("Cookie") {
            for c in h.value.as_str().split(';') {
                let mut cp = c.trim().splitn(2, '=');
                if let (Some(k), Some(v)) = (cp.next(), cp.next()) {
                    if k == "webapp_target" && caller_origin.is_empty() {
                        caller_origin = v.to_string();
                    }
                }
            }
        }
    }

    if caller_origin.is_empty() {
        if let Ok(lock) = state.last_origin.lock() {
            caller_origin = lock.clone();
        }
    }

    let origin = caller_origin.clone();

    let target_url = if let Some(t) = direct_target.take() {
        t
    } else if !origin.is_empty() {
        format!("{}{}", origin.trim_end_matches('/'), req_url)
    } else {
        let _ = request.respond(Response::from_string("Missing target URL").with_status_code(400));
        return;
    };

    let start_instant = std::time::Instant::now();
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    let time_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let mut req_headers_map = serde_json::Map::new();
    for h in request.headers() {
        req_headers_map.insert(
            h.field.as_str().to_string(),
            serde_json::Value::String(h.value.as_str().to_string()),
        );
    }
    let req_headers_val = serde_json::Value::Object(req_headers_map);

    let method_str = request.method().as_str().to_string();

    if let Some(reason) = check_blocked(&target_url) {
        let entry = WebAppLogEntry {
            id: LOG_ID_COUNTER.fetch_add(1, Ordering::SeqCst),
            timestamp,
            time_epoch,
            method: method_str,
            url: target_url,
            origin,
            status: 0,
            status_text: "DROPPED".to_string(),
            duration_ms: start_instant.elapsed().as_millis() as u64,
            request_headers: req_headers_val,
            request_body: None,
            response_headers: serde_json::json!({}),
            response_body: None,
            content_type: String::new(),
            content_length: 0,
            blocked: true,
            block_reason: Some(reason),
            host_ip: None,
        };
        emit_log(entry);
        drop(request);
        return;
    }

    let mut rb = match method_str.as_str() {
        "POST" => client.post(&target_url),
        "PUT" => client.put(&target_url),
        "DELETE" => client.delete(&target_url),
        "HEAD" => client.head(&target_url),
        _ => client.get(&target_url),
    };

    let origin_header = if !caller_origin.is_empty() {
        caller_origin.clone()
    } else if !origin.is_empty() {
        origin.clone()
    } else {
        get_origin_from_url(&target_url)
    };

    rb = rb.header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    if !origin_header.is_empty() {
        rb = rb.header("Referer", format!("{}/", origin_header));
        let browser_has_origin = request
            .headers()
            .iter()
            .any(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Origin"));
        if browser_has_origin || (method_str != "GET" && method_str != "HEAD") {
            rb = rb.header("Origin", origin_header.as_str());
        }
    }

    for h in request.headers() {
        let name = h.field.as_str().as_str();
        if name.eq_ignore_ascii_case("Host")
            || name.eq_ignore_ascii_case("Content-Length")
            || name.eq_ignore_ascii_case("Origin")
            || name.eq_ignore_ascii_case("Referer")
            || name.eq_ignore_ascii_case("User-Agent")
            || name.eq_ignore_ascii_case("Accept-Encoding")
        {
            continue;
        }
        if name.eq_ignore_ascii_case("Cookie") {
            let filtered: Vec<&str> = h
                .value
                .as_str()
                .split(';')
                .map(|c| c.trim())
                .filter(|c| !c.starts_with("webapp_target="))
                .collect();
            if !filtered.is_empty() {
                rb = rb.header("Cookie", filtered.join("; "));
            }
            continue;
        }
        rb = rb.header(name, h.value.as_str());
    }

    let mut req_body = Vec::new();
    if method_str == "POST" || method_str == "PUT" || method_str == "PATCH" {
        let _ = request.as_reader().read_to_end(&mut req_body);
        if !req_body.is_empty() {
            rb = rb.body(req_body.clone());
        }
    }
    let req_body_str = if !req_body.is_empty() {
        if let Ok(s) = std::str::from_utf8(&req_body) {
            if s.len() > 32768 {
                Some(format!("{}... [truncated]", &s[..32768]))
            } else {
                Some(s.to_string())
            }
        } else {
            Some(format!("<binary {} bytes>", req_body.len()))
        }
    } else {
        None
    };

    let res = match rb.send() {
        Ok(r) => r,
        Err(err) => {
            let entry = WebAppLogEntry {
                id: LOG_ID_COUNTER.fetch_add(1, Ordering::SeqCst),
                timestamp,
                time_epoch,
                method: method_str,
                url: target_url,
                origin,
                status: 502,
                status_text: "Bad Gateway".to_string(),
                duration_ms: start_instant.elapsed().as_millis() as u64,
                request_headers: req_headers_val,
                request_body: req_body_str,
                response_headers: serde_json::json!({}),
                response_body: Some(err.to_string()),
                content_type: "text/plain".to_string(),
                content_length: 0,
                blocked: false,
                block_reason: None,
                host_ip: None,
            };
            emit_log(entry);
            let _ = request.respond(Response::from_string("Bad Gateway").with_status_code(502));
            return;
        }
    };

    let status = res.status().as_u16();
    let status_text = res.status().canonical_reason().unwrap_or("").to_string();

    let mut resp_headers_map = serde_json::Map::new();
    for (k, v) in res.headers() {
        if let Ok(val_str) = v.to_str() {
            resp_headers_map.insert(
                k.as_str().to_string(),
                serde_json::Value::String(val_str.to_string()),
            );
        }
    }
    let resp_headers_val = serde_json::Value::Object(resp_headers_map);

    let content_type = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let mut headers = vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
        Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            b"GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
        )
        .unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], b"*").unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Credentials"[..], b"true").unwrap(),
    ];

    if !content_type.is_empty() {
        if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()) {
            headers.push(h);
        }
    }

    for (k, v) in res.headers() {
        let name = k.as_str();
        if name.eq_ignore_ascii_case("content-security-policy")
            || name.eq_ignore_ascii_case("content-security-policy-report-only")
            || name.eq_ignore_ascii_case("x-frame-options")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("content-type")
            || name.eq_ignore_ascii_case("content-encoding")
            || name.eq_ignore_ascii_case("access-control-allow-origin")
            || name.eq_ignore_ascii_case("transfer-encoding")
        {
            continue;
        }
        if name.eq_ignore_ascii_case("set-cookie") {
            let val = v.to_str().unwrap_or("");
            let re_dom = Regex::new(r"(?i)Domain=[^;]+;?\s*").unwrap();
            let re_sec = Regex::new(r"(?i)Secure;?\s*").unwrap();
            let cleaned = re_dom.replace_all(val, "");
            let cleaned = re_sec.replace_all(&cleaned, "");
            if let Ok(h) = Header::from_bytes(name.as_bytes(), cleaned.as_bytes()) {
                headers.push(h);
            }
            continue;
        }
        if let Ok(h) = Header::from_bytes(name.as_bytes(), v.as_bytes()) {
            headers.push(h);
        }
    }

    let mut bytes = match res.bytes() {
        Ok(b) => b.to_vec(),
        Err(_) => {
            let _ = request.respond(
                Response::from_string("Upstream Read Error").with_status_code(502),
            );
            return;
        }
    };

    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() {
            bytes = decompressed;
        }
    } else if bytes.len() >= 2
        && bytes[0] == 0x78
        && (bytes[1] == 0x9c || bytes[1] == 0x01 || bytes[1] == 0xda)
    {
        let mut decoder = flate2::read::ZlibDecoder::new(&bytes[..]);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() {
            bytes = decompressed;
        }
    }

    let is_js = content_type.contains("javascript")
        || target_url.contains("bridge.js")
        || target_url.ends_with(".js")
        || target_url.contains(".js?");
    let is_html = content_type.contains("text/html");

    let page_origin = get_origin_from_url(&target_url);
    if is_html && !page_origin.is_empty() {
        if let Ok(mut lock) = state.last_origin.lock() {
            *lock = page_origin.clone();
        }
        let cookie_val = format!("webapp_target={}; Path=/; SameSite=Lax", page_origin);
        if let Ok(h) = Header::from_bytes(&b"Set-Cookie"[..], cookie_val.as_bytes()) {
            headers.push(h);
        }
    }

    let final_bytes = if is_js {
        let mut text = String::from_utf8_lossy(&bytes).to_string();

        if let Ok(re) = Regex::new(r"![a-zA-Z_$][a-zA-Z0-9_$]*\.test\([a-zA-Z_$][a-zA-Z0-9_$]*\.origin\)") {
            text = re.replace_all(&text, "false").to_string();
        }
        if let Ok(re) = Regex::new(r"[a-zA-Z_$][a-zA-Z0-9_$]*\.test\([a-zA-Z_$][a-zA-Z0-9_$]*\.origin\)") {
            text = re.replace_all(&text, "true").to_string();
        }

        text.into_bytes()
    } else if is_html {
        let mut text = String::from_utf8_lossy(&bytes).to_string();
        let lower = text.to_ascii_lowercase();
        let origin_var = if !page_origin.is_empty() {
            format!(r#"<script>window.__mpOrigin="{}";</script>"#, page_origin)
        } else {
            String::new()
        };
        let full_shim = format!("{}{}", origin_var, SHIM_SCRIPT);
        let inject_pos = lower
            .find("<head>")
            .map(|p| p + 6)
            .or_else(|| {
                lower
                    .find("<head ")
                    .and_then(|p| lower[p..].find('>').map(|q| p + q + 1))
            })
            .or_else(|| lower.find("<html>").map(|p| p + 6))
            .or_else(|| {
                lower
                    .find("<html ")
                    .and_then(|p| lower[p..].find('>').map(|q| p + q + 1))
            });
        if let Some(pos) = inject_pos {
            text.insert_str(pos, &full_shim);
        } else {
            text = format!("{}{}", full_shim, text);
        }
        text.into_bytes()
    } else {
        bytes
    };

    let len = final_bytes.len();
    if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], len.to_string().as_bytes()) {
        headers.push(h);
    }

    let resp_body_preview = if len > 0 {
        if is_js || is_html || content_type.contains("json") || content_type.contains("text") || content_type.contains("xml") {
            let slice_len = final_bytes.len().min(32768);
            if let Ok(s) = std::str::from_utf8(&final_bytes[..slice_len]) {
                if final_bytes.len() > 32768 {
                    Some(format!("{}... [truncated]", s))
                } else {
                    Some(s.to_string())
                }
            } else {
                Some(format!("<binary {} bytes>", len))
            }
        } else {
            Some(format!("<{} {} bytes>", if content_type.is_empty() { "binary" } else { &content_type }, len))
        }
    } else {
        None
    };

    let log_entry = WebAppLogEntry {
        id: LOG_ID_COUNTER.fetch_add(1, Ordering::SeqCst),
        timestamp,
        time_epoch,
        method: method_str,
        url: target_url,
        origin,
        status,
        status_text,
        duration_ms: start_instant.elapsed().as_millis() as u64,
        request_headers: req_headers_val,
        request_body: req_body_str,
        response_headers: resp_headers_val,
        response_body: resp_body_preview,
        content_type,
        content_length: len,
        blocked: false,
        block_reason: None,
        host_ip: None,
    };
    emit_log(log_entry);

    let response = Response::new(
        status.into(),
        headers,
        Cursor::new(final_bytes),
        Some(len),
        None,
    );
    let _ = request.respond(response);
}

pub fn start_webapp_proxy() {
    thread::spawn(move || {
        let mut builder = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10));
        if let Ok(cert) = reqwest::Certificate::from_pem(rumax::MINTSIFRY_ROOT_CA) {
            builder = builder.add_root_certificate(cert);
        }
        let client = Arc::new(builder.build().unwrap_or_default());
        let state = Arc::new(ProxyState {
            last_origin: Mutex::new(String::new()),
        });

        let server = match Server::http("127.0.0.1:11448") {
            Ok(s) => Arc::new(s),
            Err(e) => {
                eprintln!("Failed to bind webapp proxy: {}", e);
                return;
            }
        };

        for request in server.incoming_requests() {
            let client = Arc::clone(&client);
            let state = Arc::clone(&state);
            thread::spawn(move || {
                handle_request(request, &client, &state);
            });
        }
    });
}

#[tauri::command]
pub fn set_webapp_filter_rules(rules: Vec<WebAppFilterRule>) -> Result<(), String> {
    set_filter_rules(rules);
    Ok(())
}

#[tauri::command]
pub fn get_webapp_filter_rules() -> Result<Vec<WebAppFilterRule>, String> {
    Ok(get_filter_rules())
}

#[tauri::command]
pub fn get_webapp_ram_logs() -> Result<Vec<WebAppLogEntry>, String> {
    Ok(get_ram_logs())
}

#[tauri::command]
pub fn clear_webapp_ram_logs() -> Result<(), String> {
    clear_ram_logs();
    Ok(())
}
