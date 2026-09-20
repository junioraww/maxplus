<script>
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import API from '$lib/stores/api';
  import {
    activeMedia,
    globalSpeed,
    globalVolume,
    isMuted,
    snapSpeed,
    setPlaybackSpeed,
    cyclePlaybackSpeed,
    setMediaVolume,
    toggleMediaMute,
    registerVideo,
    updateMediaProgress,
    updateMediaPlaybackState,
    seekMedia,
    stopCurrentMedia,
  } from '$lib/stores/mediaPlayback';

  export let attach;
  export let messageId;
  export let chatId;
  export let isMe = false;

  let videoEl;
  let isHovered = false;
  let isDraggingSpeed = false;
  let speedDragStartX = 0;
  let speedDragStartVal = 1.0;
  let showVolumeSlider = false;
  let resolvedVideoUrl = attach.baseUrl || attach.url || (attach.localPath ? attach.localPath : null);

  $: mId = String(messageId || '');
  $: isCurrentTrack = $activeMedia?.id === mId;
  $: isPlaying = isCurrentTrack && $activeMedia?.isPlaying;
  $: duration = attach.duration ? attach.duration / 1000 : ($activeMedia?.duration || 0);
  $: currentTime = isCurrentTrack ? ($activeMedia?.currentTime || 0) : 0;
  $: progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const size = 200;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  $: strokeDashoffset = circumference - progress * circumference;

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function ensureVideoUrl() {
    if (resolvedVideoUrl) return resolvedVideoUrl;
    if (attach.videoId && chatId && messageId) {
      try {
        const response = await $API.getVideoById(chatId, messageId, attach.videoId);
        const qualityPriority = ['MP4_720', 'MP4_480', 'MP4_360', 'MP4_1080'];
        for (const q of qualityPriority) {
          if (response[q]) {
            resolvedVideoUrl = response[q];
            return resolvedVideoUrl;
          }
        }
        if (response.HLS) {
          resolvedVideoUrl = response.HLS;
          return resolvedVideoUrl;
        }
      } catch (err) {}
    }
    return resolvedVideoUrl;
  }

  async function handleTogglePlay() {
    if (!videoEl) return;
    if (!resolvedVideoUrl) {
      await ensureVideoUrl();
    }
    if (isCurrentTrack) {
      if (isPlaying) {
        videoEl.pause();
      } else {
        videoEl.play().catch(() => {});
      }
    } else {
      registerVideo(mId, videoEl, { isNote: true, duration });
      videoEl.play().catch(() => {});
    }
  }

  function handleRingClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const ratio = angle / (2 * Math.PI);
    const target = ratio * duration;
    if (!isCurrentTrack && videoEl) {
      registerVideo(mId, videoEl, { isNote: true, duration });
    }
    seekMedia(mId, target);
    if (videoEl) videoEl.currentTime = target;
  }

  function handleSpeedPointerDown(e) {
    isDraggingSpeed = true;
    speedDragStartX = e.clientX;
    speedDragStartVal = $globalSpeed;
    window.addEventListener('pointermove', handleSpeedPointerMove);
    window.addEventListener('pointerup', handleSpeedPointerUp);
  }

  function handleSpeedPointerMove(e) {
    if (!isDraggingSpeed) return;
    const deltaX = e.clientX - speedDragStartX;
    const change = deltaX / 120;
    const newSpeed = snapSpeed(speedDragStartVal + change);
    setPlaybackSpeed(newSpeed);
  }

  function handleSpeedPointerUp() {
    isDraggingSpeed = false;
    window.removeEventListener('pointermove', handleSpeedPointerMove);
    window.removeEventListener('pointerup', handleSpeedPointerUp);
  }

  async function handleDownload() {
    const url = resolvedVideoUrl || (await ensureVideoUrl());
    if (!url) {
      showAlert('Ссылка на видео недоступна');
      return;
    }
    try {
      const defaultName = `video_note_${mId}_${Date.now()}.mp4`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm'] }],
      });
      if (savePath) {
        await invoke('download_to_path', { url, path: savePath });
        showAlert('Видеосообщение сохранено');
      } else {
        await invoke('download', { url, name: defaultName });
        showAlert('Загрузка в папку загрузок начата');
      }
    } catch (err) {
      try {
        await invoke('download', { url, name: `video_note_${mId}.mp4` });
        showAlert('Загрузка в папку загрузок начата');
      } catch (e) {
        showAlert('Не удалось скачать видео');
      }
    }
  }

  onMount(() => {
    ensureVideoUrl();
  });

  onDestroy(() => {
    if (isCurrentTrack) {
      stopCurrentMedia();
    }
  });
</script>

