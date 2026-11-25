<script>
  import { CallService } from '$lib/services/CallService';
  import { currentUser } from '$lib/stores/api';
  import { getContact } from '$lib/stores/contacts';

  export let attach = {};
  export let chatId = null;
  export let isMe = false;

  $: isVideo = (attach.callType || '').toUpperCase() === 'VIDEO';
  $: hangup = (attach.hangupType || '').toUpperCase();
  $: isMissed = hangup === 'MISSED' || hangup === 'TIMEOUT';
  $: isCanceled = hangup === 'CANCELED';
  $: isRejected = hangup === 'REJECTED' || hangup === 'BUSY';

  // In Max decompiled (s90.java):
  // z24 = !isMe && (missed || timeout || canceled) -> "Пропущенный звонок"
  // z25 = isMe && (rejected || canceled) -> "Отклонённый звонок"
  $: isMissedIncoming = !isMe && (isMissed || isCanceled);
  $: isRejectedCall = isRejected || (isMe && isCanceled);
  $: isNegative = isMissedIncoming || isRejectedCall;

  $: durationText = formatCallDuration(attach.duration);

  $: peerId = (() => {
    if (Array.isArray(attach.contactIds)) {
      const found = attach.contactIds.find(id => Number(id) !== Number($currentUser));
      if (found) return Number(found);
    }
    if (chatId != null && $currentUser != null) {
      try {
        const id = Number(BigInt(chatId) ^ BigInt($currentUser));
        if (id > 0 && Number.isSafeInteger(id)) return id;
      } catch {}
    }
    return null;
  })();

  $: contactStore = peerId ? getContact(peerId) : null;
  $: peerName = (() => {
    if (!$contactStore) return 'Собеседник';
    const fn = $contactStore.names?.[0]?.firstName || '';
    const ln = $contactStore.names?.[0]?.lastName || '';
    return `${fn} ${ln}`.trim() || $contactStore.name || 'Собеседник';
  })();

  // Exact strings from MAX-decompiled R.string:
  // chat_screen_message_call_title_missed = "Пропущенный звонок"
  // chat_screen_message_call_title_reject = "Отклонённый звонок"
  // chat_screen_message_call_title_incoming = "Входящий звонок"
  // chat_screen_message_call_title_outgoing = "Исходящий звонок"
  // chat_screen_message_group_call_title = "Групповой звонок"
  $: titleText = (() => {
    if (attach.joinLink) {
      return 'Групповой звонок';
    }
    if (isRejectedCall) {
      return 'Отклонённый звонок';
    }
    if (isMissedIncoming) {
      return 'Пропущенный звонок';
    }
    if (isMe) {
      return 'Исходящий звонок';
    }
    return 'Входящий звонок';
  })();

  // Subtitle from MAX-decompiled (s90.java):
  // chat_screen_message_call_subtitle_video = "Видеозвонок"
  // chat_screen_message_call_subtitle_audio = "Аудиозвонок"
  // chat_screen_message_group_call = "Групповой звонок"
  // + duration string om5.b(j5)
  $: callTypeStr = isVideo ? 'Видеозвонок' : 'Аудиозвонок';
  $: subText = (() => {
    if (attach.joinLink) return 'По ссылке';
    if (durationText) return `${callTypeStr}, ${durationText}`;
    return callTypeStr;
  })();

  function formatCallDuration(raw) {
    if (!raw || raw <= 0) return '';
    let sec = Math.round(Number(raw));
    if (sec > 10000) {
      sec = Math.round(sec / 1000);
    }
    if (sec < 60) {
      return `${sec} сек`;
    }
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s === 0 ? `${m} мин` : `${m} мин ${s} сек`;
  }

  function handleAction(e) {
    e.stopPropagation();
    if (attach.joinLink) {
      CallService.joinConferenceByLink(attach.joinLink, isVideo);
      return;
    }
    if (!peerId) return;
    const avatar = $contactStore?.baseUrl || $contactStore?.baseRawUrl;
    if (isVideo) {
      CallService.placeVideoCall(peerId, peerName, avatar);
    } else {
      CallService.placeAudioCall(peerId, peerName, avatar);
    }
  }
</script>

<div
  class="call-bubble-row"
  class:is-me={isMe}
  class:is-negative={isNegative}
  on:click={handleAction}
  role="button"
  tabindex="0"
>
  <div class="call-icon-badge" class:negative={isNegative}>
    {#if attach.joinLink}
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    {:else if isVideo}
      {#if isNegative}
        <!-- Missed Video Call icon (Max icon_video_call_missed_fill style) -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      {/if}
    {:else}
      {#if isNegative}
        <!-- Missed Phone Call icon (Max icon_call_missed_fill style) -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 2v4m0 0h4m-4 0l5-5"/>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      {:else if isMe}
        <!-- Outgoing Phone Call icon -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 7l10 10M17 7v10H7"/>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      {:else}
        <!-- Incoming Phone Call icon -->
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      {/if}
    {/if}
  </div>

  <div class="call-info-col">
    <div class="call-title-text" class:negative={isNegative}>
      {titleText}
    </div>
    <div class="call-subtitle-text">
      {subText}
    </div>
  </div>

  {#if attach.joinLink}
    <button class="call-join-btn" on:click={handleAction} title="Присоединиться">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .call-bubble-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 2px 2px;
    width: 100%;
    min-width: 180px;
    box-sizing: border-box;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    background: transparent;
  }

  .call-bubble-row:active {
    opacity: 0.85;
  }

  /* 40x40 circular icon matching wy1.java in MAX-decompiled */
  .call-icon-badge {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--call-icon-bg, rgba(255, 255, 255, 0.1));
    color: var(--text-primary, #ffffff);
    flex-shrink: 0;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .call-bubble-row.is-me .call-icon-badge {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
  }

  .call-icon-badge.negative {
    background: rgba(239, 68, 68, 0.14) !important;
    color: #ef4444 !important;
  }

  .call-info-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
    gap: 2px;
  }

  /* Title text matching g9k.j in MAX-decompiled (15px semibold) */
  .call-title-text {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Negative red text for missed/rejected calls matching text_negative in Max */
  .call-title-text.negative {
    color: #ef4444;
  }

  /* Subtitle matching g9k.t in MAX-decompiled (13px secondary) */
  .call-subtitle-text {
    font-size: 13px;
    line-height: 1.2;
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .call-join-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: var(--accent-primary, #007aff);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 4px;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .call-join-btn:hover {
    background: var(--accent-primary-hover, #0066dd);
    transform: scale(1.05);
  }

  .call-join-btn:active {
    transform: scale(0.95);
  }
</style>
