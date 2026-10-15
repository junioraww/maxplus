import { writable } from "svelte/store";

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
