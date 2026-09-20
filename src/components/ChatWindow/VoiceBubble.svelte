<script>
  import { onDestroy, onMount } from 'svelte';
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import { getAssetUrl, getProxiedMediaUrl } from '$lib/utils/images';
  import API from '$lib/stores/api';
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
    playMedia,
    pauseCurrentMedia,
    resumeCurrentMedia,
    playNextMedia,
    handOffToGlobal,
    takeOverFromGlobal,
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
  $: currentTime = isCurrentTrack ? ($activeMedia?.currentTime ?? (audioEl?.currentTime || 0)) : 0;
  $: progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  $: waveBars = parseWaveform(attach.wave || attach.waveform, 45);
  $: transcription = $transcriptions[mId];

  let fetchedUrl = null;
  $: rawUrl = fetchedUrl || attach.fileUrl || attach.baseUrl || attach.url || (attach.localPath ? attach.localPath : null);

  let mediaUrl = null;
  $: {
    if (!rawUrl) {
      mediaUrl = null;
    } else if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('http://127.0.0.1:11447/')) {
      mediaUrl = rawUrl;
    } else {
      mediaUrl = getProxiedMediaUrl(rawUrl);
      getAssetUrl(rawUrl).then((cached) => {
        if (cached) mediaUrl = getProxiedMediaUrl(cached);
      }).catch(() => {});
    }
  }

  $: if (audioEl && mediaUrl && (!audioEl.src || !audioEl.src.includes(mediaUrl))) {
    audioEl.src = mediaUrl;
  }

  async function ensureVoiceUrl() {
    if (mediaUrl) return mediaUrl;
    const vId = attach.videoId ?? attach.audioId ?? attach.id ?? attach.video_id;
    const token = attach.videoToken ?? attach.token ?? null;
    if (vId && chatId && messageId) {
      try {
        const response = await $API.getVideoById(chatId, messageId, vId, token);
        const qualityPriority = ['MP4_720', 'MP4_480', 'MP4_360', 'MP4_240', 'MP4_1080', 'OGG', 'MP3', 'AUDIO', 'audio', 'EXTERNAL', 'url', 'baseUrl', 'fileUrl'];
        let picked = null;
        for (const q of qualityPriority) {
          if (response && response[q]) {
            picked = response[q];
            break;
          }
        }
        if (!picked && response && response.HLS) picked = response.HLS;
        if (!picked && response && typeof response === 'object') {
          picked = Object.values(response).find(v => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://')));
        }
        if (picked) {
          fetchedUrl = picked;
          mediaUrl = getProxiedMediaUrl(picked);
          return mediaUrl;
        }
      } catch (err) {}
    }
    return mediaUrl || (rawUrl ? getProxiedMediaUrl(rawUrl) : null);
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function handleTogglePlay() {
    if (isCurrentTrack) {
      if (isPlaying) {
        pauseCurrentMedia();
        if (audioEl) audioEl.pause();
      } else {
        resumeCurrentMedia();
        if (audioEl) audioEl.play().catch(() => {});
      }
    } else {
      const url = mediaUrl || (await ensureVoiceUrl()) || (rawUrl ? getProxiedMediaUrl(rawUrl) : null);
      if (audioEl && url && (!audioEl.src || !audioEl.src.includes(url))) {
        audioEl.src = url;
      }
      await playMedia({
        id: mId,
        chatId,
        messageId,
        type: 'voice',
        url,
        duration,
        senderName: isMe ? 'Вы' : (attach.senderName || 'Собеседник'),
        title: 'Голосовое сообщение',
        attach,
        element: audioEl,
      }, { chatId, currentMessageId: messageId });
    }
  }

  async function handleWaveClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const target = ratio * duration;
    const url = mediaUrl || (await ensureVoiceUrl()) || (rawUrl ? getProxiedMediaUrl(rawUrl) : null);
    if (audioEl && url && (!audioEl.src || !audioEl.src.includes(url))) {
      audioEl.src = url;
    }
    if (!isCurrentTrack) {
      await playMedia({
        id: mId,
        chatId,
        messageId,
        type: 'voice',
        url,
        duration,
        senderName: isMe ? 'Вы' : (attach.senderName || 'Собеседник'),
        title: 'Голосовое сообщение',
        attach,
        element: audioEl,
      }, { chatId, currentMessageId: messageId });
    }
    seekMedia(mId, target);
    if (audioEl) audioEl.currentTime = target;
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

  onMount(() => {
    ensureVoiceUrl();
    if (isCurrentTrack && audioEl) {
      takeOverFromGlobal(mId, audioEl);
    }
  });

  onDestroy(() => {
    if (isCurrentTrack && isPlaying) {
      handOffToGlobal({
        id: mId,
        type: 'voice',
        url: mediaUrl,
        currentTime: audioEl?.currentTime || currentTime,
        duration,
        speed: currentSpeed,
        volume: currentVolume,
        muted: currentMuted,
        isPlaying: true,
      });
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
      playNextMedia();
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

  .volume-control-wrapper {
    position: relative;
  }

  .vol-tooltip {
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
