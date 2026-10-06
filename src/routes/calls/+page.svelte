<script>
  import { onMount, onDestroy } from 'svelte';
  import { fly, fade, scale } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { get } from 'svelte/store';

  import API, {
    currentSessionCalls,
    currentSessionChats,
    currentRealContacts,
    currentUser,
  } from '$lib/stores/api';
  import { getContact, getCachedContacts } from '$lib/stores/contacts';
  import { activeCall, patchCallState, resetCallState, CALL_PHASE, CALL_MODE } from '$lib/stores/calls.js';
  import { CallService } from '$lib/services/CallService.js';
  import Avatar from '$components/main/Avatar.svelte';
  import Session, { openChat } from '$lib/stores/session.js';
  import { showAlert } from '$lib/utils/alert.js';

  let contactsMap = {};
  let unsubMap = new Map();
  let loading = false;
  let activeTab = 'all';
  let searchQuery = '';

  let showCreateModal = false;
  let showJoinModal = false;
  let showNewCallModal = false;
  let showModeSelectModal = false;
  let activeMenuCallId = null;

  let createdRoomLink = '';
  let creatingRoom = false;
  let linkCopied = false;
  let createSecureMode = false;

  let joinLinkInput = '';
  let joinWithVideo = false;
  let joinSecureMode = false;

  let contactSearchQuery = '';
  let availableContacts = [];

  let targetPeerId = null;
  let targetPeerName = null;
  let targetPeerAvatar = null;
  let targetCallType = 'audio';

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

  onMount(async () => {
    if (typeof window !== 'undefined') {
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    }

    if (!$currentSessionCalls || !$currentSessionCalls.history) {
      loading = true;
      try {
        const calls = await $API.getCalls();
        if (calls) currentSessionCalls.set(calls);
      } catch (e) {
        console.error(e);
      } finally {
        loading = false;
      }
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

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
        const chat = $currentSessionChats?.find(c => c.id === call.chatId);
        name = chat?.title || 'Групповой звонок';
        avatar = chat?.avatar || chat?.baseUrl;
      } else {
        const contact = contactsMap[peerId];
        if (contact) {
          const fn = contact.names?.[0]?.firstName || '';
          const ln = contact.names?.[0]?.lastName || '';
          name = `${fn} ${ln}`.trim() || contact.name || 'Собеседник';
          avatar = contact.avatar || contact.baseUrl;
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

  function promptStartCall(peerId, name, avatar, type = 'audio') {
    targetPeerId = peerId;
    targetPeerName = name;
    targetPeerAvatar = avatar;
    targetCallType = type;
    showModeSelectModal = true;
  }

  async function executeCall(mode) {
    showModeSelectModal = false;
    if (!targetPeerId) return;

    if (targetCallType === 'video') {
      await CallService.placeVideoCall(targetPeerId, targetPeerName, targetPeerAvatar, mode);
    } else {
      await CallService.placeAudioCall(targetPeerId, targetPeerName, targetPeerAvatar, mode);
    }
  }

  async function handleCreateConference() {
    showCreateModal = true;
    creatingRoom = true;
    linkCopied = false;
    try {
      const res = await CallService.createConferenceRoom();
      createdRoomLink = res.link;
    } catch (e) {
      showAlert('Ошибка создания звонка: ' + (e?.message || e));
      showCreateModal = false;
    } finally {
      creatingRoom = false;
    }
  }

  async function copyRoomLink() {
    if (!createdRoomLink) return;
    try {
      await navigator.clipboard.writeText(createdRoomLink);
      linkCopied = true;
      setTimeout(() => { linkCopied = false; }, 2500);
    } catch {
      showAlert(createdRoomLink, 'Ссылка на звонок скопирована');
    }
  }

  async function startCreatedConference(video) {
    showCreateModal = false;
    if (!createdRoomLink) return;
    const mode = createSecureMode ? CALL_MODE.SECURE : CALL_MODE.PLAIN;
    await CallService.joinConferenceByLink(createdRoomLink, video, mode);
  }

  async function submitJoinByLink() {
    if (!joinLinkInput.trim()) return;
    const link = joinLinkInput.trim();
    showJoinModal = false;
    const mode = joinSecureMode ? CALL_MODE.SECURE : CALL_MODE.PLAIN;
    await CallService.joinConferenceByLink(link, joinWithVideo, mode);
  }

  async function deleteCallEntry(call) {
    activeMenuCallId = null;
    if (!call.id) return;
    await CallService.deleteCallHistory([call.id]);
    currentSessionCalls.update(state => {
      if (!state || !state.history) return state;
      return {
        ...state,
        history: state.history.filter(h => (h.id || h.message?.id) !== call.id),
      };
    });
  }

  function handleOpenChat(chatId, peerId) {
    activeMenuCallId = null;
    if (chatId) {
      openChat(chatId);
    } else if (peerId) {
      Session.set('profile', { userId: peerId });
    }
  }

  function selectContactForCall(contact) {
    showNewCallModal = false;
    const fn = contact.names?.[0]?.firstName || '';
    const ln = contact.names?.[0]?.lastName || '';
    const name = `${fn} ${ln}`.trim() || contact.name || 'Собеседник';
    promptStartCall(contact.id, name, contact.avatar || contact.baseUrl, 'audio');
  }

  $: filteredContacts = availableContacts.filter(c => {
    if (!isEligibleContact(c)) return false;
    if (!contactSearchQuery.trim()) return true;
    const q = contactSearchQuery.trim().toLowerCase();
    const fn = (c.names?.[0]?.firstName || '').toLowerCase();
    const ln = (c.names?.[0]?.lastName || '').toLowerCase();
    const name = (c.name || '').toLowerCase();
    return fn.includes(q) || ln.includes(q) || name.includes(q);
  });

  $: if ($currentRealContacts && $currentRealContacts.length) {
    getCachedContacts().then(cached => {
      if (cached && cached.length) {
        availableContacts = cached.filter(isEligibleContact);
      }
    }).catch(() => {});
  }

  function formatPhone(phone) {
    if (!phone) return '';
    const s = String(phone).trim();
    return s.startsWith('+') ? s : `+${s}`;
  }

  function toggleCallMenu(callId, e) {
    e.stopPropagation();
    activeMenuCallId = activeMenuCallId === callId ? null : callId;
  }

  function handleGlobalClick() {
    if (activeMenuCallId !== null) activeMenuCallId = null;
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
        <img src="/icons/link.svg" alt="" width="18" height="18" />
      </div>
      <div class="tile-info">
        <span class="tile-title">Ссылка</span>
        <span class="tile-desc">Новая встреча</span>
      </div>
    </div>

    <div class="action-tile" on:click={() => { showJoinModal = true; }} role="button" tabindex="0">
      <div class="tile-icon-box tile-icon--green">
        <img src="/icons/user-plus.svg" alt="" width="18" height="18" />
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
            <img src="/icons/call-accept.svg" alt="" width="44" height="44" />
          </div>
          <p class="empty-headline">История звонков пуста</p>
          <p class="empty-caption">Создайте конференцию или выберите контакт для звонка</p>
        </div>
      {:else}
        <div class="history-list">
          {#each allCalls as call (call.id || call.time)}
            <div
              class="history-card"
              on:click={() => promptStartCall(call.peerId, call.name, call.avatar, call.isVideo ? 'video' : 'audio')}
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
                      <img src="/icons/call-outgoing.svg" alt="" width="14" height="14" />
                    {:else if call.status === 'incoming'}
                      <img src="/icons/call-incoming.svg" alt="" width="14" height="14" />
                    {:else if call.status === 'missed'}
                      <img src="/icons/call-missed.svg" alt="" width="14" height="14" />
                    {:else}
                      <img src="/icons/call-canceled.svg" alt="" width="14" height="14" />
                    {/if}
                  </div>

                  <span class="call-type-label">
                    {call.label}
                    {#if call.duration}· {call.duration}{/if}
                  </span>

                  {#if call.isVideo}
                    <span class="video-indicator" title="Видеозвонок">
                      <img src="/icons/video.svg" alt="" width="13" height="13" />
                    </span>
                  {/if}
                </div>
              </div>

              <div class="actions-col">
                <button
                  class="icon-action-btn dial-btn"
                  on:click|stopPropagation={() => promptStartCall(call.peerId, call.name, call.avatar, call.isVideo ? 'video' : 'audio')}
                  aria-label="Позвонить"
                >
                  <img src="/icons/call-accept.svg" alt="" width="18" height="18" />
                </button>

                <button
                  class="icon-action-btn menu-btn"
                  on:click={(e) => toggleCallMenu(call.id, e)}
                  aria-label="Опции"
                >
                  <img src="/icons/more-vertical.svg" alt="" width="18" height="18" />
                </button>

                {#if activeMenuCallId === call.id}
                  <div class="context-popup" in:scale={{ start: 0.9, duration: 150 }} on:click|stopPropagation>
                    <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'audio'); }}>
                      <img src="/icons/call-accept.svg" alt="" width="16" height="16" />
                      <span>Аудиозвонок</span>
                    </button>

                    <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'video'); }}>
                      <img src="/icons/video.svg" alt="" width="16" height="16" />
                      <span>Видеозвонок</span>
                    </button>

                    <button class="popup-item" on:click={() => handleOpenChat(call.chatId, call.peerId)}>
                      <img src="/icons/chats.svg" alt="" width="16" height="16" />
                      <span>Перейти в чат</span>
                    </button>

                    <div class="popup-divider"></div>

                    <button class="popup-item popup-item--danger" on:click={() => deleteCallEntry(call)}>
                      <img src="/icons/trash.svg" alt="" width="16" height="16" />
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
            <img src="/icons/call-accept.svg" alt="" width="44" height="44" />
          </div>
          <p class="empty-headline">Нет пропущенных звонков</p>
          <p class="empty-caption">Здесь появятся пропущенные вызовы</p>
        </div>
      {:else}
        <div class="history-list">
          {#each missedCalls as call (call.id || call.time)}
            <div
              class="history-card"
              on:click={() => promptStartCall(call.peerId, call.name, call.avatar, call.isVideo ? 'video' : 'audio')}
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
                    <img src="/icons/call-missed.svg" alt="" width="14" height="14" />
                  </div>

                  <span class="call-type-label">
                    {call.label}
                    {#if call.duration}· {call.duration}{/if}
                  </span>

                  {#if call.isVideo}
                    <span class="video-indicator" title="Видеозвонок">
                      <img src="/icons/video.svg" alt="" width="13" height="13" />
                    </span>
                  {/if}
                </div>
              </div>

              <div class="actions-col">
                <button
                  class="icon-action-btn dial-btn"
                  on:click|stopPropagation={() => promptStartCall(call.peerId, call.name, call.avatar, call.isVideo ? 'video' : 'audio')}
                  aria-label="Позвонить"
                >
                  <img src="/icons/call-accept.svg" alt="" width="18" height="18" />
                </button>

                <button
                  class="icon-action-btn menu-btn"
                  on:click={(e) => toggleCallMenu(call.id, e)}
                  aria-label="Опции"
                >
                  <img src="/icons/more-vertical.svg" alt="" width="18" height="18" />
                </button>

                {#if activeMenuCallId === call.id}
                  <div class="context-popup" in:scale={{ start: 0.9, duration: 150 }} on:click|stopPropagation>
                    <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'audio'); }}>
                      <img src="/icons/call-accept.svg" alt="" width="16" height="16" />
                      <span>Аудиозвонок</span>
                    </button>

                    <button class="popup-item" on:click={() => { activeMenuCallId = null; promptStartCall(call.peerId, call.name, call.avatar, 'video'); }}>
                      <img src="/icons/video.svg" alt="" width="16" height="16" />
                      <span>Видеозвонок</span>
                    </button>

                    <button class="popup-item" on:click={() => handleOpenChat(call.chatId, call.peerId)}>
                      <img src="/icons/chats.svg" alt="" width="16" height="16" />
                      <span>Перейти в чат</span>
                    </button>

                    <div class="popup-divider"></div>

                    <button class="popup-item popup-item--danger" on:click={() => deleteCallEntry(call)}>
                      <img src="/icons/trash.svg" alt="" width="16" height="16" />
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

  <button class="fab-new-call" on:click={() => { showNewCallModal = true; }} aria-label="Новый вызов">
    <img src="/icons/call-accept.svg" alt="" width="24" height="24" />
  </button>

  {#if showCreateModal}
    <div
      class="sheet-backdrop"
      on:click={() => { showCreateModal = false; }}
      role="presentation"
      transition:fade={{ duration: 180 }}
    >
      <div
        class="sheet-panel"
        on:click|stopPropagation
        transition:fly={{ y: 80, duration: 240, easing: cubicOut }}
      >
        <h3 class="sheet-title">Ссылка на видеовстречу</h3>
        <p class="sheet-desc">Отправьте эту ссылку участникам, чтобы они могли присоединиться</p>

        {#if creatingRoom}
          <div class="loading-box"><div class="spinner"></div><span>Создание комнаты...</span></div>
        {:else}
          <div class="link-input-row">
            <input type="text" readonly value={createdRoomLink} class="link-field" />
            <button class="copy-action-btn" class:copied={linkCopied} on:click={copyRoomLink}>
              {linkCopied ? 'Скопировано!' : 'Копировать'}
            </button>
          </div>

          <div class="custom-checkbox-row" on:click={() => { createSecureMode = !createSecureMode; }} role="button" tabindex="0">
            <div class="custom-checkbox-box" class:checked={createSecureMode}>
              {#if createSecureMode}
                <img src="/icons/check.svg" alt="" width="14" height="14" class="check-svg" />
              {/if}
            </div>
            <span class="custom-checkbox-label">Сквозное шифрование (E2E)</span>
          </div>

          <div class="sheet-actions-row">
            <button class="primary-btn" on:click={() => startCreatedConference(false)}>
              Начать аудио
            </button>
            <button class="primary-btn primary-btn--video" on:click={() => startCreatedConference(true)}>
              Начать с видео
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showJoinModal}
    <div
      class="sheet-backdrop"
      on:click={() => { showJoinModal = false; }}
      role="presentation"
      transition:fade={{ duration: 180 }}
    >
      <div
        class="sheet-panel"
        on:click|stopPropagation
        transition:fly={{ y: 80, duration: 240, easing: cubicOut }}
      >
        <h3 class="sheet-title">Присоединиться к звонку</h3>
        <p class="sheet-desc">Вставьте полученную ссылку или идентификатор конференции</p>

        <div class="join-field-wrap">
          <input
            type="text"
            placeholder="https://max.ru/joincall/..."
            bind:value={joinLinkInput}
            class="text-input"
          />
        </div>

        <div class="custom-checkbox-row" on:click={() => { joinWithVideo = !joinWithVideo; }} role="button" tabindex="0">
          <div class="custom-checkbox-box" class:checked={joinWithVideo}>
            {#if joinWithVideo}
              <img src="/icons/check.svg" alt="" width="14" height="14" class="check-svg" />
            {/if}
          </div>
          <span class="custom-checkbox-label">Включить камеру при входе</span>
        </div>

        <div class="custom-checkbox-row" on:click={() => { joinSecureMode = !joinSecureMode; }} role="button" tabindex="0">
          <div class="custom-checkbox-box" class:checked={joinSecureMode}>
            {#if joinSecureMode}
              <img src="/icons/check.svg" alt="" width="14" height="14" class="check-svg" />
            {/if}
          </div>
          <span class="custom-checkbox-label">Сквозное шифрование (E2E)</span>
        </div>

        <button
          class="primary-btn submit-btn"
          disabled={!joinLinkInput.trim()}
          on:click={submitJoinByLink}
        >
          Присоединиться
        </button>
      </div>
    </div>
  {/if}

  {#if showNewCallModal}
    <div
      class="sheet-backdrop"
      on:click={() => { showNewCallModal = false; }}
      role="presentation"
      transition:fade={{ duration: 180 }}
    >
      <div
        class="sheet-panel sheet-panel--tall"
        on:click|stopPropagation
        transition:fly={{ y: 80, duration: 240, easing: cubicOut }}
      >
        <h3 class="sheet-title">Новый звонок</h3>
        <div class="search-input-box">
          <img src="/icons/search.svg" alt="" width="18" height="18" />
          <input
            type="text"
            placeholder="Поиск по контактам..."
            bind:value={contactSearchQuery}
            class="clean-search-input"
          />
        </div>

        <div class="contacts-scroll-list">
          {#if filteredContacts.length === 0}
            <div class="empty-contacts">Контакты не найдены</div>
          {:else}
            {#each filteredContacts as contact (contact.id)}
              <div
                class="contact-picker-row"
                on:click={() => selectContactForCall(contact)}
                role="button"
                tabindex="0"
              >
                <Avatar size={42} contactId={contact.id} title={contact.name} src={contact.avatar || contact.baseUrl} />
                <div class="contact-picker-info">
                  <span class="contact-picker-name">
                    {contact.names?.[0]?.firstName ? `${contact.names[0].firstName} ${contact.names[0].lastName || ''}`.trim() : (contact.name || 'Контакт')}
                  </span>
                  {#if contact.phone}
                    <span class="contact-picker-phone">{formatPhone(contact.phone)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showModeSelectModal}
    <div
      class="sheet-backdrop"
      on:click={() => { showModeSelectModal = false; }}
      role="presentation"
      transition:fade={{ duration: 180 }}
    >
      <div
        class="sheet-panel"
        on:click|stopPropagation
        transition:fly={{ y: 80, duration: 240, easing: cubicOut }}
      >
        <h3 class="sheet-title">{targetPeerName || 'Звонок'}</h3>
        <p class="sheet-desc">Выберите режим соединения для вызова</p>

        <div class="mode-cards-grid">
          <div class="mode-card" on:click={() => executeCall(CALL_MODE.PLAIN)} role="button" tabindex="0">
            <div class="mode-icon mode-icon--standard">
              <img src="/icons/call-accept.svg" alt="" width="28" height="28" />
            </div>
            <span class="mode-label">Обычный</span>
            <span class="mode-sub">Быстрое P2P/SFU соединение</span>
          </div>

          <div class="mode-card mode-card--secure" on:click={() => executeCall(CALL_MODE.SECURE)} role="button" tabindex="0">
            <div class="mode-icon mode-icon--shield">
              <img src="/icons/shield.svg" alt="" width="28" height="28" />
            </div>
            <span class="mode-label">Безопасный E2E</span>
            <span class="mode-sub">Сквозное шифрование медиа</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .calls-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 16px 16px 0;
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
    color: #eee;
  }

  .active-call-strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 14px;
    background: rgba(74, 222, 128, 0.12);
    border: 1px solid rgba(74, 222, 128, 0.3);
    border-radius: 14px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .pulse-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 10px #4ade80;
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
    color: #fff;
  }

  .active-call-status {
    font-size: 11px;
    color: #4ade80;
  }

  .active-call-return {
    padding: 5px 12px;
    border-radius: 16px;
    background: #4ade80;
    color: #0b2413;
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
    background: var(--bg-surface, #1e2025);
    border: 1px solid rgba(255, 255, 255, 0.05);
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
    background: var(--bg-surface-2, #26262e);
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
    background: rgba(36, 139, 254, 0.15);
    color: #248bfe;
  }

  .tile-icon--green {
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
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
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
  }

  .tile-desc {
    font-size: 10.5px;
    color: var(--text-muted, #8b929e);
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
    background: var(--bg-surface, #1e2025);
    padding: 3px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    position: relative;
    user-select: none;
  }

  .segmented-slider {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    background: var(--bg-surface-2, #26262e);
    border-radius: 9px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
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
    color: var(--text-muted, #8b929e);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s;
    position: relative;
    z-index: 2;
  }

  .segment-btn.active {
    color: #ffffff;
  }

  .count-tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.1);
  }

  .count-tag--danger {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
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
    padding-bottom: calc(76px + env(safe-area-inset-bottom, 14px));
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
    border: 2.5px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--accent-primary, #248bfe);
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
    background: rgba(255, 255, 255, 0.04);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.2);
    margin-bottom: 4px;
  }

  .empty-headline {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
  }

  .empty-caption {
    margin: 0;
    font-size: 13px;
    color: var(--text-muted, #8b929e);
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
    background: rgba(255, 255, 255, 0.04);
  }

  .history-card:active {
    background: rgba(255, 255, 255, 0.07);
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
    color: #ffffff;
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
    color: var(--text-muted, #8b929e);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }

  .icon-action-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .icon-action-btn:active {
    transform: scale(0.92);
  }

  .dial-btn {
    color: var(--accent-primary, #248bfe);
    background: rgba(36, 139, 254, 0.1);
  }

  .dial-btn:hover {
    background: rgba(36, 139, 254, 0.2);
    color: #248bfe;
  }

  .context-popup {
    position: absolute;
    top: 40px;
    right: 0;
    z-index: 150;
    min-width: 190px;
    background: var(--bg-surface-2, #26262e);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .popup-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }

  .popup-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .popup-item--danger {
    color: var(--status-danger, #ef4444);
  }

  .popup-item--danger:hover {
    background: rgba(239, 68, 68, 0.12);
  }

  .popup-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
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
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    box-shadow: 0 4px 20px rgba(36, 139, 254, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    z-index: 90;
  }

  .fab-new-call:hover {
    box-shadow: 0 6px 24px rgba(36, 139, 254, 0.6);
  }

  .fab-new-call:active {
    transform: scale(0.92);
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .sheet-panel {
    width: 100%;
    max-width: 480px;
    background: var(--bg-surface, #1e2025);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px 24px 0 0;
    padding: 24px 20px calc(24px + env(safe-area-inset-bottom, 0px));
    box-sizing: border-box;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
  }

  .sheet-panel--tall {
    max-height: 80vh;
    display: flex;
    flex-direction: column;
  }

  .sheet-title {
    margin: 0 0 6px;
    font-size: 19px;
    font-weight: 700;
    color: #ffffff;
    text-align: center;
  }

  .sheet-desc {
    margin: 0 0 20px;
    font-size: 13px;
    color: var(--text-muted, #8b929e);
    text-align: center;
    line-height: 1.4;
  }

  .link-input-row {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
    width: 100%;
    box-sizing: border-box;
  }

  .link-field {
    flex: 1;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-app, #17181c);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 10px 12px;
    color: #ffffff;
    font-size: 13px;
    outline: none;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .copy-action-btn {
    padding: 0 16px;
    height: 40px;
    flex-shrink: 0;
    box-sizing: border-box;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    border: none;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }

  .copy-action-btn.copied {
    background: var(--status-success, #4ade80);
    color: #0b2413;
  }

  .sheet-actions-row {
    display: flex;
    gap: 10px;
  }

  @media (max-width: 380px) {
    .link-input-row {
      flex-direction: column;
    }
    .copy-action-btn {
      width: 100%;
    }
    .sheet-actions-row {
      flex-direction: column;
    }
  }

  .primary-btn {
    flex: 1;
    padding: 13px;
    border-radius: 14px;
    border: none;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.12s;
  }

  .primary-btn:active {
    transform: scale(0.97);
  }

  .primary-btn--video {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .join-field-wrap {
    margin-bottom: 16px;
  }

  .text-input {
    width: 100%;
    background: var(--bg-app, #17181c);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 13px 14px;
    color: #ffffff;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
  }

  .text-input:focus {
    border-color: var(--accent-primary, #248bfe);
  }

  .custom-checkbox-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 4px;
    margin-bottom: 8px;
    cursor: pointer;
    user-select: none;
  }

  .custom-checkbox-box {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }

  .custom-checkbox-box.checked {
    background: var(--accent-primary, #248bfe);
    border-color: var(--accent-primary, #248bfe);
  }

  .check-svg {
    color: #ffffff;
    display: block;
  }

  .custom-checkbox-label {
    font-size: 13.5px;
    color: #ffffff;
    font-weight: 500;
  }

  .submit-btn {
    margin-top: 14px;
    width: 100%;
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .search-input-box {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-app, #17181c);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 10px 14px;
    margin-bottom: 14px;
    color: var(--text-muted, #8b929e);
  }

  .clean-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 14px;
  }

  .contacts-scroll-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 200px;
  }

  .empty-contacts {
    text-align: center;
    padding: 40px 0;
    color: var(--text-muted, #8b929e);
    font-size: 13px;
  }

  .contact-picker-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .contact-picker-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .contact-picker-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .contact-picker-name {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
  }

  .contact-picker-phone {
    font-size: 12px;
    color: var(--text-muted, #8b929e);
  }

  .mode-cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .mode-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
    padding: 20px 12px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.04);
    border: 1.5px solid rgba(255, 255, 255, 0.07);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, transform 0.12s;
  }

  .mode-card:hover {
    border-color: rgba(255, 255, 255, 0.18);
  }

  .mode-card:active {
    transform: scale(0.96);
  }

  .mode-card--secure {
    background: rgba(74, 222, 128, 0.05);
    border-color: rgba(74, 222, 128, 0.2);
  }

  .mode-card--secure:hover {
    border-color: rgba(74, 222, 128, 0.45);
  }

  .mode-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mode-icon--standard {
    background: rgba(36, 139, 254, 0.15);
    color: #248bfe;
  }

  .mode-icon--shield {
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
  }

  .mode-label {
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
  }

  .mode-sub {
    font-size: 11px;
    color: var(--text-muted, #8b929e);
    line-height: 1.3;
  }
</style>
