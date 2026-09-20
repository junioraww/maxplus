<script>
  import { onMount, onDestroy } from 'svelte';
  import {
    activeMedia,
    mediaPlaylist,
    showPlaylistModal,
    togglePlayPause,
    stopCurrentMedia,
    seekMedia,
    cyclePlaybackSpeed,
    snapSpeed,
    setPlaybackSpeed,
    toggleMediaMute,
    setMediaVolume,
    buildChatPlaylist,
  } from '$lib/stores/mediaPlayback';

  export let isChatHeader = false;

  let trackEl;
  let isSeeking = false;
  let seekRatio = 0;
  let animId = null;
  let smoothTime = 0;

  let isDraggingSpeed = false;
  let speedDragStartX = 0;
  let speedDragStartVal = 1.0;

  let isDraggingVolume = false;
  let volDragStartY = 0;
  let volDragStartVal = 1.0;

  $: currentTrack = $activeMedia;
  $: isPlaying = currentTrack?.isPlaying ?? false;
  $: duration = currentTrack?.duration || 0;
  $: activeId = currentTrack?.id;
  $: currentSpeed = currentTrack?.speed ?? 1.0;
  $: currentVolume = currentTrack?.volume ?? 1.0;
  $: currentMuted = currentTrack?.muted || currentVolume === 0;

  $: playlistItems = $mediaPlaylist?.items || [];
  $: playlistIndex = $mediaPlaylist?.currentIndex ?? -1;
  $: playlistCount = playlistItems.length;

  $: progressPercent = isSeeking
    ? seekRatio * 100
    : duration > 0
      ? Math.min(100, Math.max(0, (smoothTime / duration) * 100))
      : 0;

  onMount(() => {
    startSmoothTicker();
  });

  onDestroy(() => {
    if (animId) cancelAnimationFrame(animId);
  });

  function startSmoothTicker() {
    let lastRealTime = 0;
    let lastAnchor = performance.now();

    const tick = (now) => {
      if (!isSeeking && currentTrack) {
        const targetTime = currentTrack.currentTime || 0;
        if (Math.abs(targetTime - lastRealTime) > 0.05) {
          lastRealTime = targetTime;
          lastAnchor = now;
          smoothTime = targetTime;
        } else if (isPlaying && lastRealTime > 0) {
          const rate = currentSpeed || 1.0;
          const elapsed = ((now - lastAnchor) / 1000) * rate;
          const maxDur = duration || currentTrack.duration || 0;
          const est = lastRealTime + elapsed;
          smoothTime = maxDur > 0 ? Math.min(maxDur, Math.max(0, est)) : est;
        } else {
          smoothTime = targetTime;
        }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function handleTrackPointerDown(e) {
    if (e.button !== 0 || !trackEl) return;
    e.preventDefault();
    isSeeking = true;
    updateSeekFromPointer(e);
    window.addEventListener('pointermove', handleTrackPointerMove, { passive: false });
    window.addEventListener('pointerup', handleTrackPointerUp);
  }

  function updateSeekFromPointer(e) {
    if (!trackEl) return;
    const rect = trackEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekRatio = ratio;
    smoothTime = ratio * duration;
  }

  function handleTrackPointerMove(e) {
    if (!isSeeking) return;
    e.preventDefault();
    updateSeekFromPointer(e);
  }

  function handleTrackPointerUp(e) {
    if (!isSeeking) return;
    isSeeking = false;
    updateSeekFromPointer(e);
    if (activeId) {
      seekMedia(activeId, seekRatio * duration);
    }
    window.removeEventListener('pointermove', handleTrackPointerMove);
    window.removeEventListener('pointerup', handleTrackPointerUp);
  }

  function handleSpeedPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingSpeed = true;
    speedDragStartX = e.clientX;
    speedDragStartVal = currentSpeed;
    window.addEventListener('pointermove', handleSpeedPointerMove, { passive: false });
    window.addEventListener('pointerup', handleSpeedPointerUp);
  }

  function handleSpeedPointerMove(e) {
    if (!isDraggingSpeed) return;
    e.preventDefault();
    e.stopPropagation();
    const deltaX = e.clientX - speedDragStartX;
    const change = deltaX / 100;
    const newSpeed = snapSpeed(speedDragStartVal + change);
    setPlaybackSpeed(newSpeed);
  }

  function handleSpeedPointerUp() {
    isDraggingSpeed = false;
    window.removeEventListener('pointermove', handleSpeedPointerMove);
    window.removeEventListener('pointerup', handleSpeedPointerUp);
  }

  function handleVolumePointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingVolume = true;
    volDragStartY = e.clientY;
    volDragStartVal = currentVolume;
    window.addEventListener('pointermove', handleVolumePointerMove, { passive: false });
    window.addEventListener('pointerup', handleVolumePointerUp);
  }

  function handleVolumePointerMove(e) {
    if (!isDraggingVolume) return;
    e.preventDefault();
    e.stopPropagation();
    const deltaY = volDragStartY - e.clientY;
    const change = deltaY / 80;
    const newVol = Math.max(0, Math.min(1, volDragStartVal + change));
    setMediaVolume(newVol);
  }

  function handleVolumePointerUp(e) {
    if (!isDraggingVolume) return;
    const moved = Math.abs(volDragStartY - e.clientY);
    isDraggingVolume = false;
    window.removeEventListener('pointermove', handleVolumePointerMove);
    window.removeEventListener('pointerup', handleVolumePointerUp);
    if (moved < 3) {
      toggleMediaMute();
    }
  }

  function handleVolumeWheel(e) {
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    setMediaVolume(currentVolume + delta);
  }

  function openPlaylist() {
    if (currentTrack?.chatId) {
      buildChatPlaylist(currentTrack.chatId, currentTrack.messageId);
    }
    showPlaylistModal.set(true);
  }
</script>

{#if currentTrack}
  <div class="media-playback-header" class:chat-header={isChatHeader}>
    <div
      class="timeline-track-container"
      bind:this={trackEl}
      on:pointerdown|preventDefault|stopPropagation={handleTrackPointerDown}
    >
      <div class="timeline-bar-bg"></div>
      <div class="timeline-bar-played" style="width: {progressPercent}%;"></div>
      <div class="timeline-thumb-point" style="left: {progressPercent}%;"></div>
    </div>

    <div class="playback-content">
      <button
        type="button"
        class="hdr-btn play-btn"
        on:click|stopPropagation={togglePlayPause}
        title={isPlaying ? 'Пауза' : 'Продолжить'}
      >
        {#if isPlaying}
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M8 5v14l11-7z"/>
          </svg>
        {/if}
      </button>

      <div class="media-info" on:click|stopPropagation={openPlaylist} role="button" tabindex="0">
        <div class="media-title-row">
          <span class="media-type-icon">
            {#if currentTrack.type === 'video_note'}
              <svg viewBox="0 0 24 24" width="13" height="13">
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="13" height="13">
                <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              </svg>
            {/if}
          </span>
          <span class="media-title">
            {currentTrack.title || (currentTrack.type === 'video_note' ? 'Видеосообщение' : 'Голосовое сообщение')}
          </span>
          {#if playlistCount > 1}
            <span class="playlist-badge">{playlistIndex + 1}/{playlistCount}</span>
          {/if}
        </div>
        <div class="media-sub-row">
          <span class="media-sender">{currentTrack.senderName || 'Чат'}</span>
          <span class="media-divider">•</span>
          <span class="media-time-counter">{formatTime(smoothTime)} / {formatTime(duration)}</span>
        </div>
      </div>

      <div class="header-actions">
        <div class="speed-control-wrapper">
          <button
            type="button"
            class="hdr-btn speed-btn"
            class:snapped={currentSpeed === 1.0}
            draggable="false"
            on:dragstart|preventDefault
            on:click|stopPropagation={cyclePlaybackSpeed}
            on:pointerdown|preventDefault|stopPropagation={handleSpeedPointerDown}
            title="Скорость воспроизведения"
          >
            {currentSpeed}x
          </button>
          {#if isDraggingSpeed}
            <div class="speed-tooltip">{currentSpeed}x</div>
          {/if}
        </div>

        <div class="volume-control-wrapper">
          <button
            type="button"
            class="hdr-btn vol-btn"
            class:muted={currentMuted}
            draggable="false"
            on:dragstart|preventDefault
            on:pointerdown|preventDefault|stopPropagation={handleVolumePointerDown}
            on:wheel|preventDefault|stopPropagation={handleVolumeWheel}
            title={currentMuted ? 'Включить звук' : `Громкость: ${Math.round(currentVolume * 100)}%`}
          >
            {#if currentMuted}
              <svg viewBox="0 0 24 24" width="16" height="16" style="pointer-events: none;">
                <path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            {:else if currentVolume <= 0.5}
              <svg viewBox="0 0 24 24" width="16" height="16" style="pointer-events: none;">
                <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="16" height="16" style="pointer-events: none;">
                <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            {/if}
          </button>
          {#if isDraggingVolume}
            <div class="vol-tooltip">‹ {Math.round(currentVolume * 100)}% ›</div>
          {/if}
        </div>

        <button
          type="button"
          class="hdr-btn playlist-btn"
          on:click|stopPropagation={openPlaylist}
          title="Очередь воспроизведения"
        >
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M4 10h12v2H4zm0-4h12v2H4zm0 8h8v2H4zm10 0v6l5-3-5-3z"/>
          </svg>
        </button>

        <button
          type="button"
          class="hdr-btn close-btn"
          on:click|stopPropagation={stopCurrentMedia}
          title="Закрыть"
        >
          ✕
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .media-playback-header {
    width: 100%;
    background: #1e2024;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    position: relative;
    user-select: none;
    z-index: 40;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    flex-shrink: 0;
  }
  .media-playback-header.chat-header {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .timeline-track-container {
    width: 100%;
    height: 10px;
    position: relative;
    cursor: pointer;
    display: flex;
    align-items: center;
    touch-action: none;
  }
  .timeline-bar-bg {
    position: absolute;
    top: 3px;
    left: 0;
    width: 100%;
    height: 3px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }
  .timeline-bar-played {
    position: absolute;
    top: 3px;
    left: 0;
    height: 3px;
    background: #2b82d9;
    border-radius: 3px;
    pointer-events: none;
  }
  .timeline-thumb-point {
    position: absolute;
    top: 50%;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #2b82d9;
    transform: translate(-50%, -50%);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    transition: transform 0.1s ease;
  }
  .timeline-track-container:hover .timeline-thumb-point {
    transform: translate(-50%, -50%) scale(1.25);
  }
  .playback-content {
    display: flex;
    align-items: center;
    padding: 2px 10px 6px 10px;
    gap: 8px;
    min-height: 38px;
  }
  .hdr-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: #8e9aa8;
    cursor: pointer;
    border-radius: 6px;
    padding: 4px;
    transition: background 0.15s, color 0.15s;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    touch-action: none;
  }
  .hdr-btn * {
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    pointer-events: none;
  }
  .hdr-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }
  .play-btn {
    color: #2b82d9;
    padding: 6px;
    border-radius: 50%;
  }
  .play-btn:hover {
    background: rgba(43, 130, 217, 0.15);
    color: #2b82d9;
  }
  .media-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 6px;
    transition: background 0.15s;
  }
  .media-info:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .media-title-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    font-weight: 500;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .media-type-icon {
    display: inline-flex;
    color: #2b82d9;
  }
  .media-title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .playlist-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 10px;
    background: rgba(43, 130, 217, 0.2);
    color: #2b82d9;
  }
  .media-sub-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #8e9aa8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .media-sender {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .speed-control-wrapper, .volume-control-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    touch-action: none;
  }
  .speed-btn {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: -0.2px;
    padding: 3px 6px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }
  .speed-tooltip, .vol-tooltip {
    position: absolute;
    bottom: -26px;
    left: 50%;
    transform: translateX(-50%);
    background: #111316;
    color: #fff;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .close-btn {
    font-size: 13px;
    font-weight: 700;
    padding: 5px 7px;
  }
</style>
