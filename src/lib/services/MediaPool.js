import { getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";
import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";

let stegoWorker = null;

function getStegoWorker() {
  if (typeof window === "undefined") return null;
  if (!stegoWorker && typeof Worker !== "undefined") {
    try {
      stegoWorker = new Worker(new URL("../utils/stegoWorker.js", import.meta.url), { type: "module" });
      stegoWorker.onmessage = (e) => {
        const { foundUid, targetEntityId, key } = e.data || {};
        if (foundUid && targetEntityId) {
          safeAvatarMapStore.update((map) => {
            map.set(Number(targetEntityId), foundUid);
            return map;
          });
        } else if (!foundUid && key) {
          MediaPool.scannedStegoKeys.delete(key);
        }
      };
    } catch {
      stegoWorker = null;
    }
  }
  return stegoWorker;
}

let mediaPoolHost = null;

function getMediaPoolHost() {
  if (typeof document === "undefined") return null;
  if (!mediaPoolHost || !document.body.contains(mediaPoolHost)) {
    mediaPoolHost = document.getElementById("maxplus-media-pool-host");
    if (!mediaPoolHost) {
      mediaPoolHost = document.createElement("div");
      mediaPoolHost.id = "maxplus-media-pool-host";
      mediaPoolHost.setAttribute("aria-hidden", "true");
      mediaPoolHost.style.cssText = "position:fixed;width:1px;height:1px;top:-9999px;left:-9999px;opacity:0.001;pointer-events:none;overflow:hidden;z-index:-1;";
      document.body.appendChild(mediaPoolHost);
    }
  }
  return mediaPoolHost;
}

class MediaEntry {
  constructor(key, type, src) {
    this.key = key;
    this.type = type;
    this.src = src;
    this.status = "idle";
    this.error = null;
    this.source = null;
    this.masterCanvas = null;
    this.masterCtx = null;
    this.lastPlayAttempt = 0;
    this.loadStartTime = 0;
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

  getKey(src) {
    if (!src || typeof src !== "string") return "";
    return src;
  }

  getEntry(key) {
    return this.pool.get(key) || null;
  }

  acquire(key, options = {}, consumer) {
    let entry = this.pool.get(key);
    const initialType = options?.type === "image" ? "image" : "video";

    if (!entry) {
      entry = new MediaEntry(key, initialType, options.src);
      this.pool.set(key, entry);
      this._load(entry, options);
    } else {
      if (entry.evictionTimer) {
        clearTimeout(entry.evictionTimer);
        entry.evictionTimer = null;
      }
      if (entry.status === "error" || (entry.status === "loading" && Date.now() - entry.loadStartTime > 6000)) {
        entry.status = "idle";
        entry.error = null;
        this._load(entry, options);
      }
    }

    entry.refCount++;
    if (consumer) {
      entry.consumers.add(consumer);
      if (entry.status === "ready" && entry.source) {
        consumer.onReady(entry);
        if (entry.type === "image") {
          consumer.drawStatic?.(entry.source);
        } else if (entry.type === "video") {
          const frameSource = entry.masterCanvas || entry.source;
          consumer.onFrame?.(frameSource);
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
      if (entry.type === "video") {
        if (entry.source) {
          if (entry.source.paused) {
            const now = Date.now();
            if (now - entry.lastPlayAttempt > 1000) {
              entry.lastPlayAttempt = now;
              entry.source.play().then(() => this._ensureRenderLoop()).catch(() => {});
            }
          }
          if (entry.status === "ready" && entry.source.videoWidth > 0) {
            const masterFrame = entry.masterCanvas || this._updateMasterCanvas(entry, entry.source) || entry.source;
            consumer.onFrame?.(masterFrame);
          }
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

  _updateMasterCanvas(entry, video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw <= 0 || vh <= 0) return null;

    if (!entry.masterCanvas) {
      const size = 256;
      if (typeof OffscreenCanvas !== "undefined") {
        entry.masterCanvas = new OffscreenCanvas(size, size);
      } else if (typeof document !== "undefined") {
        entry.masterCanvas = document.createElement("canvas");
        entry.masterCanvas.width = size;
        entry.masterCanvas.height = size;
      }
      if (entry.masterCanvas) {
        entry.masterCtx = entry.masterCanvas.getContext("2d", { willReadFrequently: true });
        if (entry.masterCtx) {
          entry.masterCtx.imageSmoothingEnabled = true;
          entry.masterCtx.imageSmoothingQuality = "medium";
        }
      }
    }

    if (!entry.masterCtx) return null;

    let sx = 0;
    let sy = 0;
    let sSide = Math.min(vw, vh);

    if (vw > vh) {
      sx = (vw - vh) / 2;
    } else if (vh > vw) {
      sy = (vh - vw) / 2;
    }

    entry.masterCtx.clearRect(0, 0, 256, 256);
    entry.masterCtx.drawImage(video, sx, sy, sSide, sSide, 0, 0, 256, 256);
    return entry.masterCanvas;
  }

  async _load(entry, options) {
    entry.status = "loading";
    entry.loadStartTime = Date.now();
    const src = options.src;

    let localUrl = null;
    try {
      localUrl = await getAssetUrl(src);
    } catch (e) {
      this._handleError(entry, e);
      return;
    }

    if (!localUrl) {
      setTimeout(async () => {
        if (entry.status !== "loading") return;
        try {
          const retryUrl = await getAssetUrl(src);
          if (retryUrl) {
            if (entry.type === "video") {
              this._loadVideo(entry, retryUrl, options);
            } else {
              this._loadImage(entry, retryUrl, options.targetEntityId);
            }
            return;
          }
        } catch {}
        this._handleError(entry, new Error("Failed to resolve asset URL"));
      }, 400);
      return;
    }

    if (entry.type === "video") {
      this._loadVideo(entry, localUrl, options);
    } else {
      this._loadImage(entry, localUrl, options.targetEntityId);
    }
  }

  _loadVideo(entry, url, options = {}) {
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");

    entry.source = video;

    const host = getMediaPoolHost();
    if (host) {
      host.appendChild(video);
    }

    let isDisposed = false;

    const markReady = () => {
      if (isDisposed) return;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        return;
      }

      if (entry.status !== "ready") {
        entry.status = "ready";
        const masterFrame = this._updateMasterCanvas(entry, video) || video;

        for (const consumer of entry.consumers) {
          consumer.onReady(entry);
          if (entry.visibleConsumers.has(consumer)) {
            consumer.onFrame?.(masterFrame);
          }
        }
      }

      if (entry.visibleConsumers.size > 0) {
        if (video.paused) {
          const now = Date.now();
          if (now - entry.lastPlayAttempt > 1000) {
            entry.lastPlayAttempt = now;
            video.play().then(() => this._ensureRenderLoop()).catch(() => {});
          }
        }
        this._ensureRenderLoop();
      }
    };

    const handleWakeup = () => {
      markReady();
      if (entry.visibleConsumers.size > 0) {
        this._ensureRenderLoop();
      }
    };

    const handleError = () => {
      if (isDisposed) return;
      isDisposed = true;
      video.pause();
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
      entry.type = "image";
      this._loadImage(entry, url, options.targetEntityId);
    };

    video.addEventListener("loadedmetadata", markReady);
    video.addEventListener("loadeddata", markReady);
    video.addEventListener("canplay", markReady);
    video.addEventListener("canplaythrough", markReady);
    video.addEventListener("resize", markReady);
    video.addEventListener("playing", handleWakeup);
    video.addEventListener("play", handleWakeup);
    video.addEventListener("timeupdate", handleWakeup);
    video.addEventListener("seeked", handleWakeup);
    video.addEventListener("error", handleError, { once: true });

    video.src = url;
    video.load();

    video.play().then(() => {
      this._ensureRenderLoop();
    }).catch(() => {});

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      markReady();
    }
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
        this._inspectStego(bitmap, targetEntityId, entry.key);
      }

      for (const consumer of entry.consumers) {
        consumer.onReady(entry);
        consumer.drawStatic?.(bitmap);
      }
    } catch (e) {
      this._handleError(entry, e);
    }
  }

  async _inspectStego(source, targetEntityId, key) {
    if (!targetEntityId || typeof window === "undefined") return;
    try {
      const worker = getStegoWorker();
      if (worker && typeof createImageBitmap === "function") {
        const transferBitmap = await createImageBitmap(source);
        worker.postMessage({ bitmap: transferBitmap, targetEntityId, key }, [transferBitmap]);
        return;
      }
      const sw = source.naturalWidth || source.videoWidth || source.width;
      const sh = source.naturalHeight || source.videoHeight || source.height;
      if (!sw || !sh || sw < 64 || sh < 64) {
        if (key) this.scannedStegoKeys.delete(key);
        return;
      }

      const canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(sw, sh)
        : document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        if (key) this.scannedStegoKeys.delete(key);
        return;
      }
      ctx.drawImage(source, 0, 0, sw, sh);
      const imgData = ctx.getImageData(0, 0, sw, sh);
      if (!imgData) {
        if (key) this.scannedStegoKeys.delete(key);
        return;
      }

      const foundUid = decodeStegoPayload(imgData, targetEntityId);
      if (foundUid) {
        safeAvatarMapStore.update((map) => {
          map.set(Number(targetEntityId), foundUid);
          return map;
        });
      } else if (key) {
        this.scannedStegoKeys.delete(key);
      }
    } catch {
      if (key) this.scannedStegoKeys.delete(key);
    }
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

    let shouldRender = false;
    for (const entry of this.pool.values()) {
      if (entry.type === "video" && entry.visibleConsumers.size > 0) {
        shouldRender = true;
        break;
      }
    }

    if (shouldRender) {
      this.isRendering = true;
      this.rafId = requestAnimationFrame(this.render);
    }
  }

  render() {
    let hasActiveVideos = false;
    let hasPendingVideos = false;

    for (const entry of this.pool.values()) {
      if (entry.type !== "video" || entry.visibleConsumers.size === 0) {
        continue;
      }

      const video = entry.source;
      if (!video) {
        if (entry.status === "loading") {
          hasPendingVideos = true;
        }
        continue;
      }

      if (entry.status !== "ready") {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          entry.status = "ready";
          const masterFrame = this._updateMasterCanvas(entry, video) || video;
          for (const consumer of entry.consumers) {
            consumer.onReady(entry);
          }
        } else {
          hasPendingVideos = true;
          continue;
        }
      }

      if (video.paused || video.readyState < 2) {
        hasPendingVideos = true;
        const now = Date.now();
        if (video.paused && now - entry.lastPlayAttempt > 1000) {
          entry.lastPlayAttempt = now;
          video.play().catch(() => {});
        }
        continue;
      }

      const masterFrame = this._updateMasterCanvas(entry, video) || video;
      hasActiveVideos = true;
      for (const consumer of entry.visibleConsumers) {
        consumer.onFrame?.(masterFrame);
      }
    }

    if (hasActiveVideos || hasPendingVideos) {
      this.rafId = requestAnimationFrame(this.render);
    } else {
      this.isRendering = false;
      this.rafId = null;
    }
  }

  purgeSafeAvatars() {
    for (const [key, entry] of this.pool) {
      if (key.includes("/api/avatars/")) {
        entry.refCount = 0;
        this._evict(key);
      }
    }
    this.scannedStegoKeys.clear();
  }

  _evict(key) {
    const entry = this.pool.get(key);
    if (!entry || entry.refCount > 0) return;

    if (entry.masterCanvas) {
      if (typeof entry.masterCanvas.width === "number") {
        entry.masterCanvas.width = 0;
        entry.masterCanvas.height = 0;
      }
      entry.masterCanvas = null;
      entry.masterCtx = null;
    }

    if (entry.type === "video" && entry.source) {
      entry.source.pause();
      if (entry.source.parentNode) {
        entry.source.parentNode.removeChild(entry.source);
      }
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
