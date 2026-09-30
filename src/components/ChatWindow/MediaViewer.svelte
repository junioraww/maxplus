<script>
  import { fade, scale as scaleTransition } from "svelte/transition";
  import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import { get } from "svelte/store";
  import { getAssetUrl, getProxiedMediaUrl, isProxiedMediaUrl, unwrapProxiedMediaUrl } from "$lib/utils/images";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { getChatSettings } from "$lib/stores/messages";
  import { resolveSenderDisplayName, fetchSenderDisplayName } from "$lib/stores/mediaPlayback";
  import API from "$lib/stores/api";

  export let index = 0;
  export let allMedia;
  export let chatId;
  export let originEl = null;
  export let originRadius = 12;

  const dispatch = createEventDispatcher();

  let videoElement;
  let movable;
  let mainMediaEl;
  let paused = true;
  let currentTime = 0;
  let duration = 0;
  let volume = 1;
  let playbackRate = 1;
  let showControls = true;
  let controlsTimeout;
  let isMetadataLoaded = false;
  let isVideoReady = false;
  let loop = false;

  let windowWidth = typeof window !== "undefined" ? window.innerWidth : 1000;
  let isSeeking = false;
  let seekValue = 0;
  let currentSenderName = "";

  let showSkipIcon = null;
  let videoCache = {};
  let resolvedMediaMap = {};
  let isLoading = false;

  let scale = 1;
  let x = 0;
  let y = 0;

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  let slideOffset = 0;
  let isSlideAnimating = false;
  let slideAnimFrame = null;

  let heroPhase = "idle";
  let heroStyle = "";
  let backdropOpacity = 1;
  let uiOpacity = 1;
  let isClosing = false;
  let hiddenOriginEl = null;
  const initialIndex = index;

  let encryptedVideoSrc = null;
  $: currentMedia = allMedia[index];
  $: prevMedia = index > 0 ? allMedia[index - 1] : null;
  $: nextMedia = index < allMedia.length - 1 ? allMedia[index + 1] : null;
  $: effectiveVideoSrc = (currentMedia?.videoId ? videoCache[currentMedia.videoId] : null) || (currentMedia?._type === "VIDEO" ? (getProxiedMediaUrl(currentMedia.localPath || currentMedia.baseUrl) || encryptedVideoSrc) : null);

  const unregisterBack = registerBackHandler(() => {
    requestClose();
    return false;
  });

  function restoreHiddenOrigin(smooth = false) {
    if (!hiddenOriginEl || !hiddenOriginEl.style) return;
    const el = hiddenOriginEl;
    hiddenOriginEl = null;
    if (smooth) {
      el.style.transition = "opacity 220ms ease-out";
      el.style.opacity = "1";
      setTimeout(() => {
        if (el && el.style) {
          el.style.transition = "";
        }
      }, 240);
    } else {
      el.style.transition = "";
      el.style.opacity = "";
    }
  }

  onDestroy(() => {
    restoreHiddenOrigin(false);
    stopAnim();
    stopSlideAnim();
    unregisterBack();
  });

  function findElementForSlide(targetIndex) {
    if (targetIndex === initialIndex && originEl && document.body.contains(originEl)) {
      return originEl;
    }
    const item = allMedia?.[targetIndex];
    if (!item?.uid || typeof document === "undefined") return null;
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(item.uid)) : String(item.uid).replace(/"/g, '\\"');
    const found = document.querySelector(`[data-media-uid="${escaped}"]`);
    if (found && document.body.contains(found)) {
      return found;
    }
    return null;
  }

  let heroOverlayClipStyle = "";

  function getOriginScrollContainer(el) {
    if (!el || typeof el.closest !== "function") return null;
    return el.closest(".message-list-container, .tg-scroll-content, .content");
  }

  function computeOverlayClip(el) {
    const scroller = getOriginScrollContainer(el);
    if (!scroller || typeof scroller.getBoundingClientRect !== "function" || !document.body.contains(scroller)) {
      return "";
    }
    const sr = scroller.getBoundingClientRect();
    let topInset = Math.max(0, Math.round(sr.top));
    const chatWin = el.closest?.(".chat-window");
    if (chatWin) {
      const pinned = chatWin.querySelector?.(".pinned-message");
      if (pinned) {
        const pr = pinned.getBoundingClientRect();
        if (pr.bottom > topInset && pr.bottom < window.innerHeight * 0.5) {
          topInset = Math.max(topInset, Math.round(pr.bottom));
        }
      }
    }
    const bottomInset = Math.max(0, Math.round(window.innerHeight - sr.bottom));
    if (topInset <= 0 && bottomInset <= 0) return "";
    return `clip-path: inset(${topInset}px 0px ${bottomInset}px 0px);`;
  }

  function getVisibleRect(el) {
    if (!el || typeof el.getBoundingClientRect !== "function" || !document.body.contains(el)) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const scroller = getOriginScrollContainer(el);
    let minTop = 0;
    let maxBottom = window.innerHeight;
    if (scroller && document.body.contains(scroller)) {
      const sr = scroller.getBoundingClientRect();
      minTop = Math.max(0, sr.top);
      maxBottom = Math.min(window.innerHeight, sr.bottom);
    }
    if (r.bottom > minTop + 8 && r.top < maxBottom - 8 && r.right > 0 && r.left < window.innerWidth) {
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return null;
  }

  function getStageCenter() {
    if (movable && typeof movable.getBoundingClientRect === "function") {
      const mr = movable.getBoundingClientRect();
      if (mr.width > 0 && mr.height > 0) {
        return { cx: mr.left + mr.width / 2, cy: mr.top + mr.height / 2 };
      }
    }
    return { cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
  }

  let videoMetaVersion = 0;

  function getTargetMediaBox(mediaItem = currentMedia) {
    const { cx, cy } = getStageCenter();
    const activeEl = mainMediaEl || videoElement;
    let natW = activeEl?.naturalWidth || activeEl?.videoWidth || mediaItem?.width || 0;
    let natH = activeEl?.naturalHeight || activeEl?.videoHeight || mediaItem?.height || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = vw * 0.95;
    const maxH = vh * 0.80;
    if (natW > 0 && natH > 0) {
      const ratio = Math.min(maxW / natW, maxH / natH, 1);
      return { width: Math.round(natW * ratio), height: Math.round(natH * ratio), cx, cy };
    }
    if (activeEl && activeEl.offsetWidth > 0 && activeEl.offsetHeight > 0) {
      return { width: activeEl.offsetWidth, height: activeEl.offsetHeight, cx, cy };
    }
    const size = Math.min(maxW, maxH, 540);
    return { width: size, height: size, cx, cy };
  }

  $: videoDimensions = (() => {
    const _v = videoMetaVersion;
    let w = videoElement?.videoWidth || currentMedia?.width || 0;
    let h = videoElement?.videoHeight || currentMedia?.height || 0;
    if (!w || !h || !windowWidth) return null;
    const maxW = windowWidth * 0.95;
    const maxH = (typeof window !== "undefined" ? window.innerHeight : 800) * 0.80;
    const ratio = Math.min(maxW / w, maxH / h, 1);
    return {
      width: Math.round(w * ratio),
      height: Math.round(h * ratio)
    };
  })();

  function buildHeroTransform(rect, target, radiusPx) {
    const scale = Math.max(
      rect.width / Math.max(target.width, 1),
      rect.height / Math.max(target.height, 1),
      0.04
    );
    const dx = (rect.left + rect.width / 2) - target.cx;
    const dy = (rect.top + rect.height / 2) - target.cy;
    const clipX = Math.max(0, Math.round((target.width - rect.width / scale) / 2));
    const clipY = Math.max(0, Math.round((target.height - rect.height / scale) / 2));
    const rad = Math.round(radiusPx / scale);
    return {
      dx,
      dy,
      scale,
      clipX,
      clipY,
      rad,
    };
  }

  onMount(async () => {
    const el = findElementForSlide(index);
    if (el && currentMedia) {
      const thumbImg = el.querySelector?.("img, video");
      const key = getMediaKey(currentMedia);
      if (thumbImg?.src && !thumbImg.src.startsWith("data:image/svg") && key && !resolvedMediaMap[key]) {
        resolvedMediaMap = { ...resolvedMediaMap, [key]: thumbImg.src };
      }
      if (currentMedia._type === "PHOTO") {
        await loadMediaUrl(currentMedia);
      }
    }

    const rect = getVisibleRect(el);
    if (rect) {
      hiddenOriginEl = el;
      if (hiddenOriginEl && hiddenOriginEl.style) {
        hiddenOriginEl.style.transition = "none";
        hiddenOriginEl.style.opacity = "0";
      }
      heroPhase = "entering";
      backdropOpacity = 0;
      uiOpacity = 0;
      heroOverlayClipStyle = computeOverlayClip(el);
      heroStyle = "opacity: 0; transition: none;";
      await tick();

      if (mainMediaEl && !mainMediaEl.complete) {
        await new Promise((res) => {
          const done = () => res();
          mainMediaEl.addEventListener("load", done, { once: true });
          mainMediaEl.addEventListener("error", done, { once: true });
          setTimeout(done, 90);
        });
      }

      const target = getTargetMediaBox(currentMedia);
      const h = buildHeroTransform(rect, target, originRadius || 12);

      heroStyle = `transform: translate3d(calc(-50% + ${h.dx}px), calc(-50% + ${h.dy}px), 0) scale(${h.scale}); clip-path: inset(${h.clipY}px ${h.clipX}px ${h.clipY}px ${h.clipX}px round ${h.rad}px); border-radius: 0px; opacity: 1; transition: none;`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          backdropOpacity = 1;
          uiOpacity = 1;
          if (heroOverlayClipStyle) {
            heroOverlayClipStyle = "clip-path: inset(0px 0px 0px 0px); transition: clip-path 260ms cubic-bezier(0.22, 1, 0.36, 1);";
          }
          heroStyle = `transform: translate3d(-50%, -50%, 0) scale(1, 1); clip-path: inset(0px 0px 0px 0px round 0px); border-radius: 0px; opacity: 1; transition: transform 310ms cubic-bezier(0.22, 1, 0.36, 1), clip-path 310ms cubic-bezier(0.22, 1, 0.36, 1);`;
          setTimeout(() => {
            if (heroPhase === "entering") {
              heroPhase = "idle";
              heroStyle = "";
              heroOverlayClipStyle = "";
            }
          }, 320);
        });
      });
    }
  });

  export function requestClose() {
    if (isClosing) return;
    isClosing = true;
    stopAnim();
    stopSlideAnim();

    const targetEl = findElementForSlide(index);
    const rect = getVisibleRect(targetEl);
    if (rect) {
      if (hiddenOriginEl && hiddenOriginEl !== targetEl) {
        restoreHiddenOrigin(true);
      }
      hiddenOriginEl = targetEl;
      if (hiddenOriginEl && hiddenOriginEl.style) {
        hiddenOriginEl.style.transition = "none";
        hiddenOriginEl.style.opacity = "0";
      }
      heroPhase = "leaving";
      const target = getTargetMediaBox(currentMedia);
      const h = buildHeroTransform(rect, target, originRadius || 12);
      const endClip = computeOverlayClip(targetEl);
      if (endClip) {
        heroOverlayClipStyle = "clip-path: inset(0px 0px 0px 0px);";
      }

      heroStyle = `transform: translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale}); clip-path: inset(0px 0px 0px 0px round 0px); border-radius: 0px; transition: none;`;
      requestAnimationFrame(() => {
        backdropOpacity = 0;
        uiOpacity = 0;
        if (endClip) {
          heroOverlayClipStyle = `${endClip} transition: clip-path 260ms cubic-bezier(0.22, 1, 0.36, 1);`;
        }
        heroStyle = `transform: translate3d(calc(-50% + ${h.dx}px), calc(-50% + ${h.dy}px), 0) scale(${h.scale}); clip-path: inset(${h.clipY}px ${h.clipX}px ${h.clipY}px ${h.clipX}px round ${h.rad}px); border-radius: 0px; transition: transform 270ms cubic-bezier(0.22, 1, 0.36, 1), clip-path 270ms cubic-bezier(0.22, 1, 0.36, 1);`;
        setTimeout(() => {
          heroOverlayClipStyle = "";
          restoreHiddenOrigin(false);
          dispatch("close");
        }, 270);
      });
    } else {
      heroPhase = "fading";
      restoreHiddenOrigin(true);
      backdropOpacity = 0;
      uiOpacity = 0;
      heroStyle = `transform: translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale}); opacity: 0; border-radius: 0px; transition: opacity 210ms ease-out;`;
      setTimeout(() => {
        dispatch("close");
      }, 215);
    }
  }

  function getMediaKey(media) {
    if (!media) return "";
    return String(media.uid || media.fileId || media.videoId || media.baseUrl || media.localPath || media.name || "");
  }

  async function ensureEncryptedMediaUrl(media) {
    if (!media || !media.isEncryptedMedia) return media?.baseUrl || null;
    if (media.baseUrl && (media._type === "PHOTO" || isProxiedMediaUrl(media.baseUrl))) {
      return media.baseUrl;
    }
    if (media.localPath) {
      const url = getProxiedMediaUrl(media.localPath);
      media.baseUrl = url;
      return url;
    }
    const fid = media.fileId || media.encryptedAttach?.fileId;
    if (!fid) return null;

    try {
      const account = await getCurrentAccount().catch(() => null);
      const accountId = Number(account?.id || 0);
      const cached = await tauriInvoke("get_cached_file", {
        account: accountId,
        src: `enc_media_${fid}`
      }).catch(() => null);

      if (cached) {
        media.localPath = cached;
        const url = getProxiedMediaUrl(cached);
        media.baseUrl = url;
        return url;
      }

      const fileRes = await $API.getFileById(chatId, media.messageId, fid);
      if (fileRes?.url) {
        const settingsStore = chatId ? getChatSettings(chatId) : null;
        const settings = settingsStore ? get(settingsStore) : null;
        const cachedPath = await tauriInvoke("cache_encrypted_media", {
          account: accountId,
          chatId: Number(chatId || 0),
          fileId: Number(fid),
          src: fileRes.url,
          password: settings?.password || null,
        });
        if (cachedPath) {
          media.localPath = cachedPath;
          const url = getProxiedMediaUrl(cachedPath);
          media.baseUrl = url;
          return url;
        }
      }
    } catch (e) {
      console.error("[MediaViewer] Failed to ensureEncryptedMediaUrl:", e);
    }
    return null;
  }

  function ensureSlideResolved(media) {
    if (!media) return;
    const key = getMediaKey(media);
    if (!key || resolvedMediaMap[key]) return;
    if (media._type === "PHOTO") {
      loadMediaUrl(media).then((url) => {
        if (url) {
          resolvedMediaMap = { ...resolvedMediaMap, [key]: url };
        }
      }).catch(() => {});
    } else if (media._type === "VIDEO") {
      const thumb = media.thumbnail || media.baseUrl;
      if (thumb) {
        if (thumb.startsWith("data:") || thumb.startsWith("blob:") || isProxiedMediaUrl(thumb)) {
          resolvedMediaMap = { ...resolvedMediaMap, [key]: thumb };
        } else {
          getAssetUrl(thumb).then((url) => {
            resolvedMediaMap = { ...resolvedMediaMap, [key]: url || getProxiedMediaUrl(thumb) };
          }).catch(() => {
            resolvedMediaMap = { ...resolvedMediaMap, [key]: getProxiedMediaUrl(thumb) };
          });
        }
      }
    }
  }

  $: {
    if (currentMedia) ensureSlideResolved(currentMedia);
    if (prevMedia) ensureSlideResolved(prevMedia);
    if (nextMedia) ensureSlideResolved(nextMedia);
  }

  $: if (hiddenOriginEl && index !== initialIndex) {
    restoreHiddenOrigin(true);
    const nextEl = findElementForSlide(index);
    if (nextEl && getVisibleRect(nextEl)) {
      hiddenOriginEl = nextEl;
      if (hiddenOriginEl.style) {
        hiddenOriginEl.style.transition = "none";
        hiddenOriginEl.style.opacity = "0";
      }
    }
  } else if (!hiddenOriginEl && heroPhase === "idle") {
    const curEl = findElementForSlide(index);
    if (curEl && getVisibleRect(curEl)) {
      hiddenOriginEl = curEl;
      if (hiddenOriginEl.style) {
        hiddenOriginEl.style.transition = "none";
        hiddenOriginEl.style.opacity = "0";
      }
    }
  }

  let resolvingVideo = false;
  function resolveEncryptedVideo(media) {
    if (media?._type === "VIDEO" && media?.isEncryptedMedia && !effectiveVideoSrc && !resolvingVideo) {
      resolvingVideo = true;
      ensureEncryptedMediaUrl(media).then((url) => {
        resolvingVideo = false;
        if (url) {
          media.baseUrl = url;
          if (currentMedia === media) {
            encryptedVideoSrc = getProxiedMediaUrl(url);
          }
        }
      }).catch((e) => {
        console.error("[MediaViewer] resolveEncryptedVideo error:", e);
        resolvingVideo = false;
      });
    }
  }

  $: {
    encryptedVideoSrc = null;
    resolveEncryptedVideo(currentMedia);
  }

  let resolvedPoster = null;
  $: {
    const posterSrc = currentMedia?.thumbnail;
    if (posterSrc) {
      if (posterSrc.startsWith("data:") || posterSrc.startsWith("blob:") || isProxiedMediaUrl(posterSrc)) {
        resolvedPoster = posterSrc;
      } else if (posterSrc.startsWith("http")) {
        getAssetUrl(posterSrc).then((url) => {
          if (url) resolvedPoster = url;
          else resolvedPoster = getProxiedMediaUrl(posterSrc);
        }).catch(() => {
          resolvedPoster = getProxiedMediaUrl(posterSrc);
        });
      } else {
        resolvedPoster = getProxiedMediaUrl(posterSrc);
      }
    } else {
      resolvedPoster = null;
    }
  }

  $: if (index !== undefined) {
    isMetadataLoaded = false;
    isVideoReady = false;
    duration = currentMedia?.duration
      ? (currentMedia.duration > 1000 ? currentMedia.duration / 1000 : currentMedia.duration)
      : 0;
    currentTime = 0;
    playbackRate = 1;
    showControls = true;
    paused = true;
    scale = 1;
    x = 0;
    y = 0;
  }

  $: {
    const sId = currentMedia?.senderId || currentMedia?.sender;
    const initial = resolveSenderDisplayName(sId, currentMedia?.senderName);
    if (initial) {
      currentSenderName = initial;
    } else if (sId) {
      fetchSenderDisplayName(sId, currentMedia?.senderName).then((name) => {
        if (name) currentSenderName = name;
      });
    } else {
      currentSenderName = currentMedia?.senderName || "";
    }
  }

  function formatMediaDate(timestamp) {
    if (!timestamp) return "";
    const d = new Date(Number(timestamp) < 1e12 ? Number(timestamp) * 1000 : Number(timestamp));
    const now = new Date();
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (d.toDateString() === now.toDateString()) {
      return `сегодня в ${timeStr}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `вчера в ${timeStr}`;
    }
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}.${month}.${year} в ${timeStr}`;
  }

  function getMediaTypeName(media) {
    if (!media) return "";
    const vType = Number(media.videoType ?? media.video_type);
    if (media._type === "PHOTO" || media.type === "PHOTO") {
      return "Фото";
    }
    if (vType === 1 || media.isNote) {
      return "Видеосообщение";
    }
    return "Видео";
  }

  async function loadVideo(videoId) {
    if (!videoId) return;
    if (videoCache[videoId] || isLoading) return;
    isLoading = true;
    try {
      const targetChatId = currentMedia?.chatId || chatId;
      const targetToken = currentMedia?.videoToken || currentMedia?.token || null;
      const response = await $API.getVideoById(
        targetChatId,
        currentMedia.messageId,
        videoId,
        targetToken,
      );
      const qualityPriority = ["MP4_1080", "MP4_720", "MP4_480", "MP4_360"];
      let videoUrl = null;
      for (const quality of qualityPriority) {
        if (response[quality]) {
          videoUrl = response[quality];
          break;
        }
      }
      if (!videoUrl && response.HLS) videoUrl = response.HLS;

      if (videoUrl) {
        videoCache[videoId] = getProxiedMediaUrl(videoUrl);
        videoCache = { ...videoCache };
      }
    } catch (error) {
      console.error("Ошибка загрузки:", error);
    } finally {
      isLoading = false;
    }
  }

  $: if (currentMedia?._type === "VIDEO" && currentMedia?.videoId && !videoCache[currentMedia.videoId] && !isLoading) {
    loadVideo(currentMedia.videoId);
  }

  function toggleLoop() {
    loop = !loop;
    if (videoElement) {
      videoElement.loop = loop;
    }
  }

  function handleVideoEnded() {
    if (loop && videoElement) {
      videoElement.currentTime = 0;
      videoElement.play().catch(() => {});
    } else {
      paused = true;
    }
  }

  function handleSeekStart() {
    isSeeking = true;
    if (videoElement) {
      seekValue = videoElement.currentTime;
    }
  }

  function handleSeekInput(e) {
    seekValue = parseFloat(e.target.value);
    if (!isNaN(seekValue) && videoElement) {
      videoElement.currentTime = seekValue;
      currentTime = seekValue;
    }
  }

  function handleSeekChange(e) {
    const newTime = parseFloat(e.target.value);
    if (!isNaN(newTime) && videoElement) {
      videoElement.currentTime = newTime;
      currentTime = newTime;
    }
    isSeeking = false;
  }

  async function togglePlay() {
    if (!videoElement) return;
    try {
      if (videoElement.paused) {
        await videoElement.play();
      } else {
        videoElement.pause();
      }
    } catch (e) {
      console.warn("[MediaViewer] Play interrupted:", e);
    }
  }

  function handleSync(e) {
    const el = e.target;
    if (el.duration && isFinite(el.duration) && el.duration > 0) {
      duration = el.duration;
    } else if (currentMedia?.duration && (!duration || duration <= 0)) {
      duration = currentMedia.duration > 1000 ? currentMedia.duration / 1000 : currentMedia.duration;
    }
    isMetadataLoaded = duration > 0 && !isNaN(duration);
    videoMetaVersion++;
  }

  function handleCanPlay() {
    isVideoReady = true;
    if (videoElement && (!duration || isNaN(duration))) {
      duration = videoElement.duration;
    }
    videoMetaVersion++;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || isNaN(seconds) || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function resetControlsTimeout() {
    showControls = true;
    clearTimeout(controlsTimeout);
    if (!paused) {
      controlsTimeout = setTimeout(() => (showControls = false), 2500);
    }
  }

  function handleVideoTouch(side) {
    if (wasGestureMoved) return;
    if (!videoElement || !isMetadataLoaded) return;
    const now = Date.now();
    if (now - lastTap < 300) {
      if (side === "left") {
        videoElement.currentTime = Math.max(0, videoElement.currentTime - 5);
        showSkipIcon = "left";
      } else {
        videoElement.currentTime = Math.min(
          duration,
          videoElement.currentTime + 5,
        );
        showSkipIcon = "right";
      }
      setTimeout(() => (showSkipIcon = null), 500);
    } else {
      if (!showControls) resetControlsTimeout();
      else togglePlay();
    }
    lastTap = now;
  }
  let lastTap = 0;



  let pressTimer;
  function handlePressStart(e) {
    if (e.target.closest(".video-controls-bar")) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!paused && !wasGestureMoved && activePointers.size <= 1) playbackRate = 2;
    }, 500);
  }

  function handlePressEnd() {
    clearTimeout(pressTimer);
    playbackRate = 1;
  }

  function handleWheel(e) {
    if (isClosing || heroPhase !== "idle") return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
    scale = nextScale;
    if (scale === 1) {
      animateTo(0, 0, 1);
    }
  }

  $: dismissProgress = scale <= 1.02 && slideOffset === 0 ? Math.min(Math.abs(y) / (typeof window !== "undefined" ? window.innerHeight * 0.42 : 340), 1) : 0;
  $: effectiveBackdropOpacity = isClosing ? backdropOpacity : (1 - dismissProgress * 0.58);
  $: effectiveUiOpacity = isClosing ? uiOpacity : (1 - dismissProgress * 0.85);
  $: dragDismissScale = scale <= 1.02 && slideOffset === 0 && y !== 0 ? Math.max(0.84, 1 - dismissProgress * 0.16) : scale;
  $: transformStyle = `translate3d(calc(-50% + ${x + slideOffset}px), calc(-50% + ${y}px), 0) scale(${dragDismissScale})`;

  let activePointers = new Map();
  let isDragging = false;
  let dragAxis = null;
  let wasGestureMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartMidX = 0;
  let pinchStartMidY = 0;
  let pinchOriginX = 0;
  let pinchOriginY = 0;
  let lastPhotoTapTime = 0;
  let lastPhotoTapX = 0;
  let lastPhotoTapY = 0;
  let animFrameId = null;

  function stopAnim() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function stopSlideAnim() {
    if (slideAnimFrame) {
      cancelAnimationFrame(slideAnimFrame);
      slideAnimFrame = null;
    }
    isSlideAnimating = false;
  }

  function animateSlideTransition(dir, fromOffset = 0) {
    if (isSlideAnimating || isClosing) return;
    const nextIdx = index + dir;
    if (nextIdx < 0 || nextIdx >= allMedia.length) {
      animateSlideSnapBack(fromOffset);
      return;
    }

    stopSlideAnim();
    stopAnim();
    isSlideAnimating = true;

    const vw = window.innerWidth || 400;
    const gap = 28;
    const targetOffset = dir > 0 ? -(vw + gap) : (vw + gap);
    const startOffset = fromOffset;
    const startY = y;
    const startTime = performance.now();
    const animDur = 260;

    function step(now) {
      const p = Math.min((now - startTime) / animDur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      slideOffset = startOffset + (targetOffset - startOffset) * ease;
      y = startY * (1 - ease);

      if (p < 1) {
        slideAnimFrame = requestAnimationFrame(step);
      } else {
        slideAnimFrame = null;
        isSlideAnimating = false;
        slideOffset = 0;
        x = 0;
        y = 0;
        scale = 1;
        index = nextIdx;
      }
    }

    slideAnimFrame = requestAnimationFrame(step);
  }

  function animateSlideSnapBack(fromOffset) {
    stopSlideAnim();
    const startOffset = fromOffset;
    const startY = y;
    const startTime = performance.now();
    const animDur = 210;
    isSlideAnimating = true;

    function step(now) {
      const p = Math.min((now - startTime) / animDur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      slideOffset = startOffset * (1 - ease);
      y = startY * (1 - ease);

      if (p < 1) {
        slideAnimFrame = requestAnimationFrame(step);
      } else {
        slideOffset = 0;
        y = 0;
        slideAnimFrame = null;
        isSlideAnimating = false;
      }
    }

    slideAnimFrame = requestAnimationFrame(step);
  }

  function getPointerPair() {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    return { dist, midX, midY };
  }

  function handlePointerDown(e) {
    if (isClosing || heroPhase !== "idle") return;
    if (e.target.closest(".video-controls-bar") || e.target.closest(".nav-btn") || e.target.closest(".viewer-header")) {
      return;
    }
    stopAnim();
    if (isSlideAnimating) {
      stopSlideAnim();
    }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1) {
      isDragging = true;
      dragAxis = null;
      wasGestureMoved = false;
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      dragStartX = e.clientX - (scale <= 1.02 ? slideOffset : x);
      dragStartY = e.clientY - y;
    } else if (activePointers.size === 2) {
      wasGestureMoved = true;
      dragAxis = null;
      slideOffset = 0;
      clearTimeout(pressTimer);
      playbackRate = 1;
      const pair = getPointerPair();
      if (pair) {
        pinchStartDist = Math.max(pair.dist, 1);
        pinchStartScale = scale;
        pinchStartMidX = pair.midX;
        pinchStartMidY = pair.midY;
        pinchOriginX = x;
        pinchOriginY = y;
      }
    }
  }

  function handlePointerMove(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      const pair = getPointerPair();
      if (!pair) return;
      const ratio = pair.dist / pinchStartDist;
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale * ratio));
      x = pinchOriginX + (pair.midX - pinchStartMidX);
      y = pinchOriginY + (pair.midY - pinchStartMidY);
      return;
    }

    if (!isDragging || activePointers.size !== 1) return;

    const dx = e.clientX - pointerDownX;
    const dy = e.clientY - pointerDownY;
    const movedDist = Math.hypot(dx, dy);
    if (movedDist > 6) {
      wasGestureMoved = true;
      clearTimeout(pressTimer);
      playbackRate = 1;
      if (!dragAxis && scale <= 1.02) {
        dragAxis = Math.abs(dx) > Math.abs(dy) * 1.1 ? "x" : "y";
      }
    }

    if (scale <= 1.02) {
      if (dragAxis === "x") {
        let rawOffset = e.clientX - dragStartX;
        if ((index === 0 && rawOffset > 0) || (index >= allMedia.length - 1 && rawOffset < 0)) {
          rawOffset *= 0.28;
        }
        slideOffset = rawOffset;
        y = (e.clientY - dragStartY) * 0.15;
      } else if (dragAxis === "y") {
        slideOffset = 0;
        x = (e.clientX - pointerDownX) * 0.25;
        y = e.clientY - dragStartY;
      } else {
        slideOffset = e.clientX - dragStartX;
        y = e.clientY - dragStartY;
      }
    } else {
      x = e.clientX - dragStartX;
      y = e.clientY - dragStartY;
    }
  }

  function handlePointerUp(e) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);

    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      dragStartX = remaining.x - (scale <= 1.02 ? slideOffset : x);
      dragStartY = remaining.y - y;
      return;
    }

    if (activePointers.size === 0) {
      isDragging = false;

      if (!wasGestureMoved && currentMedia?._type === "PHOTO") {
        const now = Date.now();
        const tapDist = Math.hypot(e.clientX - lastPhotoTapX, e.clientY - lastPhotoTapY);
        if (now - lastPhotoTapTime < 300 && tapDist < 40) {
          if (scale > 1.05) {
            animateTo(0, 0, 1);
          } else {
            animateTo(0, 0, 2.5);
          }
          lastPhotoTapTime = 0;
          return;
        }
        lastPhotoTapTime = now;
        lastPhotoTapX = e.clientX;
        lastPhotoTapY = e.clientY;
      }

      if (wasGestureMoved) {
        checkDismiss();
      }
      dragAxis = null;
    }
  }

  function animateTo(targetX, targetY, targetScale = scale) {
    stopAnim();
    const startX = x;
    const startY = y;
    const startScale = scale;
    const animDuration = 220;
    const start = performance.now();

    function frame(t) {
      const p = Math.min((t - start) / animDuration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      x = startX + (targetX - startX) * ease;
      y = startY + (targetY - startY) * ease;
      scale = startScale + (targetScale - startScale) * ease;

      if (p < 1) {
        animFrameId = requestAnimationFrame(frame);
      } else {
        animFrameId = null;
      }
    }

    animFrameId = requestAnimationFrame(frame);
  }

  function animateBack() {
    if (!movable) {
      animateTo(0, 0, scale);
      return;
    }
    const contentWidth = movable.offsetWidth * scale;
    const contentHeight = movable.offsetHeight * scale;

    const maxX = Math.max((contentWidth - window.innerWidth) / 2, 0);
    const maxY = Math.max((contentHeight - window.innerHeight) / 2, 0);

    const targetX = scale <= 1 ? 0 : Math.max(-maxX, Math.min(x, maxX));
    const targetY = scale <= 1 ? 0 : Math.max(-maxY, Math.min(y, maxY));

    animateTo(targetX, targetY, scale);
  }

  function checkDismiss() {
    if (scale <= 1.02) {
      if (dragAxis === "x" || Math.abs(slideOffset) > Math.abs(y)) {
        const threshold = Math.min(window.innerWidth * 0.18, 95);
        if (slideOffset < -threshold && index < allMedia.length - 1) {
          animateSlideTransition(1, slideOffset);
          return;
        } else if (slideOffset > threshold && index > 0) {
          animateSlideTransition(-1, slideOffset);
          return;
        }
        animateSlideSnapBack(slideOffset);
        return;
      }

      const dismissY = window.innerHeight * 0.16;
      if (Math.abs(y) > dismissY) {
        requestClose();
      } else {
        slideOffset = 0;
        animateTo(0, 0, 1);
      }
      return;
    }

    animateBack();
  }

  async function loadMediaUrl(media) {
    if (!media) return null;
    let effective = media.baseUrl;
    if (!effective && media.isEncryptedMedia) {
      effective = await ensureEncryptedMediaUrl(media);
    }
    if (!effective) return null;
    const res = await getAssetUrl(effective);
    const key = getMediaKey(media);
    if (res && key && !resolvedMediaMap[key]) {
      resolvedMediaMap = { ...resolvedMediaMap, [key]: res };
    }
    return res;
  }

  let isDownloadingMedia = false;

  async function downloadCurrentMedia() {
    if (isDownloadingMedia || !currentMedia) return;
    isDownloadingMedia = true;
    try {
      if (currentMedia.isEncryptedMedia || (currentMedia._type === "PHOTO" && currentMedia.baseUrl) || (currentMedia._type === "VIDEO" && !currentMedia.videoId && currentMedia.baseUrl)) {
        if (!currentMedia.baseUrl && !currentMedia.localPath) {
          await ensureEncryptedMediaUrl(currentMedia);
        }
        const defaultName = currentMedia.name || (currentMedia._type === "PHOTO" ? `photo_${Date.now()}.jpg` : `video_${Date.now()}.mp4`);
        const filePath = await save({
          defaultPath: defaultName,
          filters: currentMedia._type === "PHOTO"
            ? [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }]
            : [{ name: "Videos", extensions: ["mp4", "webm", "mov"] }],
        });
        if (filePath) {
          const target = currentMedia.localPath || currentMedia.baseUrl;
          if (target) {
            await tauriInvoke("download_to_path", { url: target, path: filePath, onProgress: new Channel() });
          }
        }
        return;
      }
      if (currentMedia._type === "PHOTO") {
        const url = currentMedia.baseUrl;
        if (!url) return;
        const defaultName = currentMedia.name || `photo_${Date.now()}.jpg`;
        const filePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
        });
        if (filePath) {
          await tauriInvoke("download_to_path", { url, path: filePath, onProgress: new Channel() });
        }
      } else if (currentMedia._type === "VIDEO") {
        let videoUrl = videoCache[currentMedia.videoId] || currentMedia.baseUrl;
        if (!videoUrl && currentMedia.videoId) {
          const targetChatId = currentMedia?.chatId || chatId;
          const targetToken = currentMedia?.videoToken || currentMedia?.token || null;
          const response = await $API.getVideoById(
            targetChatId,
            currentMedia.messageId,
            currentMedia.videoId,
            targetToken,
          );
          const qualityPriority = ["MP4_1080", "MP4_720", "MP4_480", "MP4_360"];
          for (const quality of qualityPriority) {
            if (response[quality]) {
              videoUrl = response[quality];
              break;
            }
          }
          if (!videoUrl && response.HLS) videoUrl = response.HLS;
        } else if (videoUrl && isProxiedMediaUrl(videoUrl)) {
          videoUrl = unwrapProxiedMediaUrl(videoUrl);
        }
        if (!videoUrl) return;
        const defaultName = currentMedia.name || `video_${Date.now()}.mp4`;
        const filePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "Videos", extensions: ["mp4", "webm", "mov"] }],
        });
        if (filePath) {
          await tauriInvoke("download_to_path", { url: videoUrl, path: filePath, onProgress: new Channel() });
        }
      }
    } catch (e) {
      console.error("Media download error:", e);
    } finally {
      isDownloadingMedia = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      requestClose();
    } else if (e.key === "ArrowLeft" && index > 0) {
      animateSlideTransition(-1, 0);
    } else if (e.key === "ArrowRight" && index < allMedia.length - 1) {
      animateSlideTransition(1, 0);
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} bind:innerWidth={windowWidth} />

