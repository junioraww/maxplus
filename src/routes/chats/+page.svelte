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
  import Session, { openChat, openStartConversation, openContactsModal, openFolderEdit, openContactAdd, showConfirm } from "$lib/stores/session";
  import { openScreen } from "$lib/services/layerManager";
  import ChatsListSearchScreen from "$components/main/ChatsListSearchScreen.svelte";
  import StartConversationScreen from "$components/main/StartConversationScreen.svelte";
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
      if (JSON.stringify(fa.favorites || []) !== JSON.stringify(fb.favorites || [])) return false;
    }
    return true;
  }

  $: {
    const rawFolders = $currentFolders || [];
    const allIndex = rawFolders.findIndex(isAllChatsFolder);
    const nonAll = rawFolders.filter((f) => !isAllChatsFolder(f));

    let nextFolders;
    if (allIndex >= 0) {
      const allFolder = {
        ...rawFolders[allIndex],
        id: "all.chat.folder",
        title: rawFolders[allIndex].title || "Все",
        favorites: rawFolders[allIndex].favorites || [],
      };
      nextFolders = [allFolder, ...nonAll];
    } else {
      nextFolders = [{ id: "all.chat.folder", title: "Все", filters: null, favorites: [] }, ...nonAll];
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
  $: if (isSelectionMode) {
    isFolderDragging = false;
    isFolderSnapping = false;
    folderDragOffset = 0;
  }
  $: isAllSelectedPinned = (() => {
    if (!selectedChats.size) return false;
    const currentFolder = localFolders[activeFolderIndex] || localFolders[0];
    if (!currentFolder) return false;
    const currentFavs = Array.from(currentFolder.favorites || []).map(Number);
    return Array.from(selectedChats).every((id) => currentFavs.includes(Number(id)));
  })();

  function openSearch() {
    openScreen(ChatsListSearchScreen);
  }

  function handleNewChat() {
    openScreen(StartConversationScreen);
  }

  function handleChatLongPress(event) {
    isFolderDragging = false;
    isFolderSnapping = false;
    folderDragOffset = 0;
    const chat = event.detail;
    if (!selectedChats.has(chat.id)) {
      selectedChats.add(chat.id);
      selectedChats = selectedChats;
    }
  }

  function handleChatToggle(event) {
    isFolderDragging = false;
    isFolderSnapping = false;
    folderDragOffset = 0;
    const chat = event.detail;
    if (selectedChats.has(chat.id)) {
      selectedChats.delete(chat.id);
    } else {
      selectedChats.add(chat.id);
    }
    selectedChats = selectedChats;
  }

  function clearSelection() {
    isFolderDragging = false;
    isFolderSnapping = false;
    folderDragOffset = 0;
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

  async function pinSelected() {
    if (!selectedChats.size) {
      clearSelection();
      return;
    }
    const currentFolder = localFolders[activeFolderIndex] || localFolders[0];
    if (!currentFolder) {
      clearSelection();
      return;
    }
    const currentFavs = Array.from(currentFolder.favorites || []).map(Number);
    const selectedIds = Array.from(selectedChats).map(Number);

    const allPinned = selectedIds.every((id) => currentFavs.includes(id));
    let nextFavs;
    if (allPinned) {
      nextFavs = currentFavs.filter((id) => !selectedIds.includes(id));
    } else {
      nextFavs = [...currentFavs];
      for (const id of selectedIds) {
        if (!nextFavs.includes(id)) {
          nextFavs.push(id);
        }
      }
    }

    const updatedFolder = {
      ...currentFolder,
      favorites: nextFavs,
    };

    localFolders[activeFolderIndex] = updatedFolder;
    localFolders = [...localFolders];

    try {
      if ($API?.updateFolder) {
        await $API.updateFolder(updatedFolder);
      }
    } catch (err) {
      console.error(err);
    }
    clearSelection();
  }

  async function removeFolderInteractive(folderId) {
    const f = localFolders.find((x) => String(x.id) === String(folderId));
    if (!f || f.id === 0 || f.id === "all.chat.folder") return;
    const ok = await showConfirm({
      title: "Удалить папку?",
      message: `Удалить папку «${f.title}»? Чаты останутся на месте.`,
      confirmText: "Удалить",
      isDangerous: true,
    });
    if (!ok) return;
    try {
      if ($API?.deleteFolders) {
        await $API.deleteFolders([folderId]);
      }
    } catch (e) {
      console.error(e);
    }
    localFolders = localFolders.filter((x) => String(x.id) !== String(folderId));
    if (activeFolder && String(activeFolder.id) === String(folderId)) {
      activeFolder = localFolders[0] || null;
      activeFolderIndex = 0;
    }
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

  const FOLDER_FILTER = {
    UNREAD: 0,
    READ: 1,
    CHANNEL: 2,
    GROUP: 3,
    DIALOG: 4,
    MUTED: 7,
    CONTACT: 8,
    NON_CONTACT: 9,
    BOT: 10,
    UNMUTED: 11,
    MARKED_UNREAD: 12,
    ORG: 13,
  };

  function resolveDirectPeerId(chat, myUserId) {
    if (!chat) return null;
    const myStr = String(myUserId);
    if (chat.participants && typeof chat.participants === "object") {
      const other = Object.keys(chat.participants).find((p) => String(p) !== myStr);
      if (other) return String(other);
    }
    if (chat.id != null && myUserId != null) {
      try {
        return (BigInt(chat.id) ^ BigInt(myUserId)).toString();
      } catch {}
    }
    return null;
  }

  function inspectChatCategory(chat, myUserId, contactIdSet) {
    const raw = String(chat?.type || "").toUpperCase();
    if (raw === "CHANNEL") return "channel";
    if (raw === "CHAT" || raw === "GROUP" || raw === "SUPERGROUP") return "group";

    const isDirect = raw === "DIALOG" || raw === "PRIVATE";
    if (!isDirect) return "other";

    const peerStr = resolveDirectPeerId(chat, myUserId);
    const isSavedSelf = peerStr !== null && peerStr === String(myUserId);

    let botFlag = false;
    if (peerStr) {
      const contactData = get(getContact(peerStr));
      const contactOpts = contactData?.options;
      botFlag = Boolean(
        Array.isArray(contactOpts) ? contactOpts.includes("BOT") : contactOpts?.BOT
      );
    }
    if (!botFlag && chat?.options) {
      const opts = chat.options;
      botFlag = Boolean(
        Array.isArray(opts) ? opts.includes("BOT") : (opts.BOT || opts.IS_BOT || opts.bot)
      );
    }
    if (botFlag) return "bot";

    if (peerStr && !isSavedSelf && contactIdSet.has(peerStr)) {
      return "contact_dialog";
    }
    if (peerStr && !isSavedSelf) {
      return "non_contact_dialog";
    }
    return "dialog";
  }

  function isChatInFolder(chat, folder, myUserId, contactIdSet) {
    if (!folder || folder.id === 0 || folder.title === "Все" || folder.id === "all.chat.folder") {
      return true;
    }

    const explicitIds = folder.include || folder.includedChats || [];
    const isExplicitlyIncluded = explicitIds.some((id) => String(id) === String(chat?.id));
    const activeFilters = folder.filters || [];

    if (!isExplicitlyIncluded) {
      if (!activeFilters.length) return false;

      const category = inspectChatCategory(chat, myUserId, contactIdSet);
      const TYPE_FILTER_IDS = [
        FOLDER_FILTER.CONTACT,
        FOLDER_FILTER.NON_CONTACT,
        FOLDER_FILTER.GROUP,
        FOLDER_FILTER.CHANNEL,
        FOLDER_FILTER.BOT,
        FOLDER_FILTER.DIALOG,
        FOLDER_FILTER.ORG,
      ];
      const activeTypeFilters = activeFilters.filter((f) => TYPE_FILTER_IDS.includes(f));

      if (activeTypeFilters.length > 0) {
        const matchesCategory = activeTypeFilters.some((filterId) => {
          if (filterId === FOLDER_FILTER.CONTACT) return category === "contact_dialog";
          if (filterId === FOLDER_FILTER.NON_CONTACT) return category === "non_contact_dialog";
          if (filterId === FOLDER_FILTER.GROUP) return category === "group";
          if (filterId === FOLDER_FILTER.CHANNEL) return category === "channel";
          if (filterId === FOLDER_FILTER.BOT) return category === "bot";
          if (filterId === FOLDER_FILTER.DIALOG) {
            return category === "dialog" || category === "contact_dialog" || category === "non_contact_dialog";
          }
          return false;
        });
        if (!matchesCategory) return false;
      }
    }

    const hasUnread = Boolean((chat.newMessages || 0) > 0 || chat.unread || chat.markedUnread);
    if (activeFilters.includes(FOLDER_FILTER.UNREAD) && !hasUnread) return false;
    if (activeFilters.includes(FOLDER_FILTER.READ) && hasUnread) return false;

    const muted = isChatMuted(chat);
    if (activeFilters.includes(FOLDER_FILTER.MUTED) && !muted) return false;
    if (activeFilters.includes(FOLDER_FILTER.UNMUTED) && muted) return false;

    return true;
  }

  $: contactIdSet = new Set(($currentRealContacts || []).map(String));

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
        isChatInFolder(chat, folder, $currentUser, contactIdSet)
      );
      const folderFavs = (folder.favorites || []).map(Number);
      const isAllFolder = isAllChatsFolder(folder);
      filtered.sort((a, b) => {
        const isFavA = folderFavs.includes(Number(a.id));
        const isFavB = folderFavs.includes(Number(b.id));
        const pinA = isFavA ? 2 : (isAllFolder ? (a.favIndex || (a.pinned ? 1 : 0)) : 0);
        const pinB = isFavB ? 2 : (isAllFolder ? (b.favIndex || (b.pinned ? 1 : 0)) : 0);
        if (pinA !== pinB) return pinB - pinA;
        const timeA = a.lastMessage?.time || a.lastEventTime || 0;
        const timeB = b.lastMessage?.time || b.lastEventTime || 0;
        return timeB - timeA;
      });
      const decorated = filtered.map((c) => {
        const isFav = folderFavs.includes(Number(c.id));
        return {
          ...c,
          isPinned: isFav || (isAllFolder ? Boolean(c.favIndex || c.pinned) : false),
        };
      });
      result.set(folder.id, decorated);
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
    if (!folder) return;
    const index = localFolders.findIndex((f) => String(f.id) === String(folder.id));
    if (index !== -1 && index !== activeFolderIndex) {
      activeFolderIndex = index;
      activeFolder = localFolders[index];
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
            <button class="icon-btn" on:click={pinSelected} title={isAllSelectedPinned ? "Открепить" : "Закрепить"}>
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
            <h1 class="toolbar-title font-title">Выбери получателя</h1>
          {:else}
            <h1 class="toolbar-title font-title">Чаты</h1>
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
            <button class="action-circle-btn plus-btn" on:click={handleNewChat} title="Новый чат">
              <img src="/icons/plus.svg" alt="" width="20" height="20" />
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

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
      const unreadChats = chatsInFolder.filter((c) => c?.id && (c.newMessages || 0) > 0);
      if (!unreadChats.length) return;

      const now = Date.now();
      for (const c of unreadChats) {
        const chatStore = getChat(c.id);
        chatStore?.chatInfo?.update?.((current) => {
          if (!current) return current;
          return {
            ...current,
            newMessages: 0,
            hasReaction: false,
            unreadReactions: 0,
            lastReaction: null,
            unread: false,
            markedUnread: false,
          };
        });
      }
      currentRealChats.update((ids) => [...(ids || [])]);

      await Promise.allSettled(
        unreadChats.map((c) =>
          $API?.markAsRead
            ? $API.markAsRead(c.id, c.lastMessage?.id, c.lastEventTime || now)
            : Promise.resolve()
        )
      );
      currentRealChats.update((ids) => [...(ids || [])]);
    }}
    on:deleteFolder={(e) => {
      const folder = e.detail;
      if (!folder || folder.id === 0 || folder.id === "all.chat.folder") return;
      removeFolderInteractive(folder.id);
    }}
    on:addFolder={() => {
      openFolderEdit({ isNew: true });
    }}
  />

  {#if $activeMedia}
    <MediaPlaybackHeader isChatHeader={false} />
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
                on:open={(e) => {
                  const id = e.detail?.id ?? e.detail;
                  if (id != null) openChat(id);
                }}
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
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .action-circle-btn.plus-btn {
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
  }

  .action-circle-btn.plus-btn img {
    filter: none;
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
    color: var(--text-primary);
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

  .icon-btn img {
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .icon-btn:hover {
    background-color: var(--bg-hover);
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
