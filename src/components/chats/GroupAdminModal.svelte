<script>
  import { fade, scale } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import API, { currentUser } from "$lib/stores/api";
  import Avatar from "$components/main/Avatar.svelte";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import { getContact } from "$lib/utils/caching";

  export let chat;
  export let member;

  const dispatch = createEventDispatcher();

  const CHANNEL_PERMS = [
    { key: "CHANGE_CHAT_INFO", bit: 8, label: "Изменение профиля канала", desc: "Название, фото и описание" },
    { key: "POST_MESSAGE", bit: 256, label: "Публикация сообщений", desc: "Создание новых постов в канале" },
    { key: "EDIT_MESSAGE", bit: 512, label: "Редактирование сообщений", desc: "Редактирование чужих публикаций" },
    { key: "DELETE_MESSAGE", bit: 1024, label: "Удаление сообщений", desc: "Удаление любых публикаций в канале" },
    { key: "PIN_MESSAGE", bit: 16, label: "Закрепление сообщений", desc: "Закрепление и открепление постов" },
    { key: "ADD_REMOVE_MEMBER", bit: 2, label: "Добавление подписчиков", desc: "Приглашение новых подписчиков" },
    { key: "VIEW_STATS", bit: 2048, label: "Просмотр статистики", desc: "Статистика просмотров и взаимодействий" },
    { key: "ADD_ADMIN", bit: 4, label: "Назначение администраторов", desc: "Добавление новых администраторов" },
  ];

  const GROUP_PERMS = [
    { key: "CHANGE_CHAT_INFO", label: "Изменение профиля группы", desc: "Название, фото и описание" },
    { key: "DELETE_OTHERS_MESSAGES", label: "Удаление сообщений", desc: "Удаление чужих сообщений в чате" },
    { key: "PIN_MESSAGE", label: "Закрепление сообщений", desc: "Управление закрепленными сообщениями" },
    { key: "ADD_REMOVE_MEMBERS", label: "Управление участниками", desc: "Добавление и исключение пользователей" },
    { key: "ADD_ADMINS", label: "Назначение администраторов", desc: "Добавление новых админов" },
    { key: "CALL", label: "Управление звонками", desc: "Инициация и модерация групповых звонков" },
  ];

  $: isChannel = chat?.type === "CHANNEL";
  $: permissionDefs = isChannel ? CHANNEL_PERMS : GROUP_PERMS;

  let alias = "";
  let permissionsMap = {};
  let isSaving = false;
  let isRevoking = false;
  let isTransferring = false;
  let showTransferConfirm = false;
  let errorMessage = "";

  $: memberId = Number(member?.contact?.id || member?.userId || member?.id || member);
  $: contactStore = memberId ? getContact(memberId) : null;
  $: contact = $contactStore;
  $: displayName = member?.contact?.names?.[0]?.name ||
    member?.contact?.name ||
    contact?.names?.[0]?.name ||
    contact?.name ||
    member?.name ||
    "Пользователь";

  $: isExistingAdmin = Boolean(
    member?.isAdmin ||
    chat?.admins?.map(Number).includes(memberId) ||
    chat?.adminParticipants?.[memberId] ||
    chat?.adminParticipants?.[String(memberId)]
  );

  $: isOwner = Boolean(
    $currentUser != null &&
    (Number(chat?.owner) === Number($currentUser) || Number(chat?.creator) === Number($currentUser))
  );

  $: isTargetOwner = Boolean(
    Number(chat?.owner) === memberId || Number(chat?.creator) === memberId
  );

  $: isSelf = Boolean(
    $currentUser != null && Number($currentUser) === memberId
  );

  $: isReadOnly = isTargetOwner || isSelf;

  $: subtitleText = isTargetOwner
    ? (isChannel
        ? "Этот пользователь создал канал и обладает всеми правами администратора."
        : "Этот пользователь создал чат и обладает всеми правами администратора.")
    : isSelf
      ? "Вы не можете изменить свои собственные права"
      : isExistingAdmin
        ? "Редактирование прав"
        : (isChannel ? "Новый администратор" : "Назначение администратора");

  onMount(() => {
    alias = member?.alias || chat?.adminParticipants?.[memberId]?.alias || chat?.adminParticipants?.[String(memberId)]?.alias || "";
    if (isTargetOwner) {
      if (isChannel) {
        CHANNEL_PERMS.forEach(p => { permissionsMap[p.key] = true; });
      } else {
        GROUP_PERMS.forEach(p => { permissionsMap[p.key] = true; });
      }
      return;
    }
    const rawPerms = member?.permissions || chat?.adminParticipants?.[memberId]?.permissions || chat?.adminParticipants?.[String(memberId)]?.permissions;
    if (isChannel) {
      const bitmask = typeof rawPerms === "number" ? rawPerms : null;
      CHANNEL_PERMS.forEach(p => {
        if (bitmask !== null) {
          permissionsMap[p.key] = (bitmask & p.bit) !== 0;
        } else if (Array.isArray(rawPerms)) {
          permissionsMap[p.key] = rawPerms.includes(p.key);
        } else {
          permissionsMap[p.key] = isExistingAdmin ? true : (p.key !== "ADD_ADMIN");
        }
      });
    } else {
      const activeList = Array.isArray(rawPerms) ? rawPerms : [];
      GROUP_PERMS.forEach(p => {
        permissionsMap[p.key] = isExistingAdmin ? activeList.includes(p.key) : true;
      });
    }
  });

  function togglePermission(key) {
    if (isReadOnly) return;
    permissionsMap[key] = !permissionsMap[key];
    permissionsMap = { ...permissionsMap };
  }

  async function handleSave() {
    if (isSaving || !memberId || !chat?.id) return;
    isSaving = true;
    errorMessage = "";
    try {
      const trimmedAlias = alias.trim() || null;
      if (isChannel) {
        let mask = 0;
        CHANNEL_PERMS.forEach(p => {
          if (permissionsMap[p.key]) mask |= p.bit;
        });
        await $API.grantChannelAdmin(chat.id, memberId, mask, trimmedAlias);
        dispatch("saved", { userId: memberId, permissions: mask, alias: trimmedAlias });
      } else {
        const activeList = Object.keys(permissionsMap).filter(k => permissionsMap[k]);
        await $API.grantGroupAdmin(chat.id, memberId, activeList, trimmedAlias);
        dispatch("saved", { userId: memberId, permissions: activeList, alias: trimmedAlias });
      }
      dispatch("close");
    } catch (e) {
      errorMessage = typeof e === "string" ? e : (e?.message || "Ошибка сохранения прав");
    } finally {
      isSaving = false;
    }
  }

  async function handleRevoke() {
    if (isRevoking || !memberId || !chat?.id) return;
    isRevoking = true;
    errorMessage = "";
    try {
      if (isChannel) {
        await $API.revokeChannelAdmin(chat.id, memberId);
      } else {
        await $API.revokeGroupAdmin(chat.id, memberId);
      }
      dispatch("revoked", { userId: memberId });
      dispatch("close");
    } catch (e) {
      errorMessage = typeof e === "string" ? e : (e?.message || "Ошибка снятия прав");
    } finally {
      isRevoking = false;
    }
  }

  async function handleTransferOwnershipConfirm() {
    if (isTransferring || !memberId || !chat?.id) return;
    isTransferring = true;
    errorMessage = "";
    try {
      await $API.transferChannelOwnership(chat.id, memberId);
      showTransferConfirm = false;
      dispatch("transferred", { newOwnerId: memberId });
      dispatch("close");
    } catch (e) {
      errorMessage = typeof e === "string" ? e : (e?.message || "Не удалось передать права");
      showTransferConfirm = false;
    } finally {
      isTransferring = false;
    }
  }

  function close() {
    dispatch("close");
  }
