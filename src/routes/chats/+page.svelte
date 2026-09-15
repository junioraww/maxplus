<script>
  import { fly } from "svelte/transition";
  import { onDestroy } from 'svelte';

  import ChatItem from "$components/chats/ChatItem.svelte";
  import FolderTabs from "$components/chats/FolderTabs.svelte";
  import AddContactBtn from "$components/main/AddContactBtn.svelte";
  import Search from "$components/main/Search.svelte";
  import FolderEditModal from "$components/chats/FolderEditModal.svelte";

  import { escapeHtml } from "$lib/utils/text.js";
  import { debounce } from "$lib/utils/debounce.js";
  import { openChat } from "$lib/stores/session.js";
  import API, {
    currentSessionChats,
    currentSessionCalls,
    currentRealChats,
    currentRealContacts,
    currentlySyncing,
    currentFolders,
    currentUser,
  } from "$lib/stores/api.js";
  import {
    getChat,
  } from "$lib/stores/messages";
  import {
    getContact,
    updateContact
  } from "$lib/stores/contacts";
  import { isChatMuted } from "$lib/utils/notifications";

  let localFolders = [];
  $: if ($currentFolders) {
    if (
      localFolders.length === 0 ||
      localFolders.length !== $currentFolders.length + 1
    ) {
      localFolders = [
        { id: 0, title: "Все", filters: null },
        ...($currentFolders || []),
      ];
    }
  }
  let activeFolder = null;
  let activeFolderIndex = 0;
  $: if (!activeFolder && localFolders.length > 0)
    activeFolder = localFolders[0];
  $: shouldRender = (index) => Math.abs(index - activeFolderIndex) <= 1;

  let selectedChats = new Set(); // ID выбранных чатов
  let isSelectionMode = false;

  $: isSelectionMode = selectedChats.size > 0;

  let searchQuery = "";
  let searchPublic = [];
  let searchMsg = [];

  /*receivedMessage.subscribe((msg) => {//TODO перенести в layout
    if (!msg || !msg.chatId) return;

    currentSessionChats.update((chats) => {
      const index = chats.findIndex((x) => x.id === msg.chatId);
      if (index === -1) return chats;

      const newChats = [...chats];
      const oldChat = newChats[index];

      const newLastMessage = {
        id: msg.id || Date.now(),
        text: msg.text || msg.content || "",
        time: Date.now(), // Время
        sender: msg.sender || msg.from,
        read: false,
        file: msg.file || null,
      };

      const updatedChat = {
        ...oldChat,
        lastMessage: newLastMessage,
        lastEventTime: Date.now(),
        newMessages: (oldChat.newMessages || 0) + 1,
      };

      newChats.splice(index, 1);
      newChats.unshift(updatedChat);

      return newChats;
    });
  });*/

  function handleChatLongPress(event) {
    const chat = event.detail;
    // вибрация уже сработала в компоненте
    if (!selectedChats.has(chat.id)) {
      selectedChats.add(chat.id);
      selectedChats = selectedChats; // триггер реактивности
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

  function deleteSelected() {
    if (!confirm(`Удалить ${selectedChats.size} чат(ов)?`)) return;
    // $API.deleteChats([...selectedChats]);
    clearSelection();
  }

  function pinSelected() {
    clearSelection();
  }

  function addToFolder() {
    alert(
      "Открыть модальное окно выбора папки для " +
        selectedChats.size +
        " чатов",
    );
    // clearSelection();
  }

  async function muteNotifications() {
    if (!selectedChats.size) return;
    const allSelected = Array.from(selectedChats).map(id => $currentSessionChats?.find(c => c.id === id)).filter(Boolean);
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
    if (include.includes(chat.id)) {
      return true;
    }

    const filters = folder.filters || [];
    if (!filters.length && !include.length) {
      return false;
    }

    const isDialog = chat.type === "DIALOG" || chat.type === "private";
    const isBot = chat?.options?.BOT === true || chat?.options?.IS_BOT === true || chat?.options?.includes?.("BOT");
    const peerId = isDialog ? (chat.ownerId === myId ? chat.id : chat.ownerId) : null;
    const isSelf = peerId != null && peerId === myId;
    const isContact = isDialog && !isSelf && peerId != null && contactIds.has(peerId);

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
    }

    if (filters.includes(0) && !(chat.newMessages > 0)) return false;
    if (filters.includes(1) && chat.newMessages > 0) return false;
    if (filters.includes(7) && !isChatMuted(chat)) return false;
    if (filters.includes(11) && isChatMuted(chat)) return false;

    return typeFilters.length > 0 || include.includes(chat.id);
  }

  function getChatsForFolder(folder, allChats, realChats, myId, contactIds) {
    if (!allChats || !realChats) return [];
    const chats = realChats
      .map((id) => allChats.find((x) => x.id === id))
      .filter(Boolean);

    const filtered = chats.filter((chat) =>
      chatMatchesFolder(chat, folder, myId, contactIds)
    );
    return filtered.sort(
      (a, b) => (b.lastEventTime || 0) - (a.lastEventTime || 0)
    );
  }

  $: contactIdSet = new Set($currentRealContacts || []);
  $: folderChatsMap = new Map(
    localFolders.map((folder) => [
      folder.id,
      getChatsForFolder(
        folder,
        $currentSessionChats,
        $currentRealChats,
        $currentUser,
        contactIdSet
      ),
    ])
  );

  async function handleSaveFolder(folderData) {
    try {
      await $API.updateFolder(folderData);
      showFolderModal = false;
      folderToEdit = null;
    } catch (e) {
      console.error(e);
      alert("Не удалось сохранить папку");
    }
  }

  async function handleDeleteFolder(folderId) {
    try {
      await $API.deleteFolders([folderId]);
      showFolderModal = false;
      folderToEdit = null;
      if (activeFolder?.id === folderId) {
        activeFolder = localFolders[0];
        activeFolderIndex = 0;
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось удалить папку");
    }
  }

  async function handleReorderFolders(event) {
    const newFolders = event.detail;
    localFolders = newFolders;
    const order = newFolders.filter((f) => f.id !== 0).map((f) => f.id);
    try {
      await $API.reorderFolders(order);
    } catch (e) {
      console.error(e);
    }
  }

  let scrollContainer;
  let isProgrammaticScroll = false;
  let scrollTimeout;

  function handleScroll(e) {
    if (isProgrammaticScroll) return;
    const container = e.target;
    const width = container.clientWidth;
    if (width === 0) return;
    const newIndex = Math.round(container.scrollLeft / width);
    if (newIndex !== activeFolderIndex && localFolders[newIndex]) {
      activeFolderIndex = newIndex;
      activeFolder = localFolders[newIndex];
    }
  }

  function onFolderTabClick(event) {
    const folder = event.detail;
    const index = localFolders.indexOf(folder);
    if (index !== -1 && scrollContainer) {
      isProgrammaticScroll = true;
      activeFolder = folder;
      activeFolderIndex = index;
      scrollContainer.scrollTo({
        left: index * scrollContainer.clientWidth,
        behavior: "smooth",
      });
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isProgrammaticScroll = false;
      }, 500);
    }
  }

  async function handleSearch(search) {
    searchQuery = search;
    if (!search.length || (await debounce("pubsearch", 700))) return;
    if (!searchQuery.length) {
      searchPublic = [];
      searchMsg = [];
      return;
    }

    /* сначала паблики */
    const { result: publicResult } = await $API.searchPublic(search);

    if (!publicResult) alert("Ошибка поиска!");

    for (const entry of publicResult) {
      /* немного реструктурирования. todo убрать */
      if (entry.chat) entry.chat.avatar = entry.chat.baseIconUrl;
      else if (entry.contact) {
        entry.contact = entry.contact.contact;
        entry.contact.avatar = entry.contact.baseUrl;
      }
    }

    searchPublic = publicResult;

    /* потом сообщения */
    const { result: msgResult } = await $API.searchMsg(search);
    searchMsg = msgResult;
  }

  const unsubscribers = new Map();

  $: if ($currentSessionChats) {
    $currentSessionChats.forEach((chat) => {
      if (!unsubscribers.has(chat.id)) {
        const { receivedMessage } = getChat(chat.id);
        let initialSkip = true;

        const unsub = receivedMessage.subscribe((msg) => {
          // Пропускаем начальное значение при первой подписке
          if (initialSkip) {
            initialSkip = false;
            return;
          }
          if (!msg) return;

          currentSessionChats.update((chats) => {
            const index = chats.findIndex((c) => c.id === chat.id);
            if (index === -1) return chats;

            const updatedChat = {
              ...chats[index],
              lastMessage: msg,
              lastEventTime: msg.time || Date.now(),
              newMessages: (chats[index].newMessages || 0) + 1,
            };

            const next = [...chats];
            next.splice(index, 1);
            return [updatedChat, ...next];
          });
        });

        unsubscribers.set(chat.id, unsub);
      }
    });
  }

  onDestroy(() => {
    unsubscribers.forEach(unsub => unsub());
    unsubscribers.clear();
  });

  let showFolderModal = false;
  let folderToEdit = null;
