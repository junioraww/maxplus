import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { MediaPool } from "$lib/services/MediaPool";
import { clearSafeAvatarImageCache } from "$lib/utils/images";
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

export async function inspectAvatarStego(url, targetId) {
  if (!url || !targetId) return;
  const key = MediaPool.getKey(url);
  MediaPool.acquire(key, { src: url, type: "image", targetEntityId: targetId }, {
    onReady() {},
    onError() {},
    onFrame() {},
    drawStatic() {}
  });
}

export async function clearAllSafeAvatarCaches() {
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
