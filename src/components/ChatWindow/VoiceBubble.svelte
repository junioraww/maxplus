<script>
  import { onDestroy, onMount } from 'svelte';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import { parseWaveform } from '$lib/utils/waveform';
  import {
    activeMedia,
    trackSettings,
    snapSpeed,
    setTrackSpeed,
    cycleTrackSpeed,
    setTrackVolume,
    toggleTrackMute,
    registerAudio,
    updateMediaProgress,
    updateMediaPlaybackState,
    seekMedia,
    stopCurrentMedia,
  } from '$lib/stores/mediaPlayback';
  import {
    transcriptions,
    requestAudioTranscription,
    toggleTranscriptionExpanded,
  } from '$lib/stores/transcription';

  export let attach;
  export let messageId;
  export let chatId;
  export let isMe = false;

  let audioEl;
  let isDraggingScrub = false;
  let isDraggingSpeed = false;
  let speedDragStartX = 0;
  let speedDragStartVal = 1.0;

  $: mId = String(messageId ?? attach.token ?? attach.localPath ?? 'voice');
  $: isCurrentTrack = $activeMedia?.id === mId;
  $: isPlaying = isCurrentTrack && $activeMedia?.isPlaying;
  $: currentSpeed = $trackSettings[mId]?.speed ?? 1.0;
  $: currentVolume = $trackSettings[mId]?.volume ?? 1.0;
  $: currentMuted = $trackSettings[mId]?.muted ?? false;
  $: duration = (audioEl && audioEl.duration && isFinite(audioEl.duration) && audioEl.duration > 0)
    ? audioEl.duration
    : (attach.duration
        ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration)
        : ($activeMedia?.duration || 0));
  $: currentTime = isCurrentTrack ? ($activeMedia?.currentTime || 0) : 0;
  $: progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  $: waveBars = parseWaveform(attach.wave || attach.waveform, 45);
  $: transcription = $transcriptions[mId];

  $: rawUrl = attach.fileUrl || attach.baseUrl || attach.url || (attach.localPath ? attach.localPath : null);
  $: mediaUrl = rawUrl ? (rawUrl.startsWith('http') || rawUrl.startsWith('blob:') ? rawUrl : convertFileSrc(rawUrl)) : null;

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function handleTogglePlay() {
    if (!audioEl) return;
    if (isCurrentTrack) {
      if (isPlaying) {
        audioEl.pause();
      } else {
        audioEl.play().catch(() => {});
      }
    } else {
      registerAudio(mId, audioEl, { duration });
      audioEl.play().catch(() => {});
    }
  }

  function handleWaveClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = ratio * duration;
    if (!isCurrentTrack && audioEl) {
      registerAudio(mId, audioEl, { duration });
    }
    seekMedia(mId, target);
    if (audioEl) audioEl.currentTime = target;
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
    const change = (deltaX / 120);
    const newSpeed = snapSpeed(speedDragStartVal + change);
    setTrackSpeed(mId, newSpeed);
  }

  function handleSpeedPointerUp() {
    isDraggingSpeed = false;
    window.removeEventListener('pointermove', handleSpeedPointerMove);
    window.removeEventListener('pointerup', handleSpeedPointerUp);
  }

  function handleTranscriptionClick() {
    requestAudioTranscription(chatId, mId, attach.audioId || mId);
  }

  async function handleDownload() {
    if (!mediaUrl) {
      showAlert('Ссылка на аудио недоступна');
      return;
    }
    try {
      const defaultName = `voice_${mId}_${Date.now()}.ogg`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Audio', extensions: ['ogg', 'mp3', 'wav', 'm4a'] }],
      });
      if (savePath) {
        await invoke('download_to_path', { url: mediaUrl, path: savePath });
        showAlert('Аудио успешно сохранено');
      } else {
        await invoke('download', { url: mediaUrl, name: defaultName });
        showAlert('Загрузка в папку загрузок начата');
      }
    } catch (err) {
      try {
        await invoke('download', { url: mediaUrl, name: `voice_${mId}.ogg` });
        showAlert('Загрузка в папку загрузок начата');
      } catch (e) {
        showAlert('Не удалось скачать файл');
      }
    }
  }

  onDestroy(() => {
    if (isCurrentTrack) {
      stopCurrentMedia();
    }
  });
</script>

