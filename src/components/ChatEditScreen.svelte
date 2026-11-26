<script>
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import Avatar from "$components/main/Avatar.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Switch from "$components/common/Switch.svelte";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import GroupAdminModal from "$components/chats/GroupAdminModal.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { getContact } from "$lib/utils/caching";
  import { openScreen } from "$lib/services/layerManager";

  export let chat = null;
  export let close = () => {};
  export let onAvatarClick = null;
  export let onUpdated = null;
  export let onDeleted = null;
  export let onLeft = null;

  let editTitle = "";
  let editDescription = "";
  let initialized = false;

  $: if (chat && !initialized) {
    editTitle = chat.title || "";
    editDescription = chat.description || "";
    initialized = true;
  }

  $: chatId = chat?.id;
  $: isChannel = chat?.type === "CHANNEL";
  $: isGroupChat = chat?.type === "CHAT" || chat?.type === "GROUP";
  $: isOwner = Boolean(chat && $currentUser != null && Number(chat.owner) === Number($currentUser));
  $: isAdmin = Boolean(chat && $currentUser != null && (isOwner || chat.admins?.includes(Number($currentUser)) || chat.admins?.includes($currentUser)));

  $: chatAccessType = (chat?.access === "PUBLIC" || (chat?.link && !chat.link.includes("join/"))) ? "PUBLIC" : "PRIVATE";
  $: commentsEnabled = Boolean(chat?.options?.COMMENTS ?? chat?.options?.comments);
  $: signaturesEnabled = Boolean(chat?.options?.SIGNATURES ?? chat?.options?.signatures);

  $: channelAdminPerms = (() => {
    if (!chat || !isAdmin) return 0;
    if (isOwner) return 0x7fffffff;
    const myAdminObj = chat.adminParticipants?.[$currentUser] || chat.adminParticipants?.[String($currentUser)];
    return Number(myAdminObj?.permissions ?? 0);
  })();

  $: channelAdmins = (() => {
    if (!isChannel || !chat) return [];
    const list = [];
    const ownerId = Number(chat.owner);
    if (ownerId) {
      const c = getContact(ownerId);
      list.push({ id: ownerId, contact: c, isOwner: true, alias: "владелец" });
    }
    const adminIds = Array.isArray(chat.admins) ? chat.admins : [];
    for (const rawId of adminIds) {
      const id = Number(rawId);
      if (!id || id === ownerId) continue;
      const c = getContact(id);
      const adminMeta = chat.adminParticipants?.[id] || chat.adminParticipants?.[String(id)];
      list.push({
        id,
        contact: c,
        isOwner: false,
        alias: adminMeta?.alias || "админ",
        permissions: Number(adminMeta?.permissions ?? 0),
      });
    }
    return list;
  })();

  let toastMessage = "";
  let toastTimer = null;
  function showToast(msg) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage = ""), 2200);
  }

  let showPurgeConfirm = false;
  let showDeleteConfirm = false;
  let showAdminModal = false;
  let adminModalMember = null;

  async function openAdminPickerScreen() {
    const mod = await import("$components/chats/UserSelectScreen.svelte");
    openScreen(
      mod.default || mod,
      {
        title: "Добавить администратора",
        multiSelect: false,
        autoAddToChat: false,
        onSelect: (picked) => {
          if (picked?.id) {
            adminModalMember = { id: picked.id, contact: { id: picked.id }, userId: picked.id };
            showAdminModal = true;
          }
        }
      },
      { canSwipe: true }
    );
  }

  function syncChat(patch) {
    if (!chat) return;
    chat = { ...chat, ...patch };
    if (chatId) {
      getChat(chatId).chatInfo.update((c) => ({ ...(c || {}), ...patch }));
    }
    if (onUpdated) onUpdated(chat);
  }

  async function saveChatProfile() {
    if (!chat?.id) return;
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      showToast("Введите название");
      return;
    }
    try {
      const updated = {
        ...chat,
        title: trimmedTitle,
        description: editDescription.trim() || undefined,
      };
      await $API.updateChatProfile(updated);
      syncChat({ title: trimmedTitle, description: editDescription.trim() || undefined });
      showToast("Изменения сохранены");
      close();
    } catch (e) {
      showToast("Не удалось сохранить");
    }
  }

  async function openLinkSettings() {
    const mod = await import("$components/ChatLinkSettingsScreen.svelte");
    openScreen(
      mod.default || mod,
      {
        chat,
        onUpdated: (updated) => {
          chat = updated;
          if (onUpdated) onUpdated(updated);
        },
      },
      { canSwipe: true }
    );
  }

  async function toggleComments() {
    if (!chatId || !isAdmin) return;
    const next = !commentsEnabled;
    try {
      await $API.setChannelOptions(chatId, {
        comments: next,
        signatures: signaturesEnabled,
      });
      syncChat({
        options: {
          ...(chat?.options || {}),
          COMMENTS: next,
          comments: next,
        },
      });
      showToast(next ? "Комментарии включены" : "Комментарии отключены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }

  async function toggleSignatures() {
    if (!chatId || !isAdmin) return;
    const next = !signaturesEnabled;
    try {
      await $API.setChannelOptions(chatId, {
        comments: commentsEnabled,
        signatures: next,
      });
      syncChat({
        options: {
          ...(chat?.options || {}),
          SIGNATURES: next,
          signatures: next,
        },
      });
      showToast(next ? "Подписи сообщений включены" : "Подписи сообщений отключены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }

  async function handlePurge() {
    showPurgeConfirm = false;
    if (!chatId) return;
    try {
      await $API.purgeChatHistory(chatId, false);
      const c = getChat(chatId);
      c?.receivedMessage?.set({ chatId: Number(chatId), type: "CLEAR_HISTORY" });
      showToast("История очищена");
    } catch (e) {
      showToast("Не удалось очистить историю");
    }
  }

  async function handleLeave() {
    if (!chatId) return;
    try {
      if (isChannel && typeof $API.leaveChannel === "function") {
        await $API.leaveChannel(chatId);
      } else {
        await $API.leaveGroup(chatId);
      }
      close();
      if (onLeft) onLeft();
    } catch (e) {
      showToast("Не удалось выйти");
    }
  }

  async function handleDelete() {
    showDeleteConfirm = false;
    if (!chatId) return;
    try {
      await $API.deleteChat(chatId);
      close();
      if (onDeleted) onDeleted();
    } catch (e) {
      showToast("Не удалось удалить");
    }
  }

  function getMemberName(item) {
    const c = item?.contact;
    return c?.names?.[0]?.name || c?.name || (c?.firstName ? `${c.firstName} ${c.lastName || ""}`.trim() : "") || `Пользователь ${item?.id}`;
  }
</script>

<div class="edit-screen-root">
  <header class="edit-toolbar">
    <button type="button" class="edit-icon-btn" on:click={() => close()} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <div class="edit-toolbar-title">{isChannel ? "Редактировать" : ""}</div>
    <div class="edit-toolbar-right">
      <button type="button" class="edit-icon-btn accent" on:click={saveChatProfile} aria-label="Сохранить" title="Сохранить">
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/check.svg'); mask-image: url('/icons/check.svg'); width: 22px; height: 22px;"></span>
      </button>
    </div>
  </header>

  <div class="edit-scroll-body">
    <div class="edit-cards-list">
      <div class="edit-avatar-wrap" on:click={(e) => onAvatarClick && onAvatarClick(e)}>
        <Avatar
          chat={chat}
          title={editTitle || chat?.title || ""}
          size={96}
          allowStories={false}
        />
        <div class="edit-avatar-camera-badge">
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/camera.svg'); mask-image: url('/icons/camera.svg'); width: 16px; height: 16px;"></span>
        </div>
      </div>

      <div class="edit-card">
        <div class="edit-field-name-row">
          <input
            type="text"
            class="edit-field-input"
            bind:value={editTitle}
            placeholder={isChannel ? "Название канала" : "Название чата"}
          />
          {#if editTitle}
            <button type="button" class="edit-field-clear-btn" on:click={() => (editTitle = "")} aria-label="Очистить">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 16px; height: 16px;"></span>
            </button>
          {/if}
        </div>
      </div>

      <div class="edit-card">
        <div class="edit-field-desc-group">
          <textarea
            class="edit-field-textarea"
            bind:value={editDescription}
            placeholder={isChannel ? "О канале" : "О чате"}
            rows="3"
          ></textarea>
        </div>
      </div>

      <div class="edit-card">
        <div class="edit-item-row" on:click={openLinkSettings}>
          <div class="edit-item-icon">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 22px; height: 22px;"></span>
          </div>
          <div class="edit-item-content">
            <div class="edit-item-title">{isChannel ? "Тип канала и ссылка" : "Тип чата и ссылка"}</div>
          </div>
          <span class="edit-item-trailing">{chatAccessType === "PUBLIC" ? "Публичный" : "Частный"}</span>
          <span class="mask-icon edit-item-chevron" style="-webkit-mask-image: url('/icons/arrow.svg'); mask-image: url('/icons/arrow.svg'); width: 14px; height: 14px;"></span>
        </div>
      </div>

      {#if isChannel}
        <div class="edit-card">
          <div class="edit-item-row" on:click={toggleComments}>
            <div class="edit-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/chats.svg'); mask-image: url('/icons/chats.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="edit-item-content">
              <div class="edit-item-title">Комментарии</div>
              <div class="edit-item-subtitle">Обсуждение публикаций</div>
            </div>
            <Switch checked={commentsEnabled} ariaLabel="Комментарии" />
          </div>

          <div class="edit-item-row" on:click={toggleSignatures}>
            <div class="edit-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/edit.svg'); mask-image: url('/icons/edit.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="edit-item-content">
              <div class="edit-item-title">Подписи сообщений</div>
              <div class="edit-item-subtitle">Имя автора в каждом посте</div>
            </div>
            <Switch checked={signaturesEnabled} ariaLabel="Подписи сообщений" />
          </div>
        </div>

        <div class="edit-card-caption">Администраторы · {channelAdmins.length}</div>
        <div class="edit-card">
          {#if isOwner || (channelAdminPerms & 4) !== 0}
            <div class="edit-item-row" on:click={openAdminPickerScreen}>
              <div class="edit-item-icon accent">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/user-plus.svg'); mask-image: url('/icons/user-plus.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="edit-item-content">
                <div class="edit-item-title accent">Добавить администратора</div>
              </div>
            </div>
          {/if}

          {#each channelAdmins as adminItem}
            <div class="edit-item-row" on:click={() => { adminModalMember = adminItem; showAdminModal = true; }}>
              <Avatar
                contactId={adminItem.id}
                size={40}
                src={adminItem?.contact?.baseUrl || adminItem?.contact?.baseRawUrl}
                title={getMemberName(adminItem)}
              />
              <div class="edit-item-content">
                <div class="edit-name-badge-row">
                  <span class="edit-item-title">{getMemberName(adminItem)}</span>
                  <span class="edit-role-pill" class:admin={!adminItem.isOwner}>{adminItem.alias}</span>
                </div>
                <div class="edit-item-subtitle">
                  <Signature contactId={adminItem.id} />
                </div>
              </div>
              <span class="mask-icon edit-item-chevron" style="-webkit-mask-image: url('/icons/arrow.svg'); mask-image: url('/icons/arrow.svg'); width: 14px; height: 14px;"></span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="edit-card">
        <div class="edit-item-row" on:click={() => (showPurgeConfirm = true)}>
          <div class="edit-item-icon">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 22px; height: 22px;"></span>
          </div>
          <div class="edit-item-content">
            <div class="edit-item-title">Стереть переписку</div>
          </div>
        </div>

        <div class="edit-item-row danger" on:click={handleLeave}>
          <div class="edit-item-icon danger">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/forward.svg'); mask-image: url('/icons/forward.svg'); width: 22px; height: 22px;"></span>
          </div>
          <div class="edit-item-content">
            <div class="edit-item-title danger">{isChannel ? "Покинуть канал" : "Выйти из чата"}</div>
          </div>
        </div>
      </div>

      {#if isOwner}
        <div class="edit-card">
          <div class="edit-item-row danger" on:click={() => (showDeleteConfirm = true)}>
            <div class="edit-item-icon danger">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="edit-item-content">
              <div class="edit-item-title danger">{isChannel ? "Удалить канал" : "Удалить чат"}</div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if toastMessage}
    <div class="edit-toast" transition:fade={{ duration: 120 }}>
      <span>{toastMessage}</span>
    </div>
  {/if}
</div>

{#if showPurgeConfirm}
  <ConfirmModal
    title="Стереть переписку?"
    message="Все сообщения в этом чате будут удалены для вас."
    confirmText="Стереть"
    danger={true}
    on:confirm={handlePurge}
    on:cancel={() => (showPurgeConfirm = false)}
    on:close={() => (showPurgeConfirm = false)}
  />
{/if}

{#if showDeleteConfirm}
  <ConfirmModal
    title={isChannel ? "Удалить канал?" : "Удалить чат?"}
    message="Это действие необратимо."
    confirmText="Удалить"
    danger={true}
    on:confirm={handleDelete}
    on:cancel={() => (showDeleteConfirm = false)}
    on:close={() => (showDeleteConfirm = false)}
  />
{/if}

{#if showAdminModal && adminModalMember}
  <GroupAdminModal
    {chatId}
    member={adminModalMember}
    isChannel={isChannel}
    isOwner={isOwner}
    currentUserId={$currentUser}
    on:close={() => { showAdminModal = false; adminModalMember = null; }}
    on:saved={() => { showAdminModal = false; adminModalMember = null; }}
    on:revoked={() => { showAdminModal = false; adminModalMember = null; }}
    on:transferOwnership={() => { showAdminModal = false; adminModalMember = null; }}
  />
{/if}

<style>
  .edit-screen-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-main, #101114);
    color: var(--text-primary, #ffffff);
  }

  .edit-toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: calc(56px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0 12px;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .edit-icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .edit-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .edit-icon-btn.accent {
    color: var(--profile-primary-blue, #007aff);
  }

  .edit-toolbar-title {
    flex: 1;
    font-size: 18px;
    font-weight: 600;
  }

  .edit-toolbar-right {
    display: flex;
    align-items: center;
  }

  .edit-scroll-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px calc(24px + var(--safe-bottom, 0px));
  }

  .edit-cards-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 520px;
    margin: 0 auto;
  }

  .edit-avatar-wrap {
    position: relative;
    width: 96px;
    height: 96px;
    margin: 8px auto 12px auto;
    cursor: pointer;
    border-radius: 50%;
  }

  .edit-avatar-camera-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--profile-primary-blue, #007aff);
    border: 2.5px solid var(--bg-main, #101114);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    z-index: var(--z-floating, 5);
    pointer-events: none;
  }

  .edit-card {
    background: var(--profile-card-bg, #1c1d24);
    border-radius: 16px;
    overflow: hidden;
  }

  .edit-card-caption {
    font-size: 13px;
    font-weight: 500;
    color: var(--profile-primary-blue, #007aff);
    padding: 4px 4px 0;
  }

  .edit-field-name-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 13px 14px;
  }

  .edit-field-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 15px;
    font-weight: 500;
    outline: none;
    padding: 0;
  }

  .edit-field-clear-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.45);
    padding: 4px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .edit-field-desc-group {
    padding: 12px 14px;
  }

  .edit-field-textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 15px;
    font-family: inherit;
    outline: none;
    resize: none;
    padding: 0;
  }

  .edit-field-input::placeholder,
  .edit-field-textarea::placeholder {
    color: rgba(255, 255, 255, 0.45);
  }

  .edit-item-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .edit-item-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .edit-item-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.85);
    flex-shrink: 0;
  }

  .edit-item-icon.accent {
    color: var(--profile-primary-blue, #007aff);
  }

  .edit-item-icon.danger {
    color: #ef4444;
  }

  .edit-item-content {
    flex: 1;
    min-width: 0;
  }

  .edit-item-title {
    font-size: 15px;
    font-weight: 500;
    color: #ffffff;
  }

  .edit-item-title.accent {
    color: var(--profile-primary-blue, #007aff);
  }

  .edit-item-title.danger {
    color: #ef4444;
  }

  .edit-item-subtitle {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 2px;
  }

  .edit-item-trailing {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    margin-right: 4px;
    flex-shrink: 0;
  }

  .edit-item-chevron {
    color: rgba(255, 255, 255, 0.35);
    flex-shrink: 0;
  }

  .edit-name-badge-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .edit-role-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 8px;
    background: rgba(0, 122, 255, 0.16);
    color: #5ca8ff;
  }

  .edit-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30, 32, 40, 0.94);
    color: #ffffff;
    padding: 10px 18px;
    border-radius: 12px;
    font-size: 14px;
    z-index: var(--z-toast, 120);
  }
</style>
