<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import Signature from "$components/main/Signature.svelte";
  import { openProfile } from "$lib/stores/session";
  import { currentUser } from "$lib/stores/api";
  import { getChatSettings } from "$lib/stores/messages";
  import { getContact } from "$lib/stores/contacts";
  import { CallService } from "$lib/services/CallService";
  import { activeCall, CALL_PHASE } from "$lib/stores/calls";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import { showAlert } from "$lib/utils/alert";
  import { openScreen } from "$lib/services/layerManager";

  const pluginHeaderLeadings = getMountStore("chat:header-leading");
  const pluginHeaderInfos = getMountStore("chat:header-info");
  const pluginHeaderActions = getMountStore("chat:header-action");

  export let chat;
  export let avatarUserId;
  export let title = "";
  export let isSearchOpen = false;
  export let searchQuery = "";
  export let searchMatchIndex = 0;
  export let searchMatchCount = 0;

  let searchInputEl;
  $: if (isSearchOpen && searchInputEl) {
    setTimeout(() => searchInputEl?.focus(), 50);
  }

  const dispatch = createEventDispatcher();

  let showMoreMenu = false;
  let moreMenuAnchorEl;

  $: chatSettings = chat?.id != null ? getChatSettings(chat.id) : null;
  $: fingerprint = $chatSettings?.session?.fingerprint;
  $: peerContact = avatarUserId ? getContact(avatarUserId) : null;
  $: canCall = Boolean(
    chat &&
    chat.type === "DIALOG" &&
    avatarUserId &&
    Number(avatarUserId) !== Number($currentUser) &&
    !$peerContact?.bot &&
    !$peerContact?.options?.includes("BOT") &&
    $peerContact?.status !== "REMOVED" &&
    $peerContact?.accountStatus !== "DELETED"
  );

  function getFingerprintEmojis(val) {
    if (!val) return [];
    let raw = [];
    if (Array.isArray(val)) {
      raw = val;
    } else if (typeof Intl !== "undefined" && Intl.Segmenter) {
      raw = Array.from(new Intl.Segmenter().segment(String(val)), (s) => s.segment);
    } else {
      raw = Array.from(String(val));
    }
    return raw.filter((s) => s.trim().length > 0).slice(0, 4);
  }

  $: effectivePeerId = (() => {
    if (avatarUserId && Number(avatarUserId) > 0) return Number(avatarUserId);
    if (chat?.participants) {
      const pIds = Array.isArray(chat.participants)
        ? chat.participants.map(p => (typeof p === 'object' ? (p.id || p.userId) : p))
        : Object.keys(chat.participants);
      const other = pIds.find(id => String(id) !== String($currentUser));
      if (other && Number(other) > 0) return Number(other);
    }
    return null;
  })();

  function handleAudioCall() {
    if ($activeCall.phase !== CALL_PHASE.IDLE) return;
    const mode = ($chatSettings?.session?.shared_secret || $chatSettings?.password) ? 'secure' : 'plain';
    if (chat?.type === "CHAT") {
      CallService.placeGroupAudioCall(chat.id, title, chat?.avatar || chat?.iconUrl, mode);
      return;
    }
    const targetPeerId = effectivePeerId;
    if (!targetPeerId) {
      showAlert('Не удалось определить собеседника для звонка');
      return;
    }
    CallService.placeAudioCall(targetPeerId, title, chat?.avatar || chat?.iconUrl || $peerContact?.avatar, mode);
  }

  function handleVideoCall() {
    if ($activeCall.phase !== CALL_PHASE.IDLE) return;
    const mode = ($chatSettings?.session?.shared_secret || $chatSettings?.password) ? 'secure' : 'plain';
    if (chat?.type === "CHAT") {
      CallService.placeGroupVideoCall(chat.id, title, chat?.avatar || chat?.iconUrl, mode);
      return;
    }
    const targetPeerId = effectivePeerId;
    if (!targetPeerId) {
      showAlert('Не удалось определить собеседника для видеозвонка');
      return;
    }
    CallService.placeVideoCall(targetPeerId, title, chat?.avatar || chat?.iconUrl || $peerContact?.avatar, mode);
  }

  function handleClose() {
    dispatch("close");
  }

  function handleOpenSettings() {
    dispatch("openSettings");
  }

  async function handleOpenAdvancedSettings() {
    const mod = await import("$components/ChatWindow/AdvancedSettingsScreen.svelte");
    openScreen(mod.default || mod, { chat, userId: avatarUserId }, { canSwipe: true });
  }

  function handleProfileClick() {
    if (!chat) return;
    if (chat.id === 0) {
      openProfile({ userId: $currentUser, chatId: 0 });
    } else if (chat.type === "DIALOG") {
      openProfile({ userId: avatarUserId, chatId: chat.id });
    } else {
      openProfile({ chatId: chat.id });
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpenSettings();
    }
  }

  function handleDocClick(e) {
    if (showMoreMenu && moreMenuAnchorEl && !moreMenuAnchorEl.contains(e.target)) {
      showMoreMenu = false;
    }
  }

  onMount(() => {
    if (typeof document !== "undefined") {
      document.addEventListener("click", handleDocClick);
    }
  });

  onDestroy(() => {
    if (typeof document !== "undefined") {
      document.removeEventListener("click", handleDocClick);
    }
  });
