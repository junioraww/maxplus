<script>
  import { onDestroy, onMount } from 'svelte';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import { getAssetUrl, getProxiedMediaUrl } from '$lib/utils/images';
  import API from '$lib/stores/api';
  import {
    activeMedia,
    trackSettings,
    snapSpeed,
    setTrackSpeed,
    cycleTrackSpeed,
    setTrackVolume,
    toggleTrackMute,
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
  let animFrameId = null;
  let smoothProgress = 0;
  let fetchedUrl = null;

  $: mId = String(messageId ?? attach.token ?? attach.videoId ?? attach.localPath ?? 'video_note');
  $: isCurrentTrack = $activeMedia?.id === mId;
  $: isPlaying = isCurrentTrack && $activeMedia?.isPlaying;
  $: currentSpeed = $trackSettings[mId]?.speed ?? 1.0;
  $: currentVolume = $trackSettings[mId]?.volume ?? 1.0;
  $: currentMuted = $trackSettings[mId]?.muted ?? false;
  $: attachDur = attach.duration
    ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration)
    : ($activeMedia?.duration || 0);
  $: duration = (videoEl && videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0 && (!attachDur || Math.abs(videoEl.duration - attachDur) < 2))
    ? videoEl.duration
    : (attachDur || (videoEl?.duration && isFinite(videoEl.duration) ? videoEl.duration : 0));
  $: currentTime = isCurrentTrack ? ($activeMedia?.currentTime || 0) : 0;
  $: rawUrl = fetchedUrl || attach.baseUrl || attach.url || (attach.localPath ? attach.localPath : null);

  let resolvedPosterUrl = null;
  $: {
    const posterSrc = attach.thumbnail || attach.baseUrl;
    if (posterSrc) {
      if (posterSrc.startsWith('data:') || posterSrc.startsWith('blob:') || posterSrc.startsWith('asset:') || posterSrc.startsWith('http://asset.localhost/')) {
        resolvedPosterUrl = posterSrc;
      } else if (posterSrc.startsWith('http')) {
        getAssetUrl(posterSrc).then((url) => {
          if (url) resolvedPosterUrl = url;
          else resolvedPosterUrl = getProxiedMediaUrl(posterSrc);
        }).catch(() => {
          resolvedPosterUrl = getProxiedMediaUrl(posterSrc);
        });
      } else {
        resolvedPosterUrl = convertFileSrc(posterSrc);
      }
    } else {
      resolvedPosterUrl = null;
    }
  }

  let resolvedVideoUrl = null;
  $: {
    if (!rawUrl) {
      resolvedVideoUrl = null;
    } else if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('asset:') || rawUrl.startsWith('http://asset.localhost/')) {
      resolvedVideoUrl = rawUrl;
    } else if (rawUrl.startsWith('http')) {
      resolvedVideoUrl = getProxiedMediaUrl(rawUrl);
      getAssetUrl(rawUrl).then((cached) => {
        if (cached) resolvedVideoUrl = cached;
      }).catch(() => {});
    } else {
      resolvedVideoUrl = convertFileSrc(rawUrl);
    }
  }

  const size = 200;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let lastAnchorTime = 0;
  let lastVideoTime = 0;

  function runSmoothProgress() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (!isPlaying || !videoEl) return;

    lastAnchorTime = performance.now();
    lastVideoTime = videoEl.currentTime || 0;

    const tick = (now) => {
      if (!videoEl || !isPlaying) return;
      const currentVidTime = videoEl.currentTime || 0;
      if (Math.abs(currentVidTime - lastVideoTime) > 0.005) {
        lastVideoTime = currentVidTime;
        lastAnchorTime = now;
      }
      const rate = videoEl.playbackRate || currentSpeed || 1.0;
      const elapsed = Math.max(0, (now - lastAnchorTime) / 1000) * rate;
      const realDur = (videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0)
        ? videoEl.duration
        : duration;
      if (realDur > 0) {
        const estimated = Math.min(realDur, Math.max(0, lastVideoTime + elapsed));
        smoothProgress = Math.min(1, Math.max(0, estimated / realDur));
      }
      animFrameId = requestAnimationFrame(tick);
    };
    animFrameId = requestAnimationFrame(tick);
  }

  $: if (isPlaying) {
    runSmoothProgress();
  } else {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    const realDur = (videoEl && videoEl.duration && isFinite(videoEl.duration) && videoEl.duration > 0)
      ? videoEl.duration
      : duration;
    smoothProgress = realDur > 0 ? Math.min(1, Math.max(0, (videoEl?.currentTime ?? currentTime) / realDur)) : 0;
  }

  $: strokeDashoffset = circumference - smoothProgress * circumference;

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
            fetchedUrl = response[q];
            return resolvedVideoUrl;
          }
        }
        if (response.HLS) {
          fetchedUrl = response.HLS;
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
    speedDragStartVal = currentSpeed;
    window.addEventListener('pointermove', handleSpeedPointerMove);
    window.addEventListener('pointerup', handleSpeedPointerUp);
  }

  function handleSpeedPointerMove(e) {
    if (!isDraggingSpeed) return;
    const deltaX = e.clientX - speedDragStartX;
    const change = deltaX / 120;
    const newSpeed = snapSpeed(speedDragStartVal + change);
    setTrackSpeed(mId, newSpeed);
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
    if (animFrameId) cancelAnimationFrame(animFrameId);
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
        poster={resolvedPosterUrl}
        playsinline
        preload="metadata"
        on:play={() => {
          lastAnchorTime = performance.now();
          lastVideoTime = videoEl?.currentTime || 0;
          updateMediaPlaybackState(mId, true);
        }}
        on:pause={() => updateMediaPlaybackState(mId, false)}
        on:seeked={() => {
          lastAnchorTime = performance.now();
          lastVideoTime = videoEl?.currentTime || 0;
          const realDur = (videoEl?.duration && isFinite(videoEl.duration) && videoEl.duration > 0) ? videoEl.duration : duration;
          if (realDur > 0) smoothProgress = Math.min(1, Math.max(0, lastVideoTime / realDur));
        }}
        on:ended={() => {
          updateMediaPlaybackState(mId, false);
          if (videoEl) videoEl.currentTime = 0;
          smoothProgress = 0;
        }}
      ></video>

      {#if attach.loading}
        <div class="video-loading-overlay">
          <div class="video-loading-spinner"></div>
        </div>
      {:else if !isPlaying}
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
          class:snapped={currentSpeed === 1.0}
          on:click|stopPropagation={() => cycleTrackSpeed(mId)}
          on:pointerdown|stopPropagation={handleSpeedPointerDown}
          title="Скорость: {currentSpeed}x"
        >
          {currentSpeed}x
        </button>
        {#if isDraggingSpeed}
          <div class="speed-tooltip">
            {currentSpeed}x
          </div>
        {/if}
      </div>

      <button
        type="button"
        class="note-btn vol-btn"
        class:muted={currentMuted || currentVolume === 0}
        on:click|stopPropagation={() => toggleTrackMute(mId)}
        on:wheel|preventDefault|stopPropagation={(e) => {
          const delta = e.deltaY < 0 ? 0.05 : -0.05;
          setTrackVolume(mId, currentVolume + delta);
        }}
        title={currentMuted || currentVolume === 0 ? 'Включить звук' : `Громкость: ${Math.round(currentVolume * 100)}%`}
      >
        {#if currentMuted || currentVolume === 0}
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        {:else if currentVolume <= 0.5}
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        {/if}
      </button>

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
    will-change: stroke-dashoffset;
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

  .video-loading-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-loading-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: note-spin 0.9s linear infinite;
  }

  @keyframes note-spin {
    to { transform: rotate(360deg); }
  }

  .video-note-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 200px;
    margin-top: 4px;
    padding: 2px 6px;
    border-radius: 12px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.8);
    opacity: 0;
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

  .speed-control-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .vol-btn.muted {
    opacity: 0.6;
  }
</style>
