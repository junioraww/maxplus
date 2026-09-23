<script>
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import { getProxiedMediaUrl } from '$lib/utils/images';
  import API from '$lib/stores/api';
  import { getCurrentAccount } from '$lib/stores/accounts';
  import {
    activeMedia,
    trackSettings,
    seekMedia,
    playMedia,
    pauseCurrentMedia,
    resumeCurrentMedia,
    registerVideoCanvas,
    unregisterVideoCanvas,
    getMasterMediaCurrentTime,
    handOffToGlobal,
    takeOverFromGlobal,
  } from '$lib/stores/mediaPlayback';

  export let attach;
  export let messageId;
  export let chatId;
  export let isMe = false;

  let containerEl;
  let canvasEl;
  let isHovered = false;
  let fetchedUrl = null;
  let isVisibleOnScreen = true;
  let observer = null;

  $: mId = String(messageId ?? attach.videoId ?? attach.token ?? attach.audioId ?? attach.localPath ?? 'video_note');
  $: isCurrentTrack = $activeMedia?.id === mId || (messageId != null && String($activeMedia?.messageId) === String(messageId));
  $: isPlaying = isCurrentTrack && !!$activeMedia?.isPlaying;
  $: currentSpeed = $trackSettings[mId]?.speed ?? 1.0;
  $: currentVolume = $trackSettings[mId]?.volume ?? 1.0;
  $: currentMuted = $trackSettings[mId]?.muted ?? false;
  $: attachDur = attach.duration
    ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration)
    : ($activeMedia?.duration || 0);
  $: duration = attachDur || ($activeMedia?.duration || 0);

  let localProgress = 0;
  let localTime = 0;

  $: if (isCurrentTrack) {
    const cur = $activeMedia?.currentTime ?? getMasterMediaCurrentTime();
    const dur = ($activeMedia?.duration && isFinite($activeMedia.duration) && $activeMedia.duration > 0)
      ? $activeMedia.duration
      : duration;
    localTime = cur;
    localProgress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
  } else {
    localProgress = 0;
    localTime = 0;
  }

  $: activeTrackId = $activeMedia?.id;
  $: if (canvasEl && (mId || activeTrackId)) {
    if (mId) registerVideoCanvas(mId, canvasEl);
    if (isCurrentTrack && activeTrackId && activeTrackId !== mId) {
      registerVideoCanvas(activeTrackId, canvasEl);
    }
  }

  let previewDataUrl = null;
  $: if (attach?.previewData) {
    try {
      let bytes;
      if (typeof attach.previewData === 'string') {
        if (attach.previewData.startsWith('data:')) {
          previewDataUrl = attach.previewData;
        } else {
          bytes = Uint8Array.from(atob(attach.previewData), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'image/webp' });
          previewDataUrl = URL.createObjectURL(blob);
        }
      } else if (Array.isArray(attach.previewData)) {
        bytes = new Uint8Array(attach.previewData);
        const blob = new Blob([bytes], { type: 'image/webp' });
        previewDataUrl = URL.createObjectURL(blob);
      }
    } catch {
      previewDataUrl = null;
    }
  } else {
    previewDataUrl = null;
  }

  $: posterSrc = previewDataUrl || attach.thumbnail || attach.baseUrl || (attach.url && (attach.url.endsWith('.jpg') || attach.url.endsWith('.png') || attach.url.endsWith('.webp')) ? attach.url : null);
  $: rawUrl = fetchedUrl || (attach.localPath ? attach.localPath : null) || attach.videoUrl || attach.fileUrl || ((attach.url && attach.url !== attach.baseUrl && !attach.url.endsWith('.jpg') && !attach.url.endsWith('.jpeg') && !attach.url.endsWith('.png') && !attach.url.endsWith('.webp')) ? attach.url : null);

  let resolvedPosterUrl = null;
  $: resolvedPosterUrl = posterSrc ? (posterSrc.startsWith('blob:') || posterSrc.startsWith('data:') ? posterSrc : getProxiedMediaUrl(posterSrc)) : null;

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

  $: strokeDashoffset = circumference - (isCurrentTrack ? localProgress : 0) * circumference;

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  const bubbleInFlightMap = new Map();

  async function ensureVideoUrl() {
    if (fetchedUrl && (fetchedUrl.startsWith('/') || fetchedUrl.startsWith('file://') || fetchedUrl.includes('/cache/'))) {
      return toPlayableUrl(fetchedUrl);
    }
    if (attach.localPath) return toPlayableUrl(attach.localPath);
    if (attach.isEncryptedMedia) {
      const fid = attach.fileId || attach.encryptedAttach?.fileId || attach.id;
      if (fid) {
        try {
          const account = await getCurrentAccount().catch(() => null);
          const accountId = Number(account?.id || 0);
          const cached = await invoke("get_cached_file", {
            account: accountId,
            src: `enc_media_${fid}`
          }).catch(() => null);
          if (cached) {
            fetchedUrl = cached;
            attach.localPath = cached;
            return toPlayableUrl(cached);
          }
          const fileRes = await $API.getFileById(chatId, messageId, fid);
          if (fileRes?.url) {
            const cachedPath = await invoke("cache_encrypted_media", {
              account: accountId,
              chatId: Number(chatId || 0),
              fileId: Number(fid),
              src: fileRes.url,
              password: null,
            });
            if (cachedPath) {
              fetchedUrl = cachedPath;
              attach.localPath = cachedPath;
              return toPlayableUrl(cachedPath);
            }
          }
        } catch (e) {
          console.error(e);
        }
      }
      return null;
    }
    const vId = attach.videoId ?? attach.id ?? attach.video_id ?? 0;
    const token = attach.videoToken ?? attach.token ?? null;
    const cacheKey = `video_note_${chatId ?? 0}_${messageId ?? 0}_${vId || '0'}`;

    if (bubbleInFlightMap.has(cacheKey)) {
      return await bubbleInFlightMap.get(cacheKey);
    }

    const task = (async () => {
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
            fetchedUrl = picked;
            if (picked.startsWith('http://') || picked.startsWith('https://')) {
              invoke('cache_url', {
                src: picked,
                chatId: chatId != null ? Number(chatId) : null,
                mediaType: 'video_note',
                key: cacheKey,
              }).then((cached) => {
                if (cached) fetchedUrl = cached;
              }).catch(() => {});
            }
            return toPlayableUrl(picked);
          }
        } catch (err) {}
      }
      const fallback = attach.videoUrl || attach.fileUrl || attach.url || attach.baseUrl;
      if (fallback && (fallback.startsWith('http://') || fallback.startsWith('https://'))) {
        fetchedUrl = fallback;
        invoke('cache_url', {
          src: fallback,
          chatId: chatId != null ? Number(chatId) : null,
          mediaType: 'video_note',
          key: cacheKey,
        }).then((cached) => {
          if (cached) fetchedUrl = cached;
        }).catch(() => {});
        return toPlayableUrl(fallback);
      }
      return resolvedVideoUrl || toPlayableUrl(rawUrl);
    })().finally(() => {
      bubbleInFlightMap.delete(cacheKey);
    });

    bubbleInFlightMap.set(cacheKey, task);
    return await task;
  }

  let isLoading = false;

  async function handleTogglePlay() {
    if (isCurrentTrack) {
      if (isPlaying) {
        pauseCurrentMedia();
      } else {
        resumeCurrentMedia();
      }
      return;
    }

    const currentUrl = resolvedVideoUrl || (rawUrl ? toPlayableUrl(rawUrl) : null);
    if (currentUrl) {
      await playMedia({
        id: mId,
        chatId,
        messageId,
        type: 'video_note',
        url: currentUrl,
        poster: resolvedPosterUrl,
        duration,
        senderName: isMe ? 'Вы' : (attach.senderName || 'Собеседник'),
        title: 'Видеосообщение',
        attach,
      }, { chatId, currentMessageId: messageId });
      return;
    }

    isLoading = true;
    try {
      const url = await ensureVideoUrl();
      if (!url) return;
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
      }, { chatId, currentMessageId: messageId });
    } finally {
      isLoading = false;
    }
  }

  async function handleProgressClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const clickX = e.clientX - cx;
    const clickY = e.clientY - cy;
    const dist = Math.hypot(clickX, clickY);

    if (dist < radius - 18) {
      handleTogglePlay();
      return;
    }

    if (!duration || duration <= 0) return;

    let angle = Math.atan2(clickY, clickX) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const targetRatio = Math.max(0, Math.min(1, angle / (2 * Math.PI)));
    const targetTime = targetRatio * duration;

    localProgress = targetRatio;
    localTime = targetTime;

    if (!isCurrentTrack) {
      const url = resolvedVideoUrl || (rawUrl ? toPlayableUrl(rawUrl) : null);
      if (url) {
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
        }, { chatId, currentMessageId: messageId });
      }
      ensureVideoUrl().catch(() => {});
    }

    seekMedia(mId, targetTime);
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
    if (!resolvedVideoUrl && !fetchedUrl) {
      ensureVideoUrl().catch(() => {});
    }
    if (isCurrentTrack) {
      takeOverFromGlobal($activeMedia?.id || mId);
    }
    if (typeof IntersectionObserver !== 'undefined' && containerEl) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          isVisibleOnScreen = entry.isIntersecting && entry.intersectionRatio > 0.05;
          if (isCurrentTrack) {
            if (!isVisibleOnScreen && isPlaying) {
              handOffToGlobal({
                id: $activeMedia?.id || mId,
                type: 'video_note',
                url: resolvedVideoUrl || rawUrl,
                isPlaying: true,
              });
            } else if (isVisibleOnScreen && $activeMedia?.isGlobalPlayback) {
              takeOverFromGlobal($activeMedia?.id || mId);
            }
          }
        }
      }, { threshold: [0, 0.05, 0.5, 1.0] });
      observer.observe(containerEl);
    }
  });

  onDestroy(() => {
    if (previewDataUrl && previewDataUrl.startsWith('blob:')) {
      try { URL.revokeObjectURL(previewDataUrl); } catch {}
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (canvasEl && mId) {
      unregisterVideoCanvas(mId, canvasEl);
    }
    if (canvasEl && $activeMedia?.id && $activeMedia.id !== mId) {
      unregisterVideoCanvas($activeMedia.id, canvasEl);
    }
    if (isCurrentTrack && isPlaying) {
      handOffToGlobal({
        id: $activeMedia.id || mId,
        type: 'video_note',
        url: resolvedVideoUrl || rawUrl,
        isPlaying: true,
      });
    }
  });
</script>

<div
  bind:this={containerEl}
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
      on:click|stopPropagation={handleProgressClick}
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
      {#if resolvedPosterUrl}
        <img
          class="video-poster-img"
          src={resolvedPosterUrl}
          alt=""
        />
      {/if}
      <canvas
        bind:this={canvasEl}
        width={size}
        height={size}
        class="video-canvas"
      ></canvas>

      {#if attach.loading || isLoading}
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
      {isPlaying ? formatTime(localTime) : formatTime(duration)}
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
    pointer-events: stroke;
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

  .video-poster-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    pointer-events: none;
  }

  .video-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: 50%;
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
</style>
