<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { get } from "svelte/store";
  import API, { currentRealChats, currentUser } from "$lib/stores/api";
  import { getChat, isChatInUserList } from "$lib/stores/messages";
  import { getContact } from "$lib/stores/contacts";
  import Avatar from "$components/main/Avatar.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Switch from "$components/common/Switch.svelte";
  import { showAlert } from "$lib/utils/alert";
  import { showConfirm } from "$lib/stores/session";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let folder = null;
  export let allChats = [];
  export let close = null;
  export let setBackHandler = null;

  const dispatch = createEventDispatcher();

  const isNew = !folder || !folder.id || folder.id === 0 || folder.isNew;

  let view = "main";
  let title = folder?.title && folder?.id !== 0 ? folder.title : "";
  let filters = [...(folder?.filters || [])];
  let includedChats = [...(folder?.include || folder?.includedChats || [])];
  let stagedChatIds = [];
  let stagedFilters = [];
  let searchQuery = "";

  let touchStartX = 0;
  let touchStartY = 0;
  let swipeTranslateX = 0;
  let isSwiping = false;

  const FILTER_PRESETS = [
    { id: 8, label: "Контакты", desc: "Контакты из записной книжки", icon: "/icons/user.svg" },
    { id: 9, label: "Не контакты", desc: "Пользователи не из контактов", icon: "/icons/user-crossed.svg" },
    { id: 3, label: "Группы", desc: "Все групповые чаты", icon: "/icons/users.svg" },
    { id: 2, label: "Каналы", desc: "Все информационные каналы", icon: "/icons/megaphone.svg" },
    { id: 10, label: "Боты", desc: "Чат-боты", icon: "/icons/bot.svg" },
  ];

  let unregisterBack = null;

  $: if (setBackHandler) {
    setBackHandler(() => {
      if (searchQuery) {
        searchQuery = "";
        return false;
      }
      if (view === "picker") {
        view = "main";
        return false;
      }
      dismissFolderEditor();
      return true;
    });
  }

  if (typeof window !== "undefined" && !setBackHandler) {
    unregisterBack = registerBackHandler(() => {
      if (searchQuery) {
        searchQuery = "";
        return false;
      }
      if (view === "picker") {
        view = "main";
        return false;
      }
      dismissFolderEditor();
      return true;
    });
  }

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
  });

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (searchQuery) {
        searchQuery = "";
      } else if (view === "picker") {
        view = "main";
      } else {
        dismissFolderEditor();
      }
    }
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swipeTranslateX = 0;
    isSwiping = false;
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - touchStartX;
    const dy = currentY - touchStartY;

    if (!isSwiping) {
      if (dx > 12 && dx > Math.abs(dy) * 1.5 && touchStartX < 70) {
        isSwiping = true;
      }
    }

    if (isSwiping && dx > 0) {
      swipeTranslateX = dx;
    }
  }

  function onTouchEnd() {
    if (isSwiping) {
      if (swipeTranslateX > 90) {
        if (view === "picker") {
          view = "main";
        } else {
          dismissFolderEditor();
        }
      }
      swipeTranslateX = 0;
      isSwiping = false;
    }
  }

  function toggleFolderFilter(filterId) {
    if (filters.includes(filterId)) {
      filters = filters.filter((f) => f !== filterId);
    } else {
      filters = [...filters, filterId];
    }
  }

  function toggleStagedFilter(filterId) {
    if (stagedFilters.includes(filterId)) {
      stagedFilters = stagedFilters.filter((f) => f !== filterId);
    } else {
      stagedFilters = [...stagedFilters, filterId];
    }
  }

  function detachChatFromFolder(chatId) {
    includedChats = includedChats.filter((id) => Number(id) !== Number(chatId));
  }

  function openChatSelector() {
    stagedChatIds = [...includedChats];
    stagedFilters = [...filters];
    searchQuery = "";
    view = "picker";
  }

  function toggleStagedChatId(chatId) {
    const idNum = Number(chatId);
    if (stagedChatIds.some((id) => Number(id) === idNum)) {
      stagedChatIds = stagedChatIds.filter((id) => Number(id) !== idNum);
    } else {
      stagedChatIds = [...stagedChatIds, idNum];
    }
  }

  function commitSelectedChats() {
    includedChats = [...stagedChatIds];
    filters = [...stagedFilters];
    view = "main";
  }

  function generateUuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  $: canSave = title.trim().length > 0 && (filters.length > 0 || includedChats.length > 0);

  async function submitFolderData() {
    const trimmed = title.trim();
    if (!trimmed) {
      showAlert("Введите название папки");
      return;
    }
    if (filters.length === 0 && includedChats.length === 0) {
      showAlert("Выберите хотя бы один фильтр или чат");
      return;
    }

    const payload = {
      id: isNew ? generateUuid() : String(folder.id),
      title: trimmed,
      filters: filters.map(Number),
      include: includedChats.map(Number),
      options: (folder?.options || []).map(Number),
      favorites: (folder?.favorites || []).map(Number),
    };

    dispatch("save", payload);
    try {
      const api = typeof $API === "function" ? $API() : $API;
      if (api?.updateFolder) {
        await api.updateFolder(payload);
      }
    } catch {}
    dismissFolderEditor();
  }

  async function promptFolderDeletion() {
    if (isNew || !folder?.id) return;
    const ok = await showConfirm({
      title: "Удалить папку?",
      message: `Удалить папку «${folder.title}»? Чаты останутся на месте.`,
      confirmText: "Удалить",
      cancelText: "Отмена",
      confirmDanger: true,
    });
    if (!ok) return;
    dispatch("delete", folder.id);
    try {
      const api = typeof $API === "function" ? $API() : $API;
      if (api?.deleteFolders) {
        await api.deleteFolders([folder.id]);
      }
    } catch {}
    dismissFolderEditor();
  }

  function dismissFolderEditor() {
    dispatch("close");
    if (close) close();
  }

  function resolveDialogPartnerId(chat) {
    if (!chat) return null;
    if (chat.contactId) return Number(chat.contactId);
    if (chat.id === 0) return Number($currentUser);
    if (chat.type === "DIALOG" || chat.type === "private" || !chat.title) {
      if (chat.ownerId && Number(chat.ownerId) !== Number($currentUser)) {
        return Number(chat.ownerId);
      }
      if (chat.participants && Object.keys(chat.participants).length > 0) {
        const other = Object.keys(chat.participants).find((id) => Number(id) !== Number($currentUser));
        if (other) return Number(other);
      }
      if ($currentUser != null && chat.id != null) {
        try {
          const id = Number(BigInt(chat.id) ^ BigInt($currentUser));
          if (id > 0) return id;
        } catch (_) {}
      }
      return Number(chat.id);
    }
    return null;
  }

  function formatChatHeader(chat) {
    if (!chat) return "Чат";
    if (chat.id === 0) return "Избранное";
    if (chat.title) return chat.title;
    const partnerId = resolveDialogPartnerId(chat);
    if (partnerId) {
      const c = get(getContact(partnerId));
      if (c?.names?.[0]?.name) return c.names[0].name;
      if (c?.names?.[0]?.firstName) {
        return `${c.names[0].firstName} ${c.names[0].lastName || ""}`.trim();
      }
      if (c?.name) return c.name;
      if (c?.phone) return c.phone;
    }
    return chat.name || "Диалог";
  }

  $: userChatPool = (() => {
    if (allChats && allChats.length > 0) return allChats;
    const list = [];
    const ids = $currentRealChats || [];
    for (let i = 0; i < ids.length; i++) {
      const c = getChat(ids[i])?.getInfo();
      if (c && isChatInUserList(c, $currentUser)) {
        list.push(c);
      }
    }
    return list;
  })();

  $: includedChatObjects = includedChats.map((id) => {
    const found = userChatPool.find((c) => Number(c.id) === Number(id)) || getChat(id)?.getInfo();
    return found || { id: Number(id), title: `Чат #${id}` };
  });

  $: searchedChatList = userChatPool.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const t = formatChatHeader(c).toLowerCase();
    return t.includes(q);
  });

  $: searchedFilterList = FILTER_PRESETS.filter((f) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return f.label.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q);
  });
