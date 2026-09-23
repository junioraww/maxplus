<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { generateWaveformFromAmplitudes } from "$lib/utils/waveform.js";

  export let reviewAudioUrl = null;
  export let reviewAudioDuration = 0;
  export let reviewAmplitudes = [];
  export let reviewAudioBlob = null;

  const dispatch = createEventDispatcher();

  let reviewAudioEl;
  let reviewAudioPlaying = false;
  let reviewAudioCurrentTime = 0;
  let reviewAudioTrimStart = 0;
  let reviewAudioTrimEnd = reviewAudioDuration;

  $: if (reviewAudioDuration > 0 && reviewAudioTrimEnd === 0) {
    reviewAudioTrimEnd = reviewAudioDuration;
  }

  $: voiceReviewBars = Array.from(generateWaveformFromAmplitudes(reviewAmplitudes, 60));
  $: voiceProgress = reviewAudioDuration > 0
    ? Math.min(1, Math.max(0, (reviewAudioCurrentTime - reviewAudioTrimStart) / Math.max(0.01, (reviewAudioTrimEnd - reviewAudioTrimStart))))
    : 0;

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  function handleLoadedMetadata() {
    if (reviewAudioEl && isFinite(reviewAudioEl.duration) && reviewAudioEl.duration > 0) {
      const d = reviewAudioEl.duration;
      if (d > reviewAudioDuration) {
        reviewAudioDuration = d;
        if (reviewAudioTrimEnd >= d - 0.5 || reviewAudioTrimEnd === 0) {
          reviewAudioTrimEnd = d;
        }
      }
    }
  }

  function toggleVoiceReviewPlay() {
    if (!reviewAudioEl) return;
    if (reviewAudioPlaying) {
      reviewAudioEl.pause();
      reviewAudioPlaying = false;
    } else {
      if (reviewAudioEl.currentTime < reviewAudioTrimStart || reviewAudioEl.currentTime >= reviewAudioTrimEnd - 0.1) {
        reviewAudioEl.currentTime = reviewAudioTrimStart;
      }
      reviewAudioEl.play().catch(() => {});
      reviewAudioPlaying = true;
    }
  }

  function handleVoiceReviewTimeUpdate() {
    if (!reviewAudioEl) return;
    reviewAudioCurrentTime = reviewAudioEl.currentTime;
    if (reviewAudioEl.currentTime >= reviewAudioTrimEnd) {
      reviewAudioEl.pause();
      reviewAudioPlaying = false;
      reviewAudioEl.currentTime = reviewAudioTrimStart;
      reviewAudioCurrentTime = reviewAudioTrimStart;
    }
  }

  function handleVoiceTrimStartChange(e) {
    const val = parseFloat(e.target.value);
    if (val >= reviewAudioTrimEnd - 0.3) {
      reviewAudioTrimStart = Math.max(0, reviewAudioTrimEnd - 0.3);
    } else {
      reviewAudioTrimStart = val;
    }
    if (reviewAudioEl) reviewAudioEl.currentTime = reviewAudioTrimStart;
  }

  function handleVoiceTrimEndChange(e) {
    const val = parseFloat(e.target.value);
    if (val <= reviewAudioTrimStart + 0.3) {
      reviewAudioTrimEnd = Math.min(reviewAudioDuration, reviewAudioTrimStart + 0.3);
    } else {
      reviewAudioTrimEnd = val;
    }
  }

  function discard() {
    if (reviewAudioEl) {
      reviewAudioEl.pause();
    }
    reviewAudioPlaying = false;
    dispatch("discard");
  }

  function send() {
    if (reviewAudioEl) {
      reviewAudioEl.pause();
    }
    reviewAudioPlaying = false;
    dispatch("send", {
      reviewAudioBlob,
      reviewAudioTrimStart,
      reviewAudioTrimEnd,
      reviewAudioDuration,
      reviewAmplitudes,
    });
  }

  onDestroy(() => {
    if (reviewAudioEl) {
      reviewAudioEl.pause();
    }
  });
