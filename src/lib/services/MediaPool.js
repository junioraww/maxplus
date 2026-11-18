import { getAssetUrl } from "$lib/utils/images";
import { decodeStegoPayload } from "$lib/utils/stego";
import { safeAvatarMapStore, recordSafeAvatarForTarget } from "$lib/services/AvatarSyncManager";

let mediaPoolHost = null;

function getMediaPoolHost() {
  if (typeof document === "undefined") return null;
  if (!mediaPoolHost || !document.body.contains(mediaPoolHost)) {
    mediaPoolHost = document.getElementById("maxplus-media-pool-host");
    if (!mediaPoolHost) {
      mediaPoolHost = document.createElement("div");
      mediaPoolHost.id = "maxplus-media-pool-host";
      mediaPoolHost.setAttribute("aria-hidden", "true");
      mediaPoolHost.style.cssText = "position:fixed;bottom:0px;right:0px;width:128px;height:128px;opacity:1;pointer-events:none;z-index:-9999;overflow:hidden;";
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
    this.frames = [];
    this.isBuffered = false;
    this.frameIndex = 0;
    this.lastFrameTime = 0;
    this.lastVideoTime = -1;
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
    this.isPaused = false;
    this.rafId = null;
    this.lastRenderTime = 0;
    this.render = this.render.bind(this);
  }

  getKey(src) {
    if (!src || typeof src !== "string") return "";
    return src;
  }

  getEntry(key) {
    return this.pool.get(key) || null;
  }

  _hasHighResConsumer(entry) {
    if (!entry || !entry.visibleConsumers) return false;
    for (const c of entry.visibleConsumers) {
      if (c && c.highRes) return true;
    }
    return false;
  }

  acquire(key, options = {}, consumer) {
    let entry = this.pool.get(key);
    let initialType = options?.type;
    if (!initialType || initialType === "auto") {
      const s = options?.src || key || "";
      if ((s.includes("/api/avatars/") && s.includes("/media")) || /\.(mp4|webm|mov|ogg)($|\?)/i.test(s)) {
        initialType = "video";
      } else {
        initialType = "image";
      }
    }

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
      if (entry.status === "ready") {
        consumer.onReady(entry);
        if (entry.type === "image" && entry.source) {
          consumer.drawStatic?.(entry.source);
        } else if (entry.type === "video") {
          const frameSource = (entry.isBuffered && entry.frames.length > 0)
            ? entry.frames[entry.frameIndex]
            : (entry.masterCanvas || entry.source);
          if (frameSource) {
            consumer.onFrame?.(frameSource);
          }
          this._ensureRenderLoop();
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

    if (entry.visibleConsumers.size === 0 && entry.type === "video" && !entry.isBuffered && entry.source && !entry.source.paused) {
      try {
        entry.source.pause();
      } catch {}
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
        if (!entry.isBuffered && entry.source && entry.source.paused) {
          const now = Date.now();
          if (now - entry.lastPlayAttempt > 500) {
            entry.lastPlayAttempt = now;
            entry.source.play().then(() => this._ensureRenderLoop()).catch(() => {});
          }
        }
        if (entry.status === "ready") {
          const frameSource = (entry.isBuffered && entry.frames.length > 0)
            ? entry.frames[entry.frameIndex]
            : (entry.masterCanvas || (entry.source && entry.source.videoWidth > 0 && entry.source.readyState >= 2 ? (this._updateMasterCanvas(entry, entry.source) || entry.source) : null));
          if (frameSource) {
            consumer.onFrame?.(frameSource);
          }
        }
        this._ensureRenderLoop();
      } else if (entry.type === "image" && entry.status === "ready" && entry.source) {
        consumer.drawStatic?.(entry.source);
      }
    } else {
      entry.visibleConsumers.delete(consumer);
      if (entry.visibleConsumers.size === 0 && entry.type === "video" && !entry.isBuffered && entry.source && !entry.source.paused) {
        try {
          entry.source.pause();
        } catch {}
      }
    }
  }

  _updateMasterCanvas(entry, video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw <= 0 || vh <= 0 || video.readyState < 2) return null;

    let maxConsumerSize = 48;
    for (const c of entry.visibleConsumers) {
      if (c && c.size && c.size > maxConsumerSize) {
        maxConsumerSize = c.size;
      }
    }
    const targetSize = this._hasHighResConsumer(entry)
      ? Math.min(vw, vh, 512)
      : Math.min(vw, vh, Math.max(160, Math.min(256, maxConsumerSize * 2)));

    if (!entry.masterCanvas || entry.masterCanvas.width !== targetSize) {
      if (typeof document !== "undefined") {
        entry.masterCanvas = document.createElement("canvas");
        entry.masterCanvas.width = targetSize;
        entry.masterCanvas.height = targetSize;
      } else if (typeof OffscreenCanvas !== "undefined") {
        entry.masterCanvas = new OffscreenCanvas(targetSize, targetSize);
      }
      if (entry.masterCanvas) {
        entry.masterCtx = entry.masterCanvas.getContext("2d", { willReadFrequently: false });
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

    entry.masterCtx.drawImage(video, sx, sy, sSide, sSide, 0, 0, targetSize, targetSize);
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
      let retried = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((r) => setTimeout(r, 800));
        if (entry.status !== "loading") return;
        try {
          localUrl = await getAssetUrl(src);
          if (localUrl) {
            retried = true;
            break;
          }
        } catch {}
      }
      if (!retried || !localUrl) {
        this._handleError(entry, new Error("Failed to resolve asset URL"));
        return;
      }
    }

    if (entry.type === "video") {
      this._loadVideo(entry, localUrl, options);
    } else {
      this._loadImage(entry, localUrl, options.targetEntityId);
    }
  }

  _finishBuffering(entry) {
    if (!entry || entry.isBuffered) return;
    entry.isBuffered = true;
    entry.frames = entry.frames.filter(Boolean);
    const video = entry.source;
    if (video) {
      video.onended = null;
      video.onerror = null;
      video.onplaying = null;
      video.onplay = null;
      video.ontimeupdate = null;
      video.oncanplay = null;
      video.onloadeddata = null;
      try {
        video.pause();
      } catch {}
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
      entry.source = null;
    }
  }

  _loadVideo(entry, url, options = {}) {
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.loop = false;
    video.playsInline = true;
    video.autoplay = true;
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");
    video.removeAttribute("poster");
    video.style.cssText = "width:128px;height:128px;opacity:1;display:block;";

    entry.source = video;

    const host = getMediaPoolHost();
    if (host) {
      host.appendChild(video);
    }

    let isDisposed = false;
    let timeoutTimer = setTimeout(() => {
      if (entry.status !== "ready") {
        handleError();
      }
    }, 10000);

    const markReady = () => {
      if (isDisposed || entry.isBuffered) return;
      if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < 2) {
        return;
      }

      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      const masterFrame = this._updateMasterCanvas(entry, video) || video;

      if (entry.status !== "ready") {
        entry.status = "ready";
        for (const consumer of entry.consumers) {
          consumer.onReady(entry);
          if (entry.visibleConsumers.has(consumer)) {
            consumer.onFrame?.(masterFrame);
          }
        }
      }

      if (entry.visibleConsumers.size > 0) {
        if (video.paused) {
          video.play().then(() => this._ensureRenderLoop()).catch(() => {});
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
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      try {
        video.pause();
      } catch {}
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
    video.addEventListener("ended", () => {
      this._finishBuffering(entry);
    });
    video.addEventListener("error", handleError, { once: true });

    video.src = url;
    video.load();

    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      markReady();
    }
  }

  async _loadImage(entry, url, targetEntityId) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });

      entry.source = img;
      entry.status = "ready";
      console.log("[Max+ MediaPool]", "image ready", { key: entry.key, width: img.naturalWidth, height: img.naturalHeight });

      if (targetEntityId && !this.scannedStegoKeys.has(entry.key)) {
        this.scannedStegoKeys.add(entry.key);
        this._inspectStego(img, targetEntityId, entry.key);
      }

      for (const consumer of entry.consumers) {
        consumer.onReady(entry);
        consumer.drawStatic?.(img);
      }
    } catch (e) {
      this._handleError(entry, e);
    }
  }

  async _inspectStego(source, targetEntityId, key) {
    if (!targetEntityId || typeof document === "undefined") return;
    try {
      const sw = source.naturalWidth || source.videoWidth || source.width;
      const sh = source.naturalHeight || source.videoHeight || source.height;
      if (!sw || !sh || sw < 64 || sh < 64) {
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        return;
      }
      ctx.drawImage(source, 0, 0, sw, sh);
      const imgData = ctx.getImageData(0, 0, sw, sh);
      if (!imgData) {
        return;
      }

      const numTargetId = Number(targetEntityId);
      const candidateIds = [numTargetId, Math.abs(numTargetId)].filter((x) => x != null && !isNaN(x) && x !== 0);
      let foundUid = decodeStegoPayload(imgData, candidateIds);
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
        ctx.drawImage(source, sx, sy, side, side, 0, 0, 512, 512);
        const fallbackData = ctx.getImageData(0, 0, 512, 512);
        if (fallbackData) {
          foundUid = decodeStegoPayload(fallbackData, candidateIds);
        }
      }
      if (foundUid) {
        console.log("[Max+ MediaPool]", "stego decoded UID:", foundUid, "target:", numTargetId);
        recordSafeAvatarForTarget(numTargetId, foundUid, key);
      }
    } catch {}
  }

  _handleError(entry, err) {
    entry.status = "error";
    entry.error = err;
    console.warn("[Max+ MediaPool]", "error", { key: entry.key, error: err?.message || err });
    for (const consumer of entry.consumers) {
      consumer.onError(err);
    }
  }

  pause() {
    if (this.isPaused) return;
    this.isPaused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.isRendering = false;
    for (const entry of this.pool.values()) {
      if (entry.type === "video" && !entry.isBuffered && entry.source && !entry.source.paused) {
        try {
          entry.source.pause();
        } catch {}
      }
    }
  }

  resume() {
    if (!this.isPaused) return;
    this.isPaused = false;
    for (const entry of this.pool.values()) {
      if (
        entry.type === "video" &&
        entry.visibleConsumers.size > 0 &&
        !entry.isBuffered &&
        entry.source &&
        entry.source.paused
      ) {
        entry.source.play().catch(() => {});
      }
    }
    this._ensureRenderLoop();
  }

  _ensureRenderLoop() {
    if (this.isRendering || this.isPaused) return;

    for (const entry of this.pool.values()) {
      if (
        entry.type === "video" &&
        entry.visibleConsumers.size > 0 &&
        (entry.isBuffered || entry.source)
      ) {
        this.isRendering = true;
        this.rafId = requestAnimationFrame(this.render);
        break;
      }
    }
  }

  render(timestamp) {
    if (!this.isRendering || this.isPaused) return;

    this.rafId = requestAnimationFrame(this.render);

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!this.lastRenderTime) {
      this.lastRenderTime = now;
    }
    const delta = now - this.lastRenderTime;
    if (delta < 15) return;
    this.lastRenderTime = now;

    let hasActiveVideos = false;
    let hasVisibleVideos = false;

    for (const entry of this.pool.values()) {
      if (entry.type !== "video" || entry.visibleConsumers.size === 0) {
        continue;
      }

      hasVisibleVideos = true;

      if (entry.isBuffered) {
        if (entry.frames.length > 0) {
          if (!entry.lastFrameTime || (now - entry.lastFrameTime) > 100) {
            entry.lastFrameTime = now;
          }
          if (now - entry.lastFrameTime >= 33.33) {
            entry.frameIndex = (entry.frameIndex + 1) % entry.frames.length;
            entry.lastFrameTime = now;
          }
          const rawFrame = entry.frames[entry.frameIndex];
          const frame = rawFrame || entry.frames[0];
          if (frame) {
            hasActiveVideos = true;
            for (const consumer of entry.visibleConsumers) {
              consumer.onFrame?.(frame);
            }
          }
        }
        continue;
      }

      const video = entry.source;
      if (!video) continue;

      if (video.paused) {
        if (now - entry.lastPlayAttempt > 1000) {
          entry.lastPlayAttempt = now;
          video.play().then(() => this._ensureRenderLoop()).catch(() => {});
        }
        continue;
      }

      if (video.videoWidth <= 0 || video.videoHeight <= 0 || video.readyState < 2) {
        continue;
      }

      if (entry.status !== "ready") {
        entry.status = "ready";
        for (const consumer of entry.consumers) {
          consumer.onReady(entry);
        }
      }

      const masterFrame = this._updateMasterCanvas(entry, video) || video;
      hasActiveVideos = true;

      const vTime = video.currentTime;
      if (vTime > 0.02 && (entry.lastVideoTime < 0 || Math.abs(vTime - entry.lastVideoTime) >= 0.03)) {
        entry.lastVideoTime = vTime;
        if (entry.masterCanvas && entry.frames.length < 180) {
          if (typeof createImageBitmap === "function") {
            const fIndex = entry.frames.length;
            entry.frames.push(null);
            createImageBitmap(entry.masterCanvas)
              .then((bmp) => {
                entry.frames[fIndex] = bmp;
              })
              .catch(() => {
                const fc = document.createElement("canvas");
                fc.width = entry.masterCanvas.width;
                fc.height = entry.masterCanvas.height;
                const c = fc.getContext("2d");
                if (c) c.drawImage(entry.masterCanvas, 0, 0);
                entry.frames[fIndex] = fc;
              });
          } else {
            const fc = document.createElement("canvas");
            fc.width = entry.masterCanvas.width;
            fc.height = entry.masterCanvas.height;
            const c = fc.getContext("2d");
            if (c) c.drawImage(entry.masterCanvas, 0, 0);
            entry.frames.push(fc);
          }
        }
      }

      for (const consumer of entry.visibleConsumers) {
        consumer.onFrame?.(masterFrame);
      }

      if (entry.frames.length > 0 && (video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.05) || entry.frames.length >= 180)) {
        this._finishBuffering(entry);
      }
    }

    if (!hasActiveVideos && !hasVisibleVideos) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.isRendering = false;
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

    if (entry.frames && entry.frames.length > 0) {
      for (const frame of entry.frames) {
        if (frame) {
          if (typeof frame.close === "function") {
            try {
              frame.close();
            } catch {}
          } else if (typeof frame.width === "number") {
            frame.width = 0;
            frame.height = 0;
          }
        }
      }
      entry.frames = [];
    }

    if (entry.masterCanvas) {
      if (typeof entry.masterCanvas.width === "number") {
        entry.masterCanvas.width = 0;
        entry.masterCanvas.height = 0;
      }
      entry.masterCanvas = null;
      entry.masterCtx = null;
    }

    if (entry.type === "video" && entry.source) {
      entry.source.onended = null;
      entry.source.onerror = null;
      try {
        entry.source.pause();
      } catch {}
      if (entry.source.parentNode) {
        entry.source.parentNode.removeChild(entry.source);
      }
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
