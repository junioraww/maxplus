<script>
  import { Button, IconButton, Modal, Tab } from "$components/ui";
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

<Modal open={true} bare closeOnEsc={true} onclose={close}>
  <div class="modal-card">
    <div class="modal-head">
      <div class="title-wrap">
        <h3>Добавить участников</h3>
        <span class="chat-sub">{chat?.title || "Группа"}</span>
      </div>
      <IconButton class="groupaddmembersmodal-btn-close" onclick={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </IconButton>
    </div>

    {#if chat?.link}
      <div class="invite-banner">
        <div class="invite-info">
          <span class="invite-label">Ссылка приглашения</span>
          <span class="invite-url">{chat.link}</span>
        </div>
        <Button class="groupaddmembersmodal-btn-copy-invite" onclick={copyInvite} title="Скопировать">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </Button>
      </div>
    {/if}

    <div class="mode-switcher">
      <Tab variant="segment" active={mode === "contacts"} class="groupaddmembersmodal-mode-btn" onclick={() => (mode = "contacts")}>
        Из контактов
      </Tab>
      <Tab variant="segment" active={mode === "manual"} class="groupaddmembersmodal-mode-btn" onclick={() => (mode = "manual")}>
        По ID / Номеру
      </Tab>
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
          <Button variant="ghost" class="groupaddmembersmodal-btn-clear" onclick={() => (searchFilter = "")}>&times;</Button>
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
      <Button class="groupaddmembersmodal-btn groupaddmembersmodal-btn-secondary" onclick={close}>Отмена</Button>
      {#if mode === "contacts"}
        <Button variant="primary" class="groupaddmembersmodal-btn" disabled={selectedUserIds.size === 0 || isSubmitting} onclick={submitContacts}>
          {#if isSubmitting}
            Добавление...
          {:else if selectedUserIds.size > 0}
            Добавить · {selectedUserIds.size}
          {:else}
            Добавить
          {/if}
        </Button>
      {:else}
        <Button variant="primary" class="groupaddmembersmodal-btn" disabled={!manualInput.trim() || isSubmitting} onclick={submitManual}>
          {isSubmitting ? "Добавление..." : "Добавить"}
        </Button>
      {/if}
    </div>
  </div>
</Modal>

<style>

  .modal-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
    border-radius: 18px;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text-primary);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title-wrap h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .chat-sub {
    font-size: 13px;
    color: var(--text-muted);
  }

  :global(.groupaddmembersmodal-btn-close)  { width: 32px; }


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
    color: var(--accent-primary);
    letter-spacing: 0.5px;
  }

  .invite-url {
    font-size: 13px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }



  .mode-switcher {
    display: flex;
    gap: 6px;
    background: rgba(0, 0, 0, 0.24);
    padding: 4px;
    border-radius: 10px;
    margin: 12px 16px;
  }

  :global(.groupaddmembersmodal-mode-btn)  { flex: 1; }


  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 10px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 8px 12px;
    color: var(--text-muted);
  }

  .search-box input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
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
    color: var(--text-muted);
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
    background: var(--bg-surface);
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
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-sub {
    font-size: 12px;
    color: var(--text-muted);
  }

  .checkbox-cell {
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1.5px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    transition: 0.15s;
  }

  .checkbox-cell.checked {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .manual-box {
    padding: 10px 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .manual-box label {
    font-size: 13px;
    color: var(--text-muted);
  }

  .manual-box input {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--text-primary);
    font-size: 15px;
    outline: none;
    transition: 0.15s;
  }

  .manual-box input:focus {
    border-color: var(--accent-primary);
  }

  .input-hint {
    font-size: 12px;
    color: var(--text-muted);
  }

  .status-msg {
    margin: 4px 16px;
    font-size: 13px;
    color: var(--accent-primary);
    text-align: center;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 16px;
    background: rgba(0, 0, 0, 0.18);
    border-top: 1px solid var(--border-subtle);
  }




  .btn-primary {
    background: var(--accent-primary);
    color: var(--button-primary-contrast);
  }

  .btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
