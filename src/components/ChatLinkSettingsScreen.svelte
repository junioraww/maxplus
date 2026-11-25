<script>
  import { fade } from "svelte/transition";
  import Switch from "$components/common/Switch.svelte";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";

  export let chat = null;
  export let close = () => {};
  export let onUpdated = null;

  let toastMessage = "";
  let toastTimer = null;
  function showToast(msg) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage = ""), 2200);
  }

  $: chatId = chat?.id;
  $: isChannel = chat?.type === "CHANNEL";
  $: isGroupChat = chat?.type === "CHAT" || chat?.type === "GROUP";
  $: isOwner = Boolean(chat && $currentUser != null && Number(chat.owner) === Number($currentUser));
  $: isAdmin = Boolean(chat && $currentUser != null && (isOwner || chat.admins?.includes(Number($currentUser)) || chat.admins?.includes($currentUser)));
  $: canEdit = isAdmin;

  $: chatAccessType = (chat?.access === "PUBLIC" || (chat?.link && !chat.link.includes("join/"))) ? "PUBLIC" : "PRIVATE";
  $: joinRequestEnabled = Boolean(chat?.options?.JOIN_REQUEST ?? chat?.options?.joinRequest);

  let linkInput = "";
  let showRefreshConfirm = false;

  function normalizeLinkSlug(value) {
    return String(value || "")
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?max\.ru\//i, "")
      .replace(/^@/, "")
      .trim();
  }

  function extractErrorMessage(err, fallback) {
    const raw = typeof err === "string" ? err : (err?.localizedMessage || err?.message || "");
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.localizedMessage || parsed?.message || parsed?.title || fallback;
    } catch {
      return raw;
    }
  }

  function initLinkInput() {
    linkInput = (chat?.link && !chat.link.includes("join/"))
      ? normalizeLinkSlug(chat.link)
      : "";
  }
  $: if (chat) initLinkInput();

  function syncChat(patch) {
    if (!chat) return;
    chat = { ...chat, ...patch };
    if (chatId) {
      getChat(chatId).chatInfo.update((c) => ({ ...(c || {}), ...patch }));
    }
    if (onUpdated) onUpdated(chat);
  }

  async function setAccessType(type) {
    if (!chatId || !canEdit) return;
    try {
      const slug = normalizeLinkSlug(linkInput);
      const link = type === "PUBLIC" ? (slug || undefined) : undefined;
      const res = await $API.setChannelAccess(chatId, type, link);
      const patch = { access: type };
      const newL = res?.chat?.link || res?.link;
      if (newL) patch.link = newL;
      syncChat(patch);
      showToast(type === "PUBLIC" ? (isChannel ? "Канал стал публичным" : "Чат стал публичным") : (isChannel ? "Канал стал частным" : "Чат стал частным"));
    } catch (e) {
      showToast(extractErrorMessage(e, "Ошибка смены типа"));
    }
  }

  async function savePublicLink() {
    const raw = normalizeLinkSlug(linkInput);
    if (!raw || !chatId) return;
    const currentSlug = (chat?.link && !chat.link.includes("join/")) ? normalizeLinkSlug(chat.link) : "";
    if (raw === currentSlug && chatAccessType === "PUBLIC") {
      showToast("Ссылка сохранена");
      return;
    }
    try {
      const res = await $API.setChannelAccess(chatId, "PUBLIC", raw);
      const updatedLink = res?.chat?.link || res?.link || `https://max.ru/${raw}`;
      syncChat({ access: "PUBLIC", link: updatedLink });
      showToast("Ссылка сохранена");
    } catch (e) {
      showToast(extractErrorMessage(e, "Ошибка сохранения ссылки"));
    }
  }

  function copyLink() {
    if (!chat?.link) return;
    navigator.clipboard.writeText(chat.link);
    showToast("Ссылка скопирована");
  }

  async function revokeLink() {
    showRefreshConfirm = false;
    if (!chatId || !canEdit) return;
    try {
      const res = await $API.revokeChannelInviteLink(chatId);
      const updatedLink = res?.chat?.link || res?.link;
      if (updatedLink) syncChat({ link: updatedLink });
      showToast("Ссылка приглашения обновлена");
    } catch (e) {
      showToast("Ошибка при обновлении ссылки");
    }
  }

  async function toggleJoinRequest() {
    if (!chatId || !canEdit) return;
    const next = !joinRequestEnabled;
    try {
      await $API.setChannelOptions(chatId, { joinRequest: next });
      syncChat({
        options: {
          ...(chat?.options || {}),
          JOIN_REQUEST: next,
          joinRequest: next,
        },
      });
      showToast(next ? "Заявки на вступление включены" : "Заявки на вступление выключены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }
</script>

<div class="edit-screen-root">
  <header class="edit-toolbar">
    <button type="button" class="edit-icon-btn" on:click={() => close()} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <div class="edit-toolbar-title">{isChannel ? "Тип канала" : "Тип чата"}</div>
  </header>

  <div class="edit-scroll-body">
    <div class="edit-cards-list">
      <div class="edit-card-caption">{isChannel ? "Тип канала" : "Тип чата"}</div>
      <div class="edit-card">
        <div class="edit-segmented-row">
          <button
            type="button"
            class="edit-segmented-btn"
            class:active={chatAccessType === "PUBLIC"}
            on:click={() => setAccessType("PUBLIC")}
          >
            <span class="edit-seg-title">Публичный</span>
            <span class="edit-seg-sub">Доступен всем</span>
          </button>
          <button
            type="button"
            class="edit-segmented-btn"
            class:active={chatAccessType === "PRIVATE"}
            on:click={() => setAccessType("PRIVATE")}
          >
            <span class="edit-seg-title">Частный</span>
            <span class="edit-seg-sub">По ссылке</span>
          </button>
        </div>
      </div>

      {#if chatAccessType === "PUBLIC"}
        <div class="edit-card-caption">Публичная ссылка</div>
        <div class="edit-card">
          <div class="edit-input-item">
            <input
              type="text"
              bind:value={linkInput}
              placeholder="username"
              class="edit-input-field"
              on:keydown={(e) => e.key === "Enter" && savePublicLink()}
            />
            <button type="button" class="edit-pill-btn" on:click={savePublicLink}>
              Сохранить
            </button>
          </div>
          <div class="edit-item-hint">max.ru/{linkInput ? linkInput.trim() : "username"}</div>
        </div>
      {:else}
        <div class="edit-card-caption">Ссылка-приглашение</div>
        <div class="edit-card">
          <div class="edit-item-row" on:click={copyLink}>
            <div class="edit-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="edit-item-content">
              <div class="edit-item-title link">{chat?.link || "Создание ссылки..."}</div>
              <div class="edit-item-subtitle">Нажмите для копирования</div>
            </div>
            <button type="button" class="edit-action-icon-btn" title="Сбросить" on:click|stopPropagation={() => (showRefreshConfirm = true)}>
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/reload.svg'); mask-image: url('/icons/reload.svg'); width: 18px; height: 18px;"></span>
            </button>
          </div>
        </div>

        <div class="edit-card">
          <div class="edit-item-row" on:click={toggleJoinRequest}>
            <div class="edit-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/user-plus.svg'); mask-image: url('/icons/user-plus.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="edit-item-content">
              <div class="edit-item-title">Заявки на вступление</div>
              <div class="edit-item-subtitle">Требуется подтверждение админом</div>
            </div>
            <Switch checked={joinRequestEnabled} ariaLabel="Заявки на вступление" />
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

{#if showRefreshConfirm}
  <ConfirmModal
    title="Обновить ссылку?"
    message="Старая ссылка-приглашение перестанет работать."
    confirmText="Обновить"
    on:confirm={revokeLink}
    on:cancel={() => (showRefreshConfirm = false)}
    on:close={() => (showRefreshConfirm = false)}
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

  .edit-toolbar-title {
    font-size: 18px;
    font-weight: 600;
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

  .edit-card-caption {
    font-size: 13px;
    font-weight: 500;
    color: var(--profile-primary-blue, #007aff);
    padding: 4px 4px 0;
  }

  .edit-card {
    background: var(--profile-card-bg, #1c1d24);
    border-radius: 16px;
    overflow: hidden;
  }

  .edit-segmented-row {
    display: flex;
    gap: 6px;
    padding: 6px;
  }

  .edit-segmented-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 8px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .edit-segmented-btn.active {
    background: var(--profile-primary-blue, #007aff);
    color: #ffffff;
  }

  .edit-seg-title {
    font-size: 14px;
    font-weight: 600;
  }

  .edit-seg-sub {
    font-size: 11px;
    opacity: 0.8;
    margin-top: 2px;
  }

  .edit-input-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
  }

  .edit-input-field {
    flex: 1;
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 15px;
    outline: none;
    min-width: 0;
  }

  .edit-pill-btn {
    background: var(--profile-primary-blue, #007aff);
    color: #ffffff;
    border: none;
    border-radius: 10px;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .edit-item-hint {
    padding: 0 14px 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
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

  .edit-item-content {
    flex: 1;
    min-width: 0;
  }

  .edit-item-title {
    font-size: 15px;
    font-weight: 500;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .edit-item-title.link {
    color: var(--profile-primary-blue, #3898ff);
  }

  .edit-item-subtitle {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 2px;
  }

  .edit-action-icon-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.6);
    padding: 6px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .edit-action-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
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
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
</style>
