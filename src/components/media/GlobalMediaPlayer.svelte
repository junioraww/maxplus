<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    activeMedia,
    registerGlobalElements,
    registerVideoCanvas,
    unregisterVideoCanvas,
    updateMediaPlaybackState,
    updateMediaProgress,
    playNextMedia,
    stopCurrentMedia,
    togglePlayPause,
  } from '$lib/stores/mediaPlayback';

  let audioEl;
  let videoEl;
  let pipCanvasEl;
  let animId = null;

  let isPipDragging = false;
  let hasDragged = false;
  let pipX = 0;
  let pipY = 0;
  let dragStartX = 0;
  let dragStartY = 0;

  onMount(() => {
    registerGlobalElements(audioEl, videoEl);
    startSmoothTicker();
  });

  $: if (audioEl || videoEl) {
    registerGlobalElements(audioEl, videoEl);
  }

  $: pipVisible = !!($activeMedia && $activeMedia.type === 'video_note' && $activeMedia.isGlobalPlayback);

  $: if (pipCanvasEl && $activeMedia?.id) {
    if (pipVisible) {
      registerVideoCanvas($activeMedia.id, pipCanvasEl);
    } else {
      unregisterVideoCanvas($activeMedia.id, pipCanvasEl);
    }
  }

  onDestroy(() => {
    if (animId) cancelAnimationFrame(animId);
    if (pipCanvasEl && $activeMedia?.id) {
      unregisterVideoCanvas($activeMedia.id, pipCanvasEl);
    }
  });

  function startSmoothTicker() {
    let lastTime = 0;
    const tick = () => {
      const state = $activeMedia;
      if (state && state.isPlaying) {
        let cur = 0;
        let dur = state.duration || 0;
        const el = state.type === 'voice' ? audioEl : (videoEl || state.element);
        if (el && el.currentTime !== undefined) {
          cur = el.currentTime;
          if (el.duration && isFinite(el.duration) && el.duration > 0) {
            dur = el.duration;
          }
        }
        if (Math.abs(cur - lastTime) >= 0.25) {
          lastTime = cur;
          updateMediaProgress(state.id, cur, dur);
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
  }

  function handleAudioTimeUpdate() {
    if (!$activeMedia || $activeMedia.type !== 'voice') return;
    if (audioEl) {
      updateMediaProgress($activeMedia.id, audioEl.currentTime, audioEl.duration || $activeMedia.duration);
    }
  }

  function handleVideoTimeUpdate() {
    if (!$activeMedia || $activeMedia.type !== 'video_note') return;
    if (videoEl) {
      updateMediaProgress($activeMedia.id, videoEl.currentTime, videoEl.duration || $activeMedia.duration);
    }
  }

  function handleEnded() {
    playNextMedia();
  }

  function handlePipPointerDown(e) {
    if (e.button !== 0) return;
    isPipDragging = true;
    hasDragged = false;
    dragStartX = e.clientX - pipX;
    dragStartY = e.clientY - pipY;
    window.addEventListener('pointermove', handlePipPointerMove);
    window.addEventListener('pointerup', handlePipPointerUp);
  }

  function handlePipPointerMove(e) {
    if (!isPipDragging) return;
    hasDragged = true;
    pipX = e.clientX - dragStartX;
    pipY = e.clientY - dragStartY;
  }

  function handlePipPointerUp() {
    isPipDragging = false;
    window.removeEventListener('pointermove', handlePipPointerMove);
    window.removeEventListener('pointerup', handlePipPointerUp);
  }

  function handlePipClick() {
    if (hasDragged) return;
    togglePlayPause();
  }
</script>

<audio
  bind:this={audioEl}
  preload="auto"
  on:play={() => $activeMedia && updateMediaPlaybackState($activeMedia.id, true)}
  on:timeupdate={handleAudioTimeUpdate}
  on:ended={handleEnded}
  style="display: none;"
></audio>

<video
  bind:this={videoEl}
  playsinline
  preload="auto"
  on:play={() => $activeMedia && updateMediaPlaybackState($activeMedia.id, true)}
  on:timeupdate={handleVideoTimeUpdate}
  on:ended={handleEnded}
  style="position: fixed; top: -9999px; left: -9999px; width: 1px; height: 1px; opacity: 0; pointer-events: none;"
></video>

<div
  class="global-video-pip"
  class:visible={pipVisible}
  style="transform: translate({pipX}px, {pipY}px);"
  on:pointerdown={handlePipPointerDown}
  on:click={handlePipClick}
>
  <div class="pip-video-circle">
    <canvas
      bind:this={pipCanvasEl}
      width={110}
      height={110}
    ></canvas>
  </div>
  <button
    class="pip-close-btn"
    on:click|stopPropagation={stopCurrentMedia}
    title="Закрыть"
  >
    ✕
  </button>
</div>

<style>
  .global-video-pip {
    position: fixed;
    bottom: 80px;
    right: 20px;
    width: 110px;
    height: 110px;
    z-index: 9999;
    cursor: grab;
    user-select: none;
    touch-action: none;
    display: none;
    overflow: visible;
  }
  .global-video-pip.visible {
    display: block;
  }
  .global-video-pip:active {
    cursor: grabbing;
  }
  .pip-video-circle {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
    border: 2px solid rgba(255, 255, 255, 0.8);
    background: #000;
  }
  .pip-video-circle canvas {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 50%;
  }
  .pip-close-btn {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgba(15, 23, 42, 0.92);
    color: #fff;
    border: 1.5px solid rgba(255, 255, 255, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
    padding: 0;
    z-index: 50;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    transition: background 0.15s, transform 0.1s;
  }
  .pip-close-btn:hover {
    background: rgba(239, 68, 68, 0.95);
    transform: scale(1.1);
  }
</style>
