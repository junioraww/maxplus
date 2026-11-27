<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import CircleCheckbox from "$components/common/CircleCheckbox.svelte";
  import { currentUser } from "$lib/stores/api";
  import { registerBackHandler } from "$lib/utils/backButton";
  import {
    checkAddressBookPermission,
    requestAddressBookPermission,
    readDeviceContacts,
    importPhonebookContacts,
    markAddressBookPrompted,
  } from "$lib/services/addressBook";

  export let close = null;
  export let setBackHandler = null;
  export let skipRationale = false;

  const dispatch = createEventDispatcher();

  let stage = "loading";
  let contacts = [];
  let selectedPhones = new Set();
  let searchQuery = "";
  let isSubmitting = false;
  let errorText = "";
  let importedCount = 0;
  let closeTimer = null;
  let unregisterBack = null;

  const AVATAR_PALETTE = [
    "#3478f6",
    "#e67e22",
    "#27ae60",
    "#9b59b6",
    "#e84393",
    "#00a8ff",
  ];

  function getInitials(name) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function getAvatarColor(key) {
    let hash = 0;
    const str = String(key || "");
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
  }

  function finishClose(result = { imported: false }) {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    markAddressBookPrompted($currentUser).catch(() => {});
    if (typeof close === "function") {
      close(result);
    } else {
      dispatch("close", result);
    }
  }

  function handleBack() {
    if (isSubmitting) return false;
    finishClose({ imported: false, cancelled: true });
    return true;
  }

  $: if (setBackHandler) {
    setBackHandler(handleBack);
  }

  onMount(async () => {
    if (!setBackHandler) {
      unregisterBack = registerBackHandler(handleBack);
    }
    await initFlow();
  });

  onDestroy(() => {
    if (closeTimer) clearTimeout(closeTimer);
    if (unregisterBack) unregisterBack();
  });

  async function initFlow() {
    stage = "loading";
    errorText = "";
    try {
      const perm = await checkAddressBookPermission();
      if (perm?.state === "granted") {
        await loadDeviceContacts();
        return;
      }
      if (perm?.state === "unsupported") {
        finishClose({ imported: false, unsupported: true });
        return;
      }
      if (perm?.state === "denied" && perm?.canAskAgain === false) {
        stage = "denied";
        return;
      }
      if (skipRationale) {
        await requestAndLoad();
      } else {
        stage = "rationale";
      }
    } catch (e) {
      errorText = e?.message || "Не удалось проверить доступ к контактам";
      stage = "rationale";
    }
  }

  async function requestAndLoad() {
    stage = "loading";
    errorText = "";
    try {
      const perm = await requestAddressBookPermission();
      if (perm?.state === "granted") {
        await loadDeviceContacts();
      } else {
        stage = "denied";
      }
    } catch (e) {
      errorText = e?.message || "Не удалось запросить доступ к контактам";
      stage = "denied";
    }
  }

  async function loadDeviceContacts() {
    stage = "loading";
    try {
      const list = await readDeviceContacts();
      contacts = list;
      selectedPhones = new Set(list.map((c) => c.phone));
      stage = list.length > 0 ? "preview" : "empty";
    } catch (e) {
      errorText = e?.message || "Не удалось прочитать контакты";
      stage = "empty";
    }
  }

  function togglePhone(phone) {
    if (isSubmitting) return;
    const next = new Set(selectedPhones);
    if (next.has(phone)) {
      next.delete(phone);
    } else {
      next.add(phone);
    }
    selectedPhones = next;
  }

  function toggleSelectAll() {
    if (isSubmitting || contacts.length === 0) return;
    if (allSelected) {
      selectedPhones = new Set();
    } else {
      selectedPhones = new Set(contacts.map((c) => c.phone));
    }
  }

  async function handleConfirm() {
    if (isSubmitting || selectedPhones.size === 0) return;
    isSubmitting = true;
    errorText = "";
    try {
      const chosen = contacts.filter((c) => selectedPhones.has(c.phone));
      const res = await importPhonebookContacts(chosen);
      await markAddressBookPrompted($currentUser);
      importedCount = res.importedCount || 0;
      stage = "done";
      closeTimer = setTimeout(() => {
        finishClose({ imported: true, count: importedCount });
      }, 900);
    } catch (e) {
      errorText = e?.message || "Не удалось импортировать контакты";
    } finally {
      isSubmitting = false;
    }
  }

  $: allSelected = contacts.length > 0 && selectedPhones.size === contacts.length;
  $: selectedCount = selectedPhones.size;
  $: filteredContacts = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        (c.displayName || "").toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q)
    );
  })();
</script>

