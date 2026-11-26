<script>
  import { onMount, onDestroy } from 'svelte';
  import { fly, fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';

  import API, {
    currentSessionCalls,
    currentRealContacts,
    currentUser,
  } from '$lib/stores/api';
  import { getChat } from '$lib/stores/messages';
  import { getContact, getCachedContacts } from '$lib/stores/contacts';
  import { activeCall, patchCallState, resetCallState, CALL_PHASE, CALL_MODE, openCallSheet } from '$lib/stores/calls';
  import { CallService } from '$lib/services/CallService';
  import Avatar from '$components/main/Avatar.svelte';
  import Session, { openChat, openProfileModal } from '$lib/stores/session';
  import { showAlert } from '$lib/utils/alert';

  let contactsMap = {};
  let unsubMap = new Map();
  let loading = false;
  let activeTab = 'all';
  let searchQuery = '';

  let activeMenuCallId = null;

  let swipeContainer;
  let isProgrammaticScroll = false;
  let scrollTimeout = null;
  let scrollRafId = null;
  let scrollEndTimer = null;
  let indicatorProgress = 0;

  let isMouseDragging = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseStartScrollLeft = 0;
  let mouseHasMoved = false;

  const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function resolvePeerId(call) {
    if (!call) return null;
    if (call.chatType === 'CHAT') return call.message?.sender || null;
    if ($currentUser != null && call.chatId != null) {
      try {
        const id = Number(BigInt(call.chatId) ^ BigInt($currentUser));
        return (id > 0 && Number.isSafeInteger(id)) ? id : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  $: {
    const history = $currentSessionCalls?.history || [];
    for (const item of history) {
      const peerId = resolvePeerId(item);
      if (peerId && !unsubMap.has(peerId)) {
        const u = getContact(peerId).subscribe(c => {
          if (c) {
            contactsMap[peerId] = c;
            contactsMap = contactsMap;
          }
        });
        unsubMap.set(peerId, u);
      }
    }
  }

  function isEligibleContact(c) {
    if (!c || c.id === $currentUser) return false;
    if (c.options?.includes('BOT') || c.bot || c.type === 'BOT') return false;
    if (c.status === 'REMOVED' || c.accountStatus === 'DELETED' || c.blocked) return false;
    return true;
  }

  export let isActive = false;

  $: isCardActive = isActive || $page?.url?.pathname === '/calls';

  let loadingCalls = false;
  async function loadCalls() {
    if (loadingCalls || loading) return;
    if (!$Session?.sync || !$Session?.connected) return;
    if (!$currentSessionCalls || !$currentSessionCalls.history) {
      loadingCalls = true;
      loading = true;
      try {
        const calls = await $API.getCalls();
        if (calls) {
          const normalized = Array.isArray(calls)
            ? { history: calls, hasMore: false }
            : (calls.history ? calls : { history: [], ...calls });
          currentSessionCalls.set(normalized);
        } else {
          currentSessionCalls.set({ history: [], hasMore: false });
        }
      } catch (e) {
        console.error(e);
        currentSessionCalls.set({ history: [], hasMore: false });
      } finally {
        loading = false;
        loadingCalls = false;
      }
    }
  }

  $: if (isCardActive && $Session?.sync && $Session?.connected && (!$currentSessionCalls || !$currentSessionCalls.history)) {
    loadCalls();
  }

  onMount(async () => {
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    }

    try {
      const cached = await getCachedContacts();
      if (cached && cached.length) {
        availableContacts = cached.filter(isEligibleContact);
      }
    } catch {}
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    }
    for (const unsub of unsubMap.values()) {
      unsub();
    }
    unsubMap.clear();
  });

  function formatDuration(raw) {
    if (!raw || raw <= 0) return '';
    let seconds = Math.round(Number(raw));
    if (seconds > 10000) {
      seconds = Math.round(seconds / 1000);
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });

    if (isToday) return timeStr;
    if (isYesterday) return `Вчера, ${timeStr}`;
    return `${date.getDate()} ${RU_MONTHS[date.getMonth()]}`;
  }

  function determineCallMeta(call) {
    const attach = call.message?.attaches?.[0];
    const isOutgoing = call.message?.sender === $currentUser;
    const hangupType = attach?.hangupType;
    const duration = attach?.duration || 0;
    const isVideo = attach?.callType === 'VIDEO';

    let status = 'incoming';
    let label = 'Входящий';

    if (isOutgoing) {
      if (hangupType === 'CANCELED' || duration === 0) {
        status = 'canceled';
        label = 'Отменённый';
      } else {
        status = 'outgoing';
        label = 'Исходящий';
      }
    } else {
      if (hangupType === 'CANCELED' || hangupType === 'REJECTED' || hangupType === 'MISSED' || duration === 0) {
        status = 'missed';
        label = 'Пропущенный';
      } else {
        status = 'incoming';
        label = 'Входящий';
      }
    }

    return {
      status,
      label,
      duration: formatDuration(duration),
      isVideo,
      timestamp: formatTime(call.message?.time),
    };
  }

  $: processedHistory = (() => {
    const raw = $currentSessionCalls?.history || [];
    const list = [];

    for (const call of raw) {
      const attach = call.message?.attaches?.[0];
      if (!attach) continue;

      const meta = determineCallMeta(call);
      const isGroup = call.chatType === 'CHAT';
      const peerId = resolvePeerId(call);

      let name = 'Неизвестный';
      let avatar = null;

      if (isGroup) {
        const chat = getChat(call.chatId).getInfo();
        name = chat?.title || 'Групповой звонок';
        avatar = chat?.baseUrl || chat?.baseRawUrl || chat?.baseIconUrl;
      } else {
        const contact = contactsMap[peerId];
        if (contact) {
          const fn = contact.names?.[0]?.firstName || '';
          const ln = contact.names?.[0]?.lastName || '';
          name = `${fn} ${ln}`.trim() || contact.name || 'Собеседник';
          avatar = contact.baseUrl || contact.baseRawUrl;
        }
      }

      list.push({
        id: call.id || call.message?.id,
        chatId: call.chatId,
        peerId,
        isGroup,
        name,
        avatar,
        time: call.message?.time || 0,
        ...meta,
      });
    }

    const grouped = [];
    for (const item of list) {
      if (grouped.length > 0) {
        const prev = grouped[grouped.length - 1];
        const samePeer = prev.peerId === item.peerId && prev.isGroup === item.isGroup;
        const sameStatus = prev.status === item.status;
        const prevDate = new Date(prev.time).toDateString();
        const currDate = new Date(item.time).toDateString();

        if (samePeer && sameStatus && prevDate === currDate) {
          prev.count = (prev.count || 1) + 1;
          continue;
        }
      }
      grouped.push({ ...item, count: 1 });
    }

    return grouped;
  })();

  $: allCalls = processedHistory.filter(call => {
    if (!searchQuery.trim()) return true;
    return call.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  $: missedCalls = processedHistory.filter(call => {
    if (call.status !== 'missed') return false;
    if (!searchQuery.trim()) return true;
    return call.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
  });

  $: missedCallsCount = processedHistory.filter(c => c.status === 'missed').length;

  function setTab(tabId) {
    activeTab = tabId;
    const index = tabId === 'all' ? 0 : 1;
    indicatorProgress = index;
    if (!swipeContainer) return;

    isProgrammaticScroll = true;
    swipeContainer.scrollTo({
      left: index * swipeContainer.clientWidth,
      behavior: 'smooth',
    });

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isProgrammaticScroll = false;
    }, 350);
  }

  function handlePagerScroll() {
    if (!swipeContainer) return;
    const width = swipeContainer.clientWidth;
    if (width === 0) return;

    if (!isProgrammaticScroll) {
      indicatorProgress = Math.max(0, Math.min(1, swipeContainer.scrollLeft / width));
    }

    if (isProgrammaticScroll) return;

    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      const rawIndex = swipeContainer.scrollLeft / width;
      const newIndex = Math.round(rawIndex);
      const tabName = newIndex === 0 ? 'all' : 'missed';
      if (Math.abs(rawIndex - newIndex) < 0.15 && activeTab !== tabName) {
        activeTab = tabName;
      }
    });

    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
      if (!swipeContainer || isProgrammaticScroll) return;
      const width = swipeContainer.clientWidth;
      if (width === 0) return;
      const finalIndex = Math.max(0, Math.min(1, Math.round(swipeContainer.scrollLeft / width)));
      const finalTab = finalIndex === 0 ? 'all' : 'missed';
      if (activeTab !== finalTab) {
        activeTab = finalTab;
      }
    }, 60);
  }

  function isInteractiveElement(target) {
    return Boolean(
      target.closest("button, a, input, textarea, select, .history-card, .action-tile, .context-popup, [role='button']")
    );
  }

  function handleSwipeMouseDown(e) {
    if (e.button !== 0) return;
    if (isInteractiveElement(e.target)) return;
    if (!swipeContainer) return;

    isMouseDragging = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartScrollLeft = swipeContainer.scrollLeft;
    mouseHasMoved = false;
  }

  function handleWindowMouseMove(e) {
    if (!isMouseDragging || !swipeContainer) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;

    if (!mouseHasMoved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
      isMouseDragging = false;
      return;
    }

    if (Math.abs(dx) > 4) {
      mouseHasMoved = true;
    }

    if (mouseHasMoved) {
      e.preventDefault();
      swipeContainer.scrollLeft = mouseStartScrollLeft - dx;
      indicatorProgress = Math.max(0, Math.min(1, swipeContainer.scrollLeft / swipeContainer.clientWidth));
    }
  }

  function handleWindowMouseUp(e) {
    if (!isMouseDragging) return;
    isMouseDragging = false;
    if (!swipeContainer || !mouseHasMoved) return;

    const width = swipeContainer.clientWidth;
    if (width === 0) return;

    const dx = e.clientX - mouseStartX;
    let targetIndex = activeTab === 'all' ? 0 : 1;

    if (Math.abs(dx) > width * 0.15 || Math.abs(dx) > 50) {
      targetIndex = dx > 0 ? 0 : 1;
    } else {
      targetIndex = Math.round(swipeContainer.scrollLeft / width);
    }

    targetIndex = Math.max(0, Math.min(1, targetIndex));
    setTab(targetIndex === 0 ? 'all' : 'missed');
  }

  async function promptStartCall(peerId, name, avatar, type = 'audio') {
    if (type === 'video') {
      await CallService.placeVideoCall(peerId, name, avatar);
    } else {
      await CallService.placeAudioCall(peerId, name, avatar);
    }
  }

  function handleCreateConference() {
    openCallSheet('create');
  }

  function toggleCallMenu(callId, e) {
    e.stopPropagation();
    activeMenuCallId = activeMenuCallId === callId ? null : callId;
  }

  function handleGlobalClick() {
    if (activeMenuCallId !== null) activeMenuCallId = null;
  }

  function handleOpenChat(chatId, peerId) {
    activeMenuCallId = null;
    if (chatId) {
      openChat(chatId);
    } else if (peerId) {
      openProfileModal({ userId: peerId });
    }
  }

  function handleCallAction(call) {
    if (!call) return;
    if (call.peerId) {
      promptStartCall(call.peerId, call.name, call.avatar, call.isVideo ? 'video' : 'audio');
    } else if (call.chatId) {
      handleOpenChat(call.chatId, null);
    }
  }
