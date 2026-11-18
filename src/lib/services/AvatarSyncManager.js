import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { MediaPool } from "$lib/services/MediaPool";
import { clearSafeAvatarImageCache, getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";
import { getCurrentAccount } from "$lib/stores/accounts";
import { getSafeAvatarMediaUrl } from "$lib/services/uplink";
import { currentUserDetails, currentUser } from "$lib/stores/api";

export const safeAvatarDebugStore = writable(false);
export const safeAvatarMapStore = writable(new Map());

let isStoreLoaded = false;
let pendingSave = null;

if (typeof window !== "undefined") {
  invoke("common_store_load", { store: "safe_avatar_map" })
    .then((saved) => {
      if (Array.isArray(saved)) {
        safeAvatarMapStore.update((map) => {
          const next = new Map(map);
          for (const [k, v] of saved) {
            if (typeof k === "string") {
              const trimmed = k.trim();
              if (
                trimmed.startsWith("http://127.0.0.1:") ||
                trimmed.startsWith("http://localhost:") ||
                trimmed === "https://i.oneme.ru/i" ||
                trimmed === "http://i.oneme.ru/i" ||
                trimmed === "https://i.oneme.ru/i/" ||
                trimmed === "http://i.oneme.ru/i/" ||
                trimmed === "https://i.oneme.ru" ||
                trimmed === "http://i.oneme.ru" ||
                trimmed === "" ||
                trimmed === "0"
              ) {
                continue;
              }
              next.set(trimmed, v);
            } else if (typeof k === "number" && !isNaN(k) && k !== 0) {
              next.set(k, v);
            }
          }
          return next;
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
      const entries = Array.from(map.entries()).filter(([k]) => {
        if (typeof k === "string") {
          return (
            !k.startsWith("http://127.0.0.1:") &&
            !k.startsWith("http://localhost:") &&
            k !== "https://i.oneme.ru/i" &&
            k !== "https://i.oneme.ru/i/" &&
            k !== "" &&
            k !== "0"
          );
        }
        return typeof k === "number" && !isNaN(k) && k !== 0;
      });
      invoke("common_store_save", { store: "safe_avatar_map", data: entries }).catch(() => {});
    }, 150);
  });

  safeAvatarDebugStore.subscribe((val) => {
    invoke("common_store_save", { store: "avatar_debug", data: Boolean(val) }).catch(() => {});
  });
}

export function cleanAvatarUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    u.searchParams.delete("uniq");
    u.searchParams.delete("_t");
    u.searchParams.delete("t");
    u.hash = "";
    if (u.pathname === "/i" && !u.searchParams.has("r")) {
      return "";
    }
    const cleanStr = u.toString();
    if (
      cleanStr === "https://i.oneme.ru/i" ||
      cleanStr === "http://i.oneme.ru/i" ||
      cleanStr === "https://i.oneme.ru/i/" ||
      cleanStr === "http://i.oneme.ru/i/"
    ) {
      return "";
    }
    return cleanStr;
  } catch {
    const withoutUniq = trimmed.split("&uniq=")[0].split("?uniq=")[0].trim();
    if (
      withoutUniq === "https://i.oneme.ru/i" ||
      withoutUniq === "http://i.oneme.ru/i" ||
      withoutUniq === "https://i.oneme.ru/i/" ||
      withoutUniq === "http://i.oneme.ru/i/"
    ) {
      return "";
    }
    return withoutUniq;
  }
}

export function recordSafeAvatarUrl(photoUrl, avatarUid) {
  if (!photoUrl || !avatarUid) return;
  const cleanUid = String(avatarUid).trim();
  const trimmed = String(photoUrl).trim();
  if (
    !trimmed ||
    trimmed.startsWith("http://127.0.0.1:") ||
    trimmed.startsWith("http://localhost:") ||
    trimmed === "https://i.oneme.ru/i" ||
    trimmed === "https://i.oneme.ru/i/"
  ) {
    return;
  }
  const clean = cleanAvatarUrl(trimmed);
  safeAvatarMapStore.update((map) => {
    const next = new Map(map);
    next.set(trimmed, cleanUid);
    if (clean && clean !== trimmed) {
      next.set(clean, cleanUid);
    }
    return next;
  });
}

