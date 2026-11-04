<script>
  import { createEventDispatcher, onDestroy } from "svelte";

  export let videoDuration = 0;
  export let currentTime = 0;
  export let trimStart = 0;
  export let trimEnd = 0;
  export let maxDuration = 60;

  const dispatch = createEventDispatcher();

  let trackEl = null;
  let dragMode = null;

  $: selectedLength = Math.max(0, trimEnd - trimStart);
  $: safeDuration = Math.max(0.1, videoDuration);

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? "0" : ""}${rem}`;
  }

  function getTimeFromEvent(e) {
    if (!trackEl) return 0;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * safeDuration;
  }

  function handlePointerDown(e) {
    if (!trackEl || !videoDuration) return;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) return;

    const clickPx = e.clientX - rect.left;
    const startPx = (trimStart / safeDuration) * rect.width;
    const endPx = (trimEnd / safeDuration) * rect.width;
    const tolerance = 22;

    const distStart = Math.abs(clickPx - startPx);
    const distEnd = Math.abs(clickPx - endPx);

    if (distStart <= tolerance && distStart <= distEnd) {
      dragMode = "start";
    } else if (distEnd <= tolerance) {
      dragMode = "end";
    } else {
      dragMode = "scrub";
      const clickTime = Math.max(0, Math.min(videoDuration, (clickPx / rect.width) * safeDuration));
      dispatch("seek", { time: clickTime });
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handlePointerMove(e) {
    if (!dragMode) return;
    const posTime = getTimeFromEvent(e);

    if (dragMode === "start") {
      trimStart = Math.max(0, Math.min(posTime, trimEnd - 0.5));
      if (trimEnd - trimStart > maxDuration) {
        trimEnd = trimStart + maxDuration;
      }
      dispatch("seek", { time: trimStart });
      dispatch("change", { trimStart, trimEnd, duration: trimEnd - trimStart });
    } else if (dragMode === "end") {
      trimEnd = Math.min(videoDuration, Math.max(posTime, trimStart + 0.5));
      if (trimEnd - trimStart > maxDuration) {
        trimStart = Math.max(0, trimEnd - maxDuration);
      }
      dispatch("seek", { time: trimEnd });
      dispatch("change", { trimStart, trimEnd, duration: trimEnd - trimStart });
    } else if (dragMode === "scrub") {
      const scrubTime = Math.max(0, Math.min(videoDuration, posTime));
      dispatch("seek", { time: scrubTime });
    }
  }

  function handlePointerUp() {
    dragMode = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  }

  onDestroy(() => {
    handlePointerUp();
  });
</script>

<div class="timeline-trimmer-box">
  <div class="timeline-labels">
    <span>{formatTime(trimStart)}</span>
    <span class="length-pill">{Math.round(selectedLength)}с</span>
    <span>{formatTime(trimEnd)}</span>
  </div>

  <div
    bind:this={trackEl}
    class="timeline-track"
    on:pointerdown={handlePointerDown}
    role="presentation"
  >
    <div
      class="timeline-range-highlight"
      style="left: {(trimStart / safeDuration) * 100}%; width: {((trimEnd - trimStart) / safeDuration) * 100}%;"
    ></div>

    <div
      class="trim-handle trim-handle-left"
      style="left: {(trimStart / safeDuration) * 100}%;"
    >
      <div class="handle-bracket bracket-left">
        <span class="grip-line"></span>
      </div>
    </div>

    <div
      class="trim-handle trim-handle-right"
      style="left: {(trimEnd / safeDuration) * 100}%;"
    >
      <div class="handle-bracket bracket-right">
        <span class="grip-line"></span>
      </div>
    </div>

    <div
      class="timeline-playhead"
      style="left: {(currentTime / safeDuration) * 100}%;"
    ></div>
  </div>
</div>

<style>
  .timeline-trimmer-box {
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    user-select: none;
    touch-action: none;
  }

  .timeline-labels {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    padding: 0 4px;
  }

  .length-pill {
    background: #2481cc;
    color: #ffffff;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
  }

  .timeline-track {
    position: relative;
    width: 100%;
    height: 40px;
    background: #1c1d22;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .timeline-range-highlight {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(36, 129, 204, 0.35);
    border-top: 2px solid #2481cc;
    border-bottom: 2px solid #2481cc;
    pointer-events: none;
    box-sizing: border-box;
  }

  .trim-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 28px;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: ew-resize;
    z-index: var(--z-floating, 5);
  }

  .handle-bracket {
    width: 14px;
    height: 100%;
    background: #3b82f6;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
    box-sizing: border-box;
  }
  .bracket-left {
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
  }
  .bracket-right {
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
  }

  .grip-line {
    width: 2px;
    height: 14px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 1px;
  }

  .timeline-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-50%);
    background: #ffffff;
    pointer-events: none;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.9);
    z-index: var(--z-header, 4);
    will-change: left;
  }
</style>
