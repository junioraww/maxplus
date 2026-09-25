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
    last_base_url: Mutex<String>,
    last_full_url: Mutex<String>,
}

static RE_DOMAIN: OnceLock<Regex> = OnceLock::new();
static RE_SECURE: OnceLock<Regex> = OnceLock::new();
static RE_PATH: OnceLock<Regex> = OnceLock::new();
static RE_SAMESITE: OnceLock<Regex> = OnceLock::new();
fn is_js_ident_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
}

fn rewrite_js_locations(text: &str) -> String {
    let bytes = text.as_bytes();
    let n = bytes.len();
    let mut out = String::with_capacity(n + 64);
    let mut i = 0;

    const PATTERNS: [(&str, &str); 6] = [
        ("window.location.hostname", "(window.__mpHostname||window.location.hostname)"),
        ("location.hostname", "(window.__mpHostname||location.hostname)"),
        ("window.location.origin", "(window.__mpOrigin||window.location.origin)"),
        ("location.origin", "(window.__mpOrigin||location.origin)"),
        ("window.location.host", "(window.__mpHost||window.location.host)"),
        ("location.host", "(window.__mpHost||location.host)"),
    ];

    while i < n {
        let mut matched = false;
        for (pat, repl) in PATTERNS.iter() {
            let pat_bytes = pat.as_bytes();
            let pat_len = pat_bytes.len();
            if i + pat_len <= n && &bytes[i..i + pat_len] == pat_bytes {
                let prev_ok = i == 0 || (!is_js_ident_char(bytes[i - 1]) && bytes[i - 1] != b'.');
                let next_pos = i + pat_len;
                let next_ok = next_pos == n || !is_js_ident_char(bytes[next_pos]);
                if prev_ok && next_ok {
                    out.push_str(repl);
                    i = next_pos;
                    matched = true;
                    break;
                }
            }
        }
        if !matched {
            let ch = text[i..].chars().next().unwrap_or(' ');
            out.push(ch);
            i += ch.len_utf8();
        }
    }

    out
}

fn clean_set_cookie_header(raw: &str) -> String {
    let re_dom = RE_DOMAIN.get_or_init(|| Regex::new(r"(?i)\bDomain=[^;]+;?\s*").unwrap());
    let re_sec = RE_SECURE.get_or_init(|| Regex::new(r"(?i)\bSecure;?\s*").unwrap());
    let re_path = RE_PATH.get_or_init(|| Regex::new(r"(?i)\bPath=[^;]+;?\s*").unwrap());
    let re_same = RE_SAMESITE.get_or_init(|| Regex::new(r"(?i)\bSameSite=[^;]+;?\s*").unwrap());

    let mut cleaned = re_dom.replace_all(raw, "").to_string();
    cleaned = re_sec.replace_all(&cleaned, "").to_string();
    cleaned = re_path.replace_all(&cleaned, "").to_string();
    cleaned = re_same.replace_all(&cleaned, "").to_string();

    let trimmed = cleaned.trim().trim_end_matches(';').trim();
    format!("{}; Path=/; SameSite=Lax", trimmed)
}

fn resolve_location_url(base_url: &str, loc: &str) -> String {
    let loc = loc.trim();
    if loc.starts_with("//") {
        let scheme = if base_url.starts_with("http://") { "http:" } else { "https:" };
        format!("{}{}", scheme, loc)
    } else if loc.starts_with('/') {
        let origin = get_origin_from_url(base_url);
        format!("{}{}", origin, loc)
    } else if !loc.contains("://") {
        if let Ok(base_parsed) = url::Url::parse(base_url) {
            if let Ok(joined) = base_parsed.join(loc) {
                return joined.to_string();
            }
        }
        let origin = get_origin_from_url(base_url);
        format!("{}/{}", origin.trim_end_matches('/'), loc)
    } else {
        loc.to_string()
    }
}