</script>

<svelte:window on:keydown={handleKeyDown} />

<div
  class="folder-screen-wrapper"
  transition:fly={{ x: 300, duration: 240, easing: cubicOut }}
  on:touchstart={onTouchStart}
  on:touchmove={onTouchMove}
  on:touchend={onTouchEnd}
  style={swipeTranslateX > 0 ? `transform: translate3d(${swipeTranslateX}px, 0, 0); transition: none;` : ""}
>
  {#if view === "main"}
    <header class="toolbar">
      <button type="button" class="icon-btn" on:click={(e) => { e.stopPropagation(); dismissFolderEditor(); }} aria-label="Назад">
        <img src="/icons/arrow.svg" alt="" class="back-arrow" />
      </button>
      <h1 class="toolbar-title">{isNew ? "Новая папка" : "Настройки папки"}</h1>
    </header>

    <div class="content-scroll">
      <div class="card-block">
        <input
          type="text"
          bind:value={title}
          placeholder="Название папки"
          maxlength="20"
          class="name-input"
        />
      </div>

      <div class="section-title-centered">ЧАТЫ В ПАПКЕ</div>

      <div class="card-block">
        <button type="button" class="add-chats-action-row" on:click={openChatSelector}>
          <div class="pure-plus-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </div>
          <span class="add-chats-text">Добавить чаты</span>
        </button>

        {#each includedChatObjects as chat (chat.id)}
          <div class="item-divider"></div>
          <div class="chat-member-row">
            <div class="avatar-cell">
              <Avatar
                {chat}
                title={formatChatHeader(chat)}
                contactId={resolveDialogPartnerId(chat)}
                size={40}
              />
            </div>
            <div class="member-info">
              <span class="member-title">{formatChatHeader(chat)}</span>
              <span class="member-sub">
                <Signature {chat} contactId={resolveDialogPartnerId(chat)} />
              </span>
            </div>
            <button
              type="button"
              class="remove-cross-btn"
              on:click|stopPropagation={() => detachChatFromFolder(chat.id)}
              aria-label="Удалить из папки"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        {/each}
      </div>

      <div class="section-title-centered">ТИПЫ ЧАТОВ</div>

      <div class="card-block no-border">
        {#each FILTER_PRESETS as preset, idx (preset.id)}
          {#if idx > 0}
            <div class="item-divider"></div>
          {/if}
          <div class="filter-switch-row" on:click={() => toggleFolderFilter(preset.id)}>
            <div class="filter-icon-box">
              <img src={preset.icon} alt="" width="20" height="20" class="filter-icon-img" />
            </div>
            <div class="member-info">
              <span class="member-title">{preset.label}</span>
            </div>
            <Switch
              checked={filters.includes(preset.id)}
              on:change={() => toggleFolderFilter(preset.id)}
              ariaLabel={preset.label}
            />
          </div>
        {/each}
      </div>

      {#if !isNew}
        <div class="card-block no-border">
          <button type="button" class="delete-folder-row" on:click={promptFolderDeletion}>
            <div class="delete-icon-box">
              <img src="/icons/trash.svg" alt="" width="20" height="20" class="trash-icon-img" />
            </div>
            <span class="delete-text">Удалить папку</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="bottom-action-bar">
      <button class="main-action-btn" on:click={submitFolderData} disabled={!canSave} type="button">
        {isNew ? "Создать папку" : "Сохранить"}
      </button>
    </div>

  {:else if view === "picker"}
    <div
      class="picker-stage"
      transition:fly={{ x: 300, duration: 240, easing: cubicOut }}
    >
      <header class="toolbar">
        <button type="button" class="icon-btn" on:click={(e) => { e.stopPropagation(); view = "main"; }} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-title-box">
          <h1 class="toolbar-title">Добавить в папку</h1>
        </div>
      </header>

      <div class="search-bar-wrap">
        <div class="search-bar-box">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-svg-icon">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="Поиск..."
            bind:value={searchQuery}
            class="search-input-field"
          />
          {#if searchQuery}
            <button type="button" class="search-clear-btn" on:click={() => (searchQuery = "")} aria-label="Очистить">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          {/if}
        </div>
      </div>

      <div class="content-scroll">
        {#if searchedFilterList.length > 0}
          <div class="sticky-section-header">ТИПЫ ЧАТОВ</div>
          <div class="card-block">
            {#each searchedFilterList as preset, idx (preset.id)}
              {#if idx > 0}
                <div class="item-divider"></div>
              {/if}
              <div class="picker-selectable-row" on:click={() => toggleStagedFilter(preset.id)}>
                <div class="radio-checkbox" class:checked={stagedFilters.includes(preset.id)}>
                  {#if stagedFilters.includes(preset.id)}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  {/if}
                </div>
                <div class="filter-avatar-circle">
                  <img src={preset.icon} alt="" width="20" height="20" class="filter-icon-img" />
                </div>
                <div class="member-info">
                  <span class="member-title">{preset.label}</span>
                  <span class="member-sub">{preset.desc}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <div class="sticky-section-header">ЧАТЫ И КАНАЛЫ</div>
        <div class="card-block">
          {#each searchedChatList as chat, idx (chat.id)}
            {#if idx > 0}
              <div class="item-divider"></div>
            {/if}
            <div class="picker-selectable-row" on:click={() => toggleStagedChatId(chat.id)}>
              <div class="radio-checkbox" class:checked={stagedChatIds.includes(Number(chat.id))}>
                {#if stagedChatIds.includes(Number(chat.id))}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                {/if}
              </div>
              <div class="avatar-cell">
                <Avatar
                  {chat}
                  title={formatChatHeader(chat)}
                  contactId={resolveDialogPartnerId(chat)}
                  size={40}
                />
              </div>
              <div class="member-info">
                <span class="member-title">{formatChatHeader(chat)}</span>
                <span class="member-sub">
                  <Signature {chat} contactId={resolveDialogPartnerId(chat)} />
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div class="bottom-action-bar">
        <button class="main-action-btn" on:click={commitSelectedChats} type="button">
          {stagedChatIds.length > 0 || stagedFilters.length > 0
            ? `Сохранить (${stagedChatIds.length + stagedFilters.length})`
            : "Сохранить"}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .folder-screen-wrapper {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-app, #17181c);
    color: var(--text-primary, #ffffff);
    z-index: var(--z-modal, 100);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
    will-change: transform;
  }

  .picker-stage {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: var(--bg-app, #17181c);
    display: flex;
    flex-direction: column;
    z-index: var(--z-panel);
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    height: calc(52px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0;
    background: var(--bg-topbar, #212126);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    border-radius: 50%;
    cursor: pointer;
    color: inherit;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .back-arrow {
    width: 14px;
    height: 14px;
    transform: scaleX(-1);
  }

  .toolbar-title-box {
    margin-left: 14px;
    flex: 1;
    min-width: 0;
  }

  .toolbar-title {
    margin: 0 0 0 14px;
    font-size: 19px;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
    letter-spacing: -0.2px;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .content-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    padding: 12px 16px calc(80px + var(--safe-bottom, 0px));
    gap: 16px;
    box-sizing: border-box;
    scrollbar-width: thin;
  }

  .card-block {
    background: var(--bg-surface-secondary, #26262e);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .card-block.no-border {
    border: none;
  }

  .name-input {
    width: 100%;
    height: 48px;
    padding: 0 16px;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary, #ffffff);
    font-size: 16px;
    font-weight: 400;
    box-sizing: border-box;
  }

  .section-title-centered {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary, #8b929e);
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 4px 0 0;
    flex-shrink: 0;
  }

  .sticky-section-header {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary, #8b929e);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 4px 8px 0;
    flex-shrink: 0;
  }

  .add-chats-action-row {
    height: 48px;
    min-height: 48px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    transition: background 0.14s ease;
  }

  .add-chats-action-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .pure-plus-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary, #248bfe);
    background: none;
    border: none;
    flex-shrink: 0;
  }

  .add-chats-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--accent-primary, #248bfe);
  }

  .chat-member-row {
    height: 56px;
    min-height: 56px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
  }

  .avatar-cell {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .member-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .member-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
  }

  .member-sub {
    font-size: 13px;
    color: var(--text-secondary, #8b929e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
    margin-top: 2px;
  }

  .remove-cross-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #8b929e);
    opacity: 0.65;
    flex-shrink: 0;
    transition: opacity 0.14s ease, background 0.14s ease;
  }

  .remove-cross-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
  }

  .item-divider {
    height: 0.5px;
    background: rgba(255, 255, 255, 0.08);
    margin-left: 54px;
    flex-shrink: 0;
  }

  .filter-switch-row {
    height: 48px;
    min-height: 48px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    box-sizing: border-box;
    transition: background 0.14s ease;
  }

  .filter-switch-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .filter-icon-box {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .filter-icon-img {
    filter: brightness(0) invert(1);
    opacity: 0.85;
  }

  .delete-folder-row {
    height: 48px;
    min-height: 48px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    transition: background 0.14s ease;
  }

  .delete-folder-row:hover {
    background: rgba(255, 77, 79, 0.08);
  }

  .delete-icon-box {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .trash-icon-img {
    filter: invert(36%) sepia(85%) saturate(3015%) hue-rotate(338deg) brightness(98%) contrast(93%);
  }

  .delete-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--danger, #ff4d4f);
    text-align: left;
  }

  .search-bar-wrap {
    padding: 8px 16px;
    background: var(--bg-topbar, #212126);
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  }

  .search-bar-box {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 0 12px;
    height: 38px;
    gap: 8px;
  }

  .search-svg-icon {
    color: var(--text-secondary, #8b929e);
    flex-shrink: 0;
  }

  .search-input-field {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary, #ffffff);
    font-size: 15px;
  }

  .search-clear-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-secondary, #8b929e);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .picker-selectable-row {
    height: 56px;
    min-height: 56px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    box-sizing: border-box;
    transition: background 0.14s ease;
  }

  .picker-selectable-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .radio-checkbox {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.28);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
    box-sizing: border-box;
  }

  .radio-checkbox.checked {
    background: var(--accent-primary, #248bfe);
    border-color: var(--accent-primary, #248bfe);
  }

  .filter-avatar-circle {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .bottom-action-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 12px 16px calc(12px + var(--safe-bottom, 0px));
    background: var(--bg-surface, #1e2025);
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    box-sizing: border-box;
    z-index: var(--z-floating);
  }

  .main-action-btn {
    width: 100%;
    height: 48px;
    border-radius: 14px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    font-size: 15px;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .main-action-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover, #1a7ae6);
  }

  .main-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