<div
  class="video-note-bubble"
  class:is-me={isMe}
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
>
  <div class="circular-wrapper" style="width: {size}px; height: {size}px;">
    <svg
      class="progress-ring"
      width={size}
      height={size}
      on:click|stopPropagation={handleRingClick}
    >
      <circle
        class="progress-ring-bg"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke-width={strokeWidth}
      />
      <circle
        class="progress-ring-fg"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke-width={strokeWidth}
        stroke-dasharray={circumference}
        stroke-dashoffset={strokeDashoffset}
      />
    </svg>

    <div class="video-crop-container" on:click|stopPropagation={handleTogglePlay}>
      <video
        bind:this={videoEl}
        src={resolvedVideoUrl}
        poster={attach.thumbnail || attach.baseUrl}
        playsinline
        preload="metadata"
        on:timeupdate={() => updateMediaProgress(mId, videoEl.currentTime, videoEl.duration || duration)}
        on:play={() => updateMediaPlaybackState(mId, true)}
        on:pause={() => updateMediaPlaybackState(mId, false)}
        on:ended={() => {
          updateMediaPlaybackState(mId, false);
          if (videoEl) videoEl.currentTime = 0;
        }}
      ></video>

      {#if !isPlaying}
        <div class="play-overlay">
          <div class="play-icon-circle">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path fill="currentColor" d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="video-note-controls" class:visible={isHovered || isPlaying}>
    <span class="video-note-time">
      {isPlaying ? formatTime(currentTime) : formatTime(duration)}
    </span>

    <div class="video-note-actions">
      <div class="speed-control-wrapper">
        <button
          type="button"
          class="note-btn speed-btn"
          class:snapped={$globalSpeed === 1.0}
          on:click|stopPropagation={cyclePlaybackSpeed}
          on:pointerdown|stopPropagation={handleSpeedPointerDown}
          title="Скорость: {$globalSpeed}x"
        >
          {$globalSpeed}x
        </button>
        {#if isDraggingSpeed}
          <div class="speed-tooltip">
            {$globalSpeed}x
          </div>
        {/if}
      </div>

      <div
        class="volume-control-wrapper"
        on:mouseenter={() => (showVolumeSlider = true)}
        on:mouseleave={() => (showVolumeSlider = false)}
      >
        <button
          type="button"
          class="note-btn vol-btn"
          on:click|stopPropagation={toggleMediaMute}
          title={$isMuted ? 'Включить звук' : 'Выключить звук'}
        >
          {#if $isMuted || $globalVolume === 0}
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          {/if}
        </button>
        {#if showVolumeSlider}
          <div class="volume-slider-popup" on:click|stopPropagation>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={$isMuted ? 0 : $globalVolume}
              on:input={(e) => setMediaVolume(parseFloat(e.currentTarget.value))}
            />
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="note-btn download-btn"
        on:click|stopPropagation={handleDownload}
        title="Скачать видеосообщение"
      >
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .video-note-bubble {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    user-select: none;
    margin: 4px 0;
  }

  .circular-wrapper {
    position: relative;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
  }

  .progress-ring {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    transform: rotate(-90deg);
    pointer-events: auto;
  }

  .progress-ring-bg {
    fill: transparent;
    stroke: rgba(255, 255, 255, 0.2);
  }

  .progress-ring-fg {
    fill: transparent;
    stroke: #38bdf8;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.1s linear;
  }

  .video-crop-container {
    position: absolute;
    top: 4px;
    left: 4px;
    right: 4px;
    bottom: 4px;
    border-radius: 50%;
    overflow: hidden;
    background: #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-crop-container video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .play-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    transition: opacity 0.2s;
  }

  .play-icon-circle {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.55);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .video-note-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 200px;
    margin-top: 4px;
    padding: 2px 6px;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(4px);
    border-radius: 12px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.8);
    opacity: 0.85;
    transition: opacity 0.15s;
  }

  .video-note-controls.visible {
    opacity: 1;
  }

  .video-note-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .note-btn {
    background: rgba(255, 255, 255, 0.12);
    border: none;
    color: rgba(255, 255, 255, 0.85);
    border-radius: 10px;
    padding: 2px 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 10px;
    transition: background 0.15s;
  }

  .note-btn:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  .speed-btn {
    font-weight: 600;
  }

  .speed-btn.snapped {
    color: #38bdf8;
  }

  .speed-control-wrapper,
  .volume-control-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .speed-tooltip {
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    color: #38bdf8;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    white-space: nowrap;
    z-index: 100;
  }

  .volume-slider-popup {
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    padding: 5px 8px;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    z-index: 100;
  }

  .volume-slider-popup input[type='range'] {
    width: 60px;
    height: 4px;
    cursor: pointer;
    accent-color: #38bdf8;
  }
</style>
