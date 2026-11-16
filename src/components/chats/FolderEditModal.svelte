<script>
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import FolderEditChatItem from "$components/chats/FolderEditChatItem.svelte";
  import API, { currentRealChats } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { showAlert } from "$lib/utils/alert";
  import { showConfirm, closeFolderEdit } from "$lib/stores/session";

  export let folder = null;
  export let allChats = [];

  const dispatch = createEventDispatcher();

  const isNew = !folder || !folder.id || folder.id === 0 || folder.isNew;

  let title = folder?.title && folder?.id !== 0 ? folder.title : "";
  let filters = [...(folder?.filters || [])];
  let includedChats = [...(folder?.include || folder?.includedChats || [])];
  let searchQuery = "";

  const filterOptions = [
    { id: 8, label: "Контакты" },
    { id: 9, label: "Не в контактах" },
    { id: 3, label: "Группы" },
    { id: 2, label: "Каналы" },
    { id: 10, label: "Боты" },
    { id: 0, label: "Непрочитанные" },
    { id: 7, label: "Без звука" },
  ];

  function toggleFilter(filterId) {
    if (filters.includes(filterId)) {
      filters = filters.filter((f) => f !== filterId);
    } else {
      filters = [...filters, filterId];
    }
  }

  function toggleChat(chatId) {
    if (includedChats.includes(chatId)) {
      includedChats = includedChats.filter((id) => id !== chatId);
    } else {
      includedChats = [...includedChats, chatId];
    }
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

  async function save() {
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
      await $API.updateFolder(payload);
    } catch {}
    close();
  }

  async function handleDelete() {
    if (isNew || !folder?.id) return;
    const ok = await showConfirm({
      title: "Удалить папку?",
      message: `Удалить папку «${folder.title}»? Чаты останутся на месте.`,
      confirmText: "Удалить",
      isDangerous: true,
    });
    if (!ok) return;
    dispatch("delete", folder.id);
    try {
      await $API.deleteFolders([folder.id]);
    } catch {}
    close();
  }

  function close() {
    dispatch("close");
    closeFolderEdit();
  }

  $: resolvedChats = allChats && allChats.length > 0
    ? allChats
    : ($currentRealChats || []).map(id => getChat(id)?.getInfo()).filter(Boolean);

  $: filteredChats = (resolvedChats || []).filter((chat) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const chatTitle = (chat.title || "").toLowerCase();
    return chatTitle.includes(q);
  });
</script>

<BottomSheet
  title={isNew ? "Новая папка" : "Редактирование папки"}
  maxHeight="88vh"
  on:close={close}
>
  <div class="folder-edit-body">
    <div class="form-group">
      <label class="form-label">Название папки</label>
      <input
        type="text"
        maxlength="20"
        bind:value={title}
        placeholder="Например: Работа"
        class="form-input"
      />
    </div>

    <div class="form-group">
      <label class="form-label">Фильтры</label>
      <div class="filters-grid">
        {#each filterOptions as opt}
          <button
            class="filter-chip"
            class:active={filters.includes(opt.id)}
            on:click={() => toggleFilter(opt.id)}
            type="button"
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="form-group">
      <div class="chat-section-header">
        <label class="form-label">Включенные чаты ({includedChats.length})</label>
        <input
          type="text"
          class="form-input chat-search-input"
          placeholder="Поиск чатов..."
          bind:value={searchQuery}
        />
      </div>
      <div class="chats-list">
        {#each filteredChats as chat (chat.id)}
          <FolderEditChatItem
            {includedChats}
            {toggleChat}
            {chat}
          />
        {/each}
      </div>
    </div>
  </div>

  <svelte:fragment slot="footer">
    <div class="sheet-footer-actions">
      {#if !isNew}
        <button class="footer-btn delete-btn" on:click={handleDelete} type="button">
          Удалить
        </button>
      {/if}
      <div class="right-buttons">
        <button class="footer-btn cancel-btn" on:click={close} type="button">
          Отмена
        </button>
        <button class="footer-btn save-btn" on:click={save} type="button">
          {isNew ? "Создать" : "Сохранить"}
        </button>
      </div>
    </div>
  </svelte:fragment>
</BottomSheet>

<style>
  .folder-edit-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px 0 12px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-label {
    color: var(--text-muted, #8b929e);
    font-size: 13px;
    font-weight: 500;
  }

  .form-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 14px;
    background: var(--bg-app, #17181c);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #ffffff;
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }

  .form-input:focus {
    border-color: var(--accent-primary, #248bfe);
  }

  .filters-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-chip {
    padding: 8px 14px;
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-secondary, #8b929e);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .filter-chip:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .filter-chip.active {
    background: var(--accent-primary, #248bfe);
    border-color: var(--accent-primary, #248bfe);
    color: #ffffff;
    font-weight: 500;
  }

  .chat-section-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chat-search-input {
    padding: 8px 12px;
    font-size: 13px;
  }

  .chats-list {
    background: var(--bg-app, #17181c);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    max-height: 220px;
    overflow-y: auto;
  }

  .sheet-footer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
  }

  .right-buttons {
    display: flex;
    gap: 10px;
    margin-left: auto;
  }

  .footer-btn {
    height: 44px;
    padding: 0 18px;
    border-radius: 22px;
    border: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .cancel-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .save-btn {
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
  }

  .save-btn:hover {
    background: var(--accent-primary-hover, #1b74d9);
  }

  .delete-btn {
    background: rgba(239, 68, 68, 0.15);
    color: var(--status-danger, #ef4444);
  }

  .delete-btn:hover {
    background: var(--status-danger, #ef4444);
    color: #ffffff;
  }
</style>
