<script>
  import { activeCall, patchCallState, CALL_PHASE } from '$lib/stores/calls.js';
  import { CallService } from '$lib/services/CallService.js';
  import { scale, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  let elapsed = 0;
  let elapsedTimer;
  let x = null;
  let y = null;
  let isDragging = false;
  let didMove = false;
  let dragStartX, dragStartY, startX, startY;

  $: ({ phase, peerName, peerAvatar, muted, videoOn, remoteStream, startedAt } = $activeCall);
  $: visible = phase === CALL_PHASE.ACTIVE || phase === CALL_PHASE.CONNECTING;

  $: if (phase === CALL_PHASE.ACTIVE && !elapsedTimer) {
    elapsedTimer = setInterval(() => { elapsed = Math.floor((Date.now() - startedAt) / 1000); }, 1000);
  } else if (phase !== CALL_PHASE.ACTIVE) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
    elapsed = 0;
  }

  function formatDuration(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    isDragging = true;
    didMove = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startX = x ?? 16;
    startY = y ?? (window.innerHeight - 88);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      didMove = true;
    }
    x = Math.max(8, Math.min(window.innerWidth - 180, startX + dx));
    y = Math.max(8, Math.min(window.innerHeight - 80, startY + dy));
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  function handleBadgeClick(e) {
    if (didMove) {
      didMove = false;
      return;
    }
    patchCallState({ minimized: false });
  }

  async function quickHangup(e) {
    e.stopPropagation();
    e.preventDefault();
    await CallService.hangup();
  }

  async function quickMute(e) {
    e.stopPropagation();
    e.preventDefault();
    await CallService.toggleMute();
  }
</script>

{#if visible}
  <div
    class="floating-badge"
    style="left: {x ?? 16}px; top: {y ?? (typeof window !== 'undefined' ? window.innerHeight - 88 : 600)}px"
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:click={handleBadgeClick}
    role="button"
    tabindex="0"
    in:scale={{ start: 0.8, duration: 240, easing: cubicOut }}
    out:scale={{ start: 0.8, duration: 180, easing: cubicOut }}
    aria-label="Вернуться к звонку"
  >
    <div class="badge-avatar" style={peerAvatar ? `background-image: url('${peerAvatar}')` : ''}>
      {#if !peerAvatar}
        <span>{(peerName || '?')[0].toUpperCase()}</span>
      {/if}
      <div class="pulsing-ring" class:active={phase === CALL_PHASE.ACTIVE}></div>
    </div>

    <div class="badge-info">
      <span class="badge-name">{peerName || 'Звонок'}</span>
      <span class="badge-time">
        {#if phase === CALL_PHASE.ACTIVE}
          {formatDuration(elapsed)}
        {:else}
          Подключение...
        {/if}
      </span>
    </div>

    <div class="badge-actions">
      <button
        type="button"
        class="badge-btn"
        class:badge-btn--muted={muted}
        on:pointerdown|stopPropagation
        on:pointerup|stopPropagation
        on:click|stopPropagation={quickMute}
        aria-label={muted ? 'Unmute' : 'Mute'}
      >
        {#if muted}
          <img src="/icons/mic-off.svg" alt="" width="16" height="16" />
        {:else}
          <img src="/icons/mic.svg" alt="" width="16" height="16" />
        {/if}
      </button>
      <button
        type="button"
        class="badge-btn badge-btn--hangup"
        on:pointerdown|stopPropagation
        on:pointerup|stopPropagation
        on:click|stopPropagation={quickHangup}
        aria-label="Hang up"
      >
        <img src="/icons/call-end.svg" alt="" width="16" height="16" />
      </button>
    </div>
  </div>
{/if}

<style>
  .floating-badge {
    position: fixed;
    z-index: 900;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    min-height: 56px;
    background: #1c1d24;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 28px;
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.45);
    cursor: pointer;
    touch-action: none;
    min-width: 180px;
    user-select: none;
    box-sizing: border-box;
  }

  .badge-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #2a2a3e;
    background-size: cover;
    background-position: center;
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: visible;
  }

  .badge-avatar span {
    font-size: 14px;
    font-weight: 700;
    color: #fff;
  }

  .pulsing-ring {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid transparent;
    transition: border-color 0.3s;
  }

  .pulsing-ring.active {
    border-color: #22c55e;
    animation: badgePulse 2s ease-in-out infinite;
  }

  @keyframes badgePulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .badge-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .badge-name {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-time {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    font-variant-numeric: tabular-nums;
  }

  .badge-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .badge-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.10);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
  }

  .badge-btn:active { transform: scale(0.88); }
  .badge-btn--muted { background: rgba(239, 68, 68, 0.20); color: #ef4444; }
  .badge-btn--hangup { background: rgba(239,68,68,0.85); }
  .badge-btn--hangup:hover { background: #ef4444; }
</style>
