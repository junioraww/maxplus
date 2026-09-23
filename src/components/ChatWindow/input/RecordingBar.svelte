<script>
  import { createEventDispatcher } from "svelte";

  export let recordMode = "voice";
  export let elapsedMs = 0;
  export let liveAmplitudes = [];
  export let isLocked = false;
  export let cancelDrag = 0;
  export let lockDrag = 0;

  const dispatch = createEventDispatcher();

  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function handleCancel() {
    dispatch("cancel");
  }

  function handleStopLocked() {
    dispatch("stopLocked");
  }

  function handleSendLocked() {
    dispatch("sendLocked");
  }
</script>

<div class="recording-bar">
  <div class="rec-dot"></div>
  <span class="rec-timer">{formatElapsed(elapsedMs)}</span>
  {#if recordMode === 'voice'}
    <svg class="rec-wave-svg" viewBox="0 0 {Math.max(1, liveAmplitudes.length * 3)} 24" preserveAspectRatio="none">
      {#each liveAmplitudes as amp, i}
        {@const h = Math.max(2, Math.round((amp / 255) * 22))}
        <rect x={i * 3} y={(24 - h) / 2} width="2" height={h} rx="1" fill="#248bfe" />
      {/each}
    </svg>
  {:else}
    <span class="rec-video-label">Запись видеосообщения</span>
  {/if}
  {#if !isLocked}
    <div class="rec-cancel-slide" style="transform: translateX(-{cancelDrag * 0.3}px)">
      <span class="rec-slide-chevron">‹</span>
      <span>Проведите для отмены</span>
    </div>
    <div class="rec-lock-slide" class:reached={lockDrag >= 60}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
      </svg>
    </div>
  {:else}
    <button class="rec-trash-btn" type="button" on:click={handleCancel} title="Удалить">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>
    </button>
    {#if recordMode === 'video'}
      <button class="rec-stop-btn" type="button" on:click={handleStopLocked} title="Остановить и просмотреть">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" ry="2"/>
        </svg>
      </button>
    {/if}
  {/if}
</div>

{#if isLocked}
  <button class="button send-button" type="button" on:click={handleSendLocked} title="Отправить">
    <svg viewBox="0 0 24 24" width="22" height="22">
      <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  </button>
{:else}
  <div class="button recording-pulse-btn">
    {#if recordMode === 'voice'}
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
        <path d="M15.5 5.5C15.5 3.567 13.933 2 12 2C10.067 2 8.5 3.567 8.5 5.5V12C8.5 13.933 10.067 15.5 12 15.5C13.933 15.5 15.5 13.933 15.5 12V5.5Z"/>
        <path d="M4.5 11.5C4.5 15.642 7.858 19 12 19M12 19C16.142 19 19.5 15.642 19.5 11.5M12 19V22"/>
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
      </svg>
    {/if}
  </div>
{/if}

<style>
  .recording-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: #1e2025;
    border-radius: 18px;
    flex: 1 1 0%;
    min-width: 0;
    max-width: 100%;
    min-height: 48px;
    padding: 0 12px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
    animation: rec-blink 1s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes rec-blink {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  .rec-timer {
    font-size: 14px;
    font-weight: 600;
    color: #edf0f5;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .rec-wave-svg {
    flex: 1 1 0%;
    width: 0;
    min-width: 0;
    max-width: 100%;
    height: 24px;
    overflow: hidden;
  }

  .rec-video-label {
    font-size: 13px;
    color: #94a3b8;
    flex: 1 1 0%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rec-cancel-slide {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #64748b;
    white-space: nowrap;
    transition: transform 0.05s linear;
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rec-slide-chevron {
    font-size: 16px;
    animation: slide-chevron 1.2s infinite;
    flex-shrink: 0;
  }

  @keyframes slide-chevron {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(-4px); }
  }

  .rec-lock-slide {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: #94a3b8;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .rec-lock-slide.reached {
    background: #248bfe;
    color: #fff;
  }

  .rec-trash-btn {
    background: transparent;
    border: none;
    color: #ef4444;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    flex-shrink: 0;
  }

  .rec-trash-btn:hover {
    background: rgba(239, 68, 68, 0.15);
  }

  .rec-stop-btn {
    background: transparent;
    border: none;
    color: #edf0f5;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }

  .rec-stop-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .button {
    border: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    color: #8b929e;
    transition: all 0.18s ease;
  }

  .send-button {
    color: #248bfe;
    background: rgba(36, 139, 254, 0.12);
  }

  .send-button:hover {
    color: #fff;
    background: #248bfe;
  }

  .recording-pulse-btn {
    background: #248bfe;
    color: #fff;
    animation: rec-btn-pulse 1.5s infinite;
    flex-shrink: 0;
  }

  @keyframes rec-btn-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
</style>
