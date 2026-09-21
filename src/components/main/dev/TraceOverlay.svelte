<script>
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import {
    isTracing,
    traceEventCount,
    traceStartTime,
    traceSize,
    stopTraceAndExport,
  } from "$lib/services/trace";

  let x = 20;
  let y = 80;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialX = 0;
  let initialY = 0;
  let hasMoved = false;

  let elapsedSec = 0;
  let timerInterval = null;

  $: if ($isTracing) {
    if (!timerInterval) {
      elapsedSec = 0;
      timerInterval = setInterval(() => {
        if ($traceStartTime) {
          elapsedSec = Math.floor((Date.now() - $traceStartTime) / 1000);
        }
      }, 1000);
    }
  } else {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    elapsedSec = 0;
  }

  onDestroy(() => {
    if (timerInterval) clearInterval(timerInterval);
    removeDragListeners();
  });

  function formatTime(s) {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function handlePointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    isDragging = true;
    hasMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialX = x;
    initialY = y;

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasMoved = true;
    }

    const maxX = (window.innerWidth || 400) - 70;
    const maxY = (window.innerHeight || 700) - 70;

    x = Math.max(10, Math.min(maxX, initialX + dx));
    y = Math.max(10, Math.min(maxY, initialY + dy));
  }

  function handlePointerUp(e) {
    removeDragListeners();
    if (!hasMoved) {
      handleClick();
    }
    isDragging = false;
  }

  function removeDragListeners() {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  }

  async function handleClick() {
    await stopTraceAndExport();
  }
</script>

{#if $isTracing}
  <div
    class="trace-bubble"
    style="left: {x}px; top: {y}px;"
    on:pointerdown={handlePointerDown}
    transition:fade={{ duration: 150 }}
    role="button"
    tabindex="0"
  >
    <div class="stop-btn">
      <div class="stop-icon"></div>
    </div>
    <div class="meta">
      <span class="timer">{formatTime(elapsedSec)}</span>
      <span class="badge">{$traceEventCount}</span>
    </div>
  </div>
{/if}

<style>
  .trace-bubble {
    position: fixed;
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(24, 24, 28, 0.94);
    border: 1.5px solid rgba(239, 68, 68, 0.7);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45), 0 0 16px rgba(239, 68, 68, 0.35);
    border-radius: 30px;
    padding: 6px 14px 6px 8px;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .trace-bubble:active {
    cursor: grabbing;
  }

  .stop-btn {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: #ef4444;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.8);
    animation: pulse-opacity 1.6s ease-in-out infinite;
    flex-shrink: 0;
  }

  .stop-icon {
    width: 14px;
    height: 14px;
    background: white;
    border-radius: 3px;
  }

  .meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    font-family: monospace;
    line-height: 1.1;
  }

  .timer {
    font-size: 13px;
    font-weight: 700;
    color: #f87171;
  }

  .badge {
    font-size: 11px;
    color: #9ca3af;
  }

  @keyframes pulse-opacity {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.35;
      transform: scale(0.94);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
