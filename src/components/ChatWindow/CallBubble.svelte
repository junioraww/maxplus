<script>
  import { CallService } from '$lib/services/CallService.js';
  import { currentUser } from '$lib/stores/api.js';
  import { getContact } from '$lib/stores/contacts.js';

  export let attach = {};
  export let chatId = null;
  export let isMe = false;

  $: isVideo = (attach.callType || '').toUpperCase() === 'VIDEO';
  $: hangup = (attach.hangupType || '').toUpperCase();
  $: isMissed = hangup === 'MISSED' || hangup === 'TIMEOUT';
  $: isCanceled = hangup === 'CANCELED';
  $: isRejected = hangup === 'REJECTED' || hangup === 'BUSY';
  $: isMissedCall = !isMe && isMissed;

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

  $: titleText = (() => {
    if (attach.joinLink) {
      return isVideo ? 'Видеовстреча' : 'Групповой звонок';
    }
    if (isMe) {
      if (isCanceled) {
        return isVideo ? 'Отменённый видеозвонок' : 'Отменённый звонок';
      }
      return isVideo ? 'Исходящий видеозвонок' : 'Исходящий звонок';
    }
    if (isMissed || isCanceled) {
      return isVideo ? 'Пропущенный видеозвонок' : 'Пропущенный звонок';
    }
    if (isRejected) {
      return isVideo ? 'Отклонённый видеозвонок' : 'Отклонённый звонок';
    }
    return isVideo ? 'Входящий видеозвонок' : 'Входящий звонок';
  })();

  $: subText = (() => {
    if (attach.joinLink) {
      return 'По ссылке';
    }
    if (durationText) {
      return durationText;
    }
    if (isMe) {
      if (isCanceled) return 'Отменён';
      if (isRejected) return 'Занято';
      if (isMissed) return 'Нет ответа';
      return 'Завершён';
    }
    if (isMissed) return 'Не отвечен';
    if (isCanceled) return 'Отменён';
    if (isRejected) return 'Отклонён';
    return 'Завершён';
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
    const avatar = $contactStore?.avatar || $contactStore?.baseUrl;
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
  class:is-missed={isMissedCall}
  on:click={handleAction}
  role="button"
  tabindex="0"
>
  <div class="call-icon-circle" class:missed={isMissedCall}>
    {#if attach.joinLink}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    {:else if isVideo}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="23 7 16 12 23 17 23 7"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    {/if}
  </div>

  <div class="call-text-col">
    <span class="call-title-line">{titleText}</span>
    <div class="call-sub-line">
      {#if !attach.joinLink}
        <svg class="call-direction-svg" class:missed={isMissedCall} viewBox="0 0 14 14" width="11" height="11">
          {#if isMe}
            <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          {:else}
            <path d="M11 3L3 11M3 11H9M3 11V5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          {/if}
        </svg>
      {/if}
      <span class="call-duration-text">{subText}</span>
    </div>
  </div>

  {#if attach.joinLink}
    <button class="call-handset-btn" on:click={handleAction} title="Присоединиться">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .call-bubble-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 1px 0;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    background: transparent;
  }

  .call-bubble-row:active {
    opacity: 0.82;
  }

  .call-icon-circle {
    width: 30px;
    height: 30px;
    min-width: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.95);
    flex-shrink: 0;
  }

  .call-bubble-row.is-me .call-icon-circle {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
  }

  .call-icon-circle.missed {
    background: rgba(255, 255, 255, 0.1);
    color: #f87171;
  }

  .call-text-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .call-title-line {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.15;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .call-sub-line {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-top: 1px;
    min-width: 0;
  }

  .call-direction-svg {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.65);
  }

  .call-direction-svg.missed {
    color: #f87171;
  }

  .call-duration-text {
    font-size: 11.5px;
    line-height: 1.1;
    color: rgba(255, 255, 255, 0.65);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .call-handset-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 4px;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .call-handset-btn:hover {
    background: var(--accent-primary-hover, #1b74dc);
    transform: scale(1.05);
  }

  .call-handset-btn:active {
    transform: scale(0.92);
  }
</style>
