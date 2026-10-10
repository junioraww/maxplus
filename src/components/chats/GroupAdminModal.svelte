<script>
  import { Button, IconButton, Modal } from "$components/ui";
  import { fade, scale } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import API from "$lib/stores/api";
  import Avatar from "$components/main/Avatar.svelte";
  import { getContact } from "$lib/utils/caching";

  export let chat;
  export let member;

  const dispatch = createEventDispatcher();

  const PERMISSION_DEFS = [
    { key: "CHANGE_CHAT_INFO", label: "Изменение профиля группы", desc: "Название, фото и описание" },
    { key: "DELETE_OTHERS_MESSAGES", label: "Удаление сообщений", desc: "Удаление чужих сообщений в чате" },
    { key: "PIN_MESSAGE", label: "Закрепление сообщений", desc: "Управление закрепленными сообщениями" },
    { key: "ADD_REMOVE_MEMBERS", label: "Управление участниками", desc: "Добавление и исключение пользователей" },
    { key: "ADD_ADMINS", label: "Назначение администраторов", desc: "Добавление новых админов" },
    { key: "CALL", label: "Управление звонками", desc: "Инициация и модерация групповых звонков" },
  ];

  let alias = "";
  let permissionsMap = {};
  let isSaving = false;
  let isRevoking = false;
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

  const isExistingAdmin = Boolean(member?.isAdmin);

  onMount(() => {
    alias = member?.alias || "";
    const activePerms = Array.isArray(member?.permissions) ? member.permissions : [];
    PERMISSION_DEFS.forEach(p => {
      permissionsMap[p.key] = isExistingAdmin ? activePerms.includes(p.key) : true;
    });
  });

  function togglePermission(key) {
    permissionsMap[key] = !permissionsMap[key];
    permissionsMap = { ...permissionsMap };
  }

  async function handleSave() {
    if (isSaving || !memberId) return;
    isSaving = true;
    errorMessage = "";
    try {
      const activeList = Object.keys(permissionsMap).filter(k => permissionsMap[k]);
      await $API.grantGroupAdmin(chat.id, memberId, activeList, alias);
      dispatch("saved", { userId: memberId, permissions: activeList, alias });
      dispatch("close");
    } catch (e) {
      errorMessage = typeof e === "string" ? e : (e?.message || "Ошибка сохранения прав");
    } finally {
      isSaving = false;
    }
  }

  async function handleRevoke() {
    if (isRevoking || !memberId) return;
    isRevoking = true;
    errorMessage = "";
    try {
      await $API.revokeGroupAdmin(chat.id, memberId);
      dispatch("revoked", { userId: memberId });
      dispatch("close");
    } catch (e) {
      errorMessage = typeof e === "string" ? e : (e?.message || "Ошибка снятия прав");
    } finally {
      isRevoking = false;
    }
  }

  function close() {
    dispatch("close");
  }
</script>

<Modal open={true} bare closeOnEsc={true} onclose={close}>
  <div class="modal-card">
    <div class="modal-head">
      <div class="user-preview">
        <Avatar contactId={memberId} size={42} />
        <div class="user-text">
          <span class="user-title">{displayName}</span>
          <span class="user-subtitle">
            {isExistingAdmin ? "Редактирование прав администратора" : "Назначение администратора"}
          </span>
        </div>
      </div>
      <IconButton class="groupadminmodal-btn-close" onclick={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </IconButton>
    </div>

    <div class="modal-scroll-body">
      <div class="field-block">
        <label for="admin-alias-input">Должность (псевдоним в чате)</label>
        <input
          id="admin-alias-input"
          type="text"
          bind:value={alias}
          placeholder="Например: Модератор, Поддержка..."
          maxlength="32"
        />
        <span class="field-hint">Отображается рядом с именем пользователя в чате</span>
      </div>

      <div class="perms-header">Права администратора</div>
      <div class="perms-list">
        {#each PERMISSION_DEFS as perm}
          {@const checked = Boolean(permissionsMap[perm.key])}
          <div class="perm-row" on:click={() => togglePermission(perm.key)}>
            <div class="perm-info">
              <span class="perm-label">{perm.label}</span>
              <span class="perm-desc">{perm.desc}</span>
            </div>
            <div class="toggle-switch" class:active={checked}>
              <div class="toggle-thumb"></div>
            </div>
          </div>
        {/each}
      </div>

      {#if errorMessage}
        <div class="error-banner" transition:fade={{ duration: 150 }}>
          {errorMessage}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      {#if isExistingAdmin}
        <Button variant="danger" class="groupadminmodal-btn" disabled={isRevoking || isSaving} onclick={handleRevoke}>
          {isRevoking ? "Снятие..." : "Разжаловать"}
        </Button>
      {/if}
      <Button class="groupadminmodal-btn groupadminmodal-btn-secondary" onclick={close}>Отмена</Button>
      <Button variant="primary" class="groupadminmodal-btn" disabled={isSaving || isRevoking} onclick={handleSave}>
        {isSaving ? "Сохранение..." : "Сохранить"}
      </Button>
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
    max-width: 460px;
    display: flex;
    flex-direction: column;
    max-height: 85vh;
    overflow: hidden;
    color: var(--text-primary);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .user-preview {
    display: flex;
    align-items: center;
    gap: 12px;
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
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-subtitle {
    font-size: 12px;
    color: var(--text-muted);
  }

  :global(.groupadminmodal-btn-close)  { width: 32px; }


  .modal-scroll-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 20px;
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
    color: #cbd5e1;
  }

  .field-block input {
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 10px 14px;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
    transition: 0.15s;
  }

  .field-block input:focus {
    border-color: var(--accent-primary);
  }

  .field-hint {
    font-size: 12px;
    color: var(--text-muted);
  }

  .perms-header {
    font-size: 12px;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.5px;
  }

  .perms-list {
    display: flex;
    flex-direction: column;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    overflow: hidden;
  }

  .perm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 14px;
    cursor: pointer;
    transition: background 0.12s;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .perm-row:last-child {
    border-bottom: none;
  }

  .perm-row:hover {
    background: var(--bg-surface);
  }

  .perm-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .perm-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .perm-desc {
    font-size: 12px;
    color: var(--text-muted);
  }

  .toggle-switch {
    width: 38px;
    height: 22px;
    border-radius: 11px;
    background: var(--bg-surface-2);
    position: relative;
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .toggle-switch.active {
    background: var(--accent-primary);
  }

  .toggle-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--bg-sheet);
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }

  .toggle-switch.active .toggle-thumb {
    transform: translateX(16px);
  }

  .error-banner {
    padding: 10px 14px;
    background: var(--danger-subtle);
    border: 1px solid var(--danger-subtle-strong);
    border-radius: 10px;
    color: var(--status-danger);
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

  .btn-danger-action {
    margin-right: auto;
    background: var(--danger-subtle);
    color: var(--status-danger);
    border: 1px solid var(--danger-subtle-strong);
  }

  .btn-danger-action:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.22);
  }
</style>