<div class="voice-message-bubble" class:is-me={isMe}>
  <audio
    bind:this={audioEl}
    src={mediaUrl}
    preload="metadata"
    on:timeupdate={() => updateMediaProgress(mId, audioEl.currentTime, audioEl.duration || duration)}
    on:play={() => updateMediaPlaybackState(mId, true)}
    on:pause={() => updateMediaPlaybackState(mId, false)}
    on:ended={() => {
      updateMediaPlaybackState(mId, false);
      if (audioEl) audioEl.currentTime = 0;
    }}
  ></audio>

  <div class="voice-row">
    <button
      type="button"
      class="voice-play-btn"
      on:click|stopPropagation={handleTogglePlay}
      title={isPlaying ? 'Пауза' : 'Воспроизвести'}
    >
      {#if attach.loading}
        <div class="mini-spinner"></div>
      {:else if isPlaying}
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M8 5v14l11-7z"/>
        </svg>
      {/if}
    </button>

    <div class="voice-content">
      <div
        class="voice-waveform-wrap"
        on:click|stopPropagation={handleWaveClick}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin="0"
        aria-valuemax="1"
        tabindex="0"
      >
        <svg
          class="voice-waveform-svg"
          viewBox="0 0 {Math.max(1, waveBars.length * 3)} 30"
          preserveAspectRatio="none"
        >
          {#each waveBars as bar, index}
            {@const isPlayed = (index + 0.5) / waveBars.length <= progress}
            {@const barH = Math.max(3, Math.round(bar * 26))}
            {@const barY = (30 - barH) / 2}
            <rect
              x={index * 3}
              y={barY}
              width="1.8"
              height={barH}
              rx="0.9"
              class="svg-bar"
              class:played={isPlayed}
            />
          {/each}
        </svg>
      </div>

      <div class="voice-meta">
        <span class="voice-duration">
          {isPlaying ? formatTime(currentTime) : formatTime(duration)}
        </span>

        <div class="voice-actions">
          <div class="speed-control-wrapper">
            <button
              type="button"
              class="voice-btn speed-btn"
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
            class="voice-btn vol-btn"
            class:muted={currentMuted || currentVolume === 0}
            on:click|stopPropagation={() => toggleTrackMute(mId)}
            on:wheel|preventDefault|stopPropagation={(e) => {
              const delta = e.deltaY < 0 ? 0.05 : -0.05;
              setTrackVolume(mId, currentVolume + delta);
            }}
            title={currentMuted || currentVolume === 0 ? 'Включить звук' : `Громкость: ${Math.round(currentVolume * 100)}%`}
          >
            {#if currentMuted || currentVolume === 0}
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            {:else if currentVolume <= 0.5}
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            {/if}
          </button>

          <button
            type="button"
            class="voice-btn transcribe-btn"
            class:active={transcription?.status === 'done'}
            class:loading={transcription?.status === 'loading'}
            on:click|stopPropagation={handleTranscriptionClick}
            title="Транскрибировать текст"
          >
            {#if transcription?.status === 'loading'}
              <div class="mini-spinner"></div>
            {:else}
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
              </svg>
            {/if}
          </button>

          <button
            type="button"
            class="voice-btn download-btn"
            on:click|stopPropagation={handleDownload}
            title="Скачать на устройство"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .voice-message-bubble {
    display: flex;
    flex-direction: column;
    min-width: 220px;
    max-width: 300px;
    padding: 2px 2px 2px 2px;
    user-select: none;
  }

  .voice-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .voice-play-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #3b82f6;
    border: none;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.12s, background-color 0.15s;
  }

  .voice-play-btn:hover {
    background: #2563eb;
    transform: scale(1.05);
  }

  .voice-play-btn:active {
    transform: scale(0.96);
  }

  .voice-content {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    min-width: 0;
    gap: 2px;
  }

  .voice-waveform-wrap {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    height: 24px;
    cursor: pointer;
    overflow: hidden;
  }

  .voice-waveform-svg {
    width: 100%;
    height: 100%;
    display: block;
    overflow: hidden;
  }

  .svg-bar {
    fill: rgba(255, 255, 255, 0.35);
    transition: fill 0.1s;
  }

  .is-me .svg-bar {
    fill: rgba(255, 255, 255, 0.45);
  }

  .svg-bar.played {
    fill: #38bdf8;
  }

  .voice-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.65);
    min-height: 20px;
  }

  .voice-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .voice-btn {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: rgba(255, 255, 255, 0.85);
    border-radius: 12px;
    padding: 2px 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.15s, transform 0.1s;
  }

  .voice-btn:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .speed-btn {
    font-weight: 600;
    min-width: 28px;
  }

  .speed-btn.snapped {
    color: #38bdf8;
  }

  .speed-control-wrapper {
    position: relative;
  }

  .speed-tooltip {
    position: absolute;
    bottom: 125%;
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
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

  .mini-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
