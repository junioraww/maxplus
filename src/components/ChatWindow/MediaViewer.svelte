<script>
  import { fade, fly, scale as scaleTransition } from "svelte/transition";
  import { invoke as tauriInvoke, convertFileSrc } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { createEventDispatcher } from "svelte";

  import { getAssetUrl, getProxiedMediaUrl, isProxiedMediaUrl, unwrapProxiedMediaUrl } from "$lib/utils/images";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import API from "$lib/stores/api";

  export let index = 0;
  export let allMedia;
  export let chatId;

  const dispatch = createEventDispatcher();

  let videoElement;
  let movable;
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

  let showSkipIcon = null;
  let videoCache = {};
  let isLoading = false;

  let scale = 1;
  let x = 0;
  let y = 0;

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  let encryptedVideoSrc = null;
  $: currentMedia = allMedia[index];
  $: effectiveVideoSrc = (currentMedia?.videoId ? videoCache[currentMedia.videoId] : null) || (currentMedia?._type === "VIDEO" ? (getProxiedMediaUrl(currentMedia.localPath || currentMedia.baseUrl) || encryptedVideoSrc) : null);

  $: console.log("[MediaViewer] currentMedia:", {
    idx: index,
    type: currentMedia?._type,
    isEncrypted: currentMedia?.isEncryptedMedia,
    localPath: currentMedia?.localPath,
    baseUrl: currentMedia?.baseUrl,
    effectiveVideoSrc,
  });

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
        console.log("[MediaViewer] Found encrypted media in cache:", fid, "path:", cached, "url:", url);
        return url;
      }

      console.log("[MediaViewer] Downloading encrypted media:", fid);
      const fileRes = await $API.getFileById(chatId, media.messageId, fid);
      if (fileRes?.url) {
        const cachedPath = await tauriInvoke("cache_encrypted_media", {
          account: accountId,
          chatId: Number(chatId || 0),
          fileId: Number(fid),
          src: fileRes.url,
          password: null,
        });
        if (cachedPath) {
          media.localPath = cachedPath;
          const url = getProxiedMediaUrl(cachedPath);
          media.baseUrl = url;
          console.log("[MediaViewer] Decrypted and cached media:", fid, "url:", url);
          return url;
        }
      }
    } catch (e) {
      console.error("[MediaViewer] Failed to ensureEncryptedMediaUrl:", e);
    }
    return null;
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
      if (posterSrc.startsWith('data:') || posterSrc.startsWith('blob:') || isProxiedMediaUrl(posterSrc)) {
        resolvedPoster = posterSrc;
      } else if (posterSrc.startsWith('http')) {
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
  }

  async function loadVideo(videoId) {
    if (!videoId) return;
    if (videoCache[videoId] || isLoading) return;
    isLoading = true;
    try {
      const response = await $API.getVideoById(
        chatId,
        currentMedia.messageId,
        videoId,
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

  async function togglePlay() {
    if (!videoElement) return;
    try {
      console.log("[MediaViewer] togglePlay:", { paused: videoElement.paused, readyState: videoElement.readyState, src: videoElement.src });
      if (videoElement.paused) {
        await videoElement.play();
      } else {
        videoElement.pause();
      }
    } catch (e) {
      console.warn("[MediaViewer] Play interrupted:", e, "src:", videoElement?.src, "readyState:", videoElement?.readyState);
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
    console.log("[MediaViewer] handleSync:", { duration, isMetadataLoaded, src: el?.src });
  }

  function handleCanPlay(e) {
    isVideoReady = true;
    if (videoElement && (!duration || isNaN(duration))) {
      duration = videoElement.duration;
    }
    console.log("[MediaViewer] handleCanPlay:", { duration, isVideoReady, src: e.target?.src });
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

  function handleSeek(e) {
    const newTime = parseFloat(e.target.value);
    if (!isNaN(newTime) && videoElement) {
      videoElement.currentTime = newTime;
      currentTime = newTime;
    }
  }

  /*
   * UPD: Drag & Drop
   */

  let pressTimer;
  function handlePressStart(e) {
    if (e.target.closest(".video-controls-bar")) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!paused) playbackRate = 2;
    }, 500);
  }

  function handlePressEnd() {
    clearTimeout(pressTimer);
    playbackRate = 1;
  }

  function handleWheel(e) {
    e.preventDefault();

    const delta = -e.deltaY * 0.001;
    scale += delta;

    if (scale < SAFE_MIN_SCALE) scale = SAFE_MIN_SCALE;
    if (scale > MAX_SCALE) scale = MAX_SCALE;
  }

  $: transformStyle = `
    translate(calc(-50% + ${x}px), calc(-50% + ${y}px))
    scale(${scale})
  `;

  let lastDistance = null;

  function getDistance(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2) {
      const dist = getDistance(e.touches);

      if (lastDistance) {
        const delta = dist - lastDistance;
        scale += delta * 0.005;
      }

      lastDistance = dist;

      scale = Math.max(SAFE_MIN_SCALE, Math.min(scale, MAX_SCALE));
    }
  }

  function handleTouchEnd() {
    lastDistance = null;
  }

  let isDragging = false;
  let startX, startY;

  function handlePointerDown(e) {
    isDragging = true;
    startX = e.clientX - x;
    startY = e.clientY - y;
  }

  function handlePointerMove(e) {
    if (!isDragging) return;

    x = e.clientX - startX;
    y = e.clientY - startY;
  }

  function handlePointerUp() {
    isDragging = false;

    checkDismiss();
  }

  function animateBack() {
    const startX = x;
    const startY = y;
    const startScale = scale;

    const contentWidth = movable.offsetWidth * startScale;
    const contentHeight = movable.offsetHeight * startScale;

    const maxX = Math.max((contentWidth - window.innerWidth) / 2, 0);
    const maxY = Math.max((contentHeight - window.innerHeight) / 2, 0);

    const targetX = Math.max(-maxX, Math.min(x, maxX));
    const targetY = Math.max(-maxY, Math.min(y, maxY));

    const duration = 200;
    const start = performance.now();

    function frame(t) {
      const p = Math.min((t - start) / duration, 1);

      x = startX + (targetX - startX) * p;
      y = startY + (targetY - startY) * p;

      if (p < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  function checkDismiss() {
    const absX = Math.abs(x);
    const absY = Math.abs(y);

    const halfWidth = window.innerWidth / 2;
    const halfHeight = window.innerHeight / 2;

    const dismissX = halfWidth * 0.5;
    const dismissY = halfHeight * 0.5;

    if (scale === 1) {
      if (absX > dismissX || absY > dismissY) {
        dispatch("close");
      } else {
        animateBack();
      }
      return;
    }

    const distance = Math.hypot(x, y);
    const threshold = window.innerWidth * 0.2;

    if (distance > threshold * scale) {
      animateBack();
    }
  }

  function clampPan() {
    const contentWidth = content.offsetWidth * scale;
    const contentHeight = content.offsetHeight * scale;

    const maxX = Math.max((contentWidth - window.innerWidth) / 2, 0);
    const maxY = Math.max((contentHeight - window.innerHeight) / 2, 0);

    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
  }

  async function load(url) {
    let effective = url;
    if (!effective && currentMedia?.isEncryptedMedia) {
      effective = await ensureEncryptedMediaUrl(currentMedia);
    }
    if (!effective) return null;
    return await getAssetUrl(effective);
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
            await tauriInvoke("download_to_path", { url: target, path: filePath });
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
          await tauriInvoke("download_to_path", { url, path: filePath });
        }
      } else if (currentMedia._type === "VIDEO") {
        let videoUrl = videoCache[currentMedia.videoId] || currentMedia.baseUrl;
        if (!videoUrl && currentMedia.videoId) {
          const response = await $API.getVideoById(
            chatId,
            currentMedia.messageId,
            currentMedia.videoId,
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
          await tauriInvoke("download_to_path", { url: videoUrl, path: filePath });
        }
      }
    } catch (e) {
      console.error("Media download error:", e);
    } finally {
      isDownloadingMedia = false;
    }
  }
</script>

<div
  class="media-viewer-overlay"
  transition:fade={{ duration: 100 }}
  on:click|self={() => dispatch("close")}
>
  <div class="viewer-header">
    <div class="counter">{index + 1} из {allMedia.length}</div>
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
      <button class="viewer-icon-btn close" on:click={() => dispatch("close")}>
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
      class:hidden={index === 0}
      on:click|stopPropagation={() => index--}
    >
      <svg viewBox="0 0 24 24"
        ><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg
      >
    </button>

    <div
      on:wheel|passive={handleWheel}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointerleave={handlePointerUp}
      on:touchmove={handleTouchMove}
      on:touchend={handleTouchEnd}
      bind:this={movable}
      class="media-container"
    >
      {#key index}
        {#if currentMedia._type === "PHOTO"}
          {#await load(currentMedia.baseUrl)}
            <div class="media-shimmer" style="width: min(80vw, 600px); height: min(70vh, 500px); border-radius: 12px;"></div>
          {:then url}
            {#if url}
              <img
                style="transform: {transformStyle}"
                src={url}
                alt=""
                in:fly={{ y: 20, duration: 200 }}
              />
            {:else}
              <div class="media-shimmer" style="width: min(80vw, 600px); height: min(70vh, 500px); border-radius: 12px;"></div>
            {/if}
          {/await}
        {:else if currentMedia._type === "VIDEO"}
          {#if effectiveVideoSrc}
            <div
              class="tg-video-wrapper"
              on:mousedown={handlePressStart}
              on:touchstart={handlePressStart}
              on:mouseup={handlePressEnd}
              on:touchend={handlePressEnd}
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
                on:error={(e) => console.error("[MediaViewer] Video element error:", e.target?.error, "src:", effectiveVideoSrc)}
                playsinline
                style="transform: {transformStyle}"
              ></video>

              <div class="tap-zones">
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
                class:hidden={!showControls}
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
                    value={currentTime}
                    on:input={handleSeek}
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
                      on:click={() => (loop = !loop)}
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
                src={currentMedia.thumbnail}
                alt=""
                class="video-preview"
              />
              <div class="play-overlay">
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
    </div>

    <button
      class="nav-btn next"
      class:hidden={index === allMedia.length - 1}
      on:click|stopPropagation={() => index++}
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
    background: rgba(0, 0, 0, 0.96);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    user-select: none;
  }

  .viewer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    color: white;
    z-index: 10;
  }

  .counter {
    font-size: 15px;
    font-weight: 500;
    opacity: 0.8;
  }

  .viewer-content {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px 40px 10px;
    position: relative;
  }

  .media-container {
    flex: 1;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-top: env(safe-area-inset-top, 10px);
    padding-bottom: env(safe-area-inset-bottom, 20px);
  }

  .media-container :global(img),
  .media-container :global(.video-player),
  .media-container :global(.video-preview) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(1);
    object-fit: contain;
    max-width: 95vw;
    max-height: 80vh;
  }

  .nav-btn {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    flex-shrink: 0;
    margin: 0 15px;
    z-index: 100;
  }
  .nav-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  .nav-btn svg {
    width: 36px;
    height: 36px;
    fill: currentColor;
  }
  .nav-btn.hidden {
    opacity: 0;
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
    padding: 5px;
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
    width: 100%;
    height: 100%;
    z-index: 2;
    display: block;
    opacity: 0;
    transition: opacity 0.5s;
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
    opacity: 0;
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
      background: rgba(0, 0, 0, 0.3);
      top: 50%;
      transform: translateY(-50%);
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
