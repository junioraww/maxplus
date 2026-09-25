<script>
  import { fade, scale, fly } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import API, { currentRealContacts, currentUser } from "$lib/stores/api";
  import { getCachedContacts, getContact } from "$lib/stores/contacts";
  import { get } from "svelte/store";
  import Avatar from "$components/main/Avatar.svelte";

  export let chat;
  export let existingMemberIds = new Set();

  const dispatch = createEventDispatcher();

  let mode = "contacts";
  let searchFilter = "";
  let manualInput = "";
  let selectedUserIds = new Set();
  let isSubmitting = false;
  let statusMessage = "";

  let allContacts = [];
  onMount(async () => {
    try {
      const cached = await getCachedContacts();
      if (Array.isArray(cached) && cached.length > 0) {
        allContacts = cached;
      } else {
        const ids = $currentRealContacts || [];
        allContacts = ids.map(id => get(getContact(id))).filter(Boolean);
      }
    } catch {
      const ids = $currentRealContacts || [];
      allContacts = ids.map(id => get(getContact(id))).filter(Boolean);
    }
  });

  $: availableContacts = allContacts.filter(c => {
    const id = Number(c?.id);
    return id && id !== Number($currentUser) && !existingMemberIds?.has?.(id);
  });

  $: filteredContacts = availableContacts.filter(c => {
    const name = c.names?.[0]?.name || c.name || "";
    if (!searchFilter.trim()) return true;
    return name.toLowerCase().includes(searchFilter.trim().toLowerCase());
  });

  function toggleSelect(id) {
    const num = Number(id);
    if (selectedUserIds.has(num)) {
      selectedUserIds.delete(num);
    } else {
      selectedUserIds.add(num);
    }
    selectedUserIds = new Set(selectedUserIds);
  }

  async function submitContacts() {
    if (selectedUserIds.size === 0 || isSubmitting) return;
    isSubmitting = true;
    statusMessage = "";
    try {
      const ids = Array.from(selectedUserIds);
      await $API.addGroupMembers(chat.id, ids, true);
      dispatch("added", { count: ids.length, userIds: ids });
      dispatch("close");
    } catch (e) {
      statusMessage = typeof e === "string" ? e : (e?.message || "Не удалось добавить участников");
    } finally {
      isSubmitting = false;
    }
  }

  async function submitManual() {
    const raw = manualInput.trim();
    if (!raw || isSubmitting) return;
    isSubmitting = true;
    statusMessage = "";
    try {
      const cleanNumeric = raw.replace(/[^\d]/g, "");
      if (cleanNumeric && cleanNumeric.length >= 4) {
        const uid = Number(cleanNumeric);
        await $API.addGroupMembers(chat.id, [uid], true);
        dispatch("added", { count: 1, userIds: [uid] });
        dispatch("close");
        return;
      }
      statusMessage = "Укажите корректный цифровой ID или номер телефона";
    } catch (e) {
      statusMessage = typeof e === "string" ? e : (e?.message || "Не удалось добавить");
    } finally {
      isSubmitting = false;
    }
  }

  function copyInvite() {
    if (!chat?.link) return;
    navigator.clipboard.writeText(chat.link);
    statusMessage = "Ссылка скопирована";
    setTimeout(() => {
      if (statusMessage === "Ссылка скопирована") statusMessage = "";
    }, 2000);
  }

  function close() {
    dispatch("close");
  }
</script>

