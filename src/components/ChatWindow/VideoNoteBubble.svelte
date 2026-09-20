<script>
  import { onDestroy, onMount } from 'svelte';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import { getProxiedMediaUrl } from '$lib/utils/images';
  import API from '$lib/stores/api';
  import {
    activeMedia,
    trackSettings,
    updateMediaProgress,
    updateMediaPlaybackState,
    seekMedia,
    playMedia,
    pauseCurrentMedia,
    resumeCurrentMedia,
    playNextMedia,
    handOffToGlobal,
    takeOverFromGlobal,
  } from '$lib/stores/mediaPlayback';

  export let attach;
  export let messageId;
  export let chatId;
  export let isMe = false;

  let videoEl;
  let isHovered = false;
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
  $: currentTime = isCurrentTrack ? ($activeMedia?.currentTime ?? (videoEl?.currentTime || 0)) : 0;
  $: posterSrc = attach.thumbnail || attach.baseUrl || (attach.url && (attach.url.endsWith('.jpg') || attach.url.endsWith('.png') || attach.url.endsWith('.webp')) ? attach.url : null);
  $: rawUrl = fetchedUrl || (attach.localPath ? attach.localPath : null) || attach.videoUrl || attach.fileUrl || ((attach.url && attach.url !== attach.baseUrl && !attach.url.endsWith('.jpg') && !attach.url.endsWith('.jpeg') && !attach.url.endsWith('.png') && !attach.url.endsWith('.webp')) ? attach.url : null);

  let resolvedPosterUrl = null;
  $: resolvedPosterUrl = posterSrc ? getProxiedMediaUrl(posterSrc) : null;

  function toPlayableUrl(path) {
    if (!path) return null;
    return getProxiedMediaUrl(path);
  }

  let resolvedVideoUrl = null;
  $: resolvedVideoUrl = toPlayableUrl(rawUrl);

  const size = 200;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2 - 1;
  const circumference = 2 * Math.PI * radius;

  let lastAnchorTime = 0;
  let lastVideoTime = 0;

  function runSmoothProgress() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (!isPlaying) return;

    lastAnchorTime = performance.now();
    lastVideoTime = videoEl?.currentTime || 0;

    const tick = (now) => {
      if (!isPlaying) return;
      const currentVidTime = videoEl?.currentTime || 0;
      if (Math.abs(currentVidTime - lastVideoTime) > 0.005) {
        lastVideoTime = currentVidTime;
        lastAnchorTime = now;
      }
      const rate = videoEl?.playbackRate || currentSpeed || 1.0;
      const elapsed = Math.max(0, (now - lastAnchorTime) / 1000) * rate;
      const realDur = (videoEl?.duration && isFinite(videoEl.duration) && videoEl.duration > 0)
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
    if (fetchedUrl) return toPlayableUrl(fetchedUrl);
    if (attach.localPath) return toPlayableUrl(attach.localPath);
    const vId = attach.videoId ?? attach.id ?? attach.video_id ?? 0;
    const token = attach.videoToken ?? attach.token ?? null;
    if ((vId || token) && chatId != null && messageId != null) {
      try {
        const response = await $API.getVideoById(chatId, messageId, vId || 0, token);
        const qualityPriority = ['MP4_720', 'MP4_480', 'MP4_360', 'MP4_240', 'MP4_144', 'MP4_1080', 'EXTERNAL', 'url', 'baseUrl', 'fileUrl'];
        let picked = null;
        for (const q of qualityPriority) {
          if (response && response[q]) { picked = response[q]; break; }
        }
        if (!picked && response && response.HLS) picked = response.HLS;
        if (!picked && response && typeof response === 'object') {
          picked = Object.values(response).find(v => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://')) && !v.endsWith('.jpg') && !v.endsWith('.png') && !v.endsWith('.webp'));
        }
        if (picked) {
          let localTarget = picked;
          if (picked.startsWith('http://') || picked.startsWith('https://')) {
            try {
              const cached = await invoke('cache_url', { src: picked });
              if (cached) localTarget = cached;
            } catch (e) {}
          }
          fetchedUrl = localTarget;
          return toPlayableUrl(localTarget);
        }
      } catch (err) {}
    }
    return resolvedVideoUrl || toPlayableUrl(rawUrl);
  }

  async function handleTogglePlay() {
    if (isCurrentTrack) {
      if (isPlaying) {
        pauseCurrentMedia();
        if (videoEl) videoEl.pause();
      } else {
        resumeCurrentMedia();
        if (videoEl) videoEl.play().catch(() => {});
      }
      return;
    }

    const url = (await ensureVideoUrl()) || resolvedVideoUrl || (rawUrl ? toPlayableUrl(rawUrl) : null);
    if (!url) return;

    if (videoEl && (!videoEl.src || !videoEl.src.includes(url))) {
      videoEl.src = url;
    }

    await playMedia({
      id: mId,
      chatId,
      messageId,
      type: 'video_note',
      url,
      poster: resolvedPosterUrl,
      duration,
      senderName: isMe ? 'Вы' : (attach.senderName || 'Собеседник'),
      title: 'Видеосообщение',
      attach,
      element: videoEl,
    }, { chatId, currentMessageId: messageId });
  }

  $: if (isCurrentTrack && videoEl && ($activeMedia?.isGlobalPlayback || $activeMedia?.element !== videoEl)) {
    takeOverFromGlobal(mId, videoEl);
  }

  async function handleDownload() {
    const url = (await ensureVideoUrl()) || resolvedVideoUrl || rawUrl;
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
    if (isCurrentTrack && videoEl) {
      takeOverFromGlobal(mId, videoEl);
    }
  });

  onDestroy(() => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (isCurrentTrack && isPlaying) {
      handOffToGlobal({
        id: mId,
        type: 'video_note',
        url: resolvedVideoUrl || rawUrl,
        poster: resolvedPosterUrl,
        currentTime: videoEl?.currentTime || currentTime,
        duration,
        speed: currentSpeed,
        volume: currentVolume,
        muted: currentMuted,
        isPlaying: true,
      });
    }
  });
</script>

<div
  class="video-note-bubble"
  class:is-me={isMe}
  on:mouseenter={() => (isHovered = true)}
  on:mouseleave={() => (isHovered = false)}
>
  <div
    class="circular-wrapper"
    style="width: {size}px; height: {size}px;"
    on:click|stopPropagation={handleTogglePlay}
  >
    <svg
      class="progress-ring"
      width={size}
      height={size}
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

    <div class="video-crop-container">
      <video
        bind:this={videoEl}
        src={resolvedVideoUrl}
        poster={resolvedPosterUrl}
        playsinline
        preload="metadata"
        on:timeupdate={() => updateMediaProgress(mId, videoEl?.currentTime || 0, videoEl?.duration || duration)}
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
          playNextMedia();
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
    pointer-events: none;
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

  .volume-control-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .vol-tooltip {
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.9);
    color: #38bdf8;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    white-space: nowrap;
    z-index: 100;
  }

  .vol-btn.muted {
    opacity: 0.6;
  }
</style>
