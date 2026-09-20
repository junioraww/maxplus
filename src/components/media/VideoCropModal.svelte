<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  export let isOpen = false;
  export let sourcePath = '';
  export let previewUrl = '';
  export let onConfirm = null;
  export let onCancel = null;

  let videoEl;
  let viewportEl;
  let isPlaying = false;
  let isProcessing = false;
  let errorMessage = '';

  let videoDuration = 0;
  let currentTime = 0;
  let videoWidth = 0;
  let videoHeight = 0;

  let trimStart = 0;
  let trimEnd = 0;

  let normCx = 0.5;
  let normCy = 0.5;
  let zoomRatio = 1.0;

  let isDragging = false;
  let dragStartPointerX = 0;
  let dragStartPointerY = 0;
  let dragStartNormCx = 0.5;
  let dragStartNormCy = 0.5;

  let initialPinchDist = 0;
  let initialPinchZoom = 1.0;

  let renderedRect = { x: 0, y: 0, w: 0, h: 0 };
  let circlePx = { cx: 0, cy: 0, r: 0 };

  function updateRenderedLayout() {
    if (!viewportEl || !videoWidth || !videoHeight) return;
    const vpRect = viewportEl.getBoundingClientRect();
    if (vpRect.width === 0 || vpRect.height === 0) return;

    const videoAspect = videoWidth / videoHeight;
    const vpAspect = vpRect.width / vpRect.height;

    let rw = 0;
    let rh = 0;
    let rx = 0;
    let ry = 0;

    if (videoAspect > vpAspect) {
      rw = vpRect.width;
      rh = vpRect.width / videoAspect;
      rx = 0;
      ry = (vpRect.height - rh) / 2;
    } else {
      rh = vpRect.height;
      rw = vpRect.height * videoAspect;
      rx = (vpRect.width - rw) / 2;
      ry = 0;
    }

    renderedRect = { x: rx, y: ry, w: rw, h: rh };

    const maxDiameter = Math.min(rw, rh);
    const minDiameter = Math.max(48, maxDiameter * 0.25);
    const currentDiameter = minDiameter + (maxDiameter - minDiameter) * zoomRatio;
    const r = currentDiameter / 2;

    const minCx = rx + r;
    const maxCx = rx + rw - r;
    const minCy = ry + r;
    const maxCy = ry + rh - r;

    let cx = rx + normCx * rw;
    let cy = ry + normCy * rh;

    cx = Math.max(minCx, Math.min(maxCx, cx));
    cy = Math.max(minCy, Math.min(maxCy, cy));

    if (rw > 0) normCx = (cx - rx) / rw;
    if (rh > 0) normCy = (cy - ry) / rh;

    circlePx = { cx, cy, r };
  }

  function handleVideoLoadedMetadata() {
    if (!videoEl) return;
    videoWidth = videoEl.videoWidth || 640;
    videoHeight = videoEl.videoHeight || 480;
    videoDuration = videoEl.duration || 0;
    trimStart = 0;
    trimEnd = Math.min(videoDuration, 60);
    currentTime = 0;
    normCx = 0.5;
    normCy = 0.5;
    zoomRatio = 1.0;
    updateRenderedLayout();
  }

  function handleTimeUpdate() {
    if (!videoEl) return;
    currentTime = videoEl.currentTime;
    if (currentTime >= trimEnd) {
      videoEl.currentTime = trimStart;
      if (!isPlaying) {
        videoEl.pause();
      }
    }
  }

  function togglePlay() {
    if (!videoEl) return;
    if (videoEl.paused) {
      if (videoEl.currentTime < trimStart || videoEl.currentTime >= trimEnd) {
        videoEl.currentTime = trimStart;
      }
      videoEl.play().then(() => {
        isPlaying = true;
      }).catch(() => {});
    } else {
      videoEl.pause();
      isPlaying = false;
    }
  }

  function handleTrimStartInput(e) {
    let val = parseFloat(e.target.value) || 0;
    if (val >= trimEnd - 0.5) val = Math.max(0, trimEnd - 0.5);
    trimStart = val;
    if (trimEnd - trimStart > 60) {
      trimEnd = trimStart + 60;
    }
    if (videoEl) {
      videoEl.currentTime = trimStart;
    }
  }

  function handleTrimEndInput(e) {
    let val = parseFloat(e.target.value) || 0;
    if (val <= trimStart + 0.5) val = Math.min(videoDuration, trimStart + 0.5);
    trimEnd = val;
    if (trimEnd - trimStart > 60) {
      trimStart = Math.max(0, trimEnd - 60);
    }
    if (videoEl) {
      videoEl.currentTime = trimEnd;
    }
  }

  function handleZoomInput(e) {
    zoomRatio = parseFloat(e.target.value) || 1.0;
    updateRenderedLayout();
  }

  function handleWheel(e) {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    zoomRatio = Math.max(0, Math.min(1.0, zoomRatio + delta));
    updateRenderedLayout();
  }

  function handlePointerDown(e) {
    if (e.target.closest('.controls-bar') || e.target.closest('.header-bar')) return;
    if (e.pointerType === 'touch' && !e.isPrimary) return;
    isDragging = true;
    dragStartPointerX = e.clientX;
    dragStartPointerY = e.clientY;
    dragStartNormCx = normCx;
    dragStartNormCy = normCy;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }

  function handlePointerMove(e) {
    if (!isDragging || renderedRect.w <= 0 || renderedRect.h <= 0) return;
    const dx = e.clientX - dragStartPointerX;
    const dy = e.clientY - dragStartPointerY;

    normCx = dragStartNormCx + dx / renderedRect.w;
    normCy = dragStartNormCy + dy / renderedRect.h;

    updateRenderedLayout();
  }

  function handlePointerUp() {
    isDragging = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  }

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      initialPinchZoom = zoomRatio;
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && initialPinchDist > 0) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const ratio = dist / initialPinchDist;
      zoomRatio = Math.max(0, Math.min(1.0, initialPinchZoom * ratio));
      updateRenderedLayout();
    }
  }

  function handleTouchEnd(e) {
    if (e.touches.length < 2) {
      initialPinchDist = 0;
    }
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.floor(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function handleConfirm() {
    if (isProcessing) return;
    isProcessing = true;
    errorMessage = '';

    if (videoEl && !videoEl.paused) {
      videoEl.pause();
      isPlaying = false;
    }

    try {
      const rx = renderedRect.x;
      const ry = renderedRect.y;
      const rw = renderedRect.w;
      const rh = renderedRect.h;
      const cx = circlePx.cx;
      const cy = circlePx.cy;
      const r = circlePx.r;

      const vw = videoWidth || videoEl?.videoWidth || 640;
      const vh = videoHeight || videoEl?.videoHeight || 480;
      const minDimension = Math.min(vw, vh);

      let cropSize = minDimension;
      let cropX = 0;
      let cropY = 0;

      if (rw > 0) {
        const scale = vw / rw;
        const d = r * 2;
        cropSize = Math.round(d * scale);
        cropX = Math.round((cx - rx - r) * scale);
        cropY = Math.round((cy - ry - r) * scale);
      }

      cropSize = Math.max(48, Math.min(cropSize, minDimension));
      cropX = Math.max(0, Math.min(vw - cropSize, cropX));
      cropY = Math.max(0, Math.min(vh - cropSize, cropY));

      const durationSec = Math.max(0.5, trimEnd - trimStart);

      let croppedPath = null;
      try {
        croppedPath = await invoke('crop_video_note', {
          sourcePath,
          cropX,
          cropY,
          cropSize,
          startSec: trimStart,
          endSec: trimEnd,
        });
      } catch (invErr) {
        croppedPath = null;
      }

      if (!croppedPath) {
        throw new Error("Не удалось обработать видеосообщение");
      }

      if (onConfirm) {
        await onConfirm({
          croppedPath,
          sourcePath,
          cropX,
          cropY,
          cropSize,
          startSec: trimStart,
          endSec: trimEnd,
          durationSec,
        });
      }
    } catch (err) {
      errorMessage = err?.message || String(err);
      isProcessing = false;
    }
  }

  function handleClose() {
    if (isProcessing) return;
    if (videoEl) {
      videoEl.pause();
    }
    if (onCancel) {
      onCancel();
    }
  }

  let resizeObserver;

  onMount(() => {
    if (typeof ResizeObserver !== 'undefined' && viewportEl) {
      resizeObserver = new ResizeObserver(() => {
        updateRenderedLayout();
      });
      resizeObserver.observe(viewportEl);
    }
    window.addEventListener('resize', updateRenderedLayout);
  });

  onDestroy(() => {
    if (resizeObserver) resizeObserver.disconnect();
    window.removeEventListener('resize', updateRenderedLayout);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  });
</script>

{#if isOpen}
  <div class="crop-modal-overlay" on:click|self={handleClose}>
    <div class="crop-modal-container">
      <div class="header-bar">
        <span class="header-title">Видеосообщение</span>
        <button type="button" class="close-btn" on:click={handleClose} disabled={isProcessing}>✕</button>
      </div>

      <div
        class="crop-viewport"
        bind:this={viewportEl}
        on:pointerdown={handlePointerDown}
        on:wheel={handleWheel}
        on:touchstart={handleTouchStart}
        on:touchmove={handleTouchMove}
        on:touchend={handleTouchEnd}
      >
        <video
          bind:this={videoEl}
          src={previewUrl}
          preload="auto"
          playsinline
          muted
          loop={false}
          on:loadedmetadata={handleVideoLoadedMetadata}
          on:loadeddata={handleVideoLoadedMetadata}
          on:canplay={handleVideoLoadedMetadata}
          on:timeupdate={handleTimeUpdate}
          on:play={() => isPlaying = true}
          on:pause={() => isPlaying = false}
          on:error={() => { errorMessage = "Не удалось открыть видеофайл для предпросмотра"; }}
        ></video>

        {#if renderedRect.w > 0}
          <svg class="crop-mask-svg" viewBox="0 0 {viewportEl?.clientWidth || 300} {viewportEl?.clientHeight || 300}">
            <defs>
              <mask id="circle-cutout-mask">
                <rect width="100%" height="100%" fill="white" />
                <circle cx={circlePx.cx} cy={circlePx.cy} r={circlePx.r} fill="black" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.7)" mask="url(#circle-cutout-mask)" />
            <circle
              cx={circlePx.cx}
              cy={circlePx.cy}
              r={circlePx.r}
              fill="none"
              stroke="#ffffff"
              stroke-width="2"
              class="crop-circle-ring"
            />
          </svg>
        {/if}

        <button type="button" class="center-play-btn" on:click={togglePlay}>
          {#if isPlaying}
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <polygon points="6,4 20,12 6,20"/>
            </svg>
          {/if}
        </button>
      </div>

      <div class="controls-bar">
        <div class="time-row">
          <span class="time-label">{formatTime(currentTime)} / {formatTime(videoDuration)}</span>
          <span class="trim-badge">{(trimEnd - trimStart).toFixed(1)} сек</span>
        </div>

        <div class="trim-container">
          <div class="trim-slider-track">
            <input
              type="range"
              min="0"
              max={videoDuration || 1}
              step="0.1"
              value={trimStart}
              on:input={handleTrimStartInput}
              class="range-slider range-slider-start"
            />
            <input
              type="range"
              min="0"
              max={videoDuration || 1}
              step="0.1"
              value={trimEnd}
              on:input={handleTrimEndInput}
              class="range-slider range-slider-end"
            />
          </div>
        </div>

        <div class="zoom-row">
          <span class="zoom-icon">🔍 −</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={zoomRatio}
            on:input={handleZoomInput}
            class="zoom-slider"
          />
          <span class="zoom-icon">+</span>
        </div>

        {#if errorMessage}
          <div class="error-text">{errorMessage}</div>
        {/if}

        <div class="action-buttons-row">
          <button type="button" class="action-btn cancel-btn" on:click={handleClose} disabled={isProcessing}>
            Отмена
          </button>
          <button type="button" class="action-btn confirm-btn" on:click={handleConfirm} disabled={isProcessing}>
            {#if isProcessing}
              <div class="spinner"></div>
              <span>Обработка...</span>
            {:else}
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              <span>Отправить</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .crop-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.88);
    backdrop-filter: blur(16px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    user-select: none;
    touch-action: none;
  }

  .crop-modal-container {
    width: 100%;
    max-width: 520px;
    background: #181b22;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  .header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header-title {
    font-size: 16px;
    font-weight: 600;
    color: #f0f2f5;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    font-size: 18px;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 8px;
    transition: background 0.15s, color 0.15s;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .crop-viewport {
    position: relative;
    width: 100%;
    height: 380px;
    background: #0d0f13;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
  }

  .crop-viewport:active {
    cursor: grabbing;
  }

  .crop-viewport video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .crop-mask-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .crop-circle-ring {
    filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.8));
  }

  .center-play-btn {
    position: absolute;
    bottom: 16px;
    right: 16px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, background 0.15s;
  }

  .center-play-btn:hover {
    background: rgba(0, 0, 0, 0.8);
    transform: scale(1.05);
  }

  .controls-bar {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: #181b22;
  }

  .time-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
  }

  .trim-badge {
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 500;
    color: #4da3ff;
  }

  .trim-container {
    position: relative;
    width: 100%;
    height: 32px;
    display: flex;
    align-items: center;
  }

  .trim-slider-track {
    position: relative;
    width: 100%;
    height: 8px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
  }

  .range-slider {
    position: absolute;
    width: 100%;
    top: -5px;
    left: 0;
    pointer-events: none;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    margin: 0;
  }

  .range-slider::-webkit-slider-thumb {
    pointer-events: auto;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #4da3ff;
    border: 2px solid #fff;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  }

  .range-slider::-moz-range-thumb {
    pointer-events: auto;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #4da3ff;
    border: 2px solid #fff;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  }

  .zoom-row {
    display: flex;
    align-items: center;
    gap: 12px;
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
  }

  .zoom-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    outline: none;
  }

  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #4da3ff;
    cursor: pointer;
  }

  .zoom-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #4da3ff;
    cursor: pointer;
  }

  .error-text {
    color: #ff5c5c;
    font-size: 13px;
    text-align: center;
  }

  .action-buttons-row {
    display: flex;
    gap: 12px;
    margin-top: 6px;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 18px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: background 0.15s, transform 0.1s;
  }

  .action-btn:active {
    transform: scale(0.98);
  }

  .cancel-btn {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.85);
  }

  .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .confirm-btn {
    background: #0077ff;
    color: #ffffff;
  }

  .confirm-btn:hover {
    background: #006ae6;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 600px) {
    .crop-modal-overlay {
      padding: 0;
      align-items: flex-end;
    }

    .crop-modal-container {
      max-width: 100%;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      height: 92vh;
    }

    .crop-viewport {
      flex: 1;
      height: auto;
    }
  }
</style>
