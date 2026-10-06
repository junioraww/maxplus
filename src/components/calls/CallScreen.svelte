<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { fly, fade, scale } from 'svelte/transition';
  import { cubicOut, cubicInOut } from 'svelte/easing';
  import { get } from 'svelte/store';

  import { activeCall, patchCallState, resetCallState, CALL_PHASE, CALL_MODE } from '$lib/stores/calls.js';
  import { currentUserDetails } from '$lib/stores/api.js';
  import { CallService } from '$lib/services/CallService.js';
  import ParticipantGrid from '$components/calls/ParticipantGrid.svelte';

  function srcObject(node, stream) {
    node.srcObject = stream || null;
    if (stream) {
      node.play().catch(() => {});
    }
    return {
      update(newStream) {
        if (node.srcObject !== newStream) {
          node.srcObject = newStream || null;
          if (newStream) {
            node.play().catch(() => {});
          }
        }
      },
      destroy() {
        node.srcObject = null;
      }
    };
  }

  let phase, callType, mode, peerName, peerAvatar, muted, videoOn, screenOn, speakerOn, isGroup, roomName;
  let remoteStream, localCameraStream, localScreenStream;
  let startedAt, secureKeyFingerprint, secureStatus;
  let errorText, connectionStatus, serverTopology, conversationId, cameraLoading, peerVideoOn, peerScreenOn;
  let showDebug = false;

  $: ({
    phase, callType, mode, peerName, peerAvatar,
    muted, videoOn, screenOn, speakerOn, isGroup, roomName,
    remoteStream, localCameraStream, localScreenStream,
    startedAt, secureKeyFingerprint, secureStatus,
    errorText, connectionStatus, serverTopology, conversationId, cameraLoading,
    peerVideoOn, peerScreenOn,
  } = $activeCall);

  let remoteAudioEl;
  let elapsed = 0;
  let elapsedTimer;
  let controlsVisible = true;
  let hideTimer;
  let pipX = null;
  let pipY = null;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let pipStartX = 0;
  let pipStartY = 0;
  let dragDistance = 0;
  let dragStartTime = 0;

  $: isRinging = phase === CALL_PHASE.INCOMING || phase === CALL_PHASE.OUTGOING;
  $: isActive = phase === CALL_PHASE.ACTIVE;
  $: isConnecting = phase === CALL_PHASE.CONNECTING;

  $: isSwapped = Boolean($activeCall.swapped);
  $: hasRemoteVideo = Boolean(
    remoteStream &&
    remoteStream.getVideoTracks &&
    remoteStream.getVideoTracks().some(t => t.readyState === 'live' && t.enabled) &&
    (peerVideoOn || peerScreenOn || ($activeCall.participants && $activeCall.participants.some(p => p.id !== $activeCall.myCallUserId && (p.videoOn || p.screenOn))))
  );
  $: hasLocalVideo = Boolean((videoOn || screenOn || cameraLoading) && (localCameraStream || localScreenStream || cameraLoading));
  $: localEffectiveStream = screenOn ? localScreenStream : localCameraStream;
  $: isGroupCall = Boolean(isGroup || ($activeCall.participants && $activeCall.participants.length > 1));
  $: showVideo = (hasLocalVideo || hasRemoteVideo) && isActive;
  $: mainVideoActive = isActive && (!isSwapped ? (hasRemoteVideo || (screenOn && localScreenStream)) : hasLocalVideo);
  $: showPip = !isGroupCall && isActive && (hasRemoteVideo ? hasLocalVideo : (screenOn ? (videoOn && Boolean(localCameraStream)) : hasLocalVideo));
  $: isSecure = mode === CALL_MODE.SECURE && secureStatus === 'active' && isActive;

  $: if (remoteAudioEl && remoteStream) {
    if (remoteAudioEl.srcObject !== remoteStream) {
      remoteAudioEl.srcObject = remoteStream;
      remoteAudioEl.play()
        .then(() => {
          console.log('[call] remote audio playback started');
        })
        .catch(err => {
          console.warn('[call] remote audio playback error:', err?.message || err);
        });
    }
  }

  $: if (isActive) {
    if (!startedAt) {
      patchCallState({ startedAt: Date.now() });
    }
    if (!elapsedTimer) {
      elapsedTimer = setInterval(() => {
        const start = get(activeCall).startedAt || Date.now();
        const diff = Math.floor((Date.now() - start) / 1000);
        elapsed = diff > 0 && diff < 86400 * 365 ? diff : 0;
      }, 1000);
    }
  }

  function formatDuration(s) {
    if (!s || s <= 0 || !Number.isFinite(s) || s > 86400 * 365) return '00:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function touchControls() {
    controlsVisible = true;
    clearTimeout(hideTimer);
    if (showVideo) {
      hideTimer = setTimeout(() => { controlsVisible = false; }, 4000);
    }
  }

  async function onAccept() {
    await CallService.acceptIncoming();
  }

  async function onDecline(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    resetCallState();
    try {
      CallService.declineIncoming();
    } catch {}
  }

  async function onHangup(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    try {
      await CallService.hangup();
    } catch {}
  }

  async function onToggleMute() {
    await CallService.toggleMute();
  }

  async function onToggleVideo() {
    await CallService.toggleVideo();
  }

  async function onToggleScreen() {
    await CallService.toggleScreen();
  }

  async function onToggleSecure() {
    await CallService.toggleSecure();
  }

  function toggleSwap() {
    patchCallState({ swapped: !isSwapped });
  }

  function onPipPointerDown(e) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragDistance = 0;
    dragStartTime = Date.now();
    pipStartX = pipX ?? (window.innerWidth - 124);
    pipStartY = pipY ?? (window.innerHeight - 200);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPipPointerMove(e) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    dragDistance = Math.hypot(dx, dy);
    pipX = Math.max(8, Math.min(window.innerWidth - 116, pipStartX + dx));
    pipY = Math.max(8, Math.min(window.innerHeight - 192, pipStartY + dy));
  }

  function onPipPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    const duration = Date.now() - dragStartTime;
    if (dragDistance < 10 && duration < 400) {
      toggleSwap();
    }
  }

  onMount(() => {
    touchControls();
  });

  onDestroy(() => {
    clearTimeout(hideTimer);
    clearInterval(elapsedTimer);
    if (remoteAudioEl) {
      remoteAudioEl.srcObject = null;
    }
  });
