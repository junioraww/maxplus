<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { get } from "svelte/store";
  import Avatar from "$components/main/Avatar.svelte";
  import Signature from "$components/main/Signature.svelte";
  import API, { currentRealContacts, currentUser } from "$lib/stores/api";
  import { getContact, getContactDisplayName, getCachedContacts } from "$lib/stores/contacts";

  export let close = null;
  export let title = "Пригласить участников";
  export let confirmLabel = "Добавить";
  export let emptyText = "Нет доступных контактов";
  export let searchPlaceholder = "Поиск по имени";
  export let multiSelect = true;
  export let chat = null;
  export let chatId = null;
  export let isChannel = false;
  export let existingMemberIds = new Set();
  export let excludeCurrentUser = true;
  export let autoAddToChat = true;
  export let onConfirm = null;
  export let onSelect = null;

  const dispatch = createEventDispatcher();

  let searchQuery = "";
  let selectedIds = new Set();
  let isSubmitting = false;
  let errorMsg = "";
  let contactsList = [];

  $: effectiveChatId = chat?.id ?? chatId;
  $: normalizedExistingIds =
    existingMemberIds instanceof Set
      ? existingMemberIds
      : new Set(Array.isArray(existingMemberIds) ? existingMemberIds : []);

  function loadContacts() {
    const cached = getCachedContacts();
    const map = new Map();

    if (cached && cached.size > 0) {
      for (const [id, c] of cached.entries()) {
        if (c && (!excludeCurrentUser || String(id) !== String($currentUser))) {
          map.set(String(id), {
            id,
            name: getContactDisplayName(c) || `Пользователь ${id}`,
            avatar: c.avatar || null,
            verified: Boolean(c.verified || (c.options && c.options.includes("OFFICIAL")))
          });
        }
      }
    }

    for (const id of $currentRealContacts || []) {
      const key = String(id);
      if (excludeCurrentUser && key === String($currentUser)) continue;
      if (!map.has(key)) {
        const c = get(getContact(id));
        if (c && c.status !== "REMOVED") {
          map.set(key, {
            id,
            name: getContactDisplayName(c) || `Пользователь ${id}`,
            avatar: c.avatar || null,
            verified: Boolean(c.verified || (c.options && c.options.includes("OFFICIAL")))
          });
        }
      }
    }

    contactsList = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
  }

  onMount(() => {
    loadContacts();
  });

  $: if ($currentRealContacts) {
    loadContacts();
  }

  $: filteredContacts = contactsList.filter((c) => {
    if (normalizedExistingIds.has(c.id) || normalizedExistingIds.has(String(c.id))) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return c.name.toLowerCase().includes(q) || String(c.id).includes(q);
  });

  $: groupedContacts = (() => {
    const groups = new Map();
    for (const c of filteredContacts) {
      const first = (c.name.trim()[0] || "#").toUpperCase();
      const letter = /[A-ZА-ЯЁ0-9]/.test(first) ? first : "#";
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter).push(c);
    }
    return Array.from(groups.entries());
  })();

  $: selectedUsers = contactsList.filter((c) => selectedIds.has(c.id));

  function toggleSelection(id) {
    if (!multiSelect) {
      const picked = contactsList.find((c) => c.id === id);
      if (!picked) return;
      dispatch("select", picked);
      if (typeof onSelect === "function") {
        onSelect(picked);
      }
      handleClose(picked);
      return;
    }

    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selectedIds = next;
  }

  function removeChip(id) {
    const next = new Set(selectedIds);
    next.delete(id);
    selectedIds = next;
  }

  function handleClose(result = null) {
    if (typeof close === "function") {
      close(result);
    } else {
      dispatch("close", result);
    }
  }

  async function handleConfirm() {
    if (selectedIds.size === 0 || isSubmitting) return;
    isSubmitting = true;
    errorMsg = "";

    const ids = Array.from(selectedIds);
    try {
      if (autoAddToChat && effectiveChatId && $API?.addGroupMembers) {
        await $API.addGroupMembers(effectiveChatId, ids, true);
      }
      const payload = { userIds: ids, users: selectedUsers };
      dispatch("confirm", payload);
      if (typeof onConfirm === "function") {
        await onConfirm(ids, selectedUsers);
      }
      handleClose(payload);
    } catch (e) {
      errorMsg = e?.message || (isChannel ? "Не удалось добавить подписчиков" : "Не удалось добавить участников");
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="user-select-screen">
  <header class="screen-header">
    <button type="button" class="header-back-btn" on:click={() => handleClose()} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <div class="header-title-wrap">
      <h1 class="header-title">{title}</h1>
      {#if multiSelect && selectedIds.size > 0}
        <span class="header-subtitle">Выбрано: {selectedIds.size}</span>
      {/if}
    </div>
    <div class="header-spacer"></div>
  </header>

  {#if multiSelect && selectedUsers.length > 0}
    <div class="chips-strip">
      {#each selectedUsers as user (user.id)}
        <div class="user-chip">
          <Avatar contactId={user.id} src={user.avatar} title={user.name} size={24} />
          <span class="user-chip-name">{user.name}</span>
          <button
            type="button"
            class="user-chip-remove"
            on:click={() => removeChip(user.id)}
            aria-label="Убрать {user.name}"
          >
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 12px; height: 12px;"></span>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="search-section">
    <div class="search-box">
      <span class="mask-icon search-icon" style="-webkit-mask-image: url('/icons/search.svg'); mask-image: url('/icons/search.svg'); width: 18px; height: 18px;"></span>
      <input
        type="text"
        class="search-input"
        placeholder={searchPlaceholder}
        bind:value={searchQuery}
      />
      {#if searchQuery}
        <button
          type="button"
          class="clear-search-btn"
          on:click={() => (searchQuery = "")}
          aria-label="Очистить поиск"
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 14px; height: 14px;"></span>
        </button>
      {/if}
    </div>
  </div>

  {#if errorMsg}
    <div class="error-banner">{errorMsg}</div>
  {/if}

  <div class="contacts-scroll">
    {#if groupedContacts.length === 0}
      <div class="empty-state">
        <span class="mask-icon empty-icon" style="-webkit-mask-image: url('/icons/user.svg'); mask-image: url('/icons/user.svg'); width: 42px; height: 42px;"></span>
        <div class="empty-text">{searchQuery ? "Никого не найдено" : emptyText}</div>
      </div>
    {:else}
      {#each groupedContacts as [letter, group]}
        <div class="letter-header">{letter}</div>
        {#each group as contact (contact.id)}
          <button
            type="button"
            class="contact-row"
            class:selected={multiSelect && selectedIds.has(contact.id)}
            on:click={() => toggleSelection(contact.id)}
          >
            <div class="contact-avatar">
              <Avatar contactId={contact.id} src={contact.avatar} title={contact.name} size={42} />
            </div>
            <div class="contact-info">
              <div class="contact-name-line">
                <span class="contact-name">{contact.name}</span>
                {#if contact.verified}
                  <span class="mask-icon verified-icon" style="-webkit-mask-image: url('/icons/verified.svg'); mask-image: url('/icons/verified.svg'); width: 15px; height: 15px;"></span>
                {/if}
              </div>
              <div class="contact-status">
                <Signature contactId={contact.id} />
              </div>
            </div>
            {#if multiSelect}
              <div class="select-circle" class:checked={selectedIds.has(contact.id)}>
                {#if selectedIds.has(contact.id)}
                  <span class="mask-icon check-icon" style="-webkit-mask-image: url('/icons/check.svg'); mask-image: url('/icons/check.svg'); width: 14px; height: 14px;"></span>
                {/if}
              </div>
            {/if}
          </button>
        {/each}
      {/each}
    {/if}
  </div>

  {#if multiSelect}
    <div class="bottom-action-bar">
      <button
        type="button"
        class="primary-confirm-btn"
        disabled={selectedIds.size === 0 || isSubmitting}
        on:click={handleConfirm}
      >
        {#if isSubmitting}
          Загрузка...
        {:else if selectedIds.size > 0}
          {confirmLabel} ({selectedIds.size})
        {:else}
          {confirmLabel}
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .user-select-screen {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    color: var(--text-primary);
    overflow: hidden;
  }

  .screen-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-topbar, var(--bg-surface));
    flex-shrink: 0;
  }

  .header-back-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s ease;
  }

  .header-back-btn:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
  }

  .header-title-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .header-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-subtitle {
    font-size: 12px;
    color: var(--text-secondary, #6b7280);
  }

  .header-spacer {
    width: 36px;
    flex-shrink: 0;
  }

  .chips-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    flex-shrink: 0;
  }

  .chips-strip::-webkit-scrollbar {
    height: 4px;
  }

  .user-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 4px;
    border-radius: 999px;
    background: var(--bg-secondary, #f3f4f6);
    flex-shrink: 0;
    max-width: 180px;
  }

  .user-chip-name {
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-chip-remove {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.08);
    color: var(--text-secondary, #6b7280);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .user-chip-remove:hover {
    background: rgba(0, 0, 0, 0.16);
    color: var(--text-primary, #111827);
  }

  .search-section {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    flex-shrink: 0;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-secondary, #f3f4f6);
    border-radius: 12px;
    padding: 8px 12px;
  }

  .search-icon {
    color: var(--text-secondary, #9ca3af);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-primary, #111827);
    font-size: 14px;
    outline: none;
    min-width: 0;
  }

  .search-input::placeholder {
    color: var(--text-secondary, #9ca3af);
  }

  .clear-search-btn {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.08);
    color: var(--text-secondary, #6b7280);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .error-banner {
    margin: 10px 16px 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    font-size: 13px;
    flex-shrink: 0;
  }

  .contacts-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 48px 20px;
    color: var(--text-secondary, #9ca3af);
  }

  .empty-icon {
    opacity: 0.6;
  }

  .empty-text {
    font-size: 14px;
  }

  .letter-header {
    padding: 8px 16px 4px;
    font-size: 12px;
    font-weight: 700;
    color: var(--accent-color, #2563eb);
    text-transform: uppercase;
  }

  .contact-row {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.12s ease;
  }

  .contact-row:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  }

  .contact-row.selected {
    background: var(--bg-hover, rgba(37, 99, 235, 0.06));
  }

  .contact-avatar {
    flex-shrink: 0;
  }

  .contact-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .contact-name-line {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .contact-name {
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .verified-icon {
    color: var(--accent-color, #2563eb);
    flex-shrink: 0;
  }

  .contact-status {
    font-size: 13px;
    color: var(--text-secondary, #6b7280);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .select-circle {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid var(--border-strong, var(--border-subtle));
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .select-circle.checked {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    color: var(--accent-contrast, #ffffff);
  }

  .bottom-action-bar {
    padding: 12px 16px;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .primary-confirm-btn {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 12px;
    background: var(--accent-primary);
    color: var(--accent-contrast, #ffffff);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .primary-confirm-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .mask-icon {
    display: inline-block;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
  }
</style>
