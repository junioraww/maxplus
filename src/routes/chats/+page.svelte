<script>
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';

  import ChatItem from "$components/chats/ChatItem.svelte";
  import FolderChatList from "$components/chats/FolderChatList.svelte";
  import FolderTabs from "$components/chats/FolderTabs.svelte";
  import StoriesTray from "$components/stories/StoriesTray.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import { openStoryComposer, sortedStoriesFeed, selfStoryPreview } from "$lib/stores/stories";
  import MediaPlaybackHeader from "$components/media/MediaPlaybackHeader.svelte";
  import { activeMedia } from "$lib/stores/mediaPlayback";
  import { panelSlider } from "$lib/utils/panelSlider";

  let storiesTrayEl;
  let isStoriesExpanded = true;

  $: myId = Number($currentUser);
  $: selfPreview = $selfStoryPreview;
  $: otherStoryPreviews = ($sortedStoriesFeed || []).filter((p) => Number(p.owner?.ownerId) !== myId);
  $: hasStories = otherStoryPreviews.length > 0 || (selfPreview && (selfPreview.totalCount || 0) > 0);
  $: topStoryAvatars = otherStoryPreviews.slice(0, 3);

  import { escapeHtml } from "$lib/utils/text";
  import { debounce } from "$lib/utils/debounce";
  import Session, { openChat, openStartConversation, openContactsModal, openFolderEdit, openContactAdd } from "$lib/stores/session";
  import ChatsListSearchScreen from "$components/main/ChatsListSearchScreen.svelte";
  import API, {
    currentSessionCalls,
    currentRealChats,
    currentRealContacts,
    currentlySyncing,
    currentFolders,
    currentUser,
    currentUserDetails,
  } from "$lib/stores/api";
  import {
    getChat,
    isChatInUserList,
  } from "$lib/stores/messages";
  import {
    getContact,
    updateContact
  } from "$lib/stores/contacts";
  import { isChatMuted } from "$lib/utils/notifications";
  import { forwardDraft, clearForwardDraft } from "$lib/stores/forwardDraft";
  import { forwardMessages } from "$components/ChatWindow/actions";
  import { showAlert } from "$lib/utils/alert";

  let localFolders = [];
  const isAllChatsFolder = (f) => {
    if (!f) return false;
    if (f.id === 0 || f.id === "0" || f.id === "all.chat.folder") return true;
    const t = (f.title || "").trim().toLowerCase();
    return t === "все" || t === "все чаты" || t === "all" || t === "all chats";
  };

  function areFoldersEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const fa = a[i];
      const fb = b[i];
      if (String(fa.id) !== String(fb.id) || fa.title !== fb.title) return false;
      if (JSON.stringify(fa.filters || []) !== JSON.stringify(fb.filters || [])) return false;
      if (JSON.stringify(fa.include || []) !== JSON.stringify(fb.include || [])) return false;
    }
    return true;
  }

  $: {
    const rawFolders = $currentFolders || [];
    const allIndex = rawFolders.findIndex(isAllChatsFolder);
    const nonAll = rawFolders.filter((f) => !isAllChatsFolder(f));

    let nextFolders;
    if (allIndex >= 0) {
      nextFolders = rawFolders.map((f) =>
        isAllChatsFolder(f) ? { ...f, id: "all.chat.folder", title: f.title || "Все" } : f
      );
    } else {
      nextFolders = [{ id: "all.chat.folder", title: "Все", filters: null }, ...nonAll];
    }

    if (!areFoldersEqual(localFolders, nextFolders)) {
      localFolders = nextFolders;
      activeFolder =
        localFolders.find((f) => String(f.id) === String(activeFolder?.id)) ||
        localFolders[0];
      activeFolderIndex = localFolders.findIndex((f) => String(f.id) === String(activeFolder?.id));
      if (activeFolderIndex === -1) activeFolderIndex = 0;
    }
  }

  let activeFolder = null;
  let activeFolderIndex = 0;
  $: if (!activeFolder && localFolders.length > 0)
    activeFolder = localFolders[0];
  let renderedFolderIndices = new Set([0]);
  $: {
    let changed = false;
    for (const idx of [activeFolderIndex - 1, activeFolderIndex, activeFolderIndex + 1]) {
      if (idx >= 0 && idx < localFolders.length && !renderedFolderIndices.has(idx)) {
        renderedFolderIndices.add(idx);
        changed = true;
      }
    }
    if (changed) {
      renderedFolderIndices = renderedFolderIndices;
    }
  }
  $: shouldRender = (index) => renderedFolderIndices.has(index);

  let selectedChats = new Set();
  let isSelectionMode = false;

  $: isSelectionMode = selectedChats.size > 0;

  let isSearchOpen = false;

  function openSearch() {
    isSearchOpen = true;
  }

  function handleChatLongPress(event) {
    const chat = event.detail;
    if (!selectedChats.has(chat.id)) {
      selectedChats.add(chat.id);
      selectedChats = selectedChats;
    }
  }

  function handleChatToggle(event) {
    const chat = event.detail;
    if (selectedChats.has(chat.id)) {
      selectedChats.delete(chat.id);
    } else {
      selectedChats.add(chat.id);
    }
    selectedChats = selectedChats;
  }

  function clearSelection() {
    selectedChats = new Set();
  }

  async function handleBatchForward() {
    if (!selectedChats.size || !$forwardDraft?.messages?.length) return;
    const msgs = [...$forwardDraft.messages];
    const targets = Array.from(selectedChats);
    clearForwardDraft();
    clearSelection();
    for (const targetId of targets) {
      await forwardMessages(Number(targetId), msgs);
    }
    showAlert("Сообщения пересланы");
  }

  function deleteSelected() {
    if (!confirm(`Удалить ${selectedChats.size} чат(ов)?`)) return;
    clearSelection();
  }

  function pinSelected() {
    clearSelection();
  }

  function addToFolder() {
    alert("Открыть модальное окно выбора папки для " + selectedChats.size + " чатов");
  }

  async function muteNotifications() {
    if (!selectedChats.size) return;
    const allSelected = Array.from(selectedChats).map(id => getChat(id).getInfo()).filter(Boolean);
    const anyMuted = allSelected.some(c => isChatMuted(c));
    const targetDDU = anyMuted ? 0 : -1;
    for (const chat of allSelected) {
      await $API.setChatMute(chat.id, targetDDU);
    }
    clearSelection();
  }

  function downloadSelected() {
    alert("Скачивание истории чатов...");
    clearSelection();
  }

  function chatMatchesFolder(chat, folder, myId, contactIds) {
    if (folder.id === 0 || folder.title === "Все" || folder.id === "all.chat.folder") {
      return true;
    }

    const include = folder.include || folder.includedChats || [];
    const isIncluded = include.includes(chat.id);
    const filters = folder.filters || [];

    if (!isIncluded) {
      if (!filters.length) return false;

      const isDialog = chat.type === "DIALOG" || chat.type === "private";
      let peerId = null;
      if (isDialog) {
        if (chat.participants && Object.keys(chat.participants).length > 0) {
          const other = Object.keys(chat.participants).find(id => String(id) !== String(myId));
          if (other) peerId = Number(other);
        }
        if (!peerId && chat.id && myId) {
          try {
            peerId = Number(BigInt(chat.id) ^ BigInt(myId));
          } catch {}
        }
      }

      const cachedContact = peerId ? get(getContact(peerId)) : null;
      const isBot =
        Boolean(cachedContact?.options && (Array.isArray(cachedContact.options) ? cachedContact.options.includes("BOT") : cachedContact.options.BOT)) ||
        chat?.options?.BOT === true ||
        chat?.options?.IS_BOT === true ||
        Boolean(Array.isArray(chat?.options) && chat.options.includes("BOT")) ||
        chat?.options?.bot === true;

      const isSelf = peerId != null && peerId === myId;
      const isContact = isDialog && !isBot && !isSelf && peerId != null && contactIds.has(peerId);

      const typeFilters = filters.filter((f) => [8, 9, 3, 2, 10, 4, 13].includes(f));
      if (typeFilters.length > 0) {
        const matchesType = typeFilters.some((f) => {
          switch (f) {
            case 8:
              return isDialog && !isBot && isContact;
            case 9:
              return isDialog && !isBot && !isSelf && !isContact;
            case 3:
              return chat.type === "CHAT" || chat.type === "GROUP" || chat.type === "group" || chat.type === "supergroup";
            case 2:
              return chat.type === "CHANNEL" || chat.type === "channel";
            case 10:
              return isBot;
            case 4:
              return isDialog;
            default:
              return false;
          }
        });
        if (!matchesType) return false;
      } else {
        return false;
      }
    }

    if (filters.includes(0) && !(chat.newMessages > 0)) return false;
    if (filters.includes(1) && chat.newMessages > 0) return false;
    if (filters.includes(7) && !isChatMuted(chat)) return false;
    if (filters.includes(11) && isChatMuted(chat)) return false;

    return true;
  }

  $: contactIdSet = new Set($currentRealContacts || []);

  $: chatsByFolderId = (() => {
    if (!$currentRealChats || !localFolders.length) return new Map();
    const chats = [];
    for (let i = 0; i < $currentRealChats.length; i++) {
      const found = getChat($currentRealChats[i]).getInfo();
      if (found && isChatInUserList(found, $currentUser)) chats.push(found);
    }
    const result = new Map();
    for (let f = 0; f < localFolders.length; f++) {
      const folder = localFolders[f];
      const filtered = chats.filter((chat) =>
        chatMatchesFolder(chat, folder, $currentUser, contactIdSet)
      );
      filtered.sort((a, b) => {
        const pinA = a.favIndex || (a.pinned ? 1 : 0);
        const pinB = b.favIndex || (b.pinned ? 1 : 0);
        if (pinA !== pinB) return pinB - pinA;
        const timeA = a.lastMessage?.time || a.lastEventTime || 0;
        const timeB = b.lastMessage?.time || b.lastEventTime || 0;
        return timeB - timeA;
      });
      result.set(folder.id, filtered);
    }
    return result;
  })();

  $: folderUnreadMap = (() => {
    const map = new Map();
    for (let f = 0; f < localFolders.length; f++) {
      const folder = localFolders[f];
      const folderChats = chatsByFolderId.get(folder.id) || [];
      let count = 0;
      for (let c = 0; c < folderChats.length; c++) {
        const u = folderChats[c]?.newMessages || 0;
        if (u > 0) count += u;
      }
      map.set(folder.id, count);
    }
    return map;
  })();

  function getFolderChats(folder) {
    return chatsByFolderId.get(folder?.id) || [];
  }

  async function handleReorderFolders(event) {
    const newFolders = event.detail;
    localFolders = newFolders;
    const order = newFolders.map((f) => String(f.id));
    try {
      await $API.reorderFolders(order);
    } catch (e) {
      console.error(e);
    }
  }

  let folderDragOffset = 0;
  let isFolderDragging = false;
  let isFolderSnapping = false;

  function ensureNeighborFoldersMounted(idx) {
    let changed = false;
    for (const t of [idx - 1, idx, idx + 1]) {
      if (t >= 0 && t < localFolders.length && !renderedFolderIndices.has(t)) {
        renderedFolderIndices.add(t);
        changed = true;
      }
    }
    if (changed) {
      renderedFolderIndices = new Set(renderedFolderIndices);
    }
  }

  function handleFolderDragStart() {
    isFolderDragging = true;
    isFolderSnapping = false;
  }

  function handleFolderDragMove(offset) {
    folderDragOffset = offset;
    if (offset < 0 && activeFolderIndex + 1 < localFolders.length) {
      ensureNeighborFoldersMounted(activeFolderIndex + 1);
    } else if (offset > 0 && activeFolderIndex - 1 >= 0) {
      ensureNeighborFoldersMounted(activeFolderIndex - 1);
    }
  }

  function handleFolderDragEnd(targetIndex, finalOffset, containerWidth) {
    const oldActive = activeFolderIndex;
    isFolderDragging = false;

    if (targetIndex === oldActive) {
      if (finalOffset === 0) {
        folderDragOffset = 0;
        return;
      }
      isFolderSnapping = true;
      folderDragOffset = 0;
      setTimeout(() => {
        isFolderSnapping = false;
      }, 280);
      return;
    }

    const offsetDelta = (targetIndex - oldActive) * containerWidth;
    const initialSnapOffset = finalOffset + offsetDelta;

    activeFolderIndex = targetIndex;
    activeFolder = localFolders[targetIndex];
    ensureNeighborFoldersMounted(targetIndex);

    folderDragOffset = initialSnapOffset;
    isFolderSnapping = false;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isFolderSnapping = true;
        folderDragOffset = 0;
        setTimeout(() => {
          isFolderSnapping = false;
        }, 280);
      });
    });
  }

  function onFolderTabClick(event) {
    const folder = event.detail;
    const index = localFolders.findIndex((f) => f.id === folder.id);
    if (index !== -1 && index !== activeFolderIndex) {
      activeFolderIndex = index;
      activeFolder = folder;
      folderDragOffset = 0;
      isFolderDragging = false;
      isFolderSnapping = true;
      ensureNeighborFoldersMounted(index);
      setTimeout(() => {
        isFolderSnapping = false;
      }, 280);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape" && isSelectionMode) {
      clearSelection();
    }
  }

  function handleInviteLink() {
    const nick = $currentUserDetails?.nick;
    const link = nick ? `https://max.ru/${nick}` : ($currentUser ? `https://max.ru/u/${$currentUser}` : "https://max.ru");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => {
        showAlert("Ссылка на ваш профиль скопирована");
      });
    } else {
      showAlert(link);
    }
  }

  onDestroy(() => {});
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="layout">
  <div class="header-container">
    {#if isSelectionMode}
      <div class="action-header" transition:fly={{ y: -50, duration: 200 }}>
        <div class="action-left">
          <button class="icon-btn" on:click={() => { if ($forwardDraft && $forwardDraft.messages?.length) { clearForwardDraft(); } clearSelection(); }}>
            <img src="/icons/close.svg" width="24" height="24" alt="" />
          </button>
          <span class="selection-count">{selectedChats.size}</span>
        </div>

        <div class="action-right">
          {#if $forwardDraft && $forwardDraft.messages?.length > 0}
            <button class="icon-btn send-forward-btn" on:click={handleBatchForward} title="Отправить">
              <span class="send-icon" aria-hidden="true"></span>
            </button>
          {:else}
            <button class="icon-btn" on:click={pinSelected} title="Закрепить">
              <img src="/icons/pin.svg" width="20" height="20" alt="" />
            </button>
            <button class="icon-btn" on:click={muteNotifications} title="Уведомления">
              <img src="/icons/mute.svg" width="20" height="20" alt="" />
            </button>
            <button class="icon-btn" on:click={addToFolder} title="В папку">
              <img src="/icons/folder.svg" width="20" height="20" alt="" />
            </button>
            <button class="icon-btn" on:click={downloadSelected} title="Скачать">
              <img src="/icons/download.svg" width="20" height="20" alt="" />
            </button>
            <button class="icon-btn" on:click={deleteSelected} title="Удалить">
              <img src="/icons/trash.svg" width="20" height="20" alt="" />
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="main-toolbar">
        <div class="toolbar-title-box">
          {#if $forwardDraft && $forwardDraft.messages?.length > 0}
            <button class="action-circle-btn" on:click={() => { clearForwardDraft(); clearSelection(); }} title="Отмена">
              <img src="/icons/close.svg" width="22" height="22" alt="" />
            </button>
            <h1 class="toolbar-title">Выбери получателя</h1>
          {:else}
            <h1 class="toolbar-title">Чаты</h1>
            {#if !isStoriesExpanded}
              <button
                type="button"
                class="stories-badge-btn"
                on:click={() => {
                  isStoriesExpanded = true;
                }}
                title="Истории"
                aria-label="Развернуть истории"
                transition:fade={{ duration: 150 }}
              >
                {#if topStoryAvatars.length > 0}
                  <div class="peanut-avatars-stack">
                    {#each topStoryAvatars as item, idx (item.owner?.ownerId || idx)}
                      <div class="peanut-avatar-wrap" style="z-index: {4 - idx};">
                        <Avatar
                          userId={item.owner?.ownerId}
                          contactId={item.owner?.ownerId}
                          size={24}
                          enableStoryRing={false}
                        />
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="new-story-gradient-icon">
                    <img src="/svg/new-story.svg" alt="" width="32" height="32" class="new-story-img" />
                  </div>
                {/if}
              </button>
            {/if}
          {/if}
        </div>

        {#if !$forwardDraft || !$forwardDraft.messages?.length}
          <div class="toolbar-actions">
            <button class="action-circle-btn" on:click={openSearch} title="Поиск">
              <img src="/icons/search.svg" alt="" width="20" height="20" />
            </button>
            <button class="action-circle-btn plus-btn" on:click={openStartConversation} title="Новый чат">
              <img src="/icons/plus.svg" alt="" width="20" height="20" />
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if !isSearchOpen}
    <StoriesTray
      bind:this={storiesTrayEl}
      bind:isExpanded={isStoriesExpanded}
      on:compose={() => openStoryComposer()}
    />
    <FolderTabs
      folders={localFolders}
      bind:activeFolder
      unreadCounts={folderUnreadMap}
      on:folderChange={onFolderTabClick}
      on:reorder={handleReorderFolders}
      on:editFolder={(e) => {
        openFolderEdit(e.detail);
      }}
      on:readFolder={async (e) => {
        const folder = e.detail;
        if (!folder) return;
        const chatsInFolder = chatsByFolderId.get(folder.id) || [];
        for (const c of chatsInFolder) {
          if (c?.id) {
            try {
              await $API?.markAsRead?.(c.id);
            } catch {}
          }
        }
      }}
      on:deleteFolder={(e) => {
        const folder = e.detail;
        if (!folder || folder.id === 0 || folder.id === "all.chat.folder") return;
        deleteFolder(folder.id);
      }}
      on:addFolder={() => {
        openFolderEdit({ isNew: true });
      }}
    />
  {/if}

  {#if $activeMedia}
    <MediaPlaybackHeader isChatHeader={false} />
  {/if}

  {#if isSearchOpen}
    <ChatsListSearchScreen on:close={() => (isSearchOpen = false)} />
  {/if}

  <div
    class="folders-slider"
    class:no-panel-drag={isSelectionMode}
    use:panelSlider={{
      getPagesCount: () => localFolders.length,
      getActive: () => activeFolderIndex,
      canDrag: () => localFolders.length > 1 && !isSelectionMode,
      nested: true,
      onPrepare: () => ensureNeighborFoldersMounted(activeFolderIndex),
        onDragStart: handleFolderDragStart,
        onDragMove: handleFolderDragMove,
        onDragEnd: handleFolderDragEnd,
      }}
    >
      <div
        class="folders-track"
        class:dragging={isFolderDragging}
        class:snapping={isFolderSnapping}
        style="transform: translate3d(calc({-activeFolderIndex * 100}% + {folderDragOffset}px), 0, 0);"
      >
        {#each localFolders as folder, i (folder.id)}
          <div class="folder-page">
            {#if shouldRender(i)}
              {@const folderChats = chatsByFolderId.get(folder.id) || []}
              <FolderChatList
                chats={folderChats}
                {isSelectionMode}
                {selectedChats}
                loading={$currentlySyncing && i === activeFolderIndex && (!$currentRealChats || $currentRealChats.length === 0)}
                on:open={(e) => e.detail && openChat(e.detail)}
                on:longpress={handleChatLongPress}
                on:toggle={handleChatToggle}
                on:findContact={openContactAdd}
                on:inviteLink={handleInviteLink}
                on:loadMore={() => {
                  if ($API?.loadMoreChats) {
                    $API.loadMoreChats();
                  }
                }}
                on:scroll={(e) => {
                  if (e.detail?.scrollTop > 20) {
                    storiesTrayEl?.collapse();
                  }
                }}
              />
            {:else}
              <div class="placeholder"></div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: transparent;
  }

  .header-container {
    padding: var(--safe-top, 0px) 0 0 0;
    position: relative;
    flex-shrink: 0;
    height: calc(52px + var(--safe-top, 0px));
    box-sizing: border-box;
    display: flex;
    align-items: center;
    background: transparent;
  }

  .main-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 52px;
    padding: 0 12px 0 16px;
    box-sizing: border-box;
  }

  .toolbar-title-box {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .toolbar-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 24px;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    letter-spacing: -0.2px;
  }

  .stories-badge-btn {
    background: none;
    border: none;
    padding: 0;
    margin: 0 0 0 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 16px;
    flex-shrink: 0;
    transition: transform 0.15s ease;
  }

  .stories-badge-btn:active {
    transform: scale(0.92);
  }

  .peanut-avatars-stack {
    display: flex;
    align-items: center;
    height: 28px;
  }

  .peanut-avatar-wrap {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin-right: -8px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 0 2px var(--bg-app, #17181c), 0 0 0 3.5px #3b82f6;
    background: var(--bg-app, #17181c);
    overflow: hidden;
  }

  .new-story-gradient-icon {
    width: 32px;
    height: 32px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .new-story-img {
    width: 32px;
    height: 32px;
    display: block;
    pointer-events: none;
    user-select: none;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-shrink: 0;
  }

  .action-circle-btn {
    width: 32px;
    height: 32px;
    border-radius: 12px;
    border: none;
    background: var(--bg-surface-subtle, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: background-color 0.15s ease, opacity 0.15s ease;
  }

  .action-circle-btn img {
    width: 20px;
    height: 20px;
  }

  .action-circle-btn.plus-btn {
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
  }

  .action-circle-btn.plus-btn:hover {
    background: var(--accent-primary-hover, #1a7ae6);
  }

  .action-circle-btn:hover {
    background-color: var(--bg-surface-subtle-hover, rgba(255, 255, 255, 0.14));
  }

  .action-header {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: var(--z-header, 4);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--safe-top, 0px) 12px 0 16px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    background: var(--bg-app, #17181c);
  }

  .action-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .selection-count {
    font-size: 18px;
    font-weight: 600;
    color: #ffffff;
  }

  .action-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--text-primary, #ffffff);
    padding: 8px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease;
  }

  .icon-btn:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }

  .send-forward-btn {
    color: var(--accent-primary, #248bfe);
  }

  .send-forward-btn .send-icon {
    width: 22px;
    height: 22px;
    background-color: currentColor;
    -webkit-mask: url("/icons/send.svg") no-repeat center / contain;
    mask: url("/icons/send.svg") no-repeat center / contain;
    display: inline-block;
  }

  .folders-slider {
    flex: 1;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }

  .folders-track {
    display: flex;
    width: 100%;
    height: 100%;
    will-change: transform;
    pointer-events: auto;
  }

  .folders-track.dragging {
    transition: none !important;
  }

  .folders-track.snapping {
    transition: transform 0.28s cubic-bezier(0.25, 1, 0.5, 1) !important;
  }

  .folder-page {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    contain: layout paint style;
    content-visibility: auto;
    contain-intrinsic-size: 100% 600px;
  }

  .placeholder {
    width: 100%;
    height: 100%;
  }
</style>
