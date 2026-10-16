import { getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";
import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";

class MediaEntry {
  constructor(key, type, src) {
    this.key = key;
    this.type = type;
    this.src = src;
    this.status = "idle";
    this.error = null;
    this.source = null;
    this.refCount = 0;
    this.consumers = new Set();
    this.visibleConsumers = new Set();
    this.evictionTimer = null;
  }
}

class MediaPoolEngine {
  constructor() {
    this.pool = new Map();
    this.scannedStegoKeys = new Set();
    this.isRendering = false;
    this.rafId = null;
    this.render = this.render.bind(this);
  }

  getKey(src, type = "auto") {
    if (!src) return "";
    return `${type}:${src}`;
  }

  getEntry(key) {
    return this.pool.get(key) || null;
  }

  inferType(src) {
    if (!src || typeof src !== "string") return "image";
    const clean = src.split("?")[0].toLowerCase();
    if (
      clean.endsWith(".mp4") ||
      clean.endsWith(".webm") ||
      clean.endsWith(".mov") ||
      clean.endsWith(".m4v") ||
      clean.includes("/video")
    ) {
      return "video";
    }
    return "image";
  }

  acquire(key, options, consumer) {
    let entry = this.pool.get(key);
    const resolvedType = options.type === "auto" || !options.type ? this.inferType(options.src) : options.type;

    if (!entry) {
      entry = new MediaEntry(key, resolvedType, options.src);
      this.pool.set(key, entry);
      this._load(entry, options);
    } else if (entry.evictionTimer) {
      clearTimeout(entry.evictionTimer);
      entry.evictionTimer = null;
    }

    entry.refCount++;
    if (consumer) {
      entry.consumers.add(consumer);
      if (entry.status === "ready" && entry.source) {
        consumer.onReady(entry);
        if (entry.type === "image") {
          consumer.drawStatic?.(entry.source);
        }
      } else if (entry.status === "error") {
        consumer.onError(entry.error);
      }
    }

    return entry;
  }

  release(key, consumer) {
    const entry = this.pool.get(key);
    if (!entry) return;

    if (consumer) {
      entry.consumers.delete(consumer);
      entry.visibleConsumers.delete(consumer);
    }

    entry.refCount = Math.max(0, entry.refCount - 1);

    if (entry.visibleConsumers.size === 0 && entry.type === "video" && entry.source && !entry.source.paused) {
      entry.source.pause();
    }

    if (entry.refCount === 0) {
      if (entry.evictionTimer) {
        clearTimeout(entry.evictionTimer);
      }
      entry.evictionTimer = setTimeout(() => {
        this._evict(key);
      }, 30000);
    }
  }

  setVisible(key, consumer, isVisible) {
    const entry = this.pool.get(key);
    if (!entry || !consumer) return;

    if (isVisible) {
      entry.visibleConsumers.add(consumer);
      if (entry.type === "video" && entry.status === "ready" && entry.source) {
        if (entry.source.paused) {
          entry.source.play().catch(() => {});
        }
        this._ensureRenderLoop();
      } else if (entry.type === "image" && entry.status === "ready" && entry.source) {
        consumer.drawStatic?.(entry.source);
      }
    } else {
      entry.visibleConsumers.delete(consumer);
      if (entry.visibleConsumers.size === 0 && entry.type === "video" && entry.source && !entry.source.paused) {
        entry.source.pause();
      }
    }
  }

  async _load(entry, options) {
    entry.status = "loading";
    const src = options.src;

    let localUrl = null;
    try {
      localUrl = await getAssetUrl(src);
    } catch (e) {
      this._handleError(entry, e);
      return;
    }

    if (!localUrl) {
      this._handleError(entry, new Error("Failed to resolve asset URL"));
      return;
    }

    if (entry.type === "video") {
      this._loadVideo(entry, localUrl);
    } else {
      this._loadImage(entry, localUrl, options.targetEntityId);
    }
  }

  _loadVideo(entry, url) {
    const video = document.createElement("video");
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.autoplay = true;

    const onReady = () => {
      if (entry.status === "ready") return;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;
      entry.status = "ready";
      entry.source = video;

      for (const consumer of entry.consumers) {
        consumer.onReady(entry);
      }

      if (entry.visibleConsumers.size > 0) {
        video.play().catch(() => {});
        this._ensureRenderLoop();
      }
    };

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener(
      "error",
      () => {
        this._handleError(entry, new Error("Failed to load video element"));
      },
      { once: true }
    );

    video.src = url;
  }

  async _loadImage(entry, url, targetEntityId) {
    try {
      let bitmap = null;
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const blob = await resp.blob();
          if (typeof createImageBitmap !== "undefined") {
            bitmap = await createImageBitmap(blob);
          }
        }
      } catch {}

      if (!bitmap) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = url;
        });
        bitmap = img;
      }

      entry.source = bitmap;
      entry.status = "ready";

      if (targetEntityId && !this.scannedStegoKeys.has(entry.key)) {
        this.scannedStegoKeys.add(entry.key);
        this._inspectStego(bitmap, targetEntityId);
      }

      for (const consumer of entry.consumers) {
        consumer.onReady(entry);
        consumer.drawStatic?.(bitmap);
      }
    } catch (e) {
      this._handleError(entry, e);
    }
  }

  async _inspectStego(source, targetEntityId) {
    if (!targetEntityId || typeof window === "undefined") return;
    try {
      const sw = source.naturalWidth || source.videoWidth || source.width;
      const sh = source.naturalHeight || source.videoHeight || source.height;
      if (!sw || !sh || sw < 64 || sh < 64) return;

      let canvas;
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(sw, sh);
      } else {
        canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, sw, sh);
      const imgData = ctx.getImageData(0, 0, sw, sh);
      if (!imgData) return;

      const foundUid = decodeStegoPayload(imgData, targetEntityId);
      if (foundUid) {
        safeAvatarMapStore.update((map) => {
          map.set(Number(targetEntityId), foundUid);
          return map;
        });
      }
    } catch {}
  }

  _handleError(entry, err) {
    entry.status = "error";
    entry.error = err;
    for (const consumer of entry.consumers) {
      consumer.onError(err);
    }
  }

  _ensureRenderLoop() {
    if (this.isRendering) return;

    let hasActiveVideos = false;
    for (const entry of this.pool.values()) {
      if (entry.type === "video" && entry.visibleConsumers.size > 0 && entry.status === "ready") {
        hasActiveVideos = true;
        break;
      }
    }

    if (hasActiveVideos) {
      this.isRendering = true;
      this.rafId = requestAnimationFrame(this.render);
    }
  }

  render() {
    let hasActiveVideos = false;

    for (const entry of this.pool.values()) {
      if (entry.type !== "video" || entry.visibleConsumers.size === 0 || entry.status !== "ready") {
        continue;
      }

      const video = entry.source;
      if (!video || video.readyState < 2 || video.paused || video.videoWidth === 0 || video.videoHeight === 0) {
        continue;
      }

      hasActiveVideos = true;
      for (const consumer of entry.visibleConsumers) {
        consumer.onFrame?.(video);
      }
    }

    if (hasActiveVideos) {
      this.rafId = requestAnimationFrame(this.render);
    } else {
      this.isRendering = false;
      this.rafId = null;
    }
  }

  _evict(key) {
    const entry = this.pool.get(key);
    if (!entry || entry.refCount > 0) return;

    if (entry.type === "video" && entry.source) {
      entry.source.pause();
      entry.source.removeAttribute("src");
      entry.source.load();
      entry.source = null;
    } else if (entry.type === "image" && entry.source) {
      if (typeof entry.source.close === "function") {
        entry.source.close();
      }
      entry.source = null;
    }

    this.pool.delete(key);
  }
}

export const MediaPool = new MediaPoolEngine();