<div class="import-screen">
  <div class="toolbar">
    <button
      class="icon-btn"
      on:click={handleBack}
      disabled={isSubmitting}
      aria-label="Отмена"
    >
      <img src="/icons/arrow.svg" alt="" class="back-arrow" />
    </button>
    <div class="toolbar-title-box">
      <div class="toolbar-title">Импорт контактов</div>
      {#if stage === "preview"}
        <div class="toolbar-sub">Выбрано {selectedCount} из {contacts.length}</div>
      {/if}
    </div>
    {#if stage === "preview" && contacts.length > 0}
      <button
        class="bulk-toggle-btn"
        on:click={toggleSelectAll}
        disabled={isSubmitting}
      >
        {allSelected ? "Убрать все галочки" : "Добавить всех"}
      </button>
    {/if}
  </div>

  {#if stage === "loading"}
    <div class="state-center">
      <div class="spinner"></div>
      <div class="state-title">Загрузка контактов…</div>
      <div class="state-desc">Читаем номера из адресной книги устройства</div>
    </div>
  {:else if stage === "rationale"}
    <div class="state-center">
      <div class="hero-icon-wrap">
        <img src="/icons/user-plus.svg" alt="" class="hero-icon" />
      </div>
      <div class="state-title">Доступ к контактам</div>
      <div class="state-desc">
        Чтобы быстро находить знакомых в Max, разрешите чтение контактов. Перед отправкой вы сможете выбрать, какие номера импортировать.
      </div>
      {#if errorText}
        <div class="error-hint">{errorText}</div>
      {/if}
      <div class="state-actions">
        <button class="main-action-btn" on:click={requestAndLoad}>
          Разрешить доступ
        </button>
        <button class="secondary-action-btn" on:click={handleBack}>
          Не сейчас
        </button>
      </div>
    </div>
  {:else if stage === "denied"}
    <div class="state-center">
      <div class="hero-icon-wrap hero-icon-wrap--muted">
        <img src="/icons/contacts.svg" alt="" class="hero-icon" />
      </div>
      <div class="state-title">Нет доступа к контактам</div>
      <div class="state-desc">
        Доступ к телефонной книге запрещён. Вы можете включить его в настройках приложения или добавить контакты позже.
      </div>
      <div class="state-actions">
        <button class="main-action-btn" on:click={handleBack}>
          Понятно
        </button>
      </div>
    </div>
  {:else if stage === "empty"}
    <div class="state-center">
      <div class="hero-icon-wrap hero-icon-wrap--muted">
        <img src="/icons/contacts.svg" alt="" class="hero-icon" />
      </div>
      <div class="state-title">Контакты не найдены</div>
      <div class="state-desc">
        {errorText || "В телефонной книге не найдено контактов с номерами телефонов."}
      </div>
      <div class="state-actions">
        <button class="main-action-btn" on:click={handleBack}>
          Закрыть
        </button>
      </div>
    </div>
  {:else if stage === "done"}
    <div class="state-center">
      <div class="hero-icon-wrap hero-icon-wrap--success">
        <img src="/icons/check.svg" alt="" class="hero-icon" />
      </div>
      <div class="state-title">
        {importedCount > 0 ? `Добавлено контактов: ${importedCount}` : "Контакты синхронизированы"}
      </div>
      <div class="state-desc">
        {importedCount > 0
          ? "Новые собеседники уже доступны в списке контактов."
          : "Все доступные аккаунты Max из выбранных номеров уже синхронизированы."}
      </div>
      <div class="state-actions">
        <button
          class="main-action-btn"
          on:click={() => finishClose({ imported: true, count: importedCount })}
        >
          Готово
        </button>
      </div>
    </div>
  {:else if stage === "preview"}
    <div class="search-wrap">
      <div class="search-box">
        <img src="/icons/search.svg" alt="" width="16" height="16" class="search-icon" />
        <input
          type="text"
          placeholder="Поиск по имени или номеру..."
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button
            class="clear-btn"
            on:click={() => (searchQuery = "")}
            aria-label="Очистить"
          >
            <img src="/icons/close.svg" alt="" width="14" height="14" class="clear-icon" />
          </button>
        {/if}
      </div>
    </div>

    <div class="contacts-scroll">
      {#each filteredContacts as item (item.id)}
        {@const checked = selectedPhones.has(item.phone)}
        <div
          class="contact-row"
          on:click={() => togglePhone(item.phone)}
          on:keydown={(e) => (e.key === "Enter" || e.key === " ") && togglePhone(item.phone)}
          role="checkbox"
          aria-checked={checked}
          tabindex="0"
        >
          <CircleCheckbox {checked} size={24} disabled={isSubmitting} />
          {#if item.avatarDataUrl}
            <img
              src={item.avatarDataUrl}
              alt=""
              class="contact-avatar"
              loading="lazy"
            />
          {:else}
            <div
              class="contact-avatar contact-avatar--fallback"
              style="background: {getAvatarColor(item.phone)};"
            >
              {getInitials(item.displayName)}
            </div>
          {/if}
          <div class="contact-info">
            <div class="contact-name">{item.displayName}</div>
            <div class="contact-phone">{item.phone}</div>
          </div>
        </div>
      {/each}

      {#if filteredContacts.length === 0}
        <div class="empty-filter">Ничего не найдено</div>
      {/if}
    </div>

    <div class="bottom-action-bar">
      {#if errorText}
        <div class="inline-error">{errorText}</div>
      {/if}
      <button
        class="main-action-btn"
        disabled={selectedCount === 0 || isSubmitting}
        on:click={handleConfirm}
      >
        {#if isSubmitting}
          Импортируем…
        {:else if selectedCount > 0}
          Далее ({selectedCount})
        {:else}
          Далее
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .import-screen {
    width: 100%;
    height: 100%;
    max-height: 100dvh;
    background: var(--bg-app, #17181c);
    color: var(--text-primary, #ffffff);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
  }

  .toolbar {
    height: calc(56px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-surface, #1e2025);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    border: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--border-subtle, rgba(255, 255, 255, 0.08));
  }

  .back-arrow {
    width: 14px;
    height: 14px;
    transform: scaleX(-1);
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .toolbar-title-box {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .toolbar-title {
    font-size: 17px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toolbar-sub {
    font-size: 12px;
    color: var(--text-secondary, #8b929e);
  }

  .bulk-toggle-btn {
    border: none;
    background: var(--accent-subtle, rgba(36, 139, 254, 0.12));
    color: var(--accent-primary, #248bfe);
    font-size: 13px;
    font-weight: 600;
    padding: 7px 12px;
    border-radius: 10px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background-color 0.15s ease;
  }

  .bulk-toggle-btn:hover:not(:disabled) {
    background: var(--accent-subtle-hover, rgba(36, 139, 254, 0.2));
  }

  .bulk-toggle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .search-wrap {
    padding: 10px 16px;
    background: var(--bg-surface, #1e2025);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 12px;
    border-radius: 10px;
    background: var(--bg-input, #26262e);
  }

  .search-icon,
  .clear-icon {
    opacity: 0.65;
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .search-box input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    font-size: 14px;
  }

  .search-box input::placeholder {
    color: var(--text-muted, #697282);
  }

  .clear-btn {
    border: none;
    background: transparent;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .contacts-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding: 4px 0;
  }

  .contact-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }

  .contact-row:hover {
    background: var(--border-card, rgba(255, 255, 255, 0.05));
  }

  .contact-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .contact-avatar--fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-size: 15px;
    font-weight: 600;
  }

  .contact-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .contact-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact-phone {
    font-size: 13px;
    color: var(--text-secondary, #8b929e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-filter {
    padding: 32px 16px;
    text-align: center;
    font-size: 14px;
    color: var(--text-secondary, #8b929e);
  }

  .bottom-action-bar {
    padding: 12px 16px calc(12px + var(--safe-bottom, 0px));
    background: var(--bg-surface, #1e2025);
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .main-action-btn {
    width: 100%;
    height: 48px;
    border: none;
    border-radius: 14px;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, opacity 0.15s ease;
  }

  .main-action-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover, #1b74d9);
  }

  .main-action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .secondary-action-btn {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 14px;
    background: var(--bg-surface-secondary, #26262e);
    color: var(--text-primary, #ffffff);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
  }

  .state-center {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px 28px calc(24px + var(--safe-bottom, 0px));
    text-align: center;
    gap: 12px;
  }

  .hero-icon-wrap {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--accent-subtle, rgba(36, 139, 254, 0.12));
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
  }

  .hero-icon-wrap--muted {
    background: var(--bg-surface-secondary, #26262e);
  }

  .hero-icon-wrap--success {
    background: rgba(74, 222, 128, 0.16);
  }

  .inline-error {
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--status-danger, #ef4444);
    text-align: center;
  }

  .hero-icon {
    width: 34px;
    height: 34px;
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .state-title {
    font-size: 19px;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
  }

  .state-desc {
    font-size: 14px;
    line-height: 1.45;
    color: var(--text-secondary, #8b929e);
    max-width: 320px;
  }

  .error-hint {
    font-size: 13px;
    color: var(--status-danger, #ef4444);
    max-width: 320px;
  }

  .state-actions {
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    border-top-color: var(--accent-primary, #248bfe);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