</script>

<div
  class="call-overlay"
  role="presentation"
  on:pointermove={touchControls}
  on:click={touchControls}
  in:fade={{ duration: 250, easing: cubicOut }}
  out:fade={{ duration: 200, easing: cubicInOut }}
>
  <audio bind:this={remoteAudioEl} autoplay playsinline></audio>

  {#if !isGroupCall}
    {#if !isSwapped}
      {#if hasRemoteVideo && remoteStream}
        <video
          class="remote-video"
          autoplay
          playsinline
          webkit-playsinline
          muted
          use:srcObject={remoteStream}
        ></video>
      {:else if screenOn && localScreenStream}
        <video
          class="remote-video"
          autoplay
          playsinline
          webkit-playsinline
          muted
          use:srcObject={localScreenStream}
        ></video>
      {:else}
        <div class="avatar-backdrop" style={peerAvatar ? `background-image: url('${peerAvatar}')` : ''}>
          <div class="avatar-blur"></div>
        </div>
      {/if}
    {:else}
      {#if hasLocalVideo && localEffectiveStream}
        <video
          class="remote-video"
          class:mirror={!screenOn}
          autoplay
          playsinline
          webkit-playsinline
          muted
          use:srcObject={localEffectiveStream}
        ></video>
      {:else if cameraLoading}
        <div class="camera-loading-backdrop">
          <div class="spinner"></div>
        </div>
      {:else}
        <div
          class="avatar-backdrop"
          style={$currentUserDetails?.avatar || $currentUserDetails?.photo ? `background-image: url('${$currentUserDetails.avatar || $currentUserDetails.photo}')` : ''}
        >
          <div class="avatar-blur"></div>
        </div>
      {/if}
    {/if}

    {#if showPip}
      <div
        class="pip-container"
        style="left: {pipX ?? (window.innerWidth - 124)}px; top: {pipY ?? (window.innerHeight - 200)}px;"
        on:pointerdown={onPipPointerDown}
        on:pointermove={onPipPointerMove}
        on:pointerup={onPipPointerUp}
        role="presentation"
      >
        {#if !isSwapped}
          {#if !hasRemoteVideo && screenOn}
            {#if videoOn && localCameraStream}
              <video
                class="pip-video mirror"
                autoplay
                playsinline
                webkit-playsinline
                muted
                use:srcObject={localCameraStream}
              ></video>
            {:else if videoOn && cameraLoading}
              <div class="pip-fallback">
                <div class="pip-loader">
                  <div class="spinner"></div>
                </div>
              </div>
            {/if}
          {:else if hasLocalVideo && localEffectiveStream}
            <video
              class="pip-video"
              class:mirror={!screenOn}
              autoplay
              playsinline
              webkit-playsinline
              muted
              use:srcObject={localEffectiveStream}
            ></video>
          {:else if cameraLoading}
            <div class="pip-fallback">
              <div class="pip-loader">
                <div class="spinner"></div>
              </div>
            </div>
          {:else}
            <div class="pip-fallback">
              <span class="pip-avatar-fallback">
                {($currentUserDetails?.name || 'Вы')[0].toUpperCase()}
              </span>
            </div>
          {/if}
        {:else}
          {#if hasRemoteVideo && remoteStream}
            <video
              class="pip-video"
              autoplay
              playsinline
              webkit-playsinline
              muted
              use:srcObject={remoteStream}
            ></video>
          {:else}
            <div
              class="pip-fallback"
              style={peerAvatar ? `background-image: url('${peerAvatar}'); background-size: cover; background-position: center;` : ''}
            >
              {#if !peerAvatar}
                <span class="pip-avatar-fallback">
                  {(peerName || '?')[0].toUpperCase()}
                </span>
              {/if}
            </div>
          {/if}
        {/if}

        <button
          class="pip-swap-btn"
          on:click|stopPropagation={toggleSwap}
          aria-label="Поменять местами"
          title="Поменять местами"
        >
          <img src="/icons/reload.svg" alt="" width="14" height="14" />
        </button>
      </div>
    {/if}
  {/if}

  <div class="top-bar" class:visible={controlsVisible || !showVideo}>
    <button class="minimize-btn" on:click={() => patchCallState({ minimized: true })} aria-label="Свернуть">
      <img src="/icons/chevron-down.svg" alt="" width="22" height="22" />
    </button>

    <div class="top-bar-center">
      {#if isGroupCall}
        <span class="group-title-label">{roomName || peerName || 'Групповой звонок'}</span>
        {#if elapsed > 0}
          <span class="duration">{formatDuration(elapsed)}</span>
        {/if}
      {:else}
        <span class="caller-title-label">{peerName || 'Собеседник'}</span>
        {#if isActive}
          <span class="duration">{formatDuration(elapsed)}</span>
        {:else if isConnecting}
          <span class="status-label">Подключение...</span>
        {/if}
      {/if}
    </div>

    <div class="top-bar-right">
      {#if mode === CALL_MODE.SECURE}
        <div class="secure-badge secure-badge--{secureStatus}" title={secureKeyFingerprint ? `Код: ${secureKeyFingerprint}` : 'E2E шифрование'}>
          {#if secureStatus === 'active'}
            <img src="/icons/lock-green.svg" alt="" width="13" height="13" class="lock-icon" />
            <span class="secure-text">Защищено</span>
          {:else if secureStatus === 'unsupported'}
            <img src="/icons/warning.svg" alt="" width="13" height="13" class="lock-icon" />
            <span class="secure-text">Без E2E</span>
          {:else}
            <img src="/icons/pending.svg" alt="" width="13" height="13" class="lock-icon" />
            <span class="secure-text">E2E...</span>
          {/if}
        </div>
      {/if}

      <button class="debug-btn" on:click={() => showDebug = !showDebug} aria-label="Отладка" title="Диагностика связи">
        <img src="/icons/debug.svg" alt="" width="16" height="16" />
      </button>
    </div>
  </div>

  {#if errorText}
    <div class="call-error-banner" in:fly={{ y: -20, duration: 200 }}>
      <img src="/icons/warning.svg" alt="" width="16" height="16" class="error-svg" />
      <span class="error-text">{errorText}</span>
    </div>
  {/if}

  {#if showDebug}
    <div class="debug-backdrop" on:click={() => showDebug = false} role="presentation" in:fade={{ duration: 150 }}>
      <div class="debug-modal" on:click|stopPropagation in:scale={{ start: 0.92, duration: 180, easing: cubicOut }}>
        <div class="debug-modal-header">
          <div class="debug-modal-title">
            <img src="/icons/debug.svg" alt="" width="18" height="18" />
            <span>Диагностика звонка</span>
          </div>
          <button class="debug-close-btn" on:click={() => showDebug = false} aria-label="Закрыть">
            <img src="/icons/close.svg" alt="" width="18" height="18" />
          </button>
        </div>
        <div class="debug-modal-body">
          <div class="debug-item"><span class="debug-label">Фаза:</span> <span class="debug-val">{phase}</span></div>
          <div class="debug-item"><span class="debug-label">Транспорт:</span> <span class="debug-val">{connectionStatus || 'idle'}</span></div>
          <div class="debug-item"><span class="debug-label">Топология:</span> <span class="debug-val">{serverTopology || 'unknown'}</span></div>
          <div class="debug-item"><span class="debug-label">E2E статус:</span> <span class="debug-val {secureStatus === 'active' ? 'text-green' : secureStatus === 'unsupported' ? 'text-red' : ''}">{mode === CALL_MODE.SECURE ? secureStatus : 'plain'}</span></div>
          {#if secureKeyFingerprint}
            <div class="debug-item"><span class="debug-label">Fingerprint:</span> <span class="debug-val debug-val--mono">{secureKeyFingerprint}</span></div>
          {/if}
          <div class="debug-item"><span class="debug-label">Участники:</span> <span class="debug-val">{$activeCall.participants?.length || 0}</span></div>
          <div class="debug-item"><span class="debug-label">Микрофон:</span> <span class="debug-val">{muted ? 'выкл' : 'вкл'}</span> | <span class="debug-label">Камера:</span> <span class="debug-val">{videoOn ? 'вкл' : 'выкл'}</span></div>
          {#if errorText}
            <div class="debug-item debug-item--error"><span class="debug-label">Ошибка:</span> <span class="debug-val">{errorText}</span></div>
          {/if}
          {#if conversationId}
            <div class="debug-item"><span class="debug-label">ID комнаты:</span> <span class="debug-val debug-val--mono">{conversationId}</span></div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if isGroupCall}
    <div class="group-grid-area">
      <ParticipantGrid />
    </div>
  {:else}
    <div class="peer-info" class:hidden={mainVideoActive}>
      {#if peerAvatar}
        <div class="peer-avatar" class:ringing={isRinging} style="background-image: url('{peerAvatar}')">
          {#if isRinging}
            <div class="ring-pulse ring-1"></div>
            <div class="ring-pulse ring-2"></div>
          {/if}
        </div>
      {:else}
        <div class="peer-avatar peer-avatar--fallback" class:ringing={isRinging}>
          <span>{(peerName || '?')[0].toUpperCase()}</span>
          {#if isRinging}
            <div class="ring-pulse ring-1"></div>
            <div class="ring-pulse ring-2"></div>
          {/if}
        </div>
      {/if}
      <p class="peer-name">{isGroupCall ? (roomName || peerName || 'Групповой звонок') : (peerName || 'Собеседник')}</p>
      <p class="call-status">
        {#if phase === CALL_PHASE.OUTGOING}Вызов...
        {:else if phase === CALL_PHASE.INCOMING}{callType === 'video' ? 'Входящий видеозвонок' : 'Входящий звонок'}
        {:else if isConnecting}Подключение...
        {:else if isActive}{callType === 'video' ? 'Видеозвонок' : 'Звонок'}
        {:else}Завершение...{/if}
      </p>
    </div>
  {/if}


  {#if phase === CALL_PHASE.INCOMING}
    <div
      class="incoming-actions"
      in:fly={{ y: 30, duration: 280, easing: cubicOut }}
      out:fade={{ duration: 160 }}
    >
      <button class="action-btn action-btn--decline" on:click={onDecline} aria-label="Decline">
        <img src="/icons/call-end.svg" alt="" width="28" height="28" />
      </button>
      <button class="action-btn action-btn--accept" on:click={onAccept} aria-label="Accept">
        <img src="/icons/call-accept.svg" alt="" width="28" height="28" />
      </button>
    </div>
  {:else}
    <div
      class="control-bar"
      class:visible={controlsVisible || !showVideo}
      in:fly={{ y: 30, duration: 280, easing: cubicOut }}
      out:fade={{ duration: 160 }}
    >
      <div class="controls-inner">
        <button
          class="ctrl-btn"
          class:ctrl-btn--active={muted}
          on:click={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {#if muted}
            <img src="/icons/mic-off.svg" alt="" width="24" height="24" />
          {:else}
            <img src="/icons/mic.svg" alt="" width="24" height="24" />
          {/if}
        </button>

        <button
          class="ctrl-btn"
          class:ctrl-btn--active={!videoOn}
          on:click={onToggleVideo}
          aria-label={videoOn ? 'Stop camera' : 'Start camera'}
        >
          {#if videoOn}
            <img src="/icons/video.svg" alt="" width="24" height="24" />
          {:else}
            <img src="/icons/video-off.svg" alt="" width="24" height="24" />
          {/if}
        </button>

        <button
          class="ctrl-btn"
          class:ctrl-btn--active={screenOn}
          on:click={onToggleScreen}
          aria-label={screenOn ? 'Stop sharing' : 'Share screen'}
        >
          <img src="/icons/screen-share.svg" alt="" width="24" height="24" />
        </button>

        <button
          class="ctrl-btn"
          class:ctrl-btn--secure={isSecure}
          on:click={onToggleSecure}
          aria-label={isSecure ? 'E2E активно' : 'Включить E2E'}
          title={isSecure ? `E2E шифрование активно (код: ${secureKeyFingerprint || 'OK'})` : 'Включить E2E шифрование'}
        >
          {#if isSecure}
            <img src="/icons/shield-check.svg" alt="" width="22" height="22" />
          {:else}
            <img src="/icons/shield.svg" alt="" width="22" height="22" />
          {/if}
        </button>

        <button class="ctrl-btn ctrl-btn--hangup" on:click={onHangup} aria-label="Hang up">
          <img src="/icons/call-end.svg" alt="" width="28" height="28" />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .call-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #0a0a12;
  }

  .group-grid-area {
    position: absolute;
    top: calc(60px + env(safe-area-inset-top, 0px));
    bottom: calc(100px + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    z-index: 1003;
    display: flex;
    flex-direction: column;
  }

  .group-title-label {
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
    letter-spacing: 0.2px;
  }

  .top-bar-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .caller-title-label {
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .top-bar-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .debug-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
  }

  .debug-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
  }

  .call-error-banner {
    position: absolute;
    top: calc(56px + env(safe-area-inset-top, 0px));
    left: 16px;
    right: 16px;
    padding: 10px 14px;
    border-radius: 12px;
    background: rgba(239, 68, 68, 0.92);
    color: #ffffff;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 1020;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }

  .error-svg {
    flex-shrink: 0;
  }

  .error-text {
    font-size: 13px;
    font-weight: 500;
    word-break: break-word;
  }

  .secure-badge--unsupported {
    background: rgba(239, 68, 68, 0.18) !important;
    border-color: rgba(239, 68, 68, 0.4) !important;
    color: #f87171 !important;
  }

  .secure-badge--negotiating {
    background: rgba(234, 179, 8, 0.18) !important;
    border-color: rgba(234, 179, 8, 0.4) !important;
    color: #facc15 !important;
  }

  .debug-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1030;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }

  .debug-modal {
    width: 100%;
    max-width: 360px;
    background: #1c1d25;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 20px;
    padding: 18px;
    box-sizing: border-box;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }

  .debug-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .debug-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 700;
    color: #38bdf8;
  }

  .debug-close-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s;
  }

  .debug-close-btn:hover {
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
  }

  .debug-modal-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: monospace;
    font-size: 12px;
  }

  .debug-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
  }

  .debug-label {
    color: rgba(255, 255, 255, 0.5);
  }

  .debug-val {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
  }

  .debug-val--mono {
    font-size: 11px;
    word-break: break-all;
    text-align: right;
    max-width: 180px;
  }

  .text-green { color: #4ade80 !important; }
  .text-red { color: #f87171 !important; }

  .avatar-backdrop {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    background-color: #1a1a2e;
  }

  .avatar-blur {
    position: absolute;
    inset: 0;
    background: rgba(10, 10, 20, 0.85);
  }

  .remote-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .remote-video.mirror, .pip-video.mirror {
    transform: scaleX(-1);
  }

  .pip-container {
    position: fixed;
    width: 108px;
    height: 184px;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    cursor: grab;
    touch-action: none;
    z-index: 1010;
    border: 1.5px solid rgba(255,255,255,0.12);
    user-select: none;
    -webkit-user-select: none;
  }

  .pip-container:active { cursor: grabbing; }

  .pip-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .pip-fallback {
    width: 100%;
    height: 100%;
    background: #1e1f2b;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pip-avatar-fallback {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
  }

  .pip-swap-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    padding: 0;
    transition: background 0.15s, transform 0.15s;
  }

  .pip-swap-btn:hover {
    background: rgba(0, 0, 0, 0.85);
    transform: scale(1.08);
  }

  .pip-swap-btn:active {
    transform: scale(0.92);
  }

  .top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    padding: 16px 20px;
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
    display: flex;
    align-items: center;
    gap: 10px;
    opacity: 0;
    transition: opacity 0.3s;
    z-index: 1005;
  }

  .top-bar.visible { opacity: 1; }

  .minimize-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    margin-right: 4px;
  }

  .minimize-btn:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .minimize-btn:active {
    transform: scale(0.92);
  }

  .duration {
    font-family: 'Inter Medium', sans-serif;
    font-size: 15px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
    letter-spacing: 0.5px;
  }

  .status-label {
    font-size: 14px;
    color: rgba(255,255,255,0.6);
  }

  .secure-badge {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(74, 222, 128, 0.15);
    border: 1px solid rgba(74, 222, 128, 0.3);
    border-radius: 20px;
    padding: 3px 10px;
  }

  .lock-icon { width: 13px; height: 13px; object-fit: contain; }

  .secure-text {
    font-size: 11px;
    font-weight: 600;
    color: #4ade80;
    letter-spacing: 0.5px;
  }

  .peer-info {
    position: relative;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    transition: opacity 0.3s;
  }

  .peer-info.hidden { opacity: 0; pointer-events: none; }

  .peer-avatar {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background-size: cover;
    background-position: center;
    background-color: #2a2a3e;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .peer-avatar--fallback span {
    font-size: 36px;
    font-weight: 700;
    color: #fff;
  }

  .ring-pulse {
    position: absolute;
    border-radius: 50%;
    background: rgba(255,255,255,0.12);
    animation: ringExpand 2s ease-out infinite;
    pointer-events: none;
  }

  .ring-1 { inset: -16px; animation-delay: 0s; }
  .ring-2 { inset: -32px; animation-delay: 0.8s; }

  @keyframes ringExpand {
    0% { transform: scale(0.9); opacity: 0.6; }
    100% { transform: scale(1.3); opacity: 0; }
  }

  .peer-name {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    text-align: center;
    text-shadow: 0 1px 8px rgba(0,0,0,0.5);
  }

  .call-status {
    margin: 0;
    font-size: 14px;
    color: rgba(255,255,255,0.55);
  }

  .incoming-actions {
    position: absolute;
    bottom: calc(48px + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: clamp(32px, 12vw, 64px);
    z-index: 1005;
  }

  .action-btn {
    width: clamp(56px, 16vw, 68px);
    height: clamp(56px, 16vw, 68px);
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s, box-shadow 0.15s;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  .action-btn :is(svg, img) {
    width: clamp(24px, 7vw, 30px);
    height: clamp(24px, 7vw, 30px);
  }

  .action-btn:active { transform: scale(0.93); }

  .action-btn--decline {
    background: #ef4444;
    box-shadow: 0 4px 20px rgba(239,68,68,0.4);
    color: #fff;
  }

  .action-btn--accept {
    background: #22c55e;
    box-shadow: 0 4px 20px rgba(34,197,94,0.4);
    color: #fff;
  }

  .control-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    padding-left: 8px;
    padding-right: 8px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s;
    z-index: 1005;
    box-sizing: border-box;
  }

  .control-bar.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .controls-inner {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: clamp(6px, 1.8vw, 12px);
    padding: 8px clamp(10px, 2.5vw, 18px);
    margin: 0 auto;
    max-width: calc(100vw - 16px);
    width: fit-content;
    box-sizing: border-box;
    background: #181922;
    border-radius: 36px;
    border: 1px solid rgba(255,255,255,0.08);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .controls-inner::-webkit-scrollbar {
    display: none;
  }

  .ctrl-btn {
    width: clamp(38px, 10.5vw, 48px);
    height: clamp(38px, 10.5vw, 48px);
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.10);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.18s, transform 0.15s;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  .ctrl-btn :is(svg, img) {
    width: clamp(18px, 4.8vw, 22px);
    height: clamp(18px, 4.8vw, 22px);
  }

  .ctrl-btn:active { transform: scale(0.90); }
  .ctrl-btn--active { background: rgba(255,255,255,0.22); }

  .ctrl-btn--secure {
    background: rgba(74, 222, 128, 0.18);
    border: 1px solid rgba(74, 222, 128, 0.4);
  }

  .ctrl-btn--hangup {
    background: #ef4444;
    box-shadow: 0 2px 14px rgba(239,68,68,0.4);
    width: clamp(42px, 11.5vw, 52px);
    height: clamp(42px, 11.5vw, 52px);
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
  }

  .ctrl-btn--hangup :is(svg, img) {
    width: clamp(20px, 5.2vw, 24px);
    height: clamp(20px, 5.2vw, 24px);
  }

  .ctrl-btn--hangup:hover { background: #dc2626; }

  .pip-loader {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.45);
  }

  .camera-loading-backdrop {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #111;
  }

  .spinner {
    width: 26px;
    height: 26px;
    border: 2.5px solid rgba(255, 255, 255, 0.2);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