<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={close}>
  <div class="modal-card" transition:scale={{ duration: 200, start: 0.94 }} on:click|stopPropagation>
    <div class="modal-head">
      <div class="title-wrap">
        <h3>Добавить участников</h3>
        <span class="chat-sub">{chat?.title || "Группа"}</span>
      </div>
      <button type="button" class="btn-close" on:click={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    {#if chat?.link}
      <div class="invite-banner">
        <div class="invite-info">
          <span class="invite-label">Ссылка приглашения</span>
          <span class="invite-url">{chat.link}</span>
        </div>
        <button type="button" class="btn-copy-invite" on:click={copyInvite} title="Скопировать">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
    {/if}

    <div class="mode-switcher">
      <button
        type="button"
        class="mode-btn"
        class:active={mode === "contacts"}
        on:click={() => (mode = "contacts")}
      >
        Из контактов
      </button>
      <button
        type="button"
        class="mode-btn"
        class:active={mode === "manual"}
        on:click={() => (mode = "manual")}
      >
        По ID / Номеру
      </button>
    </div>

    {#if mode === "contacts"}
      <div class="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          bind:value={searchFilter}
          placeholder="Поиск по контактам..."
        />
        {#if searchFilter}
          <button type="button" class="btn-clear" on:click={() => (searchFilter = "")}>&times;</button>
        {/if}
      </div>

      <div class="contacts-scroll">
        {#if filteredContacts.length === 0}
          <div class="empty-state">
            <span>Контакты не найдены</span>
          </div>
        {:else}
          {#each filteredContacts as item (item.id)}
            {@const isSelected = selectedUserIds.has(Number(item.id))}
            <div
              class="contact-row"
              class:selected={isSelected}
              on:click={() => toggleSelect(item.id)}
            >
              <div class="avatar-cell">
                <Avatar contactId={item.id} size={40} />
              </div>
              <div class="meta-cell">
                <span class="user-name">{item.names?.[0]?.name || "Пользователь"}</span>
                <span class="user-sub">
                  {#if item.phone}
                    {item.phone}
                  {:else}
                    ID: {item.id}
                  {/if}
                </span>
              </div>
              <div class="checkbox-cell" class:checked={isSelected}>
                {#if isSelected}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="manual-box">
        <label for="manual-id-input">Идентификатор пользователя или телефон</label>
        <input
          id="manual-id-input"
          type="text"
          bind:value={manualInput}
          placeholder="Например: 12345678 или +79991234567"
          on:keydown={(e) => e.key === "Enter" && submitManual()}
        />
        <span class="input-hint">Пользователь будет напрямую приглашен в группу</span>
      </div>
    {/if}

    {#if statusMessage}
      <div class="status-msg" transition:fade={{ duration: 150 }}>
        {statusMessage}
      </div>
    {/if}

    <div class="modal-foot">
      <button type="button" class="btn btn-secondary" on:click={close}>Отмена</button>
      {#if mode === "contacts"}
        <button
          type="button"
          class="btn btn-primary"
          disabled={selectedUserIds.size === 0 || isSubmitting}
          on:click={submitContacts}
        >
          {#if isSubmitting}
            Добавление...
          {:else if selectedUserIds.size > 0}
            Добавить · {selectedUserIds.size}
          {:else}
            Добавить
          {/if}
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          disabled={!manualInput.trim() || isSubmitting}
          on:click={submitManual}
        >
          {isSubmitting ? "Добавление..." : "Добавить"}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }

  .modal-card {
    background: #1e2025;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
    border-radius: 18px;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #edf0f5;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .title-wrap h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: #f8fafc;
  }

  .chat-sub {
    font-size: 13px;
    color: #8b98a5;
  }

  .btn-close {
    background: none;
    border: none;
    color: #8b98a5;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    transition: 0.15s;
  }

  .btn-close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .invite-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 12px 16px 0;
    padding: 10px 14px;
    background: rgba(43, 130, 246, 0.08);
    border: 1px solid rgba(43, 130, 246, 0.2);
    border-radius: 12px;
  }

  .invite-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin-right: 10px;
  }

  .invite-label {
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 600;
    color: #3b82f6;
    letter-spacing: 0.5px;
  }

  .invite-url {
    font-size: 13px;
    color: #edf0f5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-copy-invite {
    background: none;
    border: none;
    color: #3b82f6;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: 0.15s;
  }

  .btn-copy-invite:hover {
    background: rgba(43, 130, 246, 0.18);
  }

  .mode-switcher {
    display: flex;
    gap: 6px;
    background: rgba(0, 0, 0, 0.24);
    padding: 4px;
    border-radius: 10px;
    margin: 12px 16px;
  }

  .mode-btn {
    flex: 1;
    background: none;
    border: none;
    color: #8b98a5;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: 0.15s;
  }

  .mode-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-weight: 600;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 10px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 8px 12px;
    color: #8b98a5;
  }

  .search-box input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 14px;
    outline: none;
  }

  .btn-clear {
    background: none;
    border: none;
    color: #8b98a5;
    font-size: 16px;
    cursor: pointer;
    line-height: 1;
  }

  .contacts-scroll {
    max-height: 280px;
    overflow-y: auto;
    padding: 0 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-state {
    padding: 36px 16px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
  }

  .contact-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.12s;
  }

  .contact-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .contact-row.selected {
    background: rgba(43, 130, 246, 0.12);
  }

  .meta-cell {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .user-name {
    font-size: 14px;
    font-weight: 500;
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-sub {
    font-size: 12px;
    color: #8b98a5;
  }

  .checkbox-cell {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition: 0.15s;
  }

  .checkbox-cell.checked {
    background: #2563eb;
    border-color: #2563eb;
  }

  .manual-box {
    padding: 10px 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .manual-box label {
    font-size: 13px;
    color: #8b98a5;
  }

  .manual-box input {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 10px 14px;
    color: #fff;
    font-size: 15px;
    outline: none;
    transition: 0.15s;
  }

  .manual-box input:focus {
    border-color: #3b82f6;
  }

  .input-hint {
    font-size: 12px;
    color: #64748b;
  }

  .status-msg {
    margin: 4px 16px;
    font-size: 13px;
    color: #38bdf8;
    text-align: center;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(0, 0, 0, 0.18);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .btn {
    padding: 9px 18px;
    border-radius: 9px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: 0.15s;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .btn-primary {
    background: #2563eb;
    color: #fff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
