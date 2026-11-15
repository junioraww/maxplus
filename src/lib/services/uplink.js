import { invoke } from "@tauri-apps/api/core";

const DEFAULT_UPLINK = "https://maxplus.dev";
const MIRRORS = [
  "https://maxplus.dev",
  "https://mirror1.maxplus.dev",
  "https://cdn.maxplus.dev"
];

let activeMirror = DEFAULT_UPLINK;
let customUplink = null;

if (typeof window !== "undefined") {
  invoke("common_store_load", { store: "maxplus_custom_uplink" })
    .then((val) => {
      if (typeof val === "string" && val.trim().startsWith("http")) {
        customUplink = val.trim().replace(/\/+$/, "");
      }
    })
    .catch(() => {});
}

export function getActiveUplink() {
  if (customUplink && customUplink.trim().startsWith("http")) {
    return customUplink.trim().replace(/\/+$/, "");
  }
  return activeMirror;
}

export function setActiveUplink(url) {
  if (!url) {
    activeMirror = DEFAULT_UPLINK;
    customUplink = null;
    if (typeof window !== "undefined") {
      invoke("common_store_save", { store: "maxplus_custom_uplink", data: null }).catch(() => {});
    }
    return;
  }
  const clean = url.trim().replace(/\/+$/, "");
  activeMirror = clean;
  customUplink = clean;
  if (typeof window !== "undefined") {
    invoke("common_store_save", { store: "maxplus_custom_uplink", data: clean }).catch(() => {});
  }
}

export function getUplinkUrl(endpoint) {
  const base = getActiveUplink();
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

export function getSafeAvatarMediaUrl(uid) {
  return getUplinkUrl(`/api/avatars/${encodeURIComponent(uid)}/media`);
}

export function getSafeAvatarPreviewUrl(uid) {
  return getUplinkUrl(`/api/avatars/${encodeURIComponent(uid)}/preview`);
}

export function getSafeAvatarInstallUrl(uid) {
  return getUplinkUrl(`/api/avatars/${encodeURIComponent(uid)}/install`);
}

export async function checkUplinkHealth(url) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(`${url}/api/avatars?limit=1`, { signal: ctrl.signal });
    clearTimeout(timeout);
    return res.ok || res.status === 429;
  } catch {
    return false;
  }
}