fn build_shim_script(port: u16, token: &str) -> String {
    let proxy_prefix = format!("http://127.0.0.1:{}/{}/proxy", port, token);
    let proxy_origin = format!("http://127.0.0.1:{}", port);
    format!(
        concat!(
            r#"<meta name="referrer" content="unsafe-url">"#,
            r#"<script>(function(){{if(window.__mpwb)return;window.__mpwb=true;"#,
            r#"try{{var _t='__mp_test__';window.localStorage.setItem(_t,_t);window.localStorage.removeItem(_t);}}catch(e){{try{{var _mem={{}};var _shim={{getItem:function(k){{return Object.prototype.hasOwnProperty.call(_mem,k)?_mem[k]:null;}},setItem:function(k,v){{_mem[k]=String(v);}},removeItem:function(k){{delete _mem[k];}},clear:function(){{_mem={{}};}},key:function(i){{return Object.keys(_mem)[i]||null;}},get length(){{return Object.keys(_mem).length;}}}};Object.defineProperty(window,'localStorage',{{value:_shim,writable:true,configurable:true}});Object.defineProperty(window,'sessionStorage',{{value:_shim,writable:true,configurable:true}});}}catch(x){{}}}}"#,
            r#"function deliver(n,d,p){{try{{var raw=typeof d==='string'?JSON.parse(d):(d||{{}});var obj=Object.assign({{}},raw);obj.type=n;var evt=new MessageEvent('message',{{data:JSON.stringify(obj),origin:'https://web.max.ru'}});window.dispatchEvent(evt);if(window.self===window.top&&window.WebApp&&typeof window.WebApp.sendEvent==='function'){{try{{window.WebApp.sendEvent(n,typeof d==='string'?d:JSON.stringify(d));}}catch(e){{}}}}if(window.Telegram&&window.Telegram.WebView&&typeof window.Telegram.WebView.receiveEvent==='function'){{try{{window.Telegram.WebView.receiveEvent(n,raw);}}catch(e){{}}}}}}catch(x){{}}}}window.__mpDeliver=deliver;"#,
            r#"function toParent(n,d){{if(window.parent===window)return;var o={{}};try{{o=typeof d==='string'?JSON.parse(d):(d||{{}});}}catch(e){{}}"#,
            r#"var m=Object.assign({{}},o);m.type=n;try{{window.parent.postMessage(JSON.stringify(m),'*');}}catch(e){{}}}}"#,
            r#"window.WebViewHandler={{postEvent:function(n,d){{toParent(n,d);}},resolveShare:function(){{}}}};"#,
            r#"window.PrivateWebViewHandler={{postEvent:function(n,d){{toParent(n,d);}}}};"#,
            r#"if(!window.AndroidPerf){{window.AndroidPerf={{trackFcp:function(){{}}}};}}"#,
            r#"window.addEventListener('message',function(e){{if(!e.data||e.source===window)return;var d;try{{d=typeof e.data==='string'?JSON.parse(e.data):e.data;}}catch(x){{return;}}"#,
            r#"if(d&&d.__mpDeliver&&typeof d.name==='string'){{deliver(d.name,d.data,!!d.priv);}}}});"#,
            r#"function resolveTarget(u){{"#,
            r#"if(!u||typeof u!=='string')return '';"#,
            r#"if(u.indexOf('data:')===0||u.indexOf('blob:')===0||u.indexOf('javascript:')===0)return '';"#,
            r#"if(u.indexOf('{}')===0||u.indexOf('/proxy')!==-1)return '';"#,
            r#"if(u.indexOf('https://')===0||u.indexOf('http://')===0){{"#,
            r#"if(u.indexOf('{}')===0||u.indexOf('http://localhost:{}')===0){{"#,
            r#"var path=u.replace(/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[a-f0-9]{{64}})?/,'');"#,
            r#"return window.__mpOrigin?window.__mpOrigin+path:'';"#,
            r#"}}return u;}}"#,
            r#"if(u.charAt(0)==='/'){{return window.__mpOrigin?window.__mpOrigin+u:'';}}"#,
            r#"if(window.__mpBase){{return window.__mpBase+(window.__mpBase.charAt(window.__mpBase.length-1)==='/'?'':'/')+u;}}"#,
            r#"if(window.__mpOrigin){{return window.__mpOrigin+'/'+u;}}"#,
            r#"return '';}}"#,
            r#"function wrapProxy(u){{"#,
            r#"if(!u||typeof u!=='string')return u;"#,
            r#"if(u.indexOf('data:')===0||u.indexOf('blob:')===0||u.indexOf('javascript:')===0||u.charAt(0)==='#')return u;"#,
            r#"if(u.indexOf('{}')===0)return u;"#,
            r#"var t=resolveTarget(u);"#,
            r#"if(t){{return '{}?url='+encodeURIComponent(t);}}"#,
            r#"return u;}}"#,
            r#"if(window.__mpRealUrl){{toParent('web_app_page_navigated',{{url:window.__mpRealUrl}});}}"#,
            r#"var of=window.fetch;if(of){{window.fetch=function(u,i){{try{{"#,
            r#"var s=typeof u==='string'?u:(u&&u.url?u.url:'');"#,
            r#"var p=wrapProxy(s);"#,
            r#"if(p!==s){{"#,
            r#"if(typeof u==='string'){{return of.call(this,p,i);}}"#,
            r#"if(u&&typeof u==='object'){{var self=this;var opts={{method:u.method,headers:u.headers,mode:u.mode,credentials:u.credentials,cache:u.cache,redirect:u.redirect,referrer:u.referrer}};if(u.method!=='GET'&&u.method!=='HEAD'){{return Promise.resolve().then(function(){{return u.clone().arrayBuffer();}}).then(function(buf){{opts.body=buf;return of.call(self,p,Object.assign(opts,i||{{}}));}}).catch(function(){{return of.call(self,p,i);}});}}else{{return of.call(self,p,Object.assign(opts,i||{{}}));}}}}"#,
            r#"}}"#,
            r#"}}catch(e){{}}return of.call(this,u,i);}};try{{window.fetch.toString=function(){{return 'function fetch() {{ [native code] }}';}};}}catch(e){{}}}}"#,
            r#"var ox=XMLHttpRequest.prototype.open;if(ox){{XMLHttpRequest.prototype.open=function(m,u){{try{{"#,
            r#"if(typeof u==='string'){{u=wrapProxy(u);}}"#,
            r#"}}catch(e){{}}var a=Array.prototype.slice.call(arguments);a[1]=u;return ox.apply(this,a);}};try{{ox.toString=function(){{return 'function open() {{ [native code] }}';}};}}catch(e){{}}}}"#,
            r#"document.addEventListener('click',function(e){{var a=e.target&&e.target.closest?e.target.closest('a'):null;if(!a)return;var h=a.getAttribute('href');if(!h||h.charAt(0)==='#'||h.indexOf('javascript:')===0)return;var tgt=a.getAttribute('target');var isMax=(h.indexOf('max.ru')!==-1||h.indexOf('max://')===0||(a.href&&a.href.indexOf('max.ru')!==-1)||(a.href&&a.href.indexOf('max://')===0));if(tgt==='_blank'||tgt==='_new'||isMax){{var targetUrl=resolveTarget(h)||resolveTarget(a.href)||a.href;if(targetUrl){{e.preventDefault();e.stopPropagation();toParent('web_app_open_link',{{url:targetUrl}});}}}}}},true);"#,
            r#"}}());</script>"#
        ),
        proxy_prefix,
        proxy_origin,
        port,
        proxy_prefix,
        proxy_prefix
    )
}

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
    let parsed_opt = if u.starts_with("//") {
        url::Url::parse(&format!("https:{}", u)).ok()
    } else {
        url::Url::parse(u).ok()
    };
    if let Some(parsed) = parsed_opt {
        let origin = parsed.origin().ascii_serialization();
        if origin != "null" && !origin.is_empty() {
            return origin;
        }
    }
    if let Some(pos) = u.find("://") {
        let rest = &u[pos + 3..];
        let host = match rest.find(|c| c == '/' || c == '?' || c == '#') {
            Some(p) => &rest[..p],
            None => rest,
        };
        format!("{}://{}", &u[..pos], host)
    } else {
        String::new()
    }
}

