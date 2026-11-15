import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { MediaPool } from "$lib/services/MediaPool";
import { clearSafeAvatarImageCache, getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";
import { getCurrentAccount } from "$lib/stores/accounts";

export const safeAvatarDebugStore = writable(false);
export const safeAvatarMapStore = writable(new Map());

let isStoreLoaded = false;
let pendingSave = null;

if (typeof window !== "undefined") {
  invoke("common_store_load", { store: "safe_avatar_map" })
    .then((saved) => {
      if (Array.isArray(saved)) {
        safeAvatarMapStore.update((map) => {
          for (const [k, v] of saved) {
            map.set(Number(k), v);
          }
          return map;
        });
      }
      isStoreLoaded = true;
    })
    .catch(() => {
      isStoreLoaded = true;
    });

  invoke("common_store_load", { store: "avatar_debug" })
    .then((val) => {
      if (val === true || val === "1") {
        safeAvatarDebugStore.set(true);
      }
    })
    .catch(() => {});

  safeAvatarMapStore.subscribe((map) => {
    if (!isStoreLoaded) return;
    if (pendingSave) clearTimeout(pendingSave);
    pendingSave = setTimeout(() => {
      const entries = Array.from(map.entries());
      invoke("common_store_save", { store: "safe_avatar_map", data: entries }).catch(() => {});
    }, 150);
  });

  safeAvatarDebugStore.subscribe((val) => {
    invoke("common_store_save", { store: "avatar_debug", data: Boolean(val) }).catch(() => {});
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
  let img = new Image();
  img.crossOrigin = "anonymous";
  const loaded = await new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = resolvedUrl;
  });
  if (!loaded && resolvedUrl !== url) {
    img = new Image();
    img.crossOrigin = "anonymous";
    const retryLoaded = await new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (!retryLoaded) return;
  } else if (!loaded) {
    return;
  }

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
  invoke("common_store_save", { store: "safe_avatar_map", data: [] }).catch(() => {});
  MediaPool.purgeSafeAvatars();
  clearSafeAvatarImageCache();
  try {
    const acc = await getCurrentAccount().catch(() => null);
    await invoke("delete_safe_avatars_cache", {
      account: acc?.id ? Number(acc.id) : null
    });
  } catch {}
}