</script>

{#if isSearchOpen}
  <header class="chat-topbar search-mode">
    <button
      class="icon-button back-button"
      on:click|stopPropagation={() => dispatch("closeSearch")}
      aria-label="Закрыть поиск"
      title="Закрыть поиск (Esc)"
    >
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>

    <div class="search-input-field">
      <span class="mask-icon search-field-icon" style="-webkit-mask-image: url('/icons/search.svg'); mask-image: url('/icons/search.svg'); width: 18px; height: 18px;"></span>
      <input
        bind:this={searchInputEl}
        type="text"
        class="search-text-input"
        placeholder="Поиск по сообщениям"
        bind:value={searchQuery}
        on:input={(e) => dispatch("searchQueryChange", e.target.value)}
        on:keydown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            dispatch("closeSearch");
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) {
              dispatch("searchPrev");
            } else {
              dispatch("searchNext");
            }
          }
        }}
      />
      {#if searchQuery && searchQuery.length > 0}
        <button
          type="button"
          class="search-clear-btn"
          on:click|stopPropagation={() => {
            searchQuery = "";
            dispatch("searchQueryChange", "");
            if (searchInputEl) searchInputEl.focus();
          }}
          title="Очистить"
          aria-label="Очистить"
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 16px; height: 16px;"></span>
        </button>
      {/if}
    </div>

    <div class="search-actions">
      {#if searchQuery && searchQuery.trim().length > 0}
        {#if searchMatchCount > 0}
          <span class="search-counter">{searchMatchIndex + 1} из {searchMatchCount}</span>
        {:else}
          <span class="search-counter not-found">Не найдено</span>
        {/if}
      {/if}

      <button
        class="header-action-btn search-nav-btn"
        type="button"
        disabled={searchMatchCount === 0}
        title="Предыдущее совпадение (Shift+Enter)"
        aria-label="Предыдущее совпадение"
        on:click|stopPropagation={() => dispatch("searchPrev")}
      >
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg'); width: 18px; height: 18px; transform: rotate(180deg);"></span>
      </button>

      <button
        class="header-action-btn search-nav-btn"
        type="button"
        disabled={searchMatchCount === 0}
        title="Следующее совпадение (Enter)"
        aria-label="Следующее совпадение"
        on:click|stopPropagation={() => dispatch("searchNext")}
      >
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg'); width: 18px; height: 18px;"></span>
      </button>
    </div>
  </header>
{:else}
  <header class="chat-topbar">
    <div class="align-left">
      <button
        class="icon-button back-button"
        on:click|stopPropagation={handleClose}
        aria-label="Назад"
        title="Назад"
      >
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
      </button>
      <div
        class="row"
        on:click={handleProfileClick}
      >
        {#each $pluginHeaderLeadings as item (item.id)}
          <div class="plugin-mount-inline plugin-header-leading" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </div>
        {/each}
        <div class="toolbar-avatar-wrap">
          <Avatar size={40} {chat} {title} contactId={avatarUserId} allowStories={true} style="cursor: pointer; flex-shrink: 0;"/>
        </div>
        <div class="info">
          <span class="title type-toolbar-title">{title}</span>
          <span class="presence type-subtitle"><Signature {chat} contactId={avatarUserId} /></span>
          {#each $pluginHeaderInfos as item (item.id)}
            <div class="plugin-mount-block plugin-header-info" data-plugin-mount={item.pluginId || item.id}>
              {@html item.html}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="align-right">
      {#each $pluginHeaderActions as item (item.id)}
        <div class="plugin-mount-inline plugin-header-action" data-plugin-mount={item.pluginId || item.id}>
          {@html item.html}
        </div>
      {/each}

      {#if canCall || chat?.type === "CHAT"}
        <button
          class="header-action-btn"
          type="button"
          disabled={$activeCall.phase !== CALL_PHASE.IDLE}
          on:click|stopPropagation={handleAudioCall}
          title="Позвонить"
          aria-label="Позвонить"
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/call.svg'); mask-image: url('/icons/call.svg'); width: 20px; height: 20px;"></span>
        </button>

        <button
          class="header-action-btn"
          type="button"
          disabled={$activeCall.phase !== CALL_PHASE.IDLE}
          on:click|stopPropagation={handleVideoCall}
          title="Видеозвонок"
          aria-label="Видеозвонок"
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/video.svg'); mask-image: url('/icons/video.svg'); width: 20px; height: 20px;"></span>
        </button>
      {/if}

      {#if chat && chat.type !== "CHANNEL" && chat.type !== "CHAT" && fingerprint}
        <button
          type="button"
          class="fingerprint-badge"
          on:click|stopPropagation={handleOpenAdvancedSettings}
          on:keydown|stopPropagation={handleKeyDown}
          title="Ключ шифрования (E2E): {fingerprint}"
          aria-label="Ключ шифрования"
        >
          <div class="fingerprint-grid">
            {#each getFingerprintEmojis(fingerprint) as emoji}
              <span>{emoji}</span>
            {/each}
          </div>
        </button>
      {/if}

      <div class="more-menu-wrapper" bind:this={moreMenuAnchorEl}>
        <button
          class="header-action-btn"
          class:active={showMoreMenu}
          type="button"
          title="Ещё"
          aria-label="Ещё"
          on:click|stopPropagation={() => (showMoreMenu = !showMoreMenu)}
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/more-vertical.svg'); mask-image: url('/icons/more-vertical.svg'); width: 20px; height: 20px;"></span>
        </button>

        {#if showMoreMenu}
          <div class="more-dropdown" on:click|stopPropagation>
            <button class="more-menu-item" on:click={() => { showMoreMenu = false; handleProfileClick(); }}>
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/user.svg'); mask-image: url('/icons/user.svg'); width: 18px; height: 18px;"></span>
              <span>Информация</span>
            </button>
            <button class="more-menu-item" on:click={() => { showMoreMenu = false; dispatch("search"); }}>
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/search.svg'); mask-image: url('/icons/search.svg'); width: 18px; height: 18px;"></span>
              <span>Поиск</span>
            </button>
            <button class="more-menu-item" on:click={() => { showMoreMenu = false; handleOpenSettings(); }}>
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/settings.svg'); mask-image: url('/icons/settings.svg'); width: 18px; height: 18px;"></span>
              <span>Настройки чата</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  </header>
{/if}

<style>
  .chat-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: calc(64px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0 8px;
    box-sizing: border-box;
    cursor: default;
    flex-shrink: 0;
    background-color: var(--bg-topbar, var(--bg-surface, #1e2025));
    z-index: var(--z-header, 40);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    user-select: none;
    -webkit-user-select: none;
  }

  .chat-topbar.search-mode {
    gap: 8px;
    padding: var(--safe-top, 0px) 12px 0 8px;
  }

  .search-input-field {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 40px;
    background-color: var(--bg-input, rgba(255, 255, 255, 0.06));
    border-radius: 20px;
    padding: 0 12px;
    gap: 8px;
    box-sizing: border-box;
    border: 1px solid var(--border-subtle, transparent);
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .search-input-field:focus-within {
    border-color: var(--accent-primary, #248bfe);
    background-color: var(--bg-surface-elevated, rgba(255, 255, 255, 0.09));
  }

  .search-field-icon {
    color: var(--text-secondary, #828899);
  }

  .search-text-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary, #ffffff);
    font-size: 15px;
    line-height: 20px;
    font-family: inherit;
  }

  .search-text-input::placeholder {
    color: var(--text-secondary, #828899);
  }

  .search-clear-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #828899);
    cursor: pointer;
    padding: 2px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease;
  }

  .search-clear-btn:hover {
    color: var(--text-primary, #ffffff);
  }

  .search-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .search-counter {
    font-size: 13px;
    line-height: 16px;
    font-weight: 500;
    color: var(--text-secondary, #828899);
    padding: 0 4px;
    white-space: nowrap;
  }

  .search-counter.not-found {
    color: var(--status-danger, #ef4444);
  }

  .search-nav-btn:disabled {
    opacity: 0.35;
    cursor: default;
    pointer-events: none;
  }

  .align-left {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  .back-button {
    background: none;
    border: none;
    color: var(--text-primary, #ffffff);
    cursor: pointer;
    height: 40px;
    width: 40px;
    padding: 0;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, transform 0.1s ease;
  }

  .back-button:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }

  .back-button:active {
    transform: scale(0.92);
  }

  .row {
    display: flex;
    align-items: center;
    cursor: pointer;
    flex: 1;
    min-width: 0;
    margin-left: 4px;
    padding-right: 8px;
  }

  .toolbar-avatar-wrap {
    flex-shrink: 0;
    margin-right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    min-width: 0;
    gap: 2px;
  }

  .title {
    color: var(--text-primary, #ffffff);
    font-size: 16px;
    line-height: 20px;
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .presence {
    color: var(--text-secondary, #828899);
    font-size: 13px;
    line-height: 16px;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    min-width: 0;
  }

  .align-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .header-action-btn {
    background: none;
    border: none;
    color: var(--text-secondary, #828899);
    cursor: pointer;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
  }

  .header-action-btn:hover {
    color: var(--text-primary, #ffffff);
    background-color: rgba(255, 255, 255, 0.08);
  }

  .header-action-btn:active,
  .header-action-btn.active {
    transform: scale(0.92);
    color: var(--text-primary, #ffffff);
    background-color: rgba(255, 255, 255, 0.12);
  }

  .more-menu-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .more-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    background: var(--bg-dropdown, var(--bg-surface, #24262d));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    border-radius: 12px;
    padding: 4px;
    min-width: 180px;
    z-index: var(--z-dropdown, 50);
    display: flex;
    flex-direction: column;
    animation: menuFadeIn 0.15s cubic-bezier(0, 0, 0.2, 1);
  }

  @keyframes menuFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .more-menu-item {
    background: none;
    border: none;
    color: var(--text-primary, #ffffff);
    padding: 8px 12px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    transition: background-color 0.12s ease;
  }

  .more-menu-item:hover {
    background-color: rgba(255, 255, 255, 0.08);
  }

  .more-menu-item:active {
    background-color: rgba(255, 255, 255, 0.12);
  }

  .fingerprint-badge {
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    background: var(--bg-surface-elevated, rgba(255, 255, 255, 0.06));
    border-radius: 8px;
    width: 34px;
    height: 34px;
    padding: 0;
    margin: 0 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
  }

  .fingerprint-badge:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.14));
    border-color: rgba(255, 255, 255, 0.22);
    transform: scale(1.04);
  }

  .fingerprint-badge:active {
    transform: scale(0.96);
  }

  .fingerprint-grid {
    display: grid;
    grid-template-columns: repeat(2, 12px);
    grid-template-rows: repeat(2, 12px);
    gap: 1px;
    width: 25px;
    height: 25px;
    box-sizing: border-box;
    place-items: center;
    place-content: center;
  }

  .fingerprint-grid span {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 10px;
    line-height: 1;
    overflow: hidden;
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  }

  .plugin-mount-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
</style>