fn is_js_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let clean = lower.split('?').next().unwrap_or(&lower);
    let clean = clean.split('#').next().unwrap_or(clean).trim_end_matches('/');
    clean.ends_with(".js")
        || clean.ends_with(".mjs")
        || clean.ends_with(".cjs")
        || clean.ends_with(".ts")
        || clean.ends_with(".tsx")
        || clean.ends_with(".jsx")
        || lower.contains(".js?")
        || lower.contains(".mjs?")
        || lower.contains(".cjs?")
        || lower.contains(".js#")
        || lower.contains("/js/")
        || lower.contains("/javascript/")
}

fn is_css_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let clean = lower.split('?').next().unwrap_or(&lower);
    let clean = clean.split('#').next().unwrap_or(clean).trim_end_matches('/');
    clean.ends_with(".css") || lower.contains(".css?") || lower.contains(".css#")
}

fn decompress_body_if_needed(bytes: Vec<u8>) -> Vec<u8> {
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() {
            return decompressed;
        }
    } else if bytes.len() >= 2
        && bytes[0] == 0x78
        && (bytes[1] == 0x9c || bytes[1] == 0x01 || bytes[1] == 0xda)
    {
        let mut decoder = flate2::read::ZlibDecoder::new(&bytes[..]);
        let mut decompressed = Vec::new();
        if decoder.read_to_end(&mut decompressed).is_ok() {
            return decompressed;
        }
    }
    bytes
}

fn is_html_bytes(bytes: &[u8]) -> bool {
    let trimmed = match bytes.iter().position(|&b| !b.is_ascii_whitespace()) {
        Some(pos) => &bytes[pos..],
        None => bytes,
    };
    trimmed.starts_with(b"<!DOCTYPE")
        || trimmed.starts_with(b"<!doctype")
        || trimmed.starts_with(b"<html")
        || trimmed.starts_with(b"<HTML")
        || trimmed.starts_with(b"<?xml")
}

