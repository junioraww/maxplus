<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";

  export let reviewVideoUrl = null;
  export let reviewVideoDuration = 0;
  export let reviewVideoBlob = null;

  const dispatch = createEventDispatcher();

  let reviewVideoEl;
  let isReviewPlaying = true;
  let isReviewMuted = false;
  let reviewCurrentTime = 0;
  let reviewTrimStart = 0;
  let reviewTrimEnd = reviewVideoDuration;

  $: if (reviewVideoDuration > 0 && reviewTrimEnd === 0) {
    reviewTrimEnd = reviewVideoDuration;
  }

  $: reviewDur = Math.max(0.01, reviewTrimEnd - reviewTrimStart);
  $: reviewProgress = reviewDur > 0 ? Math.min(1, Math.max(0, (reviewCurrentTime - reviewTrimStart) / reviewDur)) : 0;
  const ringSize = 200;
  const ringStroke = 4;
  const ringRadius = (ringSize - ringStroke) / 2;
  const ringCirc = 2 * Math.PI * ringRadius;

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  function handleLoadedMetadata() {
    if (reviewVideoEl && isFinite(reviewVideoEl.duration) && reviewVideoEl.duration > 0) {
      const d = reviewVideoEl.duration;
      if (d > reviewVideoDuration) {
        reviewVideoDuration = d;
        if (reviewTrimEnd >= d - 0.5 || reviewTrimEnd === 0) {
          reviewTrimEnd = d;
        }
      }
    }
  }

  function handleReviewTimeUpdate() {
    if (!reviewVideoEl) return;
    reviewCurrentTime = reviewVideoEl.currentTime;
    if (reviewVideoEl.currentTime >= reviewTrimEnd) {
      reviewVideoEl.currentTime = reviewTrimStart;
    }
  }

  function toggleReviewPlay() {
    if (!reviewVideoEl) return;
    if (isReviewPlaying) {
      reviewVideoEl.pause();
      isReviewPlaying = false;
    } else {
      if (reviewVideoEl.currentTime < reviewTrimStart || reviewVideoEl.currentTime >= reviewTrimEnd) {
        reviewVideoEl.currentTime = reviewTrimStart;
      }
      reviewVideoEl.play().catch(() => {});
      isReviewPlaying = true;
    }
  }

  function handleTrimStartChange(e) {
    const val = parseFloat(e.target.value);
    if (val >= reviewTrimEnd - 0.5) {
      reviewTrimStart = Math.max(0, reviewTrimEnd - 0.5);
    } else {
      reviewTrimStart = val;
    }
    if (reviewVideoEl) reviewVideoEl.currentTime = reviewTrimStart;
  }

  function handleTrimEndChange(e) {
    const val = parseFloat(e.target.value);
    if (val <= reviewTrimStart + 0.5) {
      reviewTrimEnd = Math.min(reviewVideoDuration, reviewTrimStart + 0.5);
    } else {
      reviewTrimEnd = val;
    }
  }

  function discard() {
    if (reviewVideoEl) {
      reviewVideoEl.pause();
    }
    dispatch("discard");
  }

  function send() {
    if (reviewVideoEl) {
      reviewVideoEl.pause();
    }
    dispatch("send", {
      reviewVideoBlob,
      reviewTrimStart,
      reviewTrimEnd,
      reviewVideoDuration,
      isReviewMuted,
    });
  }

  onDestroy(() => {
    if (reviewVideoEl) {
      reviewVideoEl.pause();
    }
  });
</script>

<div class="video-review-circle-wrap" transition:scale={{ duration: 220, start: 0.85 }}>
  <svg class="review-progress-ring" width={ringSize} height={ringSize} style="position:absolute;top:0;left:0;z-index:10;transform:rotate(-90deg);pointer-events:none;">
    <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} stroke="rgba(255,255,255,0.15)" stroke-width={ringStroke} fill="none" />
    <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} stroke="#38bdf8" stroke-width={ringStroke} fill="none"
      stroke-linecap="round"
      stroke-dasharray={ringCirc}
      stroke-dashoffset={ringCirc - reviewProgress * ringCirc}
    />
  </svg>
  <div class="video-review-circle-container" on:click={toggleReviewPlay} role="button" tabindex="0" on:keydown={(e) => { if (e.key === ' ' || e.key === 'Enter') toggleReviewPlay(); }}>
    <video
      bind:this={reviewVideoEl}
      src={reviewVideoUrl}
      autoplay
      playsinline
      muted={isReviewMuted}
      on:loadedmetadata={handleLoadedMetadata}
      on:timeupdate={handleReviewTimeUpdate}
      on:ended={() => {
        if (reviewVideoEl) {
          reviewVideoEl.currentTime = reviewTrimStart;
          reviewVideoEl.play().catch(() => {});
        }
      }}
      class="video-review-circle"
    ></video>
    {#if !isReviewPlaying}
      <div class="video-review-play-overlay">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
          <polygon points="8,5 19,12 8,19"/>
        </svg>
      </div>
    {/if}
  </div>
</div>

<div class="video-review-controls-bar" transition:fade={{ duration: 180 }}>
  <button class="review-action-btn trash" type="button" on:click={discard} title="Удалить">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  </button>

  <div class="review-trim-container">
    <div class="review-trim-times">
      <span>{formatSeconds(reviewTrimStart)}</span>
      <span class="review-trim-duration">{(reviewTrimEnd - reviewTrimStart).toFixed(1)}s</span>
      <span>{formatSeconds(reviewTrimEnd)}</span>
    </div>
    <div class="trim-sliders">
      <input
        type="range"
        min="0"
        max={reviewVideoDuration}
        step="0.05"
        bind:value={reviewTrimStart}
        on:input={handleTrimStartChange}
        class="trim-slider trim-slider-start"
        aria-label="Начало обрезки"
      />
      <input
        type="range"
        min="0"
        max={reviewVideoDuration}
        step="0.05"
        bind:value={reviewTrimEnd}
        on:input={handleTrimEndChange}
        class="trim-slider trim-slider-end"
        aria-label="Конец обрезки"
      />
    </div>
  </div>

  <button class="review-action-btn mute" type="button" on:click={() => (isReviewMuted = !isReviewMuted)} title={isReviewMuted ? "Включить звук" : "Выключить звук"}>
    {#if isReviewMuted}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.78 4.78H4v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    {/if}
  </button>

  <button class="review-action-btn send" type="button" on:click={send} title="Отправить">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>
  </button>
</div>

<style>
  .video-review-circle-wrap {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 200px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .video-review-circle-container {
    position: relative;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    border: 3px solid #248bfe;
    cursor: pointer;
    background: #000;
  }

  .video-review-circle {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .video-review-play-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    border: none;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .video-review-controls-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px 10px;
    background-color: #17191d;
    box-sizing: border-box;
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

  .review-action-btn.mute {
    background: #262930;
    color: #94a3b8;
  }

  .review-action-btn.mute:hover {
    background: #323640;
    color: #edf0f5;
  }

  .review-action-btn.send {
    background: #248bfe;
    color: #fff;
  }

  .review-action-btn.send:hover {
    background: #1b7cf0;
  }

  .review-trim-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .review-trim-times {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }

  .review-trim-duration {
    font-weight: 600;
    color: #248bfe;
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
</style>
