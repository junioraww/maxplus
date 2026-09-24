import { invoke } from "@tauri-apps/api/core";

let config = {
  videoPort: 11447,
  videoToken: "",
  webappPort: 11448,
  webappToken: "",
};

let initPromise = null;

function readWindowProxy() {
  if (typeof window !== "undefined" && window.__MAXPLUS_PROXY__) {
    const wp = window.__MAXPLUS_PROXY__;
    if (wp.videoPort) config.videoPort = wp.videoPort;
    if (wp.videoToken) config.videoToken = wp.videoToken;
    if (wp.webappPort) config.webappPort = wp.webappPort;
    if (wp.webappToken) config.webappToken = wp.webappToken;
  }
}

readWindowProxy();
if (typeof window !== "undefined") {
  initProxyConfig();
}

export async function initProxyConfig() {
  readWindowProxy();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
        const res = await invoke("get_proxy_config");
        if (res) {
          if (res.video_port) config.videoPort = res.video_port;
          if (res.video_token) config.videoToken = res.video_token;
          if (res.webapp_port) config.webappPort = res.webapp_port;
          if (res.webapp_token) config.webappToken = res.webapp_token;
        }
      }
    } catch {}
    return config;
  })();

  return initPromise;
}

export function getProxyConfig() {
  readWindowProxy();
  return config;
}

export function setProxyConfig(newConfig) {
  if (!newConfig) return;
  if (newConfig.videoPort || newConfig.video_port) {
    config.videoPort = newConfig.videoPort || newConfig.video_port;
  }
  if (newConfig.videoToken || newConfig.video_token) {
    config.videoToken = newConfig.videoToken || newConfig.video_token;
  }
  if (newConfig.webappPort || newConfig.webapp_port) {
    config.webappPort = newConfig.webappPort || newConfig.webapp_port;
  }
  if (newConfig.webappToken || newConfig.webapp_token) {
    config.webappToken = newConfig.webappToken || newConfig.webapp_token;
  }
}

export function getVideoProxyBase() {
  readWindowProxy();
  if (config.videoToken) {
    return `http://127.0.0.1:${config.videoPort}/${config.videoToken}`;
  }
  return `http://127.0.0.1:${config.videoPort}`;
}

export function getWebAppProxyBase() {
  readWindowProxy();
  if (config.webappToken) {
    return `http://127.0.0.1:${config.webappPort}/${config.webappToken}`;
  }
  return `http://127.0.0.1:${config.webappPort}`;
}