fn handle_request(
    mut request: tiny_http::Request,
    client: &reqwest::blocking::Client,
    state: &ProxyState,
    token: &str,
    port: u16,
) {
    let clean_path = match crate::proxy_auth::validate_and_strip_token_with_port(&request, token, port) {
        Some(p) => p,
        None => {
            let headers = vec![
                Header::from_bytes(&b"Content-Type"[..], b"text/plain; charset=utf-8").unwrap(),
                Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
            ];
            let res = Response::new(
                403.into(),
                headers,
                Cursor::new(b"Forbidden: invalid proxy token".to_vec()),
                Some(30),
                None,
            );
            let _ = request.respond(res);
            return;
        }
    };

    if request.method() == &Method::Options {
        let headers = vec![
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
            Header::from_bytes(
                &b"Access-Control-Allow-Methods"[..],
                b"GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
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

    let req_url = clean_path;
    let query_str = req_url.split_once('?').map(|x| x.1).unwrap_or("");
    let req_path_only = req_url.split('?').next().unwrap_or(&req_url);
    let is_proxy_endpoint = req_path_only == "/proxy" || req_path_only == "proxy";

    let mut direct_target = if is_proxy_endpoint {
        extract_query_param(query_str, "url").or_else(|| extract_query_param(query_str, "target"))
    } else {
        None
    };

    let req_dest_is_script = request.headers().iter().any(|h| {
        h.field.as_str().as_str().eq_ignore_ascii_case("sec-fetch-dest")
            && matches!(
                h.value.as_str().trim(),
                "script" | "worker" | "sharedworker" | "serviceworker"
            )
    });
    let req_dest_is_style = request.headers().iter().any(|h| {
        h.field.as_str().as_str().eq_ignore_ascii_case("sec-fetch-dest")
            && h.value.as_str().trim().eq_ignore_ascii_case("style")
    });
    let req_accepts_js = request.headers().iter().any(|h| {
        h.field.as_str().as_str().eq_ignore_ascii_case("accept")
            && (h.value.as_str().contains("javascript") || h.value.as_str().contains("ecmascript"))
    });
    let req_accepts_css = request.headers().iter().any(|h| {
        h.field.as_str().as_str().eq_ignore_ascii_case("accept")
            && h.value.as_str().contains("text/css")
    });

    let req_is_js = req_dest_is_script || req_accepts_js || is_js_path(&req_url);
    let req_is_css = req_dest_is_style || req_accepts_css || is_css_path(&req_url);

    let mut caller_origin = String::new();
    let mut caller_base = String::new();
    let mut referer_dir = String::new();
    let mut upstream_referer = String::new();
    let mut client_ua = None;
    let mut browser_has_origin = false;
    let mut req_headers_map = serde_json::Map::new();
    let mut passthrough_headers: Vec<(String, String)> = Vec::new();

    for h in request.headers() {
        let name = h.field.as_str().to_string();
        let val = h.value.as_str().to_string();
        req_headers_map.insert(name.clone(), serde_json::Value::String(val.clone()));

        if name.eq_ignore_ascii_case("origin") {
            browser_has_origin = true;
        } else if name.eq_ignore_ascii_case("user-agent") {
            client_ua = Some(val.clone());
        } else if name.eq_ignore_ascii_case("referer") {
            if let Some((_, ref_q)) = val.split_once('?') {
                if let Some(u) = extract_query_param(ref_q, "url").or_else(|| extract_query_param(ref_q, "target")) {
                    upstream_referer = u.clone();
                    caller_origin = get_origin_from_url(&u);
                    if let Ok(parsed) = url::Url::parse(&u) {
                        let mut p = parsed.path().to_string();
                        if let Some(pos) = p.rfind('/') {
                            p.truncate(pos + 1);
                        } else {
                            p = "/".to_string();
                        }
                        caller_base = format!("{}{}", caller_origin.trim_end_matches('/'), p);
                    }
                }
            }
            if caller_origin.is_empty() {
                caller_origin = get_origin_from_url(&val);
                if caller_origin.contains("127.0.0.1") || caller_origin.contains("localhost") {
                    caller_origin.clear();
                    if let Ok(parsed_ref) = url::Url::parse(&val) {
                        let mut p = parsed_ref.path().to_string();
                        let token_prefix = format!("/{}", token);
                        if let Some(rest) = p.strip_prefix(&token_prefix) {
                            p = rest.to_string();
                        }
                        if let Some(pos) = p.rfind('/') {
                            let d = &p[..pos + 1];
                            if d != "/" && !d.is_empty() && d != "/proxy" && d != "/proxy/" {
                                referer_dir = d.to_string();
                            }
                        }
                    }
                }
            }
        } else if name.eq_ignore_ascii_case("cookie") {
            for c in val.split(';') {
                let mut cp = c.trim().splitn(2, '=');
                if let (Some(k), Some(v)) = (cp.next(), cp.next()) {
                    if k == "webapp_target" && caller_origin.is_empty() {
                        caller_origin = v.to_string();
                    } else if k == "webapp_base" && caller_base.is_empty() {
                        caller_base = v.to_string();
                    }
                }
            }
            let filtered: Vec<&str> = val
                .split(';')
                .map(|c| c.trim())
                .filter(|c| !c.starts_with("webapp_target=") && !c.starts_with("webapp_base=") && !c.starts_with("__mp_token="))
                .collect();
            if !filtered.is_empty() {
                passthrough_headers.push(("Cookie".to_string(), filtered.join("; ")));
            }
            continue;
        }

        if !name.eq_ignore_ascii_case("host")
            && !name.eq_ignore_ascii_case("content-length")
            && !name.eq_ignore_ascii_case("origin")
            && !name.eq_ignore_ascii_case("referer")
            && !name.eq_ignore_ascii_case("user-agent")
            && !name.eq_ignore_ascii_case("accept-encoding")
        {
            passthrough_headers.push((name, val));
        }
    }

    if caller_origin.is_empty() {
        if let Ok(lock) = state.last_origin.lock() {
            caller_origin = lock.clone();
        }
    }

    if !referer_dir.is_empty() && !caller_origin.is_empty() {
        caller_base = format!("{}{}", caller_origin.trim_end_matches('/'), referer_dir);
    } else if caller_base.is_empty() {
        if let Ok(lock) = state.last_base_url.lock() {
            caller_base = lock.clone();
        }
    }

    let origin = caller_origin.clone();
    let base_url = caller_base.clone();

    let candidates: Vec<String> = if let Some(t) = direct_target.take() {
        vec![t]
    } else {
        let mut list = Vec::new();
        let rel = req_url.trim_start_matches('/');

        let c_base = if !base_url.is_empty() {
            let base_clean = base_url.trim_end_matches('/');
            if base_clean.ends_with("/assets") && rel.starts_with("assets/") {
                Some(format!("{}/{}", &base_clean[..base_clean.len() - 7], rel))
            } else {
                Some(format!("{}/{}", base_clean, rel))
            }
        } else {
            None
        };

        let c_origin = if !origin.is_empty() {
            Some(format!("{}/{}", origin.trim_end_matches('/'), rel))
        } else {
            None
        };

        let c_origin_assets = if !origin.is_empty() && (req_is_js || req_is_css) && !rel.starts_with("assets/") {
            Some(format!("{}/assets/{}", origin.trim_end_matches('/'), rel))
        } else {
            None
        };

        let c_base_assets = if !base_url.is_empty() && (req_is_js || req_is_css) && !rel.starts_with("assets/") {
            let base_clean = base_url.trim_end_matches('/');
            if !base_clean.ends_with("/assets") {
                Some(format!("{}/assets/{}", base_clean, rel))
            } else {
                None
            }
        } else {
            None
        };

        let to_add = if req_is_js || req_is_css || !req_url.starts_with('/') {
            vec![c_base, c_base_assets, c_origin, c_origin_assets]
        } else {
            vec![c_origin, c_base]
        };

        for cand_opt in to_add {
            if let Some(u) = cand_opt {
                if !list.contains(&u) {
                    list.push(u);
                }
            }
        }

        if list.is_empty() {
            if let Ok(lock) = state.last_base_url.lock() {
                if !lock.is_empty() {
                    let fallback = format!("{}/{}", lock.trim_end_matches('/'), rel);
                    if !list.contains(&fallback) {
                        list.push(fallback);
                    }
                }
            }
        }

        list
    };

    if candidates.is_empty() {
        let headers = vec![
            Header::from_bytes(&b"Content-Type"[..], b"text/plain; charset=utf-8").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
        ];
        let res = Response::new(
            400.into(),
            headers,
            Cursor::new(b"Missing target origin".to_vec()),
            Some(21),
            None,
        );
        let _ = request.respond(res);
        return;
    }

    if let Some(callback_url) = candidates.iter().find(|c| c.contains("externalCallback=1")) {
        let callback_html = format!(
            r#"<!DOCTYPE html><html><head><meta charset="utf-8"><script>try{{window.parent.postMessage(JSON.stringify({{type:"web_app_external_callback",url:"{}"}}),"*");}}catch(e){{}}</script></head><body></body></html>"#,
            callback_url.replace('"', "%22")
        );
        let bytes = callback_html.into_bytes();
        let len = bytes.len();
        let resp_headers = vec![
            Header::from_bytes(&b"Content-Type"[..], b"text/html; charset=utf-8").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
            Header::from_bytes(&b"Content-Length"[..], len.to_string().as_bytes()).unwrap(),
        ];
        let response = Response::new(200.into(), resp_headers, Cursor::new(bytes), Some(len), None);
        let _ = request.respond(response);
        return;
    }

    let start_instant = std::time::Instant::now();
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();
    let time_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let req_headers_val = serde_json::Value::Object(req_headers_map);
    let method_str = request.method().as_str().to_string();

    let mut req_body = Vec::new();
    if method_str == "POST" || method_str == "PUT" || method_str == "PATCH" {
        let _ = request.as_reader().read_to_end(&mut req_body);
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

    let origin_header = if !caller_origin.is_empty() {
        caller_origin.clone()
    } else if !origin.is_empty() {
        origin.clone()
    } else {
        get_origin_from_url(&candidates[0])
    };

    if upstream_referer.is_empty() {
        if let Ok(lock) = state.last_full_url.lock() {
            if !lock.is_empty() {
                upstream_referer = lock.clone();
            }
        }
    }

    if upstream_referer.is_empty() {
        if !origin_header.is_empty() {
            upstream_referer = format!("{}/", origin_header.trim_end_matches('/'));
        } else {
            upstream_referer = "https://max.ru/".to_string();
        }
    }

    let upstream_ua = client_ua.as_deref().unwrap_or(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );

    let upstream_origin = if !origin_header.is_empty() {
        origin_header.clone()
    } else {
        get_origin_from_url(&candidates[0])
    };

    let build_request = |url: &str| -> reqwest::blocking::RequestBuilder {
        let mut rb = match method_str.as_str() {
            "POST" => client.post(url),
            "PUT" => client.put(url),
            "DELETE" => client.delete(url),
            "HEAD" => client.head(url),
            "PATCH" => client.patch(url),
            _ => client.get(url),
        };
        rb = rb.header("User-Agent", upstream_ua);
        rb = rb.header("Referer", &upstream_referer);
        if browser_has_origin || (method_str != "GET" && method_str != "HEAD") {
            if !upstream_origin.is_empty() {
                rb = rb.header("Origin", &upstream_origin);
            }
        }
        for (name, val) in &passthrough_headers {
            rb = rb.header(name.as_str(), val.as_str());
        }
        if !req_body.is_empty() {
            rb = rb.body(req_body.clone());
        }
        rb
    };

    let mut chosen_target = candidates[0].clone();
    let mut chosen_res = None;
    let mut chosen_bytes = Vec::new();
    let mut last_err = None;

    for (idx, cand) in candidates.iter().enumerate() {
        chosen_target = cand.clone();
        if let Some(reason) = check_blocked(&chosen_target) {
            let entry = WebAppLogEntry {
                id: LOG_ID_COUNTER.fetch_add(1, Ordering::SeqCst),
                timestamp: timestamp.clone(),
                time_epoch,
                method: method_str.clone(),
                url: chosen_target.clone(),
                origin: origin.clone(),
                status: 0,
                status_text: "DROPPED".to_string(),
                duration_ms: start_instant.elapsed().as_millis() as u64,
                request_headers: req_headers_val.clone(),
                request_body: req_body_str.clone(),
                response_headers: serde_json::json!({}),
                response_body: None,
                content_type: String::new(),
                content_length: 0,
                blocked: true,
                block_reason: Some(reason),
                host_ip: None,
            };
            emit_log(entry);
            drop(request.into_writer());
            return;
        }

        let rb = build_request(&chosen_target);
        match rb.send() {
            Ok(mut r) => {
                let status = r.status().as_u16();
                let mut b = Vec::new();
                let _ = r.copy_to(&mut b);
                let decomp = decompress_body_if_needed(b);
                let html_body = is_html_bytes(&decomp);

                let is_js = req_is_js || is_js_path(&chosen_target);
                let is_css = req_is_css || is_css_path(&chosen_target);
                let is_redirect = status >= 300 && status < 400;

                let is_failure = (status >= 400) || (!is_redirect && (is_js || is_css) && html_body);
                let has_more = idx + 1 < candidates.len();

                if is_failure && has_more && (method_str == "GET" || method_str == "HEAD") {
                    continue;
                }

                chosen_res = Some(r);
                chosen_bytes = decomp;
                break;
            }
            Err(e) => {
                last_err = Some(e);
                if idx + 1 < candidates.len() && (method_str == "GET" || method_str == "HEAD") {
                    continue;
                }
                break;
            }
        }
    }

    let res = match chosen_res {
        Some(r) => r,
        None => {
            let err_msg = last_err.map(|e| e.to_string()).unwrap_or_else(|| "Bad Gateway".to_string());
            let entry = WebAppLogEntry {
                id: LOG_ID_COUNTER.fetch_add(1, Ordering::SeqCst),
                timestamp,
                time_epoch,
                method: method_str,
                url: chosen_target.clone(),
                origin,
                status: 502,
                status_text: "Bad Gateway".to_string(),
                duration_ms: start_instant.elapsed().as_millis() as u64,
                request_headers: req_headers_val,
                request_body: req_body_str,
                response_headers: serde_json::json!({}),
                response_body: Some(err_msg.clone()),
                content_type: "text/plain".to_string(),
                content_length: 0,
                blocked: false,
                block_reason: None,
                host_ip: None,
            };
            emit_log(entry);

            let err_body = err_msg.into_bytes();
            let err_len = err_body.len();
            let headers = vec![
                Header::from_bytes(&b"Content-Type"[..], b"text/plain; charset=utf-8").unwrap(),
                Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
                Header::from_bytes(&b"Content-Length"[..], err_len.to_string().as_bytes()).unwrap(),
            ];
            let res = Response::new(502.into(), headers, Cursor::new(err_body), Some(err_len), None);
            let _ = request.respond(res);
            return;
        }
    };

    let mut status = res.status().as_u16();
    let status_text = res.status().canonical_reason().unwrap_or("").to_string();
    let effective_target = res.url().as_str().to_string();
    let final_url = effective_target.replace('"', "%22");

    let is_js = req_is_js || is_js_path(&chosen_target) || is_js_path(&effective_target);
    let is_css = req_is_css || is_css_path(&chosen_target) || is_css_path(&effective_target);
    let is_redirect = status >= 300 && status < 400;

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

    let mut content_type = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let is_js = is_js || content_type.contains("javascript");
    let is_css = is_css || content_type.contains("text/css");
    let html_body = is_html_bytes(&chosen_bytes);

    if is_js {
        content_type = "application/javascript; charset=utf-8".to_string();
    } else if is_css {
        content_type = "text/css; charset=utf-8".to_string();
    } else if content_type.is_empty() {
        if let Some(mime) = mime_guess::from_path(&chosen_target).first().or_else(|| mime_guess::from_path(&req_url).first()) {
            content_type = mime.to_string();
        }
    }

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
            || name.eq_ignore_ascii_case("connection")
        {
            continue;
        }
        if name.eq_ignore_ascii_case("set-cookie") {
            let val = v.to_str().unwrap_or("");
            let cleaned = clean_set_cookie_header(val);
            if let Ok(h) = Header::from_bytes(name.as_bytes(), cleaned.as_bytes()) {
                headers.push(h);
            }
            continue;
        }
        if name.eq_ignore_ascii_case("location") {
            let loc_val = v.to_str().unwrap_or("");
            let resolved_loc = resolve_location_url(&chosen_target, loc_val);
            let o = get_origin_from_url(&resolved_loc);
            if !o.is_empty() {
                if let Ok(mut lock) = state.last_origin.lock() {
                    *lock = o.clone();
                }
                if let Ok(parsed) = url::Url::parse(&resolved_loc) {
                    let mut p = parsed.path().to_string();
                    if let Some(pos) = p.rfind('/') {
                        p.truncate(pos + 1);
                    } else {
                        p = "/".to_string();
                    }
                    if let Ok(mut lock) = state.last_base_url.lock() {
                        *lock = format!("{}{}", o.trim_end_matches('/'), p);
                    }
                }
            }
            if resolved_loc.contains("externalCallback=1") {
                let callback_html = format!(
                    r#"<!DOCTYPE html><html><head><meta charset="utf-8"><script>try{{window.parent.postMessage(JSON.stringify({{type:"web_app_external_callback",url:"{}"}}),"*");}}catch(e){{}}</script></head><body></body></html>"#,
                    resolved_loc.replace('"', "%22")
                );
                let mut resp_headers = vec![
                    Header::from_bytes(&b"Content-Type"[..], b"text/html; charset=utf-8").unwrap(),
                    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
                ];
                for (ck, cv) in res.headers() {
                    if ck.as_str().eq_ignore_ascii_case("set-cookie") {
                        if let Ok(cval) = cv.to_str() {
                            let cleaned = clean_set_cookie_header(cval);
                            if let Ok(h) = Header::from_bytes(b"Set-Cookie", cleaned.as_bytes()) {
                                resp_headers.push(h);
                            }
                        }
                    }
                }
                let bytes = callback_html.into_bytes();
                let len = bytes.len();
                if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], len.to_string().as_bytes()) {
                    resp_headers.push(h);
                }
                let response = Response::new(200.into(), resp_headers, Cursor::new(bytes), Some(len), None);
                let _ = request.respond(response);
                return;
            }
            let proxy_loc = if resolved_loc.starts_with("http://") || resolved_loc.starts_with("https://") {
                format!("http://127.0.0.1:{}/{}/proxy?url={}", port, token, urlencoding::encode(&resolved_loc))
            } else {
                resolved_loc
            };
            if let Ok(h) = Header::from_bytes(b"Location", proxy_loc.as_bytes()) {
                headers.push(h);
            }
            continue;
        }
        if let Ok(h) = Header::from_bytes(name.as_bytes(), v.as_bytes()) {
            headers.push(h);
        }
    }

    let is_html = content_type.contains("text/html") && !is_js && !is_css;
    let page_origin = {
        let o = get_origin_from_url(&effective_target);
        if o.is_empty() {
            get_origin_from_url(&chosen_target)
        } else {
            o
        }
    };

    let base_path_str = if let Ok(parsed) = url::Url::parse(&effective_target) {
        let mut p = parsed.path().to_string();
        if let Some(pos) = p.rfind('/') {
            p.truncate(pos + 1);
        } else {
            p = "/".to_string();
        }
        format!("{}{}", page_origin.trim_end_matches('/'), p)
    } else {
        String::new()
    };

    if is_html && !page_origin.is_empty() {
        if let Ok(mut lock) = state.last_origin.lock() {
            *lock = page_origin.clone();
        }
        if let Ok(mut lock) = state.last_full_url.lock() {
            *lock = effective_target.clone();
        }
        if !base_path_str.is_empty() {
            if let Ok(mut lock) = state.last_base_url.lock() {
                *lock = base_path_str.clone();
            }
        }
        let cookie_val = format!("webapp_target={}; Path=/; SameSite=Lax", page_origin);
        if let Ok(h) = Header::from_bytes(&b"Set-Cookie"[..], cookie_val.as_bytes()) {
            headers.push(h);
        }
        if !base_path_str.is_empty() {
            let cookie_base = format!("webapp_base={}; Path=/; SameSite=Lax", base_path_str);
            if let Ok(h) = Header::from_bytes(&b"Set-Cookie"[..], cookie_base.as_bytes()) {
                headers.push(h);
            }
        }
    }

    let final_bytes = if is_html && (status >= 200 && status < 300) {
        let mut text = String::from_utf8_lossy(&chosen_bytes).to_string();
        text = rewrite_js_locations(&text);
        let host_val = url::Url::parse(&effective_target)
            .ok()
            .and_then(|u| u.host_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let port_suffix = url::Url::parse(&effective_target)
            .ok()
            .and_then(|u| u.port().map(|p| format!(":{}", p)))
            .unwrap_or_default();
        let full_host = format!("{}{}", host_val, port_suffix);

        let origin_var = if !page_origin.is_empty() {
            format!(
                r#"<script>window.__mpOrigin="{}";window.__mpBase="{}";window.__mpRealUrl="{}";window.__mpHostname="{}";window.__mpHost="{}";</script>"#,
                page_origin, base_path_str, final_url, host_val, full_host
            )
        } else {
            format!(r#"<script>window.__mpRealUrl="{}";</script>"#, final_url)
        };
        let full_shim = format!("{}{}", origin_var, build_shim_script(port, token));
        let lower = text.to_ascii_lowercase();
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
    } else if is_js && !is_redirect && (status >= 400 || html_body) {
        status = 200;
        content_type = "application/javascript; charset=utf-8".to_string();
        b"/* not found */".to_vec()
    } else if is_css && !is_redirect && (status >= 400 || html_body) {
        status = 200;
        content_type = "text/css; charset=utf-8".to_string();
        Vec::new()
    } else if is_js && (status >= 200 && status < 300) {
        let text = String::from_utf8_lossy(&chosen_bytes).to_string();
        rewrite_js_locations(&text).into_bytes()
    } else {
        chosen_bytes
    };

    if !content_type.is_empty() {
        if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()) {
            headers.push(h);
        }
    }

    let len = final_bytes.len();
    if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], len.to_string().as_bytes()) {
        headers.push(h);
    }

    let resp_body_preview = if len > 0 {
        if is_html
            || content_type.contains("javascript")
            || content_type.contains("json")
            || content_type.contains("text")
            || content_type.contains("xml")
            || content_type.contains("css")
        {
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
        url: chosen_target,
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

    let cookie_header = format!("__mp_token={}; Path=/; SameSite=Lax", token);
    if let Ok(h) = Header::from_bytes(b"Set-Cookie", cookie_header.as_bytes()) {
        headers.push(h);
    }

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
    let token = crate::proxy_auth::get_webapp_token();
    let bind_addr = std::env::var("MAXPLUS_WEBAPP_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .map(|p| format!("127.0.0.1:{}", p))
        .unwrap_or_else(|| "127.0.0.1:0".to_string());

    let server = match Server::http(&bind_addr) {
        Ok(s) => {
            if let Some(addr) = s.server_addr().to_ip() {
                crate::proxy_auth::set_webapp_proxy_info(addr.port(), token.clone());
            }
            Arc::new(s)
        }
        Err(e) => {
            eprintln!("Failed to bind webapp proxy: {}", e);
            return;
        }
    };

    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);

    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.url().as_str().contains("externalCallback=1") {
            attempt.stop()
        } else if attempt.previous().len() >= 10 {
            attempt.stop()
        } else {
            attempt.follow()
        }
    });

    thread::spawn(move || {
        let mut builder = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(50)
            .pool_idle_timeout(Duration::from_secs(90))
            .redirect(redirect_policy);
        if let Ok(cert) = reqwest::Certificate::from_pem(rumax::MINTSIFRY_ROOT_CA) {
            builder = builder.add_root_certificate(cert);
        }
        let client = Arc::new(builder.build().unwrap_or_default());
        let state = Arc::new(ProxyState {
            last_origin: Mutex::new(String::new()),
            last_base_url: Mutex::new(String::new()),
            last_full_url: Mutex::new(String::new()),
        });

        for request in server.incoming_requests() {
            let client = Arc::clone(&client);
            let state = Arc::clone(&state);
            let token = token.clone();
            thread::spawn(move || {
                handle_request(request, &client, &state, &token, port);
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