</script>

<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={close}>
  <div class="modal-card" transition:scale={{ duration: 200, start: 0.94 }} on:click|stopPropagation>
    <div class="modal-head">
      <div class="user-preview">
        <Avatar
          contactId={memberId}
          size={48}
          src={memberItem?.contact?.baseUrl || memberItem?.contact?.baseRawUrl}
          title={displayName}
        />
        <div class="user-text">
          <span class="user-title">{displayName}</span>
          <span class="user-subtitle">{subtitleText}</span>
        </div>
      </div>
      <button type="button" class="btn-close" on:click={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="modal-scroll-body">
      {#if !isTargetOwner}
        <div class="field-block">
          <label for="admin-alias-input">Должность</label>
          <input
            id="admin-alias-input"
            type="text"
            bind:value={alias}
            placeholder={isChannel ? "Например: Редактор, Автор..." : "Например: Модератор, Поддержка..."}
            maxlength="32"
            disabled={isReadOnly}
          />
          <span class="field-hint">Отображается рядом с подписью сообщений</span>
        </div>
      {/if}

      <div class="perms-header">{isChannel ? "Что может делать этот администратор?" : "Права администратора"}</div>
      <div class="perms-list">
        {#each permissionDefs as perm}
          {@const checked = Boolean(permissionsMap[perm.key])}
          <div class="perm-row" class:disabled-row={isReadOnly} on:click={() => togglePermission(perm.key)}>
            <div class="perm-info">
              <span class="perm-label">{perm.label}</span>
              <span class="perm-desc">{perm.desc}</span>
            </div>
            <div class="toggle-switch" class:active={checked} class:disabled={isReadOnly}>
              <div class="toggle-thumb"></div>
            </div>
          </div>
        {/each}
      </div>

      {#if isOwner && memberId !== Number($currentUser) && Number(chat?.owner) !== memberId}
        <button
          type="button"
          class="btn-transfer-owner"
          on:click={() => (showTransferConfirm = true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Передать права владельца</span>
        </button>
      {/if}

      {#if errorMessage}
        <div class="error-banner" transition:fade={{ duration: 150 }}>
          {errorMessage}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      {#if isReadOnly}
        <button type="button" class="btn btn-secondary" on:click={close}>Закрыть</button>
      {:else}
        {#if isExistingAdmin}
          <button
            type="button"
            class="btn btn-danger-action"
            disabled={isRevoking || isSaving}
            on:click={handleRevoke}
          >
            {isRevoking ? "Снятие..." : (isChannel ? "Исключить из администраторов" : "Разжаловать")}
          </button>
        {/if}
        <button type="button" class="btn btn-secondary" on:click={close}>Отмена</button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={isSaving || isRevoking}
          on:click={handleSave}
        >
          {isSaving ? "Сохранение..." : "Сохранить"}
        </button>
      {/if}
    </div>
  </div>
</div>

{#if showTransferConfirm}
  <ConfirmModal
    title="Передать права владельца"
    message={`Вы действительно хотите передать права владельца пользователю ${displayName}? Вы останетесь администратором.`}
    confirmText="Передать права"
    isDangerous={true}
    on:confirm={handleTransferOwnershipConfirm}
    on:cancel={() => (showTransferConfirm = false)}
  />
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal, 7);
    padding: 16px;
  }

  .modal-card {
    background: var(--bg-surface, #1e2025);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
    border-radius: 24px;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    max-height: 88vh;
    overflow: hidden;
    color: var(--text-primary, #ffffff);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-card, rgba(255, 255, 255, 0.06));
  }

  .user-preview {
    display: flex;
    align-items: center;
    gap: 14px;
    overflow: hidden;
  }

  .user-text {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .user-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-subtitle {
    font-size: 13px;
    color: var(--text-secondary, #8b929e);
  }

  .btn-close {
    background: none;
    border: none;
    color: var(--text-secondary, #8b929e);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    transition: 0.15s;
  }

  .btn-close:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .modal-scroll-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-block label {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary, #8b929e);
  }

  .field-block input {
    background: var(--bg-input, #26262e);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 14px;
    padding: 12px 14px;
    color: #ffffff;
    font-size: 15px;
    outline: none;
    transition: border-color 0.15s;
  }

  .field-block input:focus {
    border-color: var(--accent-primary, #248bfe);
  }

  .field-hint {
    font-size: 12px;
    color: var(--text-muted, #697282);
  }

  .perms-header {
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--text-muted, #697282);
    letter-spacing: 0.5px;
  }

  .perms-list {
    display: flex;
    flex-direction: column;
    background: var(--bg-surface-secondary, #26262e);
    border: 1px solid var(--border-card, rgba(255, 255, 255, 0.06));
    border-radius: 16px;
    overflow: hidden;
  }

  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    cursor: pointer;
    transition: background 0.12s;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    min-height: 56px;
    box-sizing: border-box;
  }

  .perm-row:last-child {
    border-bottom: none;
  }

  .perm-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .perm-row.disabled-row {
    cursor: default;
    pointer-events: none;
  }

  .perm-row.disabled-row:hover {
    background: none;
  }

  .perm-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .perm-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
  }

  .perm-desc {
    font-size: 12.5px;
    color: var(--text-secondary, #8b929e);
  }

  .toggle-switch {
    width: 44px;
    height: 26px;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.16);
    position: relative;
    transition: background 0.2s cubic-bezier(0.2, 0, 0, 1);
    flex-shrink: 0;
  }

  .toggle-switch.active {
    background: var(--accent-primary, #248bfe);
  }

  .toggle-switch.disabled {
    opacity: 0.55;
  }

  .toggle-thumb {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #ffffff;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  .toggle-switch.active .toggle-thumb {
    transform: translateX(18px);
  }

  .btn-transfer-owner {
    width: 100%;
    height: 48px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #ffffff);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: background 0.15s, border-color 0.15s;
  }

  .btn-transfer-owner:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
  }

  .error-banner {
    padding: 10px 14px;
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: 12px;
    color: var(--status-danger, #ef4444);
    font-size: 13px;
    text-align: center;
  }

  .modal-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    background: rgba(0, 0, 0, 0.18);
    border-top: 1px solid var(--border-card, rgba(255, 255, 255, 0.06));
  }

  .btn {
    padding: 0 20px;
    height: 48px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s, background 0.15s;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary, #ffffff);
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .btn-primary {
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-primary-hover, #1b74d9);
  }

  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-danger-action {
    margin-right: auto;
    background: transparent;
    color: var(--status-danger, #ef4444);
    padding: 0 12px;
    font-weight: 500;
  }

  .btn-danger-action:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
  }
</style>