</script>

<div class="layout">
  <div class="header-container">
    {#if isSelectionMode}
      <div class="action-header" transition:fly={{ y: -50, duration: 200 }}>
        <div class="action-left">
          <button class="icon-btn" on:click={clearSelection}>
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              ><line x1="18" y1="6" x2="6" y2="18"></line><line
                x1="6"
                y1="6"
                x2="18"
                y2="18"
              ></line></svg
            >
          </button>
          <span class="selection-count">{selectedChats.size}</span>
        </div>

        <div class="action-right">
          <button class="icon-btn" on:click={pinSelected} title="Закрепить">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              ><path
                d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4a2 2 0 0 0-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58s1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41s-.23-1.06-.59-1.42zM5.5 7A1.5 1.5 0 1 1 7 5.5 1.5 1.5 0 0 1 5.5 7z"
              ></path></svg
            >
          </button>
          <button
            class="icon-btn"
            on:click={muteNotifications}
            title="Уведомления"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              ><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
              ></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg
            >
          </button>
          <button class="icon-btn" on:click={addToFolder} title="В папку">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              ><path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              ></path></svg
            >
          </button>
          <button class="icon-btn" on:click={downloadSelected} title="Скачать">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
              ></path><polyline points="7 10 12 15 17 10"></polyline><line
                x1="12"
                y1="15"
                x2="12"
                y2="3"
              ></line></svg
            >
          </button>
          <button class="icon-btn" on:click={deleteSelected} title="Удалить">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              ><polyline points="3 6 5 6 21 6"></polyline><path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              ></path></svg
            >
          </button>
        </div>
      </div>
    {:else}
      <div class="normal-header">
        <div class="row">
          <h3 style="margin-left: 15px;">Чаты</h3>
          <div style="margin-right: 15px;">
            <AddContactBtn />
          </div>
        </div>
        <Search input={handleSearch} placeholder="Поиск" />
      </div>
    {/if}
  </div>

  <FolderTabs
    folders={localFolders}
    bind:activeFolder
    on:folderChange={onFolderTabClick}
    on:reorder={handleReorderFolders}
    on:editFolder={(e) => {
      folderToEdit = e.detail;
      showFolderModal = true;
    }}
    on:addFolder={() => {
      folderToEdit = { isNew: true };
      showFolderModal = true;
    }}
  />

  {#if searchQuery.length}
    <div class="search-scrollable">
      {#if searchPublic.length}
        {#each searchPublic as result, i ((result.chat || result.contact).id)}
          <ChatItem
            chat={result.chat || result.contact}
            on:open={async () => {
              let chatId;

              if (result.chat) chatId = result.chat.id;
              else if (result.contact) {
                const contact = result.contact;

                chatId = $currentUser ^ contact.id;

                await updateContact(contact);
              }

              openChat(chatId);
            }}
          />
        {/each}
        <hr />
      {/if}

      {#if searchMsg.length}
        {#each searchMsg as result (result.count)}
          {@const chat = $currentSessionChats.find(
            (x) => x.id === result.chatId,
          )}
          {#if chat && result.message}
            {@const hl = result.highlights[0]}
            <ChatItem
              {chat}
              replace={{
                message: result.message,
                text: escapeHtml(result.message.text).replace(
                  new RegExp(hl, "gi"),
                  `<b>${hl}</b>`,
                ),
              }}
              on:open={() => openChat(result.chatId)}
            />
          {/if}
        {/each}
        <hr />
      {/if}
    </div>
  {/if}

  <div
    class="swipe-container"
    bind:this={scrollContainer}
    on:scroll={handleScroll}
  >
    {#each localFolders as folder, i (folder.id)}
      <div class="folder-page">
        {#if shouldRender(i)}
          <div class="chat-list-inner">
            {#if $currentlySyncing && i === activeFolderIndex && (!$currentSessionChats || $currentSessionChats.length === 0)}
              <div class="state">Загрузка...</div>
            {:else}
              {@const chats = folderChatsMap.get(folder.id) || []}

              {#if chats.length === 0}
                <div class="state">Нет чатов</div>
              {:else}
                {#each chats as chat (chat.id)}
                  <ChatItem
                    {chat}
                    selectionMode={isSelectionMode}
                    isSelected={selectedChats.has(chat.id)}
                    on:open={() => openChat(chat.id)}
                    on:longpress={handleChatLongPress}
                    on:toggle={handleChatToggle}
                  />
                {/each}
              {/if}
            {/if}
          </div>
        {:else}
          <div class="placeholder"></div>
        {/if}
      </div>
    {/each}
  </div>

  {#if showFolderModal && folderToEdit}
    <FolderEditModal
      folder={folderToEdit}
      allChats={$currentSessionChats}
      on:close={() => {
        showFolderModal = false;
        folderToEdit = null;
      }}
      on:save={(e) => handleSaveFolder(e.detail)}
      on:delete={(e) => handleDeleteFolder(e.detail)}
    />
  {/if}
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background-color: #1e1e1e;
  }

  .header-container {
    padding: 15px 0 0 0;
    position: relative;
    flex-shrink: 0;
    min-height: 80px;
  }

  .normal-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .action-header {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: #252525;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    box-sizing: border-box;
    border-bottom: 1px solid #333;
  }

  .action-left {
    display: flex;
    align-items: center;
    gap: 15px;
  }

  .selection-count {
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  .action-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: #eee;
    padding: 8px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h3 {
    margin: 0;
    color: #eee;
  }

  .swipe-container {
    flex: 1;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: grab;
  }
  .swipe-container::-webkit-scrollbar {
    display: none;
  }

  .folder-page {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  hr {
    width: 90%;
    color: #fff2;
  }

  .chat-list-inner {
    flex: 1;
    overflow-y: auto;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
  }

  .state {
    text-align: center;
    color: #777;
    margin-top: 50px;
  }

  .search-scrollable {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
</style>
