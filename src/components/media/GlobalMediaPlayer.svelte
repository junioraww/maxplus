<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    activeMedia,
    registerGlobalElements,
    updateMediaPlaybackState,
    updateMediaProgress,
    playNextMedia,
    stopCurrentMedia,
    togglePlayPause,
    seekMedia,
  } from '$lib/stores/mediaPlayback';
  import { openChat } from '$lib/stores/session';

  let audioEl;
  let videoEl;
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

  onDestroy(() => {
    if (animId) cancelAnimationFrame(animId);
  });

  function startSmoothTicker() {
    let lastTime = 0;
    const tick = () => {
      const state = $activeMedia;
      if (state && state.isPlaying) {
        let cur = 0;
        let dur = state.duration || 0;
        const el = state.element || (state.type === 'voice' ? audioEl : videoEl);
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

  function handlePipClick(e) {
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

<div
  class="global-video-pip"
  class:visible={$activeMedia && $activeMedia.type === 'video_note' && $activeMedia.isGlobalPlayback}
  style="transform: translate({pipX}px, {pipY}px);"
  on:pointerdown={handlePipPointerDown}
  on:click={handlePipClick}
>
  <div class="pip-video-circle">
    <video
      bind:this={videoEl}
      playsinline
      preload="auto"
      on:play={() => $activeMedia && updateMediaPlaybackState($activeMedia.id, true)}
      on:timeupdate={handleVideoTimeUpdate}
      on:ended={handleEnded}
    ></video>
    <button
      class="pip-close-btn"
      on:click|stopPropagation={stopCurrentMedia}
      title="Закрыть"
    >
      ✕
    </button>
  </div>
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
  .pip-video-circle video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .pip-close-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    line-height: 1;
    padding: 0;
    transition: background 0.15s;
  }
  .pip-close-btn:hover {
    background: rgba(230, 50, 50, 0.9);
  }
</style>
