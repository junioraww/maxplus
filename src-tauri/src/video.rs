use reqwest::header::{
    CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH,
    IF_RANGE, LAST_MODIFIED, RANGE,
};
use std::io::Cursor;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server};

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

    let mut rb = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header("Referer", "https://max.ru/");

    for h in request.headers() {
        let name = h.field.as_str().as_str();
        if name.eq_ignore_ascii_case("Range") {
            rb = rb.header(RANGE, h.value.as_str());
        } else if name.eq_ignore_ascii_case("If-Range") {
            rb = rb.header(IF_RANGE, h.value.as_str());
        } else if name.eq_ignore_ascii_case("If-None-Match") {
            rb = rb.header(IF_NONE_MATCH, h.value.as_str());
        } else if name.eq_ignore_ascii_case("If-Modified-Since") {
            rb = rb.header(IF_MODIFIED_SINCE, h.value.as_str());
        }
    }

    let res = match rb.send() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Upstream request error: {}", e);
            let _ = request.respond(Response::from_string("Bad Gateway").with_status_code(502));
            return;
        }
    };

    let status = res.status().as_u16();

    let content_length_val = res
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok());

    let content_type = res
        .headers()
        .get(CONTENT_TYPE)
        .map(|h| h.to_str().unwrap_or("video/mp4"))
        .unwrap_or("video/mp4");

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

    if let Some(cl) = res.headers().get(CONTENT_LENGTH) {
        if let Ok(h) = Header::from_bytes(&b"Content-Length"[..], cl.as_bytes()) {
            headers.push(h);
        }
    }

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

    let response = Response::new(status.into(), headers, res, content_length_val, None);
    let _ = request.respond(response);
}

pub fn start_video_proxy() {
    thread::spawn(move || {
        let mut builder = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(10));
        if let Ok(cert) = reqwest::Certificate::from_pem(rumax::MINCIFRY_ROOT_CA) {
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
