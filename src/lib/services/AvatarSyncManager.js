import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { MediaPool } from "$lib/services/MediaPool";
import { clearSafeAvatarImageCache, getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";
import { getCurrentAccount } from "$lib/stores/accounts";

function initMap() {
  const map = new Map();
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("maxplus_safe_avatar_map");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const [k, v] of parsed) {
            map.set(Number(k), v);
          }
        }
      }
    } catch {}
  }
  return map;
}

function initDebug() {
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem("maxplus_avatar_debug") === "1";
    } catch {}
  }
  return false;
}

export const safeAvatarDebugStore = writable(initDebug());
export const safeAvatarMapStore = writable(initMap());

if (typeof window !== "undefined") {
  safeAvatarDebugStore.subscribe((val) => {
    try {
      if (val) localStorage.setItem("maxplus_avatar_debug", "1");
      else localStorage.removeItem("maxplus_avatar_debug");
    } catch {}
  });

  safeAvatarMapStore.subscribe((map) => {
    try {
      const entries = Array.from(map.entries());
      localStorage.setItem("maxplus_safe_avatar_map", JSON.stringify(entries));
    } catch {}
  });
}

export const AvatarSyncManager = {
  registerVideo() {
    return () => {};
  }
};

const scannedStegoKeys = new Set();
const stegoQueue = [];
let isProcessingStegoQueue = false;

async function processStegoQueue() {
  if (isProcessingStegoQueue || stegoQueue.length === 0) return;
  isProcessingStegoQueue = true;
  const item = stegoQueue.shift();
  try {
    await scanSingleAvatarStego(item.url, item.targetId);
  } catch {}
  isProcessingStegoQueue = false;
  if (stegoQueue.length > 0) {
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(processStegoQueue);
    } else {
      setTimeout(processStegoQueue, 150);
    }
  }
}

async function scanSingleAvatarStego(url, targetId) {
  if (!url || !targetId || typeof document === "undefined") return;
  const resolvedUrl = (await getAssetUrl(url).catch(() => null)) || url;
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = resolvedUrl;
  });

  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh || sw < 64 || sh < 64) return;

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img, 0, 0, sw, sh);
  const imgData = ctx.getImageData(0, 0, sw, sh);
  if (!imgData) return;

  const foundUid = decodeStegoPayload(imgData, targetId);
  if (foundUid) {
    safeAvatarMapStore.update((map) => {
      map.set(Number(targetId), foundUid);
      return map;
    });
  }
}

export function inspectAvatarStego(url, targetId) {
  if (!url || !targetId) return;
  const key = `${targetId}_${url}`;
  if (scannedStegoKeys.has(key)) return;
  scannedStegoKeys.add(key);
  stegoQueue.push({ url, targetId });
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(processStegoQueue);
  } else {
    setTimeout(processStegoQueue, 100);
  }
}

export async function clearAllSafeAvatarCaches() {
  scannedStegoKeys.clear();
  stegoQueue.length = 0;
  safeAvatarMapStore.set(new Map());
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("maxplus_safe_avatar_map");
    } catch {}
  }
  MediaPool.purgeSafeAvatars();
  clearSafeAvatarImageCache();
  try {
    const acc = await getCurrentAccount().catch(() => null);
    await invoke("delete_safe_avatars_cache", {
      account: acc?.id ? Number(acc.id) : null
    });
  } catch {}
}
