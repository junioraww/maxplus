<script>
  import { Button, ListItem, Section, Tab } from "$components/ui";
  import { Toggle } from "$components/ui";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";

  import { get } from "svelte/store";
  import API, { currentUser, currentSessionChats } from "$lib/stores/api";
  import { getContact } from "$lib/utils/caching";
  import Avatar from "$components/main/Avatar.svelte";
  import {
    clientNotificationsEnabled,
    messagePreviewEnabled,
    notificationSoundEnabled,
    callNotificationsEnabled,
    newContactsNotificationsEnabled,
    toggleClientNotifications,
    setMessagePreviewServer,
    setNotificationSoundServer,
    setCallNotificationsServer,
    setNewContactsServer,
    isChatMuted
  } from "$lib/utils/notifications";

  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  export let isTab = false;
  export let onClose = null;

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
    if (chat?.type === "DIALOG") {
      if (chat.participants && Object.keys(chat.participants).length > 0) {
        const other = Object.keys(chat.participants).find(id => String(id) !== String($currentUser));
        if (other) return Number(other);
      }
      if (chat.id && $currentUser) {
        try {
          const pId = Number(BigInt(chat.id) ^ BigInt($currentUser));
          return pId > 0 ? pId : null;
        } catch {
          return null;
        }
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

<SettingsPageWrapper tabHeader title="Уведомления" {from} {isTab} {onClose}>
  <div class="content-container">
    <Section>
      <ListItem wrap title="Все уведомления" subtitle="Оповещения о входящих сообщениях и вызовах" onclick={toggleClientNotifications}>
{#snippet trailing()}<Toggle readonly checked={$clientNotificationsEnabled} />{/snippet}
</ListItem>
    </Section>

    <Section title="Сообщения">
      <ListItem wrap title="Предпросмотр сообщений" subtitle="Показывать текст входящего сообщения" disabled={!$clientNotificationsEnabled} onclick={() => {
          if ($clientNotificationsEnabled) setMessagePreviewServer(!$messagePreviewEnabled);
        }}>
{#snippet trailing()}<Toggle readonly checked={$messagePreviewEnabled && $clientNotificationsEnabled} />{/snippet}
</ListItem>

      <ListItem wrap title="Звук" subtitle="Звуковой сигнал при получении сообщения" disabled={!$clientNotificationsEnabled} onclick={() => {
          if ($clientNotificationsEnabled) setNotificationSoundServer(!$notificationSoundEnabled);
        }}>
{#snippet trailing()}<Toggle readonly checked={$notificationSoundEnabled && $clientNotificationsEnabled} />{/snippet}
</ListItem>
    </Section>

    <Section title="Дополнительно">
      <ListItem wrap title="Уведомления о звонках" subtitle="Оповещать о входящих аудио- и видеозвонках" onclick={() => setCallNotificationsServer(!$callNotificationsEnabled)}>
{#snippet trailing()}<Toggle readonly checked={$callNotificationsEnabled} />{/snippet}
</ListItem>

      <ListItem wrap title="Новые контакты" subtitle="Уведомлять, когда контакт присоединяется" onclick={() => setNewContactsServer(!$newContactsNotificationsEnabled)}>
{#snippet trailing()}<Toggle readonly checked={$newContactsNotificationsEnabled} />{/snippet}
</ListItem>
    </Section>

    <div class="section-header">
      <h2>Отключенные уведомления</h2>
      <span class="badge-count">{mutedItems.length}</span>
    </div>

    <div class="filter-tabs">
      <Tab variant="pill" active={activeTab === "all"} class="pg-notifications-filter-tab" onclick={() => activeTab = "all"}>
        Все ({mutedItems.length})
      </Tab>
      <Tab variant="pill" active={activeTab === "chats"} class="pg-notifications-filter-tab" onclick={() => activeTab = "chats"}>
        Чаты ({mutedChats.length})
      </Tab>
      <Tab variant="pill" active={activeTab === "contacts"} class="pg-notifications-filter-tab" onclick={() => activeTab = "contacts"}>
        Контакты ({mutedContacts.length})
      </Tab>
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
            <Button class="pg-notifications-unmute-btn" disabled={unmutingIds.has(chat.id)} onclick={() => handleUnmute(chat.id)}>
              {#if unmutingIds.has(chat.id)}
                ...
              {:else}
                Включить
              {/if}
            </Button>
          </div>
        {/each}
      {/if}
    </div>
  </div>

</SettingsPageWrapper>

<style>


  .content-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .badge-count {
    font-size: 0.75rem;
    background: var(--bg-surface-2);
    padding: 2px 8px;
    border-radius: 10px;
    color: var(--text-muted);
  }

  .filter-tabs {
    display: flex;
    gap: 8px;
    background: #202026;
    padding: 4px;
    border-radius: 10px;
  }

  :global(.pg-notifications-filter-tab)  { flex: 1; }


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
    color: var(--text-muted);
  }

  .empty-desc {
    margin: 0;
    font-size: 0.85rem;
    color: #666;
    max-width: 320px;
  }

  .muted-item {
    background: var(--bg-surface-2);
    border-radius: 12px;
    border: 1px solid var(--border-subtle);
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: border-color 0.2s;
  }

  .muted-item:hover {
    border-color: var(--border-subtle);
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
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-type-badge {
    font-size: 0.7rem;
    background: #33333d;
    color: var(--text-muted);
    padding: 1px 6px;
    border-radius: 6px;
    flex-shrink: 0;
  }

  .item-status {
    font-size: 0.8rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  :global(.pg-notifications-unmute-btn)  { flex-shrink: 0; }



</style>