</script>

<svelte:window on:click={handleGlobalClick} />

<div class="calls-page">
  <div class="top-nav">
    <div class="nav-left">
      <h3 class="nav-title" style="margin: 0;">Звонки</h3>
    </div>
  </div>

  {#if $activeCall.phase !== CALL_PHASE.IDLE && $activeCall.phase !== CALL_PHASE.ENDING}
    <div
      class="active-call-strip"
      on:click={() => patchCallState({ minimized: false })}
      in:fly={{ y: -10, duration: 200 }}
    >
      <div class="pulse-indicator"></div>
      <div class="active-call-content">
        <span class="active-call-name">{$activeCall.peerName || 'Идёт звонок'}</span>
        <span class="active-call-status">
          {#if $activeCall.phase === CALL_PHASE.ACTIVE}Разговор в процессе{:else}Подключение...{/if}
        </span>
      </div>
      <button class="active-call-return">Вернуться</button>
    </div>
  {/if}

  <div class="action-tiles">
    <div class="action-tile" on:click={handleCreateConference} role="button" tabindex="0">
      <div class="tile-icon-box tile-icon--blue">
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 18px; height: 18px;"></span>
      </div>
      <div class="tile-info">
        <span class="tile-title">Ссылка</span>
        <span class="tile-desc">Новая встреча</span>
      </div>
    </div>

    <div class="action-tile" on:click={() => openCallSheet('join')} role="button" tabindex="0">
      <div class="tile-icon-box tile-icon--green">
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/user-plus.svg'); mask-image: url('/icons/user-plus.svg'); width: 18px; height: 18px;"></span>
      </div>
      <div class="tile-info">
        <span class="tile-title">Присоединиться</span>
        <span class="tile-desc">По коду/ссылке</span>
      </div>
    </div>
  </div>

  <div class="tab-filter-bar">
    <div class="segmented-control">
      <div
        class="segmented-slider"
        class:animating={isProgrammaticScroll}
        style="transform: translateX({indicatorProgress * 100}%);"
      ></div>

      <button
        class="segment-btn"
        class:active={activeTab === 'all'}
        on:click={() => setTab('all')}
        type="button"
      >
        <span>Все</span>
        {#if processedHistory.length > 0}
          <span class="count-tag">{processedHistory.length}</span>
        {/if}
      </button>

      <button
        class="segment-btn"
        class:active={activeTab === 'missed'}
        on:click={() => setTab('missed')}
        type="button"
      >
        <span>Пропущенные</span>
        {#if missedCallsCount > 0}
          <span class="count-tag count-tag--danger">{missedCallsCount}</span>
        {/if}
      </button>
    </div>
  </div>

  <div
    class="calls-swipe-container"
    class:dragging={isMouseDragging}
    bind:this={swipeContainer}
    on:scroll={handlePagerScroll}
    on:mousedown={handleSwipeMouseDown}
  >
    <div class="calls-tab-page">
      {#if loading}
        <div class="loading-box">
          <div class="spinner"></div>
          <span>Загрузка журнала...</span>
        </div>
      {:else if allCalls.length === 0}
        <div class="empty-box" in:fade={{ duration: 180 }}>
          <div class="empty-icon-wrap">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-accept.svg'); mask-image: url('/icons/call-accept.svg'); width: 44px; height: 44px;"></span>
          </div>
          <p class="empty-headline">История звонков пуста</p>
          <p class="empty-caption">Создайте конференцию или выберите контакт для звонка</p>
        </div>
      {:else}
        <div class="history-list">
          {#each allCalls as call (call.id || call.time)}
            <div
              class="history-card"
              on:click={() => handleCallAction(call)}
              role="button"
              tabindex="0"
            >
              <div class="avatar-col">
                <Avatar size={48} contactId={call.peerId} title={call.name} src={call.avatar} />
              </div>

              <div class="details-col">
                <div class="title-row">
                  <span class="caller-name" class:danger={call.status === 'missed'}>
                    {call.name}
                    {#if call.count > 1}
                      <span class="repeat-badge">({call.count})</span>
                    {/if}
                  </span>
                  <span class="call-time">{call.timestamp}</span>
                </div>

                <div class="sub-row">
                  <div class="status-marker status--{call.status}">
                    {#if call.status === 'outgoing'}
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-outgoing.svg'); mask-image: url('/icons/call-outgoing.svg'); width: 14px; height: 14px;"></span>
                    {:else if call.status === 'incoming'}
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-incoming.svg'); mask-image: url('/icons/call-incoming.svg'); width: 14px; height: 14px;"></span>
                    {:else if call.status === 'missed'}
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-missed.svg'); mask-image: url('/icons/call-missed.svg'); width: 14px; height: 14px;"></span>
                    {:else}
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-canceled.svg'); mask-image: url('/icons/call-canceled.svg'); width: 14px; height: 14px;"></span>
                    {/if}
                  </div>

                  <span class="call-type-label">
                    {call.label}
                    {#if call.duration}· {call.duration}{/if}
                  </span>

                  {#if call.isVideo}
                    <span class="video-indicator" title="Видеозвонок">
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/video.svg'); mask-image: url('/icons/video.svg'); width: 13px; height: 13px;"></span>
                    </span>
                  {/if}
                </div>
              </div>

              <div class="actions-col">
                <button
                  class="icon-action-btn dial-btn"
                  on:click|stopPropagation={() => handleCallAction(call)}
                  aria-label="Позвонить"
                >
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-accept.svg'); mask-image: url('/icons/call-accept.svg'); width: 18px; height: 18px;"></span>
                </button>

                <button
                  class="icon-action-btn menu-btn"
                  on:click={(e) => toggleCallMenu(call.id, e)}
                  aria-label="Опции"
                >
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/more-vertical.svg'); mask-image: url('/icons/more-vertical.svg'); width: 18px; height: 18px;"></span>
                </button>

                {#if activeMenuCallId === call.id}
                  <div class="context-popup" in:scale={{ start: 0.9, duration: 150 }} on:click|stopPropagation>
                    {#if call.peerId}
                      <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'audio'); }}>
                        <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-accept.svg'); mask-image: url('/icons/call-accept.svg'); width: 16px; height: 16px;"></span>
                        <span>Аудиозвонок</span>
                      </button>

                      <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'video'); }}>
                        <span class="mask-icon" style="-webkit-mask-image: url('/icons/video.svg'); mask-image: url('/icons/video.svg'); width: 16px; height: 16px;"></span>
                        <span>Видеозвонок</span>
                      </button>
                    {/if}

                    <button class="popup-item" on:click={() => handleOpenChat(call.chatId, call.peerId)}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/chats.svg'); mask-image: url('/icons/chats.svg'); width: 16px; height: 16px;"></span>
                      <span>Перейти в чат</span>
                    </button>

                    <div class="popup-divider"></div>

                    <button class="popup-item popup-item--danger" on:click={() => deleteCallEntry(call)}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 16px; height: 16px;"></span>
                      <span>Удалить из журнала</span>
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="calls-tab-page">
      {#if loading}
        <div class="loading-box">
          <div class="spinner"></div>
          <span>Загрузка журнала...</span>
        </div>
      {:else if missedCalls.length === 0}
        <div class="empty-box" in:fade={{ duration: 180 }}>
          <div class="empty-icon-wrap">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-accept.svg'); mask-image: url('/icons/call-accept.svg'); width: 44px; height: 44px;"></span>
          </div>
          <p class="empty-headline">Нет пропущенных звонков</p>
          <p class="empty-caption">Здесь появятся пропущенные вызовы</p>
        </div>
      {:else}
        <div class="history-list">
          {#each missedCalls as call (call.id || call.time)}
            <div
              class="history-card"
              on:click={() => handleCallAction(call)}
              role="button"
              tabindex="0"
            >
              <div class="avatar-col">
                <Avatar size={48} contactId={call.peerId} title={call.name} src={call.avatar} />
              </div>

              <div class="details-col">
                <div class="title-row">
                  <span class="caller-name danger">
                    {call.name}
                    {#if call.count > 1}
                      <span class="repeat-badge">({call.count})</span>
                    {/if}
                  </span>
                  <span class="call-time">{call.timestamp}</span>
                </div>

                <div class="sub-row">
                  <div class="status-marker status--missed">
                    <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-missed.svg'); mask-image: url('/icons/call-missed.svg'); width: 14px; height: 14px;"></span>
                  </div>

                  <span class="call-type-label">
                    {call.label}
                    {#if call.duration}· {call.duration}{/if}
                  </span>

                  {#if call.isVideo}
                    <span class="video-indicator" title="Видеозвонок">
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/video.svg'); mask-image: url('/icons/video.svg'); width: 13px; height: 13px;"></span>
                    </span>
                  {/if}
                </div>
              </div>

              <div class="actions-col">
                <button
                  class="icon-action-btn dial-btn"
                  on:click|stopPropagation={() => handleCallAction(call)}
                  aria-label="Позвонить"
                >
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-accept.svg'); mask-image: url('/icons/call-accept.svg'); width: 18px; height: 18px;"></span>
                </button>

                <button
                  class="icon-action-btn menu-btn"
                  on:click={(e) => toggleCallMenu(call.id, e)}
                  aria-label="Опции"
                >
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/more-vertical.svg'); mask-image: url('/icons/more-vertical.svg'); width: 18px; height: 18px;"></span>
                </button>

                {#if activeMenuCallId === call.id}
                  <div class="context-popup" in:scale={{ start: 0.9, duration: 150 }} on:click|stopPropagation>
                    {#if call.peerId}
                      <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'audio'); }}>
                        <span class="mask-icon" style="-webkit-mask-image: url('/icons/call-accept.svg'); mask-image: url('/icons/call-accept.svg'); width: 16px; height: 16px;"></span>
                        <span>Аудиозвонок</span>
                      </button>

                      <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'video'); }}>
                        <span class="mask-icon" style="-webkit-mask-image: url('/icons/video.svg'); mask-image: url('/icons/video.svg'); width: 16px; height: 16px;"></span>
                        <span>Видеозвонок</span>
                      </button>
                    {/if}

                    <button class="popup-item" on:click={() => handleOpenChat(call.chatId, call.peerId)}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/chats.svg'); mask-image: url('/icons/chats.svg'); width: 16px; height: 16px;"></span>
                      <span>Перейти в чат</span>
                    </button>

                    <div class="popup-divider"></div>

                    <button class="popup-item popup-item--danger" on:click={() => deleteCallEntry(call)}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 16px; height: 16px;"></span>
                      <span>Удалить из журнала</span>
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <button class="fab-new-call" on:click={() => openCallSheet('new_call')} aria-label="Новый вызов">
    <img src="/icons/call-accept.svg" alt="" width="24" height="24" />
  </button>
</div>

<style>
  .calls-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: calc(16px + var(--safe-top, 0px)) 16px 0;
    color: var(--text-primary, #ffffff);
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
  }

  .top-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    flex-shrink: 0;
  }

  .nav-title {
    margin: 0;
    font-size: 1.17em;
    font-weight: bold;
    color: var(--text-primary);
  }

  .active-call-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 14px;
    background: var(--status-success-subtle);
    border: 1px solid var(--status-success);
    border-radius: 14px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .pulse-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--status-success);
    animation: ringGlow 1.8s infinite;
  }

  @keyframes ringGlow {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.2); }
  }

  .active-call-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .active-call-name {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .active-call-status {
    font-size: 11px;
    color: var(--status-success);
  }

  .active-call-return {
    padding: 5px 12px;
    border-radius: 16px;
    background: var(--status-success);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    border: none;
    cursor: pointer;
  }

  .action-tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
    width: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .action-tile {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.18s, transform 0.12s;
    min-width: 0;
    overflow: hidden;
    box-sizing: border-box;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .action-tile:hover {
    background: var(--bg-surface-2);
  }

  .action-tile:active {
    transform: scale(0.98);
  }

  .tile-icon-box {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tile-icon--blue {
    background: var(--accent-subtle);
    color: var(--accent-primary);
  }

  .tile-icon--green {
    background: var(--status-success-subtle);
    color: var(--status-success);
  }

  .tile-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .tile-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .tile-desc {
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    margin-top: 2px;
  }

  .tab-filter-bar {
    margin-bottom: 10px;
    flex-shrink: 0;
  }

  .segmented-control {
    display: flex;
    background: var(--bg-surface);
    padding: 3px;
    border-radius: 12px;
    border: 1px solid var(--border-card);
    position: relative;
    user-select: none;
  }

  .segmented-slider {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    background: var(--bg-surface-2);
    border-radius: 9px;
    pointer-events: none;
    will-change: transform;
    z-index: 1;
  }

  .segmented-slider.animating {
    transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
  }

  .segment-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    border: none;
    border-radius: 9px;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s;
    position: relative;
    z-index: 2;
  }

  .segment-btn.active {
    color: var(--text-primary);
  }

  .count-tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--bg-hover);
  }

  .count-tag--danger {
    background: var(--status-danger-subtle);
    color: var(--status-danger);
  }

  .calls-swipe-container {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: grab;
    will-change: scroll-position;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
  }

  .calls-swipe-container.dragging {
    cursor: grabbing;
    scroll-snap-type: none;
    user-select: none;
  }

  .calls-swipe-container::-webkit-scrollbar {
    display: none;
  }

  .calls-tab-page {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    min-height: 0;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    box-sizing: border-box;
    cursor: default;
    padding-bottom: calc(76px + var(--safe-bottom, 0px));
  }

  .loading-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 180px;
    color: var(--text-muted, #8b929e);
    font-size: 13px;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid var(--border-subtle);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 260px;
    text-align: center;
    padding: 0 32px;
  }

  .empty-icon-wrap {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--bg-hover);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--icon-disabled);
    margin-bottom: 4px;
  }

  .empty-headline {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-caption {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .history-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 14px;
    background: transparent;
    cursor: pointer;
    transition: background 0.15s;
    position: relative;
  }

  .history-card:hover {
    background: var(--bg-hover);
  }

  .history-card:active {
    background: var(--bg-active);
  }

  .avatar-col {
    flex-shrink: 0;
  }

  .details-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .caller-name {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .caller-name.danger {
    color: var(--status-danger, #ef4444);
  }

  .repeat-badge {
    font-size: 13px;
    font-weight: 500;
    opacity: 0.8;
  }

  .call-time {
    font-size: 11px;
    color: var(--text-muted, #8b929e);
    flex-shrink: 0;
  }

  .sub-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted, #8b929e);
  }

  .status-marker {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .status--outgoing { color: var(--accent-primary, #248bfe); }
  .status--incoming { color: var(--status-success, #4ade80); }
  .status--missed { color: var(--status-danger, #ef4444); }
  .status--canceled { color: var(--text-muted, #8b929e); }

  .call-type-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .video-indicator {
    color: var(--accent-primary, #248bfe);
    display: flex;
    align-items: center;
  }

  .actions-col {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    position: relative;
  }

  .icon-action-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--icon-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }

  .icon-action-btn:hover {
    background: var(--bg-hover);
    color: var(--icon-primary);
  }

  .icon-action-btn:active {
    transform: scale(0.92);
  }

  .dial-btn {
    color: var(--accent-primary);
    background: var(--accent-subtle);
  }

  .dial-btn:hover {
    background: var(--accent-subtle-hover);
    color: var(--accent-primary);
  }

  .context-popup {
    position: absolute;
    top: 40px;
    right: 0;
    z-index: var(--z-dropdown, 6);
    min-width: 190px;
    background: var(--dropout-bg, var(--bg-surface-2));
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: var(--dropout-shadow, var(--shadow-elevated));
  }

  .popup-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: var(--dropout-text, var(--text-primary));
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }

  .popup-item:hover {
    background: var(--dropout-item-hover, var(--bg-hover));
  }

  .popup-item--danger {
    color: var(--status-danger);
  }

  .popup-item--danger:hover {
    background: var(--status-danger-subtle);
  }

  .popup-divider {
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 6px;
  }

  .fab-new-call {
    position: absolute;
    bottom: 18px;
    right: 18px;
    width: 56px;
    height: 56px;
    border-radius: 28px;
    border: none;
    background: var(--accent-primary);
    color: var(--accent-contrast, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s;
    z-index: var(--z-floating, 5);
  }

  .fab-new-call:hover {
  }

  .fab-new-call:active {
    transform: scale(0.92);
  }
</style>