</script>

<div class="voice-review-panel" transition:fade={{ duration: 180 }}>
  <audio
    bind:this={reviewAudioEl}
    src={reviewAudioUrl}
    on:loadedmetadata={handleLoadedMetadata}
    on:timeupdate={handleVoiceReviewTimeUpdate}
    on:ended={() => { reviewAudioPlaying = false; }}
    preload="auto"
  ></audio>

  <button class="review-action-btn trash" type="button" on:click={discard} title="Удалить">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  </button>

  <div class="voice-review-content">
    <button class="voice-review-play-btn" type="button" on:click={toggleVoiceReviewPlay}>
      {#if reviewAudioPlaying}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      {/if}
    </button>

    <div class="voice-review-wave-wrap">
      <svg class="voice-review-wave-svg" viewBox="0 0 {Math.max(1, voiceReviewBars.length * 3)} 24" preserveAspectRatio="none">
        {#each voiceReviewBars as bar, i}
          {@const h = Math.max(2, Math.round(bar * 22))}
          {@const played = (i + 0.5) / voiceReviewBars.length <= voiceProgress}
          <rect x={i * 3} y={(24 - h) / 2} width="2" height={h} rx="1" fill={played ? '#38bdf8' : 'rgba(255,255,255,0.3)'} />
        {/each}
      </svg>
      <div class="trim-sliders" style="position:relative;height:20px;margin-top:4px;">
        <input type="range" min="0" max={reviewAudioDuration} step="0.05"
          bind:value={reviewAudioTrimStart} on:input={handleVoiceTrimStartChange}
          class="trim-slider trim-slider-start" aria-label="Начало" />
        <input type="range" min="0" max={reviewAudioDuration} step="0.05"
          bind:value={reviewAudioTrimEnd} on:input={handleVoiceTrimEndChange}
          class="trim-slider trim-slider-end" aria-label="Конец" />
      </div>
      <div class="review-trim-times" style="font-size:10px;display:flex;justify-content:space-between;color:rgba(255,255,255,0.5);margin-top:2px;">
        <span>{formatSeconds(reviewAudioTrimStart)}</span>
        <span style="color:#248bfe;font-weight:600;">{(reviewAudioTrimEnd - reviewAudioTrimStart).toFixed(1)}s</span>
        <span>{formatSeconds(reviewAudioTrimEnd)}</span>
      </div>
    </div>
  </div>

  <button class="review-action-btn send" type="button" on:click={send} title="Отправить">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  </button>
</div>

<style>
  .voice-review-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 10px;
    min-height: 48px;
    box-sizing: border-box;
  }

  .voice-review-content {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .voice-review-play-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #3b82f6;
    border: none;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .voice-review-wave-wrap {
    flex: 1;
    min-width: 0;
  }

  .voice-review-wave-svg {
    width: 100%;
    height: 24px;
    display: block;
  }

  .review-action-btn {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, background-color 0.15s;
    flex-shrink: 0;
  }

  .review-action-btn:hover {
    transform: scale(1.08);
  }

  .review-action-btn.trash {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .review-action-btn.trash:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .review-action-btn.send {
    background: #248bfe;
    color: #fff;
  }

  .review-action-btn.send:hover {
    background: #1b7cf0;
  }

  .trim-sliders {
    position: relative;
    height: 20px;
    display: flex;
    align-items: center;
  }

  .trim-slider {
    position: absolute;
    width: 100%;
    pointer-events: none;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    height: 6px;
    margin: 0;
  }

  .trim-slider::-webkit-slider-runnable-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .trim-slider::-webkit-slider-thumb {
    pointer-events: auto;
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #248bfe;
    cursor: ew-resize;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
    margin-top: -5px;
  }

  .trim-slider-end {
    z-index: 2;
  }

  .trim-slider-end::-webkit-slider-runnable-track {
    background: transparent;
  }

  .review-trim-times {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }
</style>
