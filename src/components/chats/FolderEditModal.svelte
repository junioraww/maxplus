<script>
  import { createEventDispatcher } from "svelte";
  import FolderEditChatItem from "$components/chats/FolderEditChatItem.svelte";

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

  function save() {
    const trimmed = title.trim();
    if (!trimmed) {
      alert("Введите название папки");
      return;
    }
    if (filters.length === 0 && includedChats.length === 0) {
      alert("Выберите хотя бы один фильтр или чат");
      return;
    }

    dispatch("save", {
      id: isNew ? generateUuid() : String(folder.id),
      title: trimmed,
      filters: filters.map(Number),
      include: includedChats.map(Number),
      options: (folder?.options || []).map(Number),
      favorites: (folder?.favorites || []).map(Number),
    });
  }

  function handleDelete() {
    if (isNew || !folder?.id) return;
    if (confirm(`Удалить папку «${folder.title}»? Чаты останутся на месте.`)) {
      dispatch("delete", folder.id);
    }
  }

  function close() {
    dispatch("close");
  }

  $: filteredChats = (allChats || []).filter((chat) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const chatTitle = (chat.title || "").toLowerCase();
    return chatTitle.includes(q);
  });
</script>

<div class="modal-backdrop" on:click={close}>
  <div class="modal" on:click|stopPropagation>
    <div class="header">
      <h3>{isNew ? "Новая папка" : "Редактирование папки"}</h3>
      <button class="close-btn" on:click={close}>&times;</button>
    </div>

    <div class="content">
      <div class="form-group">
        <label>Название папки</label>
        <input
          type="text"
          maxlength="20"
          bind:value={title}
          placeholder="Например: Работа"
        />
      </div>

      <div class="form-group">
        <label>Фильтры</label>
        <div class="filters-grid">
          {#each filterOptions as opt}
            <button
              class="filter-chip"
              class:active={filters.includes(opt.id)}
              on:click={() => toggleFilter(opt.id)}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="form-group">
        <div class="chat-section-header">
          <label>Включенные чаты ({includedChats.length})</label>
          <input
            type="text"
            class="chat-search-input"
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

    <div class="footer">
      {#if !isNew}
        <button class="btn delete-btn" on:click={handleDelete}>
          Удалить
        </button>
      {/if}
      <div class="footer-actions">
        <button class="btn cancel" on:click={close}>Отмена</button>
        <button class="btn save" on:click={save}>
          {isNew ? "Создать" : "Сохранить"}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal {
    background: #22222a;
    width: 100%;
    max-width: 440px;
    max-height: 90vh;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    color: #fff;
    border: 1px solid #33333d;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .header {
    padding: 16px 20px;
    border-bottom: 1px solid #2e2e38;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .header h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: #999;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 6px;
  }

  .close-btn:hover {
    color: #fff;
    background: #333;
  }

  .content {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .form-group label {
    color: #aaa;
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  input[type="text"] {
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #3a3a46;
    background: #18181f;
    color: #fff;
    font-size: 14px;
    box-sizing: border-box;
    outline: none;
    transition: border-color 0.2s;
  }

  input[type="text"]:focus {
    border-color: #6366f1;
  }

  .filters-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-chip {
    background: #2a2a34;
    border: 1px solid #3a3a48;
    color: #ccc;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .filter-chip:hover {
    background: #343442;
    color: #fff;
  }

  .filter-chip.active {
    background: #4f46e5;
    border-color: #6366f1;
    color: #fff;
    font-weight: 500;
  }

  .chat-section-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .chat-search-input {
    padding: 8px 12px !important;
    font-size: 13px !important;
  }

  .chats-list {
    background: #18181f;
    border-radius: 10px;
    border: 1px solid #2e2e3a;
    max-height: 220px;
    overflow-y: auto;
  }

  .footer {
    padding: 14px 20px;
    border-top: 1px solid #2e2e38;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    gap: 12px;
  }

  .footer-actions {
    display: flex;
    gap: 10px;
    margin-left: auto;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.15s;
  }

  .btn.cancel {
    background: #2a2a34;
    color: #aaa;
  }

  .btn.cancel:hover {
    background: #363644;
    color: #fff;
  }

  .btn.save {
    background: #4f46e5;
    color: #fff;
  }

  .btn.save:hover {
    background: #4338ca;
  }

  .btn.delete-btn {
    background: #dc262622;
    color: #ef4444;
    border: 1px solid #dc262644;
  }

  .btn.delete-btn:hover {
    background: #dc2626;
    color: #fff;
  }
</style>
