import { writable } from "svelte/store";
import { MediaPool } from "$lib/services/MediaPool";

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

export async function inspectAvatarStego(url, targetId) {
  if (!url || !targetId) return;
  const key = MediaPool.getKey(url, "image");
  MediaPool.acquire(key, { src: url, type: "image", targetEntityId: targetId }, {
    onReady() {},
    onError() {},
    onFrame() {},
    drawStatic() {}
  });
}
