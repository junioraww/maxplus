import { writable } from "svelte/store";
import { getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";

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

class AvatarSyncManagerClass {
  constructor() {
    this.startTimes = new Map();
    this.subscribers = new Map();
  }

  getSynchronizedTime(avatarUid, duration) {
    if (!duration || duration <= 0) return 0;
    if (!this.startTimes.has(avatarUid)) {
      this.startTimes.set(avatarUid, performance.now());
    }
    const elapsed = (performance.now() - this.startTimes.get(avatarUid)) / 1000;
    return elapsed % duration;
  }

  registerVideo(avatarUid, videoEl) {
    if (!avatarUid || !videoEl) return () => {};

    if (!this.subscribers.has(avatarUid)) {
      this.subscribers.set(avatarUid, new Set());
    }
    const set = this.subscribers.get(avatarUid);
    set.add(videoEl);

    const onLoadedMetadata = () => {
      const syncTime = this.getSynchronizedTime(avatarUid, videoEl.duration);
      if (Math.abs(videoEl.currentTime - syncTime) > 0.15) {
        try { videoEl.currentTime = syncTime; } catch {}
      }
    };

    if (videoEl.readyState >= 1) {
      onLoadedMetadata();
    } else {
      videoEl.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    }

    const onEnded = () => {
      try {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
      } catch {}
    };
    videoEl.addEventListener("ended", onEnded);

    return () => {
      videoEl.removeEventListener("ended", onEnded);
      set.delete(videoEl);
      if (set.size === 0) {
        this.subscribers.delete(avatarUid);
        this.startTimes.delete(avatarUid);
      }
    };
  }
}

export const AvatarSyncManager = new AvatarSyncManagerClass();

export const avatarAssetStore = writable(new Map());

const inflightAvatarAssets = new Map();

export async function loadAvatarAsset(url) {
  if (!url || typeof url !== "string") return null;

  let cachedUrl = null;
  const unsub = avatarAssetStore.subscribe((map) => {
    cachedUrl = map.get(url);
  });
  unsub();

  if (cachedUrl) return cachedUrl;

  if (inflightAvatarAssets.has(url)) {
    return inflightAvatarAssets.get(url);
  }

  const promise = (async () => {
    try {
      const localUrl = await getAssetUrl(url);
      if (localUrl) {
        avatarAssetStore.update((map) => {
          map.set(url, localUrl);
          return map;
        });
        return localUrl;
      }
      return url;
    } catch {
      return url;
    } finally {
      inflightAvatarAssets.delete(url);
    }
  })();

  inflightAvatarAssets.set(url, promise);
  return promise;
}

const scannedStegoUrls = new Set();
const inflightStego = new Map();

export async function inspectAvatarStego(url, targetId, disableMaxPlus = false) {
  if (typeof window === "undefined" || !url || !targetId || disableMaxPlus) return;
  if (scannedStegoUrls.has(url)) return;

  if (inflightStego.has(url)) {
    return inflightStego.get(url);
  }

  const promise = (async () => {
    try {
      const localUrl = await getAssetUrl(url);
      if (!localUrl) return;

      let imgData = null;
      try {
        const resp = await fetch(localUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          if (typeof createImageBitmap !== "undefined") {
            const bmp = await createImageBitmap(blob);
            if (bmp.width >= 64) {
              const canvas = document.createElement("canvas");
              canvas.width = bmp.width;
              canvas.height = bmp.height;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(bmp, 0, 0);
                imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
              }
            }
          }
        }
      } catch {}

      if (!imgData) {
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
          img.src = localUrl;
        });
        if (!img.width || img.width < 64) return;

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        imgData = ctx.getImageData(0, 0, img.width, img.height);
      }

      if (!imgData) return;
      const foundUid = decodeStegoPayload(imgData, targetId);

      if (foundUid) {
        safeAvatarMapStore.update((map) => {
          map.set(targetId, foundUid);
          return map;
        });
      }
    } catch {} finally {
      scannedStegoUrls.add(url);
      inflightStego.delete(url);
    }
  })();

  inflightStego.set(url, promise);
  return promise;
}
