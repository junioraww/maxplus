import { test, expect } from "@playwright/test";
import { getProxiedMediaUrl, isProxiedMediaUrl, unwrapProxiedMediaUrl } from "../src/lib/utils/images.js";
import { resolveWebAppUrl } from "../src/lib/utils/maxLink.js";
import { setProxyConfig, getVideoProxyBase, getWebAppProxyBase, getProxyConfig } from "../src/lib/utils/proxyConfig.js";

test.describe("Proxy security, dynamic port and token handling", () => {
  test("generates proxied media URL with dynamic port and token", () => {
    setProxyConfig({
      videoPort: 54321,
      videoToken: "synthetic_secret_token_12345",
      webappPort: 54322,
      webappToken: "synthetic_webapp_token_67890",
    });

    expect(getVideoProxyBase()).toBe("http://127.0.0.1:54321/synthetic_secret_token_12345");
    expect(getWebAppProxyBase()).toBe("http://127.0.0.1:54322/synthetic_webapp_token_67890");

    const mediaUrl = getProxiedMediaUrl("https://synthetic.cdn.test/video.mp4");
    expect(mediaUrl).toBe(
      "http://127.0.0.1:54321/synthetic_secret_token_12345/https%3A%2F%2Fsynthetic.cdn.test%2Fvideo.mp4"
    );

    const localUrl = getProxiedMediaUrl("/synthetic/path/sample.mp4");
    expect(localUrl).toBe(
      "http://127.0.0.1:54321/synthetic_secret_token_12345/%2Fsynthetic%2Fpath%2Fsample.mp4"
    );
  });

  test("identifies and unwraps proxied media URLs", () => {
    const raw = "https://synthetic.cdn.test/audio.ogg";
    const proxied = getProxiedMediaUrl(raw);

    expect(isProxiedMediaUrl(proxied)).toBe(true);
    expect(isProxiedMediaUrl("https://synthetic.cdn.test/audio.ogg")).toBe(false);
    expect(isProxiedMediaUrl("blob:synthetic-blob-url")).toBe(false);

    expect(unwrapProxiedMediaUrl(proxied)).toBe(raw);
    expect(unwrapProxiedMediaUrl("https://synthetic.cdn.test/audio.ogg")).toBe("https://synthetic.cdn.test/audio.ogg");
  });

  test("resolves webapp proxy URL with dynamic port and token", () => {
    setProxyConfig({
      webappPort: 48999,
      webappToken: "webapp_auth_token_abcde",
    });

    const webappUrl = resolveWebAppUrl("https://synthetic.webapp.test/app#section1");
    expect(webappUrl).toBe(
      "http://127.0.0.1:48999/webapp_auth_token_abcde/proxy?url=https%3A%2F%2Fsynthetic.webapp.test%2Fapp#section1"
    );
  });

  test("normalizes secured webapp proxy URLs with port and token", () => {
    const normalizeExternalUrl = (raw) => {
      if (!raw || typeof raw !== "string") return "";
      let clean = raw.trim();
      if (clean.includes("/proxy") || clean.includes("127.0.0.1") || clean.includes("localhost")) {
        try {
          const u = new URL(clean);
          const extracted = u.searchParams.get("url") || u.searchParams.get("target");
          if (extracted) clean = extracted;
        } catch {}
      }
      return clean;
    };

    const securedUrl = "http://127.0.0.1:48999/webapp_auth_token_abcde/proxy?url=https%3A%2F%2Fsynthetic.external.test%2Ftarget";
    expect(normalizeExternalUrl(securedUrl)).toBe("https://synthetic.external.test/target");

    const legacyUrl = "http://127.0.0.1:11448/proxy?url=https%3A%2F%2Fsynthetic.legacy.test%2Ftarget";
    expect(normalizeExternalUrl(legacyUrl)).toBe("https://synthetic.legacy.test/target");
  });
});
