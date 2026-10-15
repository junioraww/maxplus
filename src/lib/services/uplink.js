const DEFAULT_UPLINK = "https://maxplus.dev";
const MIRRORS = [
  "https://maxplus.dev",
  "https://mirror1.maxplus.dev",
  "https://cdn.maxplus.dev"
];

let activeMirror = DEFAULT_UPLINK;

export function getActiveUplink() {
  if (typeof window !== "undefined") {
    const custom = localStorage.getItem("maxplus_custom_uplink");
    if (custom && custom.trim().startsWith("http")) {
      return custom.trim().replace(/\/+$/, "");
    }
  }
  return activeMirror;
}

export function setActiveUplink(url) {
  if (!url) {
    activeMirror = DEFAULT_UPLINK;
    if (typeof window !== "undefined") {
      localStorage.removeItem("maxplus_custom_uplink");
    }
    return;
  }
  const clean = url.trim().replace(/\/+$/, "");
  activeMirror = clean;
  if (typeof window !== "undefined") {
    localStorage.setItem("maxplus_custom_uplink", clean);
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