<div
  class="media-viewer-overlay"
  style="background: rgba(0, 0, 0, {0.96 * effectiveBackdropOpacity}); {heroOverlayClipStyle}"
  on:click|self={() => requestClose()}
>
  <div class="viewer-header" style="opacity: {effectiveUiOpacity};">
    <div class="header-left">
      <div class="header-titles">
        <div class="header-title-line">
          <span class="media-type-badge">{getMediaTypeName(currentMedia)}</span>
          {#if currentSenderName}
            <span class="sender-name">{currentSenderName === 'Вы' ? 'от вас' : `от ${currentSenderName}`}</span>
          {/if}
        </div>
        <div class="header-subtitle-line">
          {#if currentMedia?.time}
            <span class="media-date">{formatMediaDate(currentMedia.time)}</span>
            <span class="header-dot">·</span>
          {/if}
          <span class="counter">{index + 1} из {allMedia.length}</span>
        </div>
      </div>
    </div>
    <div class="header-actions">
      <button
        class="viewer-icon-btn download"
        on:click|stopPropagation={downloadCurrentMedia}
        title={currentMedia?._type === "PHOTO" ? "Скачать фото" : "Скачать видео"}
        disabled={isDownloadingMedia}
      >
        <svg viewBox="0 0 24 24">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
      </button>
      <button class="viewer-icon-btn close" on:click={() => requestClose()}>
        <svg viewBox="0 0 24 24"
          ><path
            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
          /></svg
        >
      </button>
    </div>
  </div>

  <div class="viewer-content" on:mousemove={resetControlsTimeout}>
    <button
      class="nav-btn prev"
      class:hidden={index === 0 || effectiveUiOpacity < 0.2}
      style="opacity: {index === 0 ? 0 : effectiveUiOpacity};"
      on:click|stopPropagation={() => animateSlideTransition(-1, 0)}
    >
      <svg viewBox="0 0 24 24"
        ><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg
      >
    </button>

    <div
      on:wheel|nonpassive={handleWheel}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
      bind:this={movable}
      class="media-container"
    >
      {#if prevMedia && (slideOffset > 0 || isSlideAnimating) && heroPhase === "idle"}
        {@const prevSrc = resolvedMediaMap[getMediaKey(prevMedia)]}
        {#if prevSrc}
          <img
            class="adjacent-slide"
            style="transform: translate3d(calc(-50% - {windowWidth + 28}px + {slideOffset}px), -50%, 0) scale(1);"
            src={prevSrc}
            alt=""
            draggable="false"
          />
        {/if}
      {/if}

      {#key index}
        {#if currentMedia._type === "PHOTO"}
          {@const cachedPhoto = resolvedMediaMap[getMediaKey(currentMedia)]}
          {#if cachedPhoto}
            <img
              bind:this={mainMediaEl}
              style={heroPhase !== "idle" ? heroStyle : `transform: ${transformStyle};`}
              src={cachedPhoto}
              alt=""
              draggable="false"
            />
          {:else}
            {#await loadMediaUrl(currentMedia)}
              <div class="media-shimmer" style="width: min(80vw, 600px); height: min(70vh, 500px); border-radius: 12px;"></div>
            {:then url}
              {#if url}
                <img
                  bind:this={mainMediaEl}
                  style={heroPhase !== "idle" ? heroStyle : `transform: ${transformStyle};`}
                  src={url}
                  alt=""
                  draggable="false"
                />
              {:else}
                <div class="media-shimmer" style="width: min(80vw, 600px); height: min(70vh, 500px); border-radius: 12px;"></div>
              {/if}
            {/await}
          {/if}
        {:else if currentMedia._type === "VIDEO"}
          {#if effectiveVideoSrc}
            <div
              class="tg-video-wrapper"
              on:pointerdown={handlePressStart}
              on:pointerup={handlePressEnd}
              on:pointercancel={handlePressEnd}
            >
              <video
                bind:this={videoElement}
                src={effectiveVideoSrc}
                poster={resolvedPoster}
                class="video-player"
                class:ready={isVideoReady}
                autoplay
                bind:paused
                bind:currentTime
                bind:duration
                bind:volume
                bind:playbackRate
                {loop}
                on:loadedmetadata={handleSync}
                on:durationchange={handleSync}
                on:canplay={handleCanPlay}
                on:ended={handleVideoEnded}
                on:error={(e) => console.error("[MediaViewer] Video element error:", e.target?.error, "src:", effectiveVideoSrc)}
                playsinline
                style="{(videoDimensions ? `width: ${videoDimensions.width}px; height: ${videoDimensions.height}px; ` : '') + (heroPhase !== 'idle' ? heroStyle : `transform: ${transformStyle};`)}"
              ></video>

              <div class="tap-zones" style={heroPhase !== "idle" ? "display: none;" : `transform: ${transformStyle};`}>
                <div
                  class="tap-zone left"
                  on:click|stopPropagation={() => handleVideoTouch("left")}
                ></div>
                <div
                  class="tap-zone right"
                  on:click|stopPropagation={() => handleVideoTouch("right")}
                ></div>
              </div>

              {#if playbackRate === 2 && !paused}
                <div class="speed-badge" transition:fade>2x Ускорение</div>
              {/if}

              {#if showSkipIcon === "left"}
                <div class="skip-anim left" in:scaleTransition out:fade>
                  <svg viewBox="0 0 24 24"
                    ><path
                      d="M11 18V6l-8.5 6L11 18zm.5-6l8.5 6V6l-8.5 6z"
                    /></svg
                  >
                  <span>-5 сек</span>
                </div>
              {:else if showSkipIcon === "right"}
                <div class="skip-anim right" in:scaleTransition out:fade>
                  <svg viewBox="0 0 24 24"
                    ><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" /></svg
                  >
                  <span>+5 сек</span>
                </div>
              {/if}

              <div
                class="video-controls-bar"
                class:hidden={!showControls || heroPhase !== "idle"}
                style="opacity: {!showControls || heroPhase !== 'idle' ? 0 : effectiveUiOpacity};"
                on:click|stopPropagation
                on:pointerdown|stopPropagation
                on:pointermove|stopPropagation
                on:pointerup|stopPropagation
                on:mousedown|stopPropagation
                on:touchstart|stopPropagation
                on:touchmove|stopPropagation
                on:touchend|stopPropagation
              >
                <div
                  class="progress-row"
                  on:pointerdown|stopPropagation
                  on:pointermove|stopPropagation
                  on:pointerup|stopPropagation
                  on:mousedown|stopPropagation
                  on:touchstart|stopPropagation
                  on:touchmove|stopPropagation
                  on:touchend|stopPropagation
                >
                  <input
                    type="range"
                    min="0"
                    max={duration > 0 ? duration : 0.1}
                    step="any"
                    value={isSeeking ? seekValue : currentTime}
                    on:pointerdown={handleSeekStart}
                    on:input={handleSeekInput}
                    on:change={handleSeekChange}
                    class="seek-bar"
                  />
                </div>

                <div class="controls-main">
                  <div class="controls-left">
                    <button
                      class="icon-btn play-pause"
                      on:click|stopPropagation={togglePlay}
                    >
                      {#if paused}
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg
                        >
                      {:else}
                        <svg viewBox="0 0 24 24"
                          ><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg
                        >
                      {/if}
                    </button>
                    <span class="time-text">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>

                  <div class="controls-right">
                    <button
                      class="icon-btn loop-btn"
                      class:active={loop}
                      on:click={toggleLoop}
                      title="Повтор"
                    >
                      <svg viewBox="0 0 24 24"
                        ><path
                          d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"
                        /></svg
                      >
                    </button>
                    <div
                      class="volume-group"
                      on:pointerdown|stopPropagation
                      on:pointermove|stopPropagation
                      on:pointerup|stopPropagation
                      on:mousedown|stopPropagation
                      on:touchstart|stopPropagation
                      on:touchmove|stopPropagation
                      on:touchend|stopPropagation
                    >
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        bind:value={volume}
                        class="volume-bar"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          {:else if currentMedia.videoId}
            <div
              class="preview-wrapper"
              on:click={() => loadVideo(currentMedia.videoId)}
            >
              <img
                bind:this={mainMediaEl}
                src={currentMedia.thumbnail}
                alt=""
                draggable="false"
                class="video-preview"
                style={heroPhase !== "idle" ? heroStyle : `transform: ${transformStyle};`}
              />
              <div class="play-overlay" style="opacity: {effectiveUiOpacity};">
                {#if isLoading}
                  <div class="loader"></div>
                {:else}
                  <div class="play-button">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                {/if}
              </div>
            </div>
          {:else if currentMedia.isEncryptedMedia}
            <div class="preview-wrapper">
              <div class="loader"></div>
            </div>
          {/if}
        {/if}
      {/key}

      {#if nextMedia && (slideOffset < 0 || isSlideAnimating) && heroPhase === "idle"}
        {@const nextSrc = resolvedMediaMap[getMediaKey(nextMedia)]}
        {#if nextSrc}
          <img
            class="adjacent-slide"
            style="transform: translate3d(calc(-50% + {windowWidth + 28}px + {slideOffset}px), -50%, 0) scale(1);"
            src={nextSrc}
            alt=""
            draggable="false"
          />
        {/if}
      {/if}
    </div>

    <button
      class="nav-btn next"
      class:hidden={index === allMedia.length - 1 || effectiveUiOpacity < 0.2}
      style="opacity: {index === allMedia.length - 1 ? 0 : effectiveUiOpacity};"
      on:click|stopPropagation={() => animateSlideTransition(1, 0)}
    >
      <svg viewBox="0 0 24 24"
        ><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg
      >
    </button>
  </div>
</div>

<style>
  .media-viewer-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    background: rgba(0, 0, 0, 0.96);
    z-index: 20000;
    display: flex;
    flex-direction: column;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    overscroll-behavior: none;
    transition: background-color 220ms ease;
  }

  .viewer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: calc(env(safe-area-inset-top, 12px) + 6px) 20px 15px 20px;
    color: white;
    z-index: 10;
    transition: opacity 200ms ease;
    gap: 16px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .header-titles {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .header-title-line {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    min-width: 0;
  }

  .media-type-badge {
    background: rgba(255, 255, 255, 0.16);
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
    flex-shrink: 0;
  }

  .sender-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.95;
  }

  .header-subtitle-line {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    opacity: 0.72;
  }

  .header-dot {
    opacity: 0.5;
  }

  .counter {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.85;
  }

  .viewer-content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 40px 10px;
    position: relative;
    touch-action: none;
    overflow: visible;
  }

  .media-container {
    flex: 1;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
    position: relative;
  }

  .media-container :global(img),
  .media-container :global(.video-player),
  .media-container :global(.video-preview) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate3d(-50%, -50%, 0) scale(1);
    object-fit: contain;
    max-width: 95vw;
    max-height: 80vh;
    will-change: transform, clip-path, border-radius, opacity;
    touch-action: none;
    -webkit-user-drag: none;
    user-select: none;
  }

  .adjacent-slide {
    pointer-events: none;
    opacity: 0.92;
  }

  .nav-btn {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, opacity 0.2s, transform 0.15s;
    flex-shrink: 0;
    margin: 0 15px;
    z-index: 100;
  }
  .nav-btn:hover {
    background: rgba(255, 255, 255, 0.22);
  }
  .nav-btn:active {
    transform: scale(0.93);
  }
  .nav-btn svg {
    width: 32px;
    height: 32px;
    fill: currentColor;
  }
  .nav-btn.hidden {
    opacity: 0 !important;
    pointer-events: none;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .viewer-icon-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.15s, opacity 0.15s;
  }
  .viewer-icon-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .viewer-icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .viewer-icon-btn svg {
    width: 26px;
    height: 26px;
    fill: currentColor;
  }

  .media-shimmer {
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 35%,
      rgba(79, 195, 247, 0.16) 50%,
      rgba(255, 255, 255, 0.12) 65%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.6s infinite linear;
    max-width: 95vw;
    max-height: 80vh;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .preview-wrapper {
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .video-preview {
    filter: brightness(0.8);
    transition: filter 0.3s;
  }
  .preview-wrapper:hover .video-preview {
    filter: brightness(1);
  }
  .play-overlay {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .play-button {
    width: 80px;
    height: 80px;
    background: rgba(0, 0, 0, 0.55);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    transition: transform 0.2s;
  }
  .play-button svg {
    width: 40px;
    height: 40px;
    fill: currentColor;
    margin-left: 5px;
  }
  .loader {
    width: 50px;
    height: 50px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: #fff;
    animation: spin 1s ease-in-out infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tg-video-wrapper {
    cursor: pointer;
  }

  .video-player {
    z-index: 2;
    display: block;
    opacity: 0;
    transition: opacity 0.3s;
  }
  .video-player.ready {
    opacity: 1;
  }

  .video-controls-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(
      to top,
      rgba(0, 0, 0, 0.8) 0%,
      rgba(0, 0, 0, 0.4) 60%,
      transparent 100%
    );
    padding: 10px 15px 15px 15px;
    transition:
      opacity 0.3s,
      transform 0.3s;
    z-index: 20;
    cursor: default;
  }
  .video-controls-bar.hidden {
    opacity: 0 !important;
    transform: translateY(10px);
    pointer-events: none;
  }

  .controls-main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }
  .controls-left,
  .controls-right {
    display: flex;
    align-items: center;
    gap: 12px;
    color: white;
  }

  .icon-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 0;
    display: flex;
    opacity: 0.8;
    transition:
      opacity 0.2s,
      color 0.2s;
  }
  .icon-btn:hover {
    opacity: 1;
  }
  .icon-btn.active {
    color: #3390ec;
    opacity: 1;
  }
  .icon-btn svg {
    width: 28px;
    height: 28px;
    fill: currentColor;
  }

  .time-text {
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
  }
  .volume-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .progress-row {
    width: 100%;
    display: flex;
  }

  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    background: rgba(255, 255, 255, 0.3);
    height: 4px;
    border-radius: 2px;
    cursor: pointer;
    outline: none;
    width: 100%;
    margin: 0;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 12px;
    width: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
  }
  input[type="range"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .seek-bar {
    height: 6px;
  }
  .volume-bar {
    width: 70px;
  }

  .tap-zones {
    position: absolute;
    inset: 0;
    display: flex;
    z-index: 10;
  }
  .tap-zone {
    flex: 1;
    height: 100%;
  }

  .skip-anim {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    width: 70px;
    height: 70px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    z-index: 15;
    pointer-events: none;
  }
  .skip-anim.left {
    left: 15%;
  }
  .skip-anim.right {
    right: 15%;
  }
  .skip-anim svg {
    width: 26px;
    fill: currentColor;
  }
  .skip-anim span {
    font-size: 11px;
    font-weight: 600;
  }

  .speed-badge {
    position: absolute;
    top: 15px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    z-index: 15;
    pointer-events: none;
  }

  @media (max-width: 768px) {
    .nav-btn {
      position: absolute;
      width: 44px;
      height: 44px;
      margin: 0;
      background: rgba(0, 0, 0, 0.35);
      top: 50%;
      transform: translateY(-50%);
    }
    .nav-btn:active {
      transform: translateY(-50%) scale(0.93);
    }
    .nav-btn.prev {
      left: 10px;
    }
    .nav-btn.next {
      right: 10px;
    }
    .nav-btn svg {
      width: 28px;
      height: 28px;
    }
  }
</style>
