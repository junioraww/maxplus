<script>
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { showAlert } from '$lib/utils/alert';
  import { getProxiedMediaUrl } from '$lib/utils/images';
  import { parseWaveform } from '$lib/utils/waveform';
  import {
    activeMedia,
    trackSettings,
    seekMedia,
    playMedia,
    pauseCurrentMedia,
    resumeCurrentMedia,
    resolvePlayableUrl,
    updateMediaProgress,
    updateMediaPlaybackState,
    playNextMedia,
    handOffToGlobal,
    takeOverFromGlobal,
  } from '$lib/stores/mediaPlayback';
  import {
    transcriptions,
    requestAudioTranscription,
  } from '$lib/stores/transcription';

  export let attach;
  export let messageId;
  export let chatId;
  export let isMe = false;

  $: mId = String(messageId ?? attach.audioId ?? attach.videoId ?? attach.token ?? attach.localPath ?? 'voice');
  $: isCurrentTrack = $activeMedia?.id === mId;
  $: isPlaying = isCurrentTrack && $activeMedia?.isPlaying;
  $: currentSpeed = $trackSettings[mId]?.speed ?? 1.0;
  $: duration = ($activeMedia?.id === mId && $activeMedia?.duration > 0)
    ? $activeMedia.duration
    : (attach.duration
        ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration)
        : ($activeMedia?.duration || 0));
  $: currentTime = isCurrentTrack ? ($activeMedia?.currentTime ?? 0) : 0;
  $: progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  $: waveBars = parseWaveform(attach.wave || attach.waveform, 45);
  $: transcription = $transcriptions[mId];

  let fetchedUrl = null;
  $: rawUrl = fetchedUrl || attach.localPath || attach.fileUrl || attach.url || attach.baseUrl || null;

  let mediaUrl = null;
  $: mediaUrl = rawUrl ? getProxiedMediaUrl(rawUrl) : null;

  async function ensureVoiceUrl() {
    if (mediaUrl) return mediaUrl;
    if (fetchedUrl) return getProxiedMediaUrl(fetchedUrl);
    if (attach.localPath) return getProxiedMediaUrl(attach.localPath);
    const resolved = await resolvePlayableUrl(attach, chatId, messageId);
    if (resolved) {
      fetchedUrl = resolved;
      mediaUrl = resolved;
      return resolved;
    }
    const rawFallback = attach.fileUrl || attach.url || attach.baseUrl;
    if (rawFallback) {
      if (rawFallback.startsWith('http://') || rawFallback.startsWith('https://')) {
        invoke('cache_url', {
          src: rawFallback,
          chatId: chatId != null ? Number(chatId) : null,
          mediaType: 'voice',
        }).then((cached) => {
          if (cached) {
            fetchedUrl = cached;
            mediaUrl = getProxiedMediaUrl(cached);
          }
        }).catch(() => {});
      }
      mediaUrl = getProxiedMediaUrl(rawFallback);
      return mediaUrl;
    }
    return null;
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const total = Math.round(sec);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  let audioEl;

  $: if (isCurrentTrack && audioEl && $activeMedia?.isGlobalPlayback) {
    takeOverFromGlobal(mId, audioEl);
  }

  async function handleTogglePlay() {
    if (isCurrentTrack) {
      if (isPlaying) {
        pauseCurrentMedia();
      } else {
        resumeCurrentMedia();
      }
    } else {
      const url = mediaUrl || await ensureVoiceUrl();
      if (audioEl) {
        if (url && audioEl.src !== url) {
          audioEl.src = url;
        }
        audioEl.play().catch(() => {});
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
    if (!isCurrentTrack) {
      const url = mediaUrl || await ensureVoiceUrl();
      if (audioEl) {
        if (url && audioEl.src !== url) audioEl.src = url;
        audioEl.play().catch(() => {});
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
    seekMedia(mId, target);
  }

  function handleTranscriptionClick() {
    requestAudioTranscription(chatId, mId, attach.audioId || mId);
  }

  async function handleDownload() {
    const url = (await ensureVoiceUrl()) || mediaUrl;
    if (!url) {
      showAlert('Ссылка на файл недоступна');
      return;
    }
    try {
      const defaultName = `voice_${mId}_${Date.now()}.ogg`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'Audio', extensions: ['ogg', 'mp3', 'm4a', 'wav'] }],
      });
      if (savePath) {
        await invoke('download_to_path', { url, path: savePath });
        showAlert('Голосовое сообщение сохранено');
      } else {
        await invoke('download', { url, name: defaultName });
        showAlert('Загрузка в папку загрузок начата');
      }
    } catch (err) {
      try {
        await invoke('download', { url, name: `voice_${mId}.ogg` });
        showAlert('Загрузка в папку загрузок начата');
      } catch (e) {
        showAlert('Не удалось скачать файл');
      }
    }
  }


  onDestroy(() => {
    if (isCurrentTrack && audioEl) {
      try { audioEl.pause(); } catch {}
      const state = $activeMedia;
      handOffToGlobal({
        ...(state || {}),
        id: mId,
        type: 'voice',
        currentTime: audioEl.currentTime || 0,
        isPlaying: !audioEl.paused,
      });
    }
  });
</script>

<div class="voice-message-bubble" class:is-me={isMe}>
  <audio
    bind:this={audioEl}
    src={mediaUrl}
    preload="auto"
    on:timeupdate={() => {
      if (isCurrentTrack && audioEl) {
        updateMediaProgress(mId, audioEl.currentTime, audioEl.duration || duration);
      }
    }}
    on:play={() => {
      if (isCurrentTrack) updateMediaPlaybackState(mId, true);
    }}
    on:pause={() => {
      if (isCurrentTrack) updateMediaPlaybackState(mId, false);
    }}
    on:ended={() => {
      if (isCurrentTrack) playNextMedia();
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
