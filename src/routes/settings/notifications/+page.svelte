<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { invoke } from "$lib/utils/invoke";
  import { getCurrentAccount, setAccountMeta } from "$lib/stores/accounts";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";

  import { get } from "svelte/store";
  import API, { currentUser, currentRealChats } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { getContact } from "$lib/utils/caching";
  import Avatar from "$components/main/Avatar.svelte";
  import {
    clientNotificationsEnabled,
    messagePreviewEnabled,
    notificationSoundEnabled,
    callNotificationsEnabled,
    callSoundEnabled,
    callVibrationEnabled,
    newContactsNotificationsEnabled,
    toggleClientNotifications,
    setMessagePreviewServer,
    setNotificationSoundServer,
    setCallNotificationsServer,
    setCallSoundEnabled,
    setCallVibrationEnabled,
    setNewContactsServer,
    isChatMuted,
  } from "$lib/utils/notifications";

  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  export let isTab = false;
  export let onClose = null;

  let activeTab = "all";
  let unmutingIds = new Set();
  let notifyWhenInactive = true;
  let currentAccId = null;

  onMount(async () => {
    try {
      const acc = await getCurrentAccount();
      if (acc?.id) {
        currentAccId = acc.id;
        notifyWhenInactive = acc?.meta?.notify_when_inactive !== false;
      }
    } catch {}
  });

  async function toggleNotifyWhenInactive() {
    if (!currentAccId) return;
    const next = !notifyWhenInactive;
    notifyWhenInactive = next;
    try {
      await setAccountMeta(currentAccId, "notify_when_inactive", next);
      await invoke("refresh_background_sessions").catch(() => {});
    } catch {}
  }

  $: allChats = ($currentRealChats || []).map((id) => getChat(id).getInfo()).filter(Boolean);
  $: mutedItems = allChats.filter((c) => isChatMuted(c));
  $: mutedChats = mutedItems.filter((c) => c.type !== "DIALOG");
  $: mutedContacts = mutedItems.filter((c) => c.type === "DIALOG");

  $: displayedItems =
    activeTab === "chats" ? mutedChats : activeTab === "contacts" ? mutedContacts : mutedItems;

  function formatMuteDuration(until) {
    if (!until || until === -1) return "Навсегда";
    const date = new Date(Number(until));
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (isToday) return `До ${timeStr}`;
    return `До ${date.toLocaleDateString()} ${timeStr}`;
  }

  function getPeerId(chat) {
    if (chat?.type === "DIALOG") {
      if (chat.participants && Object.keys(chat.participants).length > 0) {
        const other = Object.keys(chat.participants).find((id) => String(id) !== String($currentUser));
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

<SettingsPageWrapper title="Уведомления" {from} {isTab} {onClose}>
  <div class="notif-page">
    <SettingsSection>
      <SettingsRow
        title="Все уведомления"
        subtitle="Оповещения о входящих сообщениях и вызовах"
        isToggle={true}
        checked={$clientNotificationsEnabled}
        on:change={() => toggleClientNotifications()}
      />
      <SettingsRow
        title="Уведомления, когда активен другой аккаунт"
        subtitle="Получать уведомления для этого аккаунта в фоне, пока выбран другой"
        isToggle={true}
        checked={notifyWhenInactive}
        on:change={toggleNotifyWhenInactive}
      />
    </SettingsSection>

    <SettingsSection title="Сообщения">
      <SettingsRow
        title="Предпросмотр сообщений"
        subtitle="Показывать текст входящего сообщения"
        isToggle={true}
        disabled={!$clientNotificationsEnabled}
        checked={$messagePreviewEnabled && $clientNotificationsEnabled}
        on:change={() => {
          if ($clientNotificationsEnabled) setMessagePreviewServer(!$messagePreviewEnabled);
        }}
      />
      <SettingsRow
        title="Звук"
        subtitle="Звуковой сигнал при получении сообщения"
        isToggle={true}
        disabled={!$clientNotificationsEnabled}
        checked={$notificationSoundEnabled && $clientNotificationsEnabled}
        on:change={() => {
          if ($clientNotificationsEnabled) setNotificationSoundServer(!$notificationSoundEnabled);
        }}
      />
    </SettingsSection>

    <SettingsSection title="Звонки и контакты">
      <SettingsRow
        title="Уведомления о звонках"
        subtitle="Оповещать о входящих аудио- и видеозвонках"
        isToggle={true}
        checked={$callNotificationsEnabled}
        on:change={() => setCallNotificationsServer(!$callNotificationsEnabled)}
      />
      <SettingsRow
        title="Звук звонка"
        subtitle="Воспроизводить рингтон при входящем звонке"
        isToggle={true}
        disabled={!$callNotificationsEnabled}
        checked={$callSoundEnabled && $callNotificationsEnabled}
        on:change={() => {
          if ($callNotificationsEnabled) setCallSoundEnabled(!$callSoundEnabled);
        }}
      />
      <SettingsRow
        title="Вибрация при звонке"
        subtitle="Вибрировать при входящем звонке"
        isToggle={true}
        disabled={!$callNotificationsEnabled}
        checked={$callVibrationEnabled && $callNotificationsEnabled}
        on:change={() => {
          if ($callNotificationsEnabled) setCallVibrationEnabled(!$callVibrationEnabled);
        }}
      />
      <SettingsRow
        title="Новые контакты"
        subtitle="Уведомлять, когда контакт присоединяется"
        isToggle={true}
        checked={$newContactsNotificationsEnabled}
        on:change={() => setNewContactsServer(!$newContactsNotificationsEnabled)}
      />
    </SettingsSection>

    <SettingsSection>
      <div class="muted-header" slot="title">
        <span>Отключенные уведомления</span>
        <span class="badge-count">{mutedItems.length}</span>
      </div>

      <div class="filter-tabs">
        <button
          type="button"
          class="filter-tab"
          class:active={activeTab === "all"}
          on:click={() => (activeTab = "all")}
        >
          Все ({mutedItems.length})
        </button>
        <button
          type="button"
          class="filter-tab"
          class:active={activeTab === "chats"}
          on:click={() => (activeTab = "chats")}
        >
          Чаты ({mutedChats.length})
        </button>
        <button
          type="button"
          class="filter-tab"
          class:active={activeTab === "contacts"}
          on:click={() => (activeTab = "contacts")}
        >
          Контакты ({mutedContacts.length})
        </button>
      </div>

      {#if displayedItems.length === 0}
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p class="empty-title">Все уведомления включены</p>
          <p class="empty-desc">Здесь появятся чаты и диалоги с отключенными оповещениями.</p>
        </div>
      {:else}
        {#each displayedItems as chat (chat.id)}
          {@const peerId = getPeerId(chat)}
          <div class="muted-row">
            <Avatar size={40} contactId={peerId} chatId={chat.id} />
            <div class="muted-info">
              <div class="muted-title">{getTitle(chat)}</div>
              <div class="muted-sub">{formatMuteDuration(chat.options?.sound?.dontDisturbUntil)}</div>
            </div>
            <button
              type="button"
              class="unmute-btn"
              disabled={unmutingIds.has(chat.id)}
              on:click={() => handleUnmute(chat.id)}
            >
              {unmutingIds.has(chat.id) ? "..." : "Включить"}
            </button>
          </div>
        {/each}
      {/if}
    </SettingsSection>
  </div>
</SettingsPageWrapper>

<style>
  .notif-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 24px;
  }

  .muted-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .badge-count {
    min-width: 22px;
    height: 20px;
    padding: 0 7px;
    border-radius: 10px;
    background: var(--settings-card-elevated, #25262d);
    color: var(--settings-text-secondary);
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .filter-tabs {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--settings-separator);
  }

  .filter-tab {
    flex: 1;
    height: 32px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--settings-text-muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .filter-tab.active {
    background: var(--settings-accent-subtle);
    color: var(--settings-accent);
    font-weight: 600;
  }

  .empty-state {
    padding: 32px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    color: var(--settings-text-muted);
    gap: 8px;
  }

  .empty-title {
    margin: 4px 0 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--settings-text-primary);
  }

  .empty-desc {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    max-width: 260px;
  }

  .muted-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--settings-separator);
  }

  .muted-row:last-child {
    border-bottom: none;
  }

  .muted-info {
    flex: 1;
    min-width: 0;
  }

  .muted-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--settings-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .muted-sub {
    font-size: 12px;
    color: var(--settings-text-muted);
  }

  .unmute-btn {
    border: none;
    border-radius: 10px;
    padding: 6px 12px;
    background: var(--settings-accent-subtle);
    color: var(--settings-accent);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .unmute-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
