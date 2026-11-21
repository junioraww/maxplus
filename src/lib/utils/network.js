import { invoke } from "@tauri-apps/api/core";

export async function proxyFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {};
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [k, v] of options.headers) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, options.headers);
    }
  }

  let bodyBytes = null;
  if (options.body) {
    if (typeof options.body === "string") {
      bodyBytes = Array.from(new TextEncoder().encode(options.body));
    } else if (options.body instanceof Uint8Array || options.body instanceof ArrayBuffer) {
      bodyBytes = Array.from(new Uint8Array(options.body));
    }
  }

  const res = await invoke("proxy_http_request", {
    url: String(url),
    method,
    headers: Object.keys(headers).length > 0 ? headers : null,
    body: bodyBytes,
  });

  const binaryString = atob(res.body_base64 || "");
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Response(bytes, {
    status: res.status,
    statusText: res.status_text,
    headers: new Headers(res.headers),
  });
}

export function setupFetchProxyInterceptor() {
  if (typeof window === "undefined" || window.__maxplus_fetch_patched) return;
  window.__maxplus_fetch_patched = true;

  const originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input?.url || "");
    if (url.startsWith("https://") || url.startsWith("http://")) {
      const isLocal =
        url.includes("127.0.0.1") ||
        url.includes("localhost") ||
        url.startsWith("asset://");
      if (!isLocal) {
        try {
          return await proxyFetch(url, init);
        } catch (_) {
          return await originalFetch.apply(this, arguments);
        }
      }
    }
    return originalFetch.apply(this, arguments);
  };
}
