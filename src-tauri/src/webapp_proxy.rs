use regex::Regex;
use reqwest::header::CONTENT_TYPE;
use std::io::{Cursor, Read};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server};

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

    let method_str = request.method().as_str();
    let mut rb = match method_str {
        "POST" => client.post(&target_url),
        "PUT" => client.put(&target_url),
        "DELETE" => client.delete(&target_url),
        "HEAD" => client.head(&target_url),
        _ => client.get(&target_url),
    };

    let origin_header = if !caller_origin.is_empty() {
        caller_origin
    } else if !origin.is_empty() {
        origin
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

    if method_str == "POST" || method_str == "PUT" || method_str == "PATCH" {
        let mut body = Vec::new();
        let _ = request.as_reader().read_to_end(&mut body);
        if !body.is_empty() {
            rb = rb.body(body);
        }
    }

    let res = match rb.send() {
        Ok(r) => r,
        Err(_) => {
            let _ = request.respond(Response::from_string("Bad Gateway").with_status_code(502));
            return;
        }
    };

    let status = res.status().as_u16();

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
