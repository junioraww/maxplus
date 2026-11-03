<script>
  import { onMount } from "svelte";
  import { fade, scale } from "svelte/transition";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import { page } from "$app/stores";
  import { get } from "svelte/store";
  import {
    privacyConfig,
    blockedContacts,
    updatePrivacySetting,
    fetchBlockedContacts,
    toggleBlockContact,
    loadPrivacySettings,
  } from "$lib/stores/privacySettings";
  import API, { currentRealChats, currentUser } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { getContact, getContactDirect, getContactDisplayName } from "$lib/stores/contacts";
  import Avatar from "$components/main/Avatar.svelte";

  export let isTab = false;
  export let onClose = null;

  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let showModal = false;
  let modalTitle = "";
  let modalDescription = "";
  let modalKey = "";
  let modalOptions = [];
  let modalSelected = "";

  let showHiddenConfirmModal = false;
  let showBlacklistModal = false;
  let blacklistMode = "list";
  let unblockingIds = new Set();
  let addSearchQuery = "";
  let addingBlockId = null;

  let candidateChats = [];

  onMount(() => {
    loadPrivacySettings();
    fetchBlockedContacts();
  });

  const ACCESS_LABELS = {
    ALL: "Все",
    CONTACTS: "Мои контакты",
    NOBODY: "Никто",
    _NONE_: "Никто",
    NONE: "Никто",
  };

  const TTL_LABELS = {
    "1M": "1 месяц",
    "3M": "3 месяца",
    "6M": "6 месяцев",
    "1Y": "1 год",
  };

  function openSelectModal({ title, description, key, options, currentValue }) {
    modalTitle = title;
    modalDescription = description;
    modalKey = key;
    modalOptions = options;
    modalSelected = currentValue;
    showModal = true;
  }

  async function handleOptionSelect(value) {
    showModal = false;
    try {
      await updatePrivacySetting(modalKey, value);
    } catch (_) {}
  }

  function handleHiddenClick() {
    if (!$privacyConfig.hidden) {
      showHiddenConfirmModal = true;
    } else {
      updatePrivacySetting("HIDDEN", false);
    }
  }

  async function confirmHidden() {
    showHiddenConfirmModal = false;
    try {
      await updatePrivacySetting("HIDDEN", true);
    } catch (_) {}
  }

  async function handleUnblock(contactId) {
    if (unblockingIds.has(contactId)) return;
    unblockingIds.add(contactId);
    unblockingIds = new Set(unblockingIds);
    try {
      const match = $blockedContacts.find(c => String(c.id || c.contactId) === String(contactId));
      if (match?.isBot) {
        if ($API?.suspendBot) {
          await $API.suspendBot(contactId, false);
        }
        blockedContacts.update(list => list.filter(c => String(c.id || c.contactId) !== String(contactId)));
      } else {
        await toggleBlockContact(contactId, false);
      }
    } catch (_) {
    } finally {
      unblockingIds.delete(contactId);
      unblockingIds = new Set(unblockingIds);
    }
  }

  function resolveContactName(c) {
    if (!c) return "Собеседник";
    const displayName = getContactDisplayName(c);
    if (displayName) return displayName;
    if (c.phone) return c.phone;
    return "Собеседник";
  }

  function getDialogPeerId(chat) {
    if (!chat || chat.type !== "DIALOG") return null;
    if (chat.participants && Object.keys(chat.participants).length > 0) {
      const other = Object.keys(chat.participants).find(id => String(id) !== String($currentUser));
      if (other) return Number(other);
    }
    if ($currentUser != null && chat.id != null) {
      try {
        const id = Number(BigInt(chat.id) ^ BigInt($currentUser));
        return id > 0 ? id : null;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function checkIsBot(chat, contact) {
    if (chat?.isBot || chat?.bot) return true;
    if (chat?.options) {
      if (Array.isArray(chat.options) && (chat.options.includes("BOT") || chat.options.includes("IS_BOT"))) return true;
      if (typeof chat.options === "object" && (chat.options.BOT === true || chat.options.IS_BOT === true || chat.options.bot === true)) return true;
    }
    if (contact?.isBot || contact?.bot || contact?.type === "BOT") return true;
    if (contact?.options) {
      if (Array.isArray(contact.options) && (contact.options.includes("BOT") || contact.options.includes("IS_BOT"))) return true;
      if (typeof contact.options === "object" && (contact.options.BOT === true || contact.options.IS_BOT === true || contact.options.bot === true)) return true;
    }
    return false;
  }

  function isSystemServiceAccount(chat, contact) {
    if (checkIsBot(chat, contact)) return false;
    if (contact?.options) {
      if (Array.isArray(contact.options) && contact.options.includes("SERVICE_ACCOUNT")) return true;
      if (typeof contact.options === "object" && contact.options.SERVICE_ACCOUNT === true) return true;
    }
    if (chat?.options) {
      if (Array.isArray(chat.options) && chat.options.includes("SERVICE_ACCOUNT")) return true;
      if (typeof chat.options === "object" && chat.options.SERVICE_ACCOUNT === true) return true;
    }
    return false;
  }

  async function loadCandidates(chatList, blockedList, myId) {
    const dialogs = (chatList || [])
      .map(id => getChat(id).getInfo())
      .filter(c => c && c.type === "DIALOG");

    const results = [];
    const missingContactIds = [];

    for (const chat of dialogs) {
      const peerId = getDialogPeerId(chat);
      if (!peerId || Number(peerId) === Number(myId)) continue;

      const isBlocked = blockedList.some(
        b => String(b.id || b.contactId) === String(peerId)
      );
      if (isBlocked) continue;

      const cached = get(getContact(peerId));
      if (!cached) {
        missingContactIds.push(peerId);
      }

      const isBot = checkIsBot(chat, cached);
      if (isSystemServiceAccount(chat, cached)) continue;

      const title = chat.title || resolveContactName(cached);

      results.push({
        chatId: chat.id,
        peerId,
        isBot,
        title,
      });
    }

    candidateChats = results;

    if (missingContactIds.length > 0) {
      Promise.all(missingContactIds.map(id => getContactDirect(id).catch(() => null))).then(contacts => {
        let changed = false;
        const updated = candidateChats.map(item => {
          const match = contacts.find(c => c && String(c.id) === String(item.peerId));
          if (match) {
            const isBot = checkIsBot(null, match) || item.isBot;
            const newTitle = resolveContactName(match);
            if (newTitle !== item.title || isBot !== item.isBot) {
              changed = true;
              return { ...item, title: newTitle, isBot };
            }
          }
          return item;
        });
        if (changed) {
          candidateChats = updated;
        }
      });
    }
  }

  $: loadCandidates($currentRealChats, $blockedContacts, $currentUser);

  $: filteredAvailableChats = candidateChats.filter(item => {
    if (!addSearchQuery) return true;
    const q = addSearchQuery.toLowerCase();
    return (item.title || "").toLowerCase().includes(q);
  });

  async function handleBlockOrSuspend(item) {
    if (!item?.peerId || addingBlockId) return;
    addingBlockId = item.peerId;
    try {
      if (item.isBot) {
        if ($API?.suspendBot) {
          await $API.suspendBot(item.peerId, true);
        }
        blockedContacts.update(list => [
          { id: item.peerId, contactId: item.peerId, firstName: item.title, isBot: true },
          ...list.filter(c => String(c.id || c.contactId) !== String(item.peerId)),
        ]);
      } else {
        await toggleBlockContact(item.peerId, true);
      }
      blacklistMode = "list";
      addSearchQuery = "";
    } catch (_) {
    } finally {
      addingBlockId = null;
    }
  }
</script>

<SettingsPageWrapper title="Конфиденциальность" {from} {isTab} {onClose}>
  {#if isTab}
    <header class="tab-header">
      <h1>Конфиденциальность</h1>
    </header>
  {/if}

  <div class="content-container">
    <div class="section-header">
      <h2>Кто видит мои данные</h2>
    </div>

    <div class="settings-card">
      <div
        class="menu-row"
        on:click={() =>
          openSelectModal({
            title: "Номер телефона",
            description: "Кто может видеть ваш номер телефона в профиле",
            key: "PHONE_NUMBER_PRIVACY",
            options: [
              { value: "ALL", label: "Все" },
              { value: "CONTACTS", label: "Мои контакты" },
              { value: "NOBODY", label: "Никто" },
            ],
            currentValue: $privacyConfig.phoneNumberPrivacy,
          })}
      >
        <div class="row-info">
          <span class="row-title">Номер телефона</span>
          <span class="row-desc">Отображение номера в профиле</span>
        </div>
        <div class="mode-badge">
          {ACCESS_LABELS[$privacyConfig.phoneNumberPrivacy] || $privacyConfig.phoneNumberPrivacy}
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="menu-row"
        on:click={() =>
          openSelectModal({
            title: "Поиск по номеру",
            description: "Кто сможет найти ваш аккаунт по номеру телефона",
            key: "SEARCH_BY_PHONE",
            options: [
              { value: "ALL", label: "Все" },
              { value: "CONTACTS", label: "Мои контакты" },
            ],
            currentValue: $privacyConfig.searchByPhone,
          })}
      >
        <div class="row-info">
          <span class="row-title">Поиск по номеру</span>
          <span class="row-desc">Кто находит вас через поиск контактов</span>
        </div>
        <div class="mode-badge">
          {ACCESS_LABELS[$privacyConfig.searchByPhone] || $privacyConfig.searchByPhone}
        </div>
      </div>

      <div class="card-divider"></div>

      <div class="menu-row" on:click={handleHiddenClick}>
        <div class="row-info">
          <span class="row-title">Время захода и статус «В сети»</span>
          <span class="row-desc">Скрыть точное время последней активности</span>
        </div>
        <div class="mode-badge" class:disabled={$privacyConfig.hidden}>
          {$privacyConfig.hidden ? "Скрыт ото всех" : "Виден контактам"}
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Связь и приглашения</h2>
    </div>

    <div class="settings-card">
      <div
        class="menu-row"
        on:click={() =>
          openSelectModal({
            title: "Входящие звонки",
            description: "Кто может звонить вам через Max",
            key: "INCOMING_CALL",
            options: [
              { value: "ALL", label: "Все" },
              { value: "CONTACTS", label: "Мои контакты" },
              { value: "NOBODY", label: "Никто" },
            ],
            currentValue: $privacyConfig.incomingCall,
          })}
      >
        <div class="row-info">
          <span class="row-title">Входящие звонки</span>
          <span class="row-desc">Разрешить звонки от собеседников</span>
        </div>
        <div class="mode-badge">
          {ACCESS_LABELS[$privacyConfig.incomingCall] || $privacyConfig.incomingCall}
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="menu-row"
        on:click={() =>
          openSelectModal({
            title: "Приглашения в группы и каналы",
            description: "Кто может добавлять вас в новые группы",
            key: "CHATS_INVITE",
            options: [
              { value: "ALL", label: "Все" },
              { value: "CONTACTS", label: "Мои контакты" },
              { value: "NOBODY", label: "Никто" },
            ],
            currentValue: $privacyConfig.chatsInvite,
          })}
      >
        <div class="row-info">
          <span class="row-title">Приглашения в чаты</span>
          <span class="row-desc">Добавление вас в публичные и приватные группы</span>
        </div>
        <div class="mode-badge">
          {ACCESS_LABELS[$privacyConfig.chatsInvite] || $privacyConfig.chatsInvite}
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Сообщения и защита</h2>
    </div>

    <div class="settings-card">
      <div
        class="toggle-row"
        on:click={() => updatePrivacySetting("SHOW_READ_MARK", !$privacyConfig.showReadMark)}
      >
        <div class="toggle-info">
          <span class="toggle-title">Отчёты о прочтении</span>
          <span class="toggle-desc">Передавать и отображать глобальные отметки прочтения</span>
        </div>
        <div class="toggle-track" class:active={$privacyConfig.showReadMark}>
          <div class="toggle-thumb" class:active={$privacyConfig.showReadMark}></div>
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="toggle-row"
        on:click={() => updatePrivacySetting("CONTENT_LEVEL_ACCESS", !$privacyConfig.contentLevelAccess)}
      >
        <div class="toggle-info">
          <span class="toggle-title">Фильтрация небезопасного контента</span>
          <span class="toggle-desc">Скрывать потенциально чувствительные или взрослые материалы</span>
        </div>
        <div class="toggle-track" class:active={$privacyConfig.contentLevelAccess}>
          <div class="toggle-thumb" class:active={$privacyConfig.contentLevelAccess}></div>
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="toggle-row"
        on:click={() => updatePrivacySetting("UNSAFE_FILES", !$privacyConfig.unsafeFiles)}
      >
        <div class="toggle-info">
          <span class="toggle-title">Предупреждать о подозрительных файлах</span>
          <span class="toggle-desc">Показывать запрос подтверждения при открытии неизвестных форматов</span>
        </div>
        <div class="toggle-track" class:active={$privacyConfig.unsafeFiles}>
          <div class="toggle-thumb" class:active={$privacyConfig.unsafeFiles}></div>
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="toggle-row"
        on:click={() =>
          updatePrivacySetting(
            "AUDIO_TRANSCRIPTION_ENABLED",
            !$privacyConfig.audioTranscriptionEnabled
          )}
      >
        <div class="toggle-info">
          <span class="toggle-title">Расшифровка голосовых сообщений</span>
          <span class="toggle-desc">Автоматическое распознавание речи на сервере</span>
        </div>
        <div class="toggle-track" class:active={$privacyConfig.audioTranscriptionEnabled}>
          <div class="toggle-thumb" class:active={$privacyConfig.audioTranscriptionEnabled}></div>
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="toggle-row"
        on:click={() =>
          updatePrivacySetting(
            "STICKERS_SUGGEST",
            $privacyConfig.stickersSuggest === "ON" ? "OFF" : "ON"
          )}
      >
        <div class="toggle-info">
          <span class="toggle-title">Подсказки стикеров</span>
          <span class="toggle-desc">Предлагать подходящие стикеры при вводе эмодзи</span>
        </div>
        <div class="toggle-track" class:active={$privacyConfig.stickersSuggest === "ON"}>
          <div class="toggle-thumb" class:active={$privacyConfig.stickersSuggest === "ON"}></div>
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Чёрный список</h2>
    </div>

    <div class="settings-card">
      <div class="menu-row" on:click={() => (showBlacklistModal = true)}>
        <div class="row-info">
          <span class="row-title">Заблокированные пользователи</span>
          <span class="row-desc">
            {$blockedContacts.length === 0
              ? "Список пуст"
              : `${$blockedContacts.length} заблокировано`}
          </span>
        </div>
        <div class="mode-badge neutral">
          {$blockedContacts.length}
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Удаление аккаунта</h2>
    </div>

    <div class="settings-card">
      <div
        class="menu-row"
        on:click={() =>
          openSelectModal({
            title: "Удаление при неактивности",
            description: "Если вы не будете заходить в приложение в течение этого срока, аккаунт и история сообщений будут удалены",
            key: "INACTIVE_TTL",
            options: [
              { value: "1M", label: "1 месяц" },
              { value: "3M", label: "3 месяца" },
              { value: "6M", label: "6 месяцев" },
              { value: "1Y", label: "1 год" },
            ],
            currentValue: $privacyConfig.inactiveTtl,
          })}
      >
        <div class="row-info">
          <span class="row-title">Если я не захожу</span>
          <span class="row-desc">Период отсутствия до автоматической очистки</span>
        </div>
        <div class="mode-badge">
          {TTL_LABELS[$privacyConfig.inactiveTtl] || $privacyConfig.inactiveTtl}
        </div>
      </div>
    </div>
  </div>
</SettingsPageWrapper>

{#if showModal}
  <div
    class="modal-backdrop"
    on:click|self={() => (showModal = false)}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal-card"
      transition:scale={{ duration: 180, start: 0.94 }}
    >
      <h3 class="modal-title">{modalTitle}</h3>
      {#if modalDescription}
        <p class="modal-desc">{modalDescription}</p>
      {/if}
      <div class="modal-options">
        {#each modalOptions as opt}
          <div
            class="modal-option"
            class:selected={modalSelected === opt.value}
            on:click={() => handleOptionSelect(opt.value)}
          >
            <span class="option-label">{opt.label}</span>
            <div class="radio-circle" class:checked={modalSelected === opt.value}>
              {#if modalSelected === opt.value}
                <div class="radio-inner"></div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      <button class="modal-cancel-btn" on:click={() => (showModal = false)}>Отмена</button>
    </div>
  </div>
{/if}

{#if showHiddenConfirmModal}
  <div
    class="modal-backdrop"
    on:click|self={() => (showHiddenConfirmModal = false)}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal-card"
      transition:scale={{ duration: 180, start: 0.94 }}
    >
      <h3 class="modal-title">Скрыть статус «В сети»?</h3>
      <p class="modal-desc">
        Если вы скроете время своей активности, вы также не сможете видеть точное время захода других пользователей — вместо него будет отображаться «Был(а) недавно».
      </p>
      <div class="modal-actions">
        <button class="modal-btn secondary" on:click={() => (showHiddenConfirmModal = false)}>
          Отмена
        </button>
        <button class="modal-btn primary" on:click={confirmHidden}>
          Скрыть
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showBlacklistModal}
  <div
    class="modal-backdrop"
    on:click|self={() => {
      showBlacklistModal = false;
      blacklistMode = "list";
      addSearchQuery = "";
    }}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal-card blacklist-card fixed-height"
      transition:fade={{ duration: 150 }}
    >
      {#if blacklistMode === "list"}
        <div class="blacklist-header">
          <div class="blacklist-header-left">
            <h3 class="modal-title">Чёрный список</h3>
            <span class="blacklist-count">({$blockedContacts.length})</span>
          </div>
          <div class="blacklist-header-actions">
            <button
              class="add-contact-icon-btn"
              title="Добавить в ЧС"
              on:click={() => (blacklistMode = "add")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button
              class="close-icon-btn"
              on:click={() => {
                showBlacklistModal = false;
                blacklistMode = "list";
                addSearchQuery = "";
              }}
            >✕</button>
          </div>
        </div>
        <div class="blacklist-scroll fixed-scroll">
          {#if $blockedContacts.length === 0}
            <div class="empty-blacklist">
              <span>В чёрном списке пока никого нет</span>
            </div>
          {:else}
            {#each $blockedContacts as contact (contact.id || contact.contactId)}
              <div class="blacklist-item">
                <Avatar size={42} contactId={contact.id || contact.contactId} />
                <div class="blacklist-info">
                  <span class="blacklist-name">{resolveContactName(contact)}</span>
                  {#if contact.phone}
                    <span class="blacklist-sub">{contact.phone}</span>
                  {/if}
                </div>
                <button
                  class="unblock-btn"
                  disabled={unblockingIds.has(contact.id || contact.contactId)}
                  on:click={() => handleUnblock(contact.id || contact.contactId)}
                >
                  {unblockingIds.has(contact.id || contact.contactId) ? "..." : "Разблокировать"}
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="blacklist-header">
          <div class="blacklist-header-left">
            <button
              class="back-icon-btn"
              title="Назад"
              on:click={() => {
                blacklistMode = "list";
                addSearchQuery = "";
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
            <h3 class="modal-title">Добавить в ЧС</h3>
          </div>
          <button
            class="close-icon-btn"
            on:click={() => {
              showBlacklistModal = false;
              blacklistMode = "list";
              addSearchQuery = "";
            }}
          >✕</button>
        </div>
        <div class="search-input-wrapper">
          <input
            type="text"
            class="custom-search-input"
            bind:value={addSearchQuery}
            placeholder="Поиск по диалогам и ботам..."
          />
        </div>
        <div class="blacklist-scroll fixed-scroll">
          {#if filteredAvailableChats.length === 0}
            <div class="empty-blacklist">
              <span>Нет доступных собеседников или ботов</span>
            </div>
          {:else}
            {#each filteredAvailableChats as item (item.chatId)}
              <div class="blacklist-item select-block-item" on:click={() => handleBlockOrSuspend(item)}>
                <Avatar size={42} contactId={item.peerId} />
                <div class="blacklist-info">
                  <div class="blacklist-title-row">
                    <span class="blacklist-name">{item.title}</span>
                    {#if item.isBot}
                      <span class="bot-badge">БОТ</span>
                    {/if}
                  </div>
                </div>
                <button
                  class="block-icon-btn"
                  title={item.isBot ? "Остановить бота" : "Заблокировать"}
                  disabled={addingBlockId === item.peerId}
                >
                  <img src="icons/block.svg" alt="Заблокировать" />
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .tab-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #212126;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .tab-header h1 {
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

  .section-header h2 {
    font-size: 0.85rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 4px 0 6px 4px;
  }

  .settings-card {
    background: #26262e;
    border-radius: 12px;
    border: 1px solid #333;
    padding: 14px 16px;
  }

  .card-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 12px 0;
  }

  .menu-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.15s;
  }

  .menu-row:hover {
    opacity: 0.9;
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .row-title {
    font-size: 0.98rem;
    font-weight: 500;
    color: #fff;
  }

  .row-desc {
    font-size: 0.82rem;
    color: #888;
  }

  .mode-badge {
    font-size: 13px;
    font-weight: 500;
    color: #4cd964;
    padding: 4px 10px;
    border-radius: 6px;
    background: rgba(76, 217, 100, 0.12);
    white-space: nowrap;
  }

  .mode-badge.disabled {
    color: #ff9f0a;
    background: rgba(255, 159, 10, 0.12);
  }

  .mode-badge.neutral {
    color: #0ea5e9;
    background: rgba(14, 165, 233, 0.12);
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
    gap: 3px;
  }

  .toggle-title {
    font-size: 0.98rem;
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
    background: #3a3a3c;
    border-radius: 12px;
    position: relative;
    flex-shrink: 0;
    transition: background-color 0.2s;
  }

  .toggle-track.active {
    background: #0ea5e9;
  }

  .toggle-thumb {
    width: 20px;
    height: 20px;
    background: #fff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }

  .toggle-thumb.active {
    transform: translateX(20px);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 7);
    padding: 16px;
  }

  .modal-card {
    background: #26262e;
    border: 1px solid #3a3a44;
    border-radius: 14px;
    padding: 20px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-card.fixed-height {
    height: 480px;
    max-height: 85vh;
  }

  .modal-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #fff;
  }

  .modal-desc {
    margin: 0;
    font-size: 0.88rem;
    color: #aaa;
    line-height: 1.4;
  }

  .modal-options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .modal-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .modal-option:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .modal-option.selected {
    border-color: #0ea5e9;
    background: rgba(14, 165, 233, 0.1);
  }

  .option-label {
    font-size: 0.95rem;
    color: #eee;
  }

  .radio-circle {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid #666;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .radio-circle.checked {
    border-color: #0ea5e9;
  }

  .radio-inner {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #0ea5e9;
  }

  .modal-cancel-btn {
    padding: 10px;
    border: none;
    background: transparent;
    color: #999;
    cursor: pointer;
    font-size: 0.92rem;
    border-radius: 8px;
  }

  .modal-cancel-btn:hover {
    color: #fff;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .modal-btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.92rem;
    cursor: pointer;
    border: none;
    font-weight: 500;
  }

  .modal-btn.secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #ccc;
  }

  .modal-btn.primary {
    background: #0ea5e9;
    color: #fff;
  }

  .blacklist-card {
    display: flex;
    flex-direction: column;
  }

  .blacklist-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .blacklist-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .blacklist-count {
    color: #888;
    font-size: 1rem;
    font-weight: 500;
  }

  .blacklist-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .add-contact-icon-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: transparent;
    color: #ffffff;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.12s;
  }

  .add-contact-icon-btn:hover {
    opacity: 0.8;
    transform: scale(1.08);
  }

  .back-icon-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: transparent;
    color: #ffffff;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.12s;
    margin-right: 2px;
  }

  .back-icon-btn:hover {
    opacity: 0.8;
    transform: scale(1.08);
  }

  .blacklist-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .bot-badge {
    font-size: 10px;
    font-weight: 600;
    color: #0ea5e9;
    background: rgba(14, 165, 233, 0.14);
    border: 1px solid rgba(14, 165, 233, 0.28);
    padding: 1px 5px;
    border-radius: 4px;
    letter-spacing: 0.04em;
    flex-shrink: 0;
    line-height: 1.4;
  }

  .close-icon-btn {
    background: transparent;
    border: none;
    color: #888;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 4px 8px;
  }

  .close-icon-btn:hover {
    color: #fff;
  }

  .search-input-wrapper {
    width: 100%;
    display: flex;
  }

  .custom-search-input {
    width: 100%;
    height: 36px;
    background-color: #202024;
    border: 1px solid #363640;
    border-radius: 8px;
    padding: 0 12px;
    color: #fff;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .custom-search-input:focus {
    border-color: #0ea5e9;
  }

  .blacklist-scroll {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .blacklist-scroll.fixed-scroll {
    flex: 1;
    min-height: 0;
  }

  .empty-blacklist {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    min-height: 200px;
    color: #888;
    font-size: 0.9rem;
    text-align: center;
  }

  .blacklist-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
  }

  .select-block-item {
    cursor: pointer;
    transition: background 0.15s;
  }

  .select-block-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .blacklist-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .blacklist-name {
    font-size: 0.92rem;
    color: #fff;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .blacklist-sub {
    font-size: 0.78rem;
    color: #888;
  }

  .unblock-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #ff5555;
    border: 1px solid rgba(255, 85, 85, 0.2);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .unblock-btn:hover:not(:disabled) {
    background: rgba(255, 85, 85, 0.15);
  }

  .block-icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 85, 85, 0.12);
    border: 1px solid rgba(255, 85, 85, 0.25);
    border-radius: 8px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, transform 0.1s;
  }

  .block-icon-btn img {
    width: 18px;
    height: 18px;
    display: block;
    filter: invert(41%) sepia(87%) saturate(2330%) hue-rotate(334deg) brightness(101%) contrast(101%);
  }

  .block-icon-btn:hover:not(:disabled) {
    background: rgba(255, 85, 85, 0.22);
    transform: scale(1.05);
  }
</style>
