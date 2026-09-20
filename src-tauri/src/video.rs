use reqwest::header::{
    CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH,
    IF_RANGE, LAST_MODIFIED, RANGE,
};
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::{Arc, LazyLock, RwLock};
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server};

static MIME_CACHE: LazyLock<RwLock<HashMap<String, String>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

fn handle_local_file(request: tiny_http::Request, mut path: &str) {
    if let Some(stripped) = path.strip_prefix("file://") {
        path = stripped;
    }
    use std::fs::File;
    use std::io::{Seek, SeekFrom};

    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(_) => {
            let _ = request.respond(Response::from_string("File Not Found").with_status_code(404));
            return;
        }
    };

    let file_len = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => {
            let _ = request.respond(Response::from_string("Error reading file").with_status_code(500));
            return;
        }
    };

    let mut mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
    if mime == "application/octet-stream" || mime == "binary/octet-stream" {
        let mut peek_buf = [0u8; 16];
        if let Ok(n) = file.read(&mut peek_buf) {
            let peeked = &peek_buf[..n];
            if peeked.starts_with(b"OggS") {
                mime = "audio/ogg".to_string();
            } else if peeked.starts_with(b"\x1a\x45\xdf\xa3") {
                mime = "video/webm".to_string();
            } else if peeked.len() >= 8 && &peeked[4..8] == b"ftyp" {
                mime = "video/mp4".to_string();
            } else if peeked.starts_with(b"ID3") || (peeked.len() >= 2 && peeked[0] == 0xff && (peeked[1] & 0xe0) == 0xe0) {
                mime = "audio/mpeg".to_string();
            } else if peeked.starts_with(b"RIFF") {
                mime = "audio/wav".to_string();
            }
            let _ = file.seek(SeekFrom::Start(0));
        }
    }

    let mut range_header = None;
    for h in request.headers() {
        if h.field.as_str().as_str().eq_ignore_ascii_case("Range") {
            range_header = Some(h.value.to_string());
            break;
        }
    }

    let mut headers = vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
        Header::from_bytes(&b"Accept-Ranges"[..], b"bytes").unwrap(),
        Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).unwrap(),
    ];

    if let Some(rh) = range_header {
        if let Some(range_spec) = rh.strip_prefix("bytes=") {
            let parts: Vec<&str> = range_spec.split('-').collect();
            let start = parts.get(0).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let end = parts.get(1).and_then(|s| s.parse::<u64>().ok()).unwrap_or(file_len.saturating_sub(1));
            let end = std::cmp::min(end, file_len.saturating_sub(1));

            if start <= end && start < file_len {
                let length = end - start + 1;
                let _ = file.seek(SeekFrom::Start(start));
                let take_reader = file.take(length);

                headers.push(Header::from_bytes(
                    &b"Content-Range"[..],
                    format!("bytes {}-{}/{}", start, end, file_len).as_bytes(),
                ).unwrap());
                headers.push(Header::from_bytes(
                    &b"Content-Length"[..],
                    length.to_string().as_bytes(),
                ).unwrap());

                let res = Response::new(
                    206.into(),
                    headers,
                    take_reader,
                    Some(length as usize),
                    None,
                );
                let _ = request.respond(res);
                return;
            }
        }
    }

    headers.push(Header::from_bytes(
        &b"Content-Length"[..],
        file_len.to_string().as_bytes(),
    ).unwrap());

    let res = Response::new(
        200.into(),
        headers,
        file,
        Some(file_len as usize),
        None,
    );
    let _ = request.respond(res);
}

