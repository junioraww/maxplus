<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { slide } from "svelte/transition";
  import { flip } from "svelte/animate";

  import { get } from "svelte/store";
  import API, { currentUser, currentSessionChats } from "$lib/stores/api";
  import { getContact } from "$lib/utils/caching";
  import Avatar from "$components/main/Avatar.svelte";
  import {
    clientNotificationsEnabled,
    toggleClientNotifications,
    isChatMuted
  } from "$lib/utils/notifications";

  $: from = $page.url.searchParams.get("from") || "/?card=3";

  let activeTab = "all";
  let unmutingIds = new Set();

  $: allChats = $currentSessionChats || [];
  $: mutedItems = allChats.filter(c => isChatMuted(c));

  $: mutedChats = mutedItems.filter(c => c.type !== "DIALOG");
  $: mutedContacts = mutedItems.filter(c => c.type === "DIALOG");

  $: displayedItems = activeTab === "chats"
    ? mutedChats
    : activeTab === "contacts"
    ? mutedContacts
    : mutedItems;

  function formatMuteDuration(until) {
    if (!until || until === -1) return "Навсегда";
    const date = new Date(Number(until));
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) {
      return `До ${timeStr}`;
    }
    return `До ${date.toLocaleDateString()} ${timeStr}`;
  }

  function getPeerId(chat) {
    if (chat?.type === "DIALOG" && chat.id && $currentUser) {
      try {
        const pId = Number(BigInt(chat.id) ^ BigInt($currentUser));
        return pId > 0 ? pId : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  function getTitle(chat) {
    if (chat.id === 0) return "Избранное";
    if (chat.title) return chat.title;
    if (chat.type === "DIALOG") {
      const peerId = getPeerId(chat);
      if (peerId) {
        const contactStore = getContact(peerId);
        const contact = contactStore ? get(contactStore) : null;
        if (contact?.names?.[0]?.name) return contact.names[0].name;
      }
    }
    return "Чат";
  }

  async function handleUnmute(chatId) {
    if (unmutingIds.has(chatId)) return;
    unmutingIds.add(chatId);
    unmutingIds = new Set(unmutingIds);
    try {
      await $API.setChatMute(chatId, 0);
    } catch (e) {
      console.error(e);
    } finally {
      unmutingIds.delete(chatId);
      unmutingIds = new Set(unmutingIds);
    }
  }
</script>

<div class="notifications-page">
  <header>
    <div class="header-left">
      <button class="icon-back-btn" on:click={() => goto(from)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>
      <h1>Уведомления</h1>
    </div>
  </header>

  <div class="content-container">
    <div class="settings-card">
      <div class="toggle-row" on:click={toggleClientNotifications}>
        <div class="toggle-info">
          <span class="toggle-title">Включить уведомления</span>
          <span class="toggle-desc">Оповещения о входящих сообщениях и вызовах</span>
        </div>
        <div class="toggle-track" class:active={$clientNotificationsEnabled}>
          <div class="toggle-thumb" class:active={$clientNotificationsEnabled}></div>
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Отключенные уведомления</h2>
      <span class="badge-count">{mutedItems.length}</span>
    </div>

    <div class="filter-tabs">
      <button
        class="filter-tab"
        class:active={activeTab === "all"}
        on:click={() => activeTab = "all"}
      >
        Все ({mutedItems.length})
      </button>
      <button
        class="filter-tab"
        class:active={activeTab === "chats"}
        on:click={() => activeTab = "chats"}
      >
        Чаты ({mutedChats.length})
      </button>
      <button
        class="filter-tab"
        class:active={activeTab === "contacts"}
        on:click={() => activeTab = "contacts"}
      >
        Контакты ({mutedContacts.length})
      </button>
    </div>

    <div class="muted-list">
      {#if displayedItems.length === 0}
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <p class="empty-title">Все уведомления включены</p>
          <p class="empty-desc">Здесь появятся чаты и диалоги с отключенными оповещениями.</p>
        </div>
      {:else}
        {#each displayedItems as chat (chat.id)}
          <div
            animate:flip={{ duration: 250 }}
            transition:slide={{ duration: 200 }}
            class="muted-item"
          >
            <div class="item-avatar">
              <Avatar
                {chat}
                contactId={getPeerId(chat)}
                size={44}
              />
            </div>
            <div class="item-info">
              <div class="item-title-row">
                <span class="item-title">{getTitle(chat)}</span>
                <span class="item-type-badge">
                  {chat.type === "DIALOG" ? "Диалог" : (chat.type === "CHANNEL" ? "Канал" : "Группа")}
                </span>
              </div>
              <span class="item-status">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" stroke-width="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  <line x1="2" y1="2" x2="22" y2="22"></line>
                </svg>
                {formatMuteDuration(chat.dontDisturbUntil)}
              </span>
            </div>
            <button
              class="unmute-btn"
              disabled={unmutingIds.has(chat.id)}
              on:click={() => handleUnmute(chat.id)}
            >
              {#if unmutingIds.has(chat.id)}
                ...
              {:else}
                Включить
              {/if}
            </button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="actions-panel">
    <button class="back-btn" on:click={() => goto(from)}>Назад</button>
  </div>
</div>

<style>
  .notifications-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background-color: #1a1a1f;
    color: #ddd;
    box-sizing: border-box;
    overflow: hidden;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    flex-shrink: 0;
    border-bottom: 1px solid #282830;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-back-btn {
    background: none;
    border: none;
    color: #bbb;
    padding: 4px;
    margin: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: color 0.15s, background 0.15s;
  }

  .icon-back-btn:hover {
    color: #fff;
    background: #282832;
  }

  h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #fff;
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-card {
    background: #26262e;
    border-radius: 12px;
    border: 1px solid #333;
    padding: 16px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    user-select: none;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .toggle-title {
    font-size: 1rem;
    font-weight: 500;
    color: #fff;
  }

  .toggle-desc {
    font-size: 0.82rem;
    color: #888;
  }

  .toggle-track {
    width: 44px;
    height: 24px;
    background: #333;
    border-radius: 12px;
    position: relative;
    transition: background 0.2s;
    cursor: pointer;
    flex-shrink: 0;
  }

  .toggle-track.active {
    background: #6366f1;
  }

  .toggle-thumb {
    width: 18px;
    height: 18px;
    background: #fff;
    border-radius: 50%;
    position: absolute;
    top: 3px;
    left: 3px;
    transition: transform 0.2s;
  }

  .toggle-thumb.active {
    transform: translateX(20px);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .badge-count {
    font-size: 0.75rem;
    background: #333;
    padding: 2px 8px;
    border-radius: 10px;
    color: #bbb;
  }

  .filter-tabs {
    display: flex;
    gap: 8px;
    background: #202026;
    padding: 4px;
    border-radius: 10px;
  }

  .filter-tab {
    flex: 1;
    background: none;
    border: none;
    color: #888;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }

  .filter-tab.active {
    background: #2f2f3a;
    color: #fff;
    font-weight: 600;
  }

  .muted-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
    text-align: center;
    gap: 10px;
  }

  .empty-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #aaa;
  }

  .empty-desc {
    margin: 0;
    font-size: 0.85rem;
    color: #666;
    max-width: 320px;
  }

  .muted-item {
    background: #26262e;
    border-radius: 12px;
    border: 1px solid #333;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: border-color 0.2s;
  }

  .muted-item:hover {
    border-color: #444;
  }

  .item-avatar {
    flex-shrink: 0;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .item-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .item-title {
    font-size: 0.95rem;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-type-badge {
    font-size: 0.7rem;
    background: #33333d;
    color: #999;
    padding: 1px 6px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .item-status {
    font-size: 0.8rem;
    color: #8e8e93;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .unmute-btn {
    background: #3a3a46;
    color: #fff;
    border: none;
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 0.82rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, opacity 0.15s;
  }

  .unmute-btn:hover {
    background: #4f46e5;
  }

  .unmute-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions-panel {
    padding: 16px 20px;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid #282830;
  }

  .back-btn {
    background: #6366f1;
    color: white;
    border: none;
    padding: 10px 40px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .back-btn:hover {
    background: #4f46e5;
  }
</style>