export function recordSafeAvatarForTarget(targetId, avatarUid, photoUrl = null) {
  if (!targetId || !avatarUid) return;
  const numId = Number(targetId);
  if (isNaN(numId) || numId === 0) return;
  const absId = Math.abs(numId);
  const cleanUid = String(avatarUid).trim();

  safeAvatarMapStore.update((map) => {
    const next = new Map(map);
    next.set(numId, cleanUid);
    next.set(absId, cleanUid);

    const histKey = `${numId}:history`;
    const absHistKey = `${absId}:history`;
    const oldHist = Array.isArray(map.get(histKey))
      ? map.get(histKey)
      : (map.get(numId) && typeof map.get(numId) === "string" ? [map.get(numId)] : []);
    const nextHist = [cleanUid, ...oldHist.filter((id) => id !== cleanUid)];
    next.set(histKey, nextHist);
    next.set(absHistKey, nextHist);

    if (photoUrl && typeof photoUrl === "string") {
      const trimmed = photoUrl.trim();
      const clean = cleanAvatarUrl(trimmed);
      if (clean) {
        next.set(clean, cleanUid);
      }
      if (trimmed && trimmed !== clean && cleanAvatarUrl(trimmed)) {
        next.set(trimmed, cleanUid);
      }
    }
    return next;
  });
}

const scannedStegoKeys = new Set();
const stegoQueue = [];
let isProcessingStegoQueue = false;

async function processStegoQueue() {
  if (isProcessingStegoQueue || stegoQueue.length === 0) return;
  isProcessingStegoQueue = true;
  while (stegoQueue.length > 0) {
    const item = stegoQueue.shift();
    try {
      await scanSingleAvatarStego(item.url, item.targetId);
    } catch {}
    if (stegoQueue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  isProcessingStegoQueue = false;
}

async function scanSingleAvatarStego(url, targetId) {
  if (!url || !targetId || typeof document === "undefined") return;
  const numTargetId = Number(targetId);
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

  const details = get(currentUserDetails);
  const myDetailsId = Number(details?.id || 0);
  const myAccId = Number(get(currentUser) || 0);
  const candidateIds = [numTargetId, Math.abs(numTargetId)];
  if (numTargetId === myDetailsId || numTargetId === myAccId) {
    if (myDetailsId) candidateIds.push(myDetailsId);
    if (myAccId) candidateIds.push(myAccId);
  }
  const uniqueCandidateIds = [...new Set(candidateIds.filter((x) => x != null && !isNaN(x) && x !== 0))];

  let foundUid = decodeStegoPayload(imgData, uniqueCandidateIds);
  if (!foundUid && (sw !== 512 || sh !== 512)) {
    canvas.width = 512;
    canvas.height = 512;
    ctx.clearRect(0, 0, 512, 512);
    let sx = 0;
    let sy = 0;
    const side = Math.min(sw, sh);
    if (sw > sh) {
      sx = Math.round((sw - sh) / 2);
    } else if (sh > sw) {
      sy = Math.round((sh - sw) / 2);
    }
    ctx.drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
    const fallbackData = ctx.getImageData(0, 0, 512, 512);
    if (fallbackData) {
      foundUid = decodeStegoPayload(fallbackData, uniqueCandidateIds);
    }
  }
  if (foundUid) {
    recordSafeAvatarForTarget(numTargetId, foundUid, url);
    if (resolvedUrl && resolvedUrl !== url) {
      safeAvatarMapStore.update((map) => {
        const next = new Map(map);
        next.set(resolvedUrl, foundUid);
        const clean = cleanAvatarUrl(resolvedUrl);
        if (clean) next.set(clean, foundUid);
        return next;
      });
    }
    if (numTargetId === myDetailsId || numTargetId === myAccId) {
      if (myDetailsId) recordSafeAvatarForTarget(myDetailsId, foundUid, url);
      if (myAccId) recordSafeAvatarForTarget(myAccId, foundUid, url);
    }
    const mediaUrl = getSafeAvatarMediaUrl(foundUid);
    getCurrentAccount().then((acc) => {
      if (acc?.id) {
        invoke("cache_url", { account: Number(acc.id), src: mediaUrl }).catch(() => {});
      }
    }).catch(() => {});
    getAssetUrl(mediaUrl).catch(() => null);
  }
}

export function invalidateStegoScan(targetId) {
  if (!targetId) return;
  const p1 = `${Number(targetId)}_`;
  const p2 = `${Math.abs(Number(targetId))}_`;
  for (const k of scannedStegoKeys) {
    if (k.startsWith(p1) || k.startsWith(p2)) {
      scannedStegoKeys.delete(k);
    }
  }
}

export function inspectAvatarStego(url, targetId, priority = false) {
  if (!url || !targetId) return;
  const numTargetId = Number(targetId);
  const key = `${numTargetId}_${url}`;
  if (scannedStegoKeys.has(key)) return;
  scannedStegoKeys.add(key);
  if (priority) {
    stegoQueue.unshift({ url, targetId: numTargetId });
  } else {
    stegoQueue.push({ url, targetId: numTargetId });
  }
  if (!isProcessingStegoQueue) {
    setTimeout(processStegoQueue, priority ? 0 : 30);
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