fn handle_request(request: tiny_http::Request, client: &reqwest::blocking::Client) {
    if request.method() == &Method::Options {
        let headers = vec![
            Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
            Header::from_bytes(&b"Access-Control-Allow-Methods"[..], b"GET, HEAD, OPTIONS").unwrap(),
            Header::from_bytes(
                &b"Access-Control-Allow-Headers"[..],
                b"Range, Origin, X-Requested-With, Content-Type, Accept",
            )
            .unwrap(),
            Header::from_bytes(&b"Access-Control-Max-Age"[..], b"86400").unwrap(),
        ];
        let res = Response::new(200.into(), headers, Cursor::new(Vec::new()), Some(0), None);
        let _ = request.respond(res);
        return;
    }

    let raw_url = &request.url()[1..];
    let url = match urlencoding::decode(raw_url) {
        Ok(u) => u.into_owned(),
        Err(_) => {
            let _ = request.respond(Response::from_string("Invalid URL").with_status_code(400));
            return;
        }
    };

    if url.starts_with('/') {
        handle_local_file(request, &url);
        return;
    }
    if let Some(local_path) = url.strip_prefix("file://") {
        handle_local_file(request, local_path);
        return;
    }
    if let Some(asset_path) = url.strip_prefix("asset://localhost/") {
        let decoded = urlencoding::decode(asset_path).unwrap_or(std::borrow::Cow::Borrowed(asset_path));
        handle_local_file(request, &decoded);
        return;
    }
    if let Some(asset_path) = url.strip_prefix("http://asset.localhost/") {
        let decoded = urlencoding::decode(asset_path).unwrap_or(std::borrow::Cow::Borrowed(asset_path));
        handle_local_file(request, &decoded);
        return;
    }

    let mut rb = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header("Referer", "https://max.ru/");

    let mut is_range_offset = false;
    for h in request.headers() {
        let name = h.field.as_str().as_str();
        if name.eq_ignore_ascii_case("Range") {
            let val = h.value.as_str();
            if !val.starts_with("bytes=0-") {
                is_range_offset = true;
            }
            rb = rb.header(RANGE, val);
        } else if name.eq_ignore_ascii_case("If-Range") {
            rb = rb.header(IF_RANGE, h.value.as_str());
        } else if name.eq_ignore_ascii_case("If-None-Match") {
            rb = rb.header(IF_NONE_MATCH, h.value.as_str());
        } else if name.eq_ignore_ascii_case("If-Modified-Since") {
            rb = rb.header(IF_MODIFIED_SINCE, h.value.as_str());
        }
    }

    let mut res = match rb.send() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Upstream request error: {}", e);
            let _ = request.respond(Response::from_string("Bad Gateway").with_status_code(502));
            return;
        }
    };

    let status = res.status().as_u16();

    let mut content_length_val = res
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok());

    if content_length_val.is_none() {
        if let Some(cr) = res.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
            if let Some(range_part) = cr.strip_prefix("bytes ") {
                if let Some(dash) = range_part.find('-') {
                    if let Some(slash) = range_part.find('/') {
                        let start = range_part[..dash].parse::<usize>().ok();
                        let end = range_part[dash + 1..slash].parse::<usize>().ok();
                        if let (Some(s), Some(e)) = (start, end) {
                            if e >= s {
                                content_length_val = Some(e - s + 1);
                            }
                        }
                    }
                }
            }
        }
    }

    let upstream_ct = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let mut peek_buf = [0u8; 16];
    let n = res.read(&mut peek_buf).unwrap_or(0);
    let peeked = &peek_buf[..n];

    let cached_ct = MIME_CACHE.read().ok().and_then(|c| c.get(&url).cloned());
    let content_type = if let Some(ct) = cached_ct {
        ct
    } else if is_range_offset {
        let lower_url = url.to_lowercase();
        if lower_url.contains(".ogg") || lower_url.contains(".opus") || lower_url.contains("audio") || lower_url.contains("voice") {
            "audio/ogg".to_string()
        } else if lower_url.contains(".mp3") {
            "audio/mpeg".to_string()
        } else if lower_url.contains(".wav") {
            "audio/wav".to_string()
        } else if lower_url.contains(".webm") {
            "video/webm".to_string()
        } else {
            "video/mp4".to_string()
        }
    } else {
        let ct = match upstream_ct {
            Some(ct) if ct != "application/octet-stream" && ct != "binary/octet-stream" => ct,
            _ => {
                if peeked.starts_with(b"OggS") {
                    "audio/ogg".to_string()
                } else if peeked.starts_with(b"\x1a\x45\xdf\xa3") {
                    "video/webm".to_string()
                } else if peeked.len() >= 8 && &peeked[4..8] == b"ftyp" {
                    "video/mp4".to_string()
                } else if peeked.starts_with(b"ID3") || (peeked.len() >= 2 && peeked[0] == 0xff && (peeked[1] & 0xe0) == 0xe0) {
                    "audio/mpeg".to_string()
                } else if peeked.starts_with(b"RIFF") {
                    "audio/wav".to_string()
                } else {
                    let lower_url = url.to_lowercase();
                    if lower_url.contains(".ogg") || lower_url.contains(".opus") || lower_url.contains("audio") || lower_url.contains("voice") {
                        "audio/ogg".to_string()
                    } else if lower_url.contains(".mp3") {
                        "audio/mpeg".to_string()
                    } else if lower_url.contains(".wav") {
                        "audio/wav".to_string()
                    } else if lower_url.contains(".webm") {
                        "video/webm".to_string()
                    } else {
                        "video/mp4".to_string()
                    }
                }
            }
        };
        if let Ok(mut lock) = MIME_CACHE.write() {
            lock.insert(url.clone(), ct.clone());
        }
        ct
    };

    let mut headers = vec![
        Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
        Header::from_bytes(
            &b"Access-Control-Expose-Headers"[..],
            b"Content-Range, Content-Length, Accept-Ranges",
        )
        .unwrap(),
        Header::from_bytes(&b"Accept-Ranges"[..], b"bytes").unwrap(),
    ];

    if let Some(cr) = res.headers().get(CONTENT_RANGE) {
        if let Ok(h) = Header::from_bytes(&b"Content-Range"[..], cr.as_bytes()) {
            headers.push(h);
        }
    }

    if let Some(etag) = res.headers().get(ETAG) {
        if let Ok(h) = Header::from_bytes(&b"ETag"[..], etag.as_bytes()) {
            headers.push(h);
        }
    }

    if let Some(lm) = res.headers().get(LAST_MODIFIED) {
        if let Ok(h) = Header::from_bytes(&b"Last-Modified"[..], lm.as_bytes()) {
            headers.push(h);
        }
    }

    let chained = Cursor::new(peeked.to_vec()).chain(res);
    let mut response = Response::new(status.into(), headers, chained, content_length_val, None);
    response = response.with_chunked_threshold(usize::MAX);
    let _ = request.respond(response);
}

pub fn start_video_proxy() {
    thread::spawn(move || {
        let mut builder = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10));
        if let Ok(cert) = reqwest::Certificate::from_pem(rumax::MINTSIFRY_ROOT_CA) {
            builder = builder.add_root_certificate(cert);
        }
        let client = Arc::new(builder.build().unwrap_or_default());

        let server = match Server::http("127.0.0.1:11447") {
            Ok(s) => Arc::new(s),
            Err(e) => {
                eprintln!("Failed to bind video proxy: {}", e);
                return;
            }
        };

        for request in server.incoming_requests() {
            let client = Arc::clone(&client);
            thread::spawn(move || {
                handle_request(request, &client);
            });
        }
    });
}
