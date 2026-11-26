<script>
  import { onMount, onDestroy } from "svelte";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { openDigitalIdApp, openSferumApp, lastClosedMiniApp } from "$lib/stores/webapp";
  import { fetchDigitalIdProfile, deleteDigitalIdProfile, DOCUMENT_TITLES, resetDigitalIdAuth } from "$lib/services/digitalId";
  import Avatar from "$components/main/Avatar.svelte";
  import { showConfirm } from "$lib/stores/session";

  let loading = false;
  let initialLoading = true;
  let error = null;
  let isLinked = false;
  let digitalProfile = null;
  let documents = [];
  let cards = [];
  let toastMessage = "";
  let toastTimer = null;
  let unsubscribeClosed = null;

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage = msg;
    toastTimer = setTimeout(() => {
      toastMessage = "";
    }, 2500);
  }

  function getDigitalIdBotId() {
    try {
      const stored = localStorage.getItem("max_app_digital_id");
      return stored ? Number(stored) : 8250447;
    } catch {
      return 8250447;
    }
  }

  async function loadData(showSpinner = false) {
    if (showSpinner) {
      loading = true;
      resetDigitalIdAuth();
    }
    error = null;
    const botId = getDigitalIdBotId();
    try {
      const result = await fetchDigitalIdProfile($API, $currentUser, botId);
      isLinked = !!result.isLinked;
      digitalProfile = result.profile;
      documents = result.documents || [];
      cards = result.cards || [];
      if (result.error && !isLinked) {
        error = result.error;
      }
    } catch (e) {
      if (!isLinked) {
        error = e?.message || "Ошибка загрузки Цифрового ID";
      }
    } finally {
      loading = false;
      initialLoading = false;
    }
  }

  onMount(() => {
    loadData(true);
    unsubscribeClosed = lastClosedMiniApp.subscribe((closed) => {
      if (!closed) return;
      const botId = getDigitalIdBotId();
      if (
        closed.botId === botId ||
        closed.title === "Цифровой ID" ||
        (typeof closed.url === "string" && closed.url.includes("digital-id"))
      ) {
        resetDigitalIdAuth();
        loadData(false);
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeClosed) unsubscribeClosed();
    if (toastTimer) clearTimeout(toastTimer);
  });

  async function handleOpenDigitalId() {
    loading = true;
    error = null;
    try {
      await openDigitalIdApp();
    } catch (e) {
      error = e?.message || "Не удалось открыть Цифровой ID";
    } finally {
      loading = false;
    }
  }

  async function handleOpenSferum() {
    loading = true;
    error = null;
    try {
      await openSferumApp();
    } catch (e) {
      error = e?.message || "Не удалось открыть Сферум";
    } finally {
      loading = false;
    }
  }

  async function handleUnbindDigitalId() {
    const ok = await showConfirm({
      title: "Отвязать Цифровой ID?",
      message: "Данные авторизации ЕСИА будут удалены с этого устройства.",
      confirmText: "Отвязать",
      cancelText: "Отмена",
      isDangerous: true,
    });
    if (ok) {
      await confirmUnbind();
    }
  }

  async function confirmUnbind() {
    loading = true;
    const botId = getDigitalIdBotId();
    try {
      await deleteDigitalIdProfile($API, $currentUser, botId);
      isLinked = false;
      digitalProfile = null;
      documents = [];
      cards = [];
      showToast("Цифровой ID отвязан");
    } catch {
      showToast("Ошибка при отвязке");
    } finally {
      loading = false;
    }
  }

  $: verifiedName = digitalProfile
    ? `${digitalProfile.lastName || ""} ${digitalProfile.firstName || ""} ${digitalProfile.middleName || ""}`.trim()
    : "";

  $: userName = verifiedName || (
    $currentUserDetails?.names?.[0]
      ? `${$currentUserDetails.names[0].firstName || ""} ${$currentUserDetails.names[0].lastName || ""}`.trim()
      : "Пользователь"
  );

  $: userPhone = $currentUserDetails?.phone
    ? `+${$currentUserDetails.phone}`
    : "";

  function getDocDescription(doc) {
    if (!doc || !doc.fields) return isLinked ? "Подтвержден" : "Требуется привязка ЕСИА";
    const parts = [];
    if (doc.fields.series) parts.push(`Серия ${doc.fields.series}`);
    if (doc.fields.number) parts.push(`№ ${doc.fields.number}`);
    return parts.length ? parts.join(" ") : "Подтвержден";
  }
</script>

<div class="digital-id-page">
  <header class="header">
    <div class="header-placeholder"></div>
    <h3>Цифровой ID</h3>
    <button
      class="icon-btn refresh-btn"
      on:click={() => loadData(true)}
      disabled={loading}
      title="Обновить"
    >
      <svg
        class:spin={loading}
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
    </button>
  </header>

  <div class="content-scroll">
    <div class="card id-card">
      <div class="id-card-top">
        <div class="id-avatar">
          <Avatar contactId={$currentUser} size={56} />
        </div>
        <div class="id-info">
          <div class="id-name">{userName}</div>
          {#if userPhone}
            <div class="id-phone">{userPhone}</div>
          {/if}
          {#if isLinked}
            <div class="id-badge linked">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
              <span>Госуслуги привязаны</span>
            </div>
          {:else}
            <div class="id-badge unlinked">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>Госуслуги не привязаны</span>
            </div>
          {/if}
        </div>
      </div>

      {#if error}
        <div class="error-banner">{error}</div>
      {/if}

      <div class="id-actions">
        <button
          class="primary-btn"
          on:click={handleOpenDigitalId}
          disabled={loading}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          <span>{loading ? "Загрузка..." : isLinked ? "Открыть Цифровой ID" : "Привязать Госуслуги"}</span>
        </button>

        {#if isLinked}
          <button class="secondary-btn danger-btn" on:click={handleUnbindDigitalId} disabled={loading}>
            Отвязать Цифровой ID
          </button>
        {/if}
      </div>
    </div>

    {#if isLinked && digitalProfile && (digitalProfile.snils || digitalProfile.inn || digitalProfile.birthDate || digitalProfile.address)}
      <div class="section-title">Личные данные</div>
      <div class="card profile-info-card">
        {#if digitalProfile.snils}
          <div class="info-row">
            <span class="info-label">СНИЛС</span>
            <span class="info-value">{digitalProfile.snils}</span>
          </div>
        {/if}
        {#if digitalProfile.inn}
          <div class="info-row">
            <span class="info-label">ИНН</span>
            <span class="info-value">{digitalProfile.inn}</span>
          </div>
        {/if}
        {#if digitalProfile.birthDate}
          <div class="info-row">
            <span class="info-label">Дата рождения</span>
            <span class="info-value">{digitalProfile.birthDate}</span>
          </div>
        {/if}
        {#if digitalProfile.birthPlace}
          <div class="info-row">
            <span class="info-label">Место рождения</span>
            <span class="info-value">{digitalProfile.birthPlace}</span>
          </div>
        {/if}
        {#if digitalProfile.address}
          <div class="info-row">
            <span class="info-label">Регистрация</span>
            <span class="info-value">{digitalProfile.address}</span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="section-title">Сервисы</div>
    <div class="card service-card" on:click={handleOpenSferum}>
      <div class="service-icon sferum-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>
      </div>
      <div class="service-content">
        <div class="service-title">Сферум</div>
        <div class="service-subtitle">Учебный профиль и сервисы образования</div>
      </div>
      <div class="service-arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    </div>

    <div class="section-title">Электронные документы</div>
    <div class="card docs-list">
      {#if isLinked && documents.length > 0}
        {#each documents as doc, idx}
          {#if idx > 0}
            <div class="doc-divider"></div>
          {/if}
          <div class="doc-item">
            <div class="doc-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                <line x1="7" y1="8" x2="17" y2="8"></line>
                <line x1="7" y1="12" x2="17" y2="12"></line>
                <line x1="7" y1="16" x2="13" y2="16"></line>
              </svg>
            </div>
            <div class="doc-details">
              <div class="doc-name">{DOCUMENT_TITLES[doc.type] || doc.type}</div>
              <div class="doc-status">{getDocDescription(doc)}</div>
            </div>
          </div>
        {/each}
      {:else}
        <div class="doc-item">
          <div class="doc-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"></rect>
              <line x1="7" y1="8" x2="17" y2="8"></line>
              <line x1="7" y1="12" x2="17" y2="12"></line>
              <line x1="7" y1="16" x2="13" y2="16"></line>
            </svg>
          </div>
          <div class="doc-details">
            <div class="doc-name">Паспорт гражданина РФ</div>
            <div class="doc-status">{isLinked ? "Подтвержден" : "Требуется привязка ЕСИА"}</div>
          </div>
        </div>

        <div class="doc-divider"></div>

        <div class="doc-item">
          <div class="doc-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
          </div>
          <div class="doc-details">
            <div class="doc-name">СНИЛС и ИНН</div>
            <div class="doc-status">{isLinked ? "Синхронизировано" : "Требуется привязка ЕСИА"}</div>
          </div>
        </div>

        <div class="doc-divider"></div>

        <div class="doc-item">
          <div class="doc-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </div>
          <div class="doc-details">
            <div class="doc-name">Водительское удостоверение</div>
            <div class="doc-status">{isLinked ? "Электронный документ" : "Требуется привязка ЕСИА"}</div>
          </div>
        </div>
      {/if}
    </div>

    {#if isLinked && cards.length > 0}
      <div class="section-title">Пропуска</div>
      <div class="card passes-card">
        {#each cards as card, idx}
          {#if idx > 0}
            <div class="doc-divider"></div>
          {/if}
          <div class="pass-item">
            <div class="pass-info">
              <div class="pass-title">{card.company_name || card.companyName || "Пропуск"}</div>
              {#if card.inn}
                <div class="pass-subtitle">ИНН {card.inn}</div>
              {/if}
            </div>
            <span class="pass-status-pill">Активен</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if toastMessage}
  <div class="toast-popup">
    {toastMessage}
  </div>
{/if}

<style>
  .digital-id-page {
    width: 100%;
    height: 100%;
    background: var(--bg-app);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    height: calc(52px + var(--safe-top, 0px));
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--safe-top, 0px) 16px 0;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .header-placeholder {
    width: 32px;
  }

  .header h3 {
    margin: 0;
    font-size: var(--font-size-toolbar, 17px);
    font-weight: var(--font-weight-title, 600);
    font-family: var(--font-family-title);
    color: var(--text-primary);
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--icon-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--icon-primary);
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spin {
    animation: rotate 1s linear infinite;
  }

  @keyframes rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    padding-bottom: calc(90px + var(--safe-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: 14px;
    padding: 16px;
  }

  .id-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: linear-gradient(135deg, var(--bg-surface) 0%, var(--bg-surface-secondary) 100%);
    border: 1px solid var(--accent-subtle-hover);
    box-shadow: var(--shadow-card);
  }

  .id-card-top {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .id-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .id-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .id-phone {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .id-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    margin-top: 4px;
    width: fit-content;
  }

  .id-badge.linked {
    background: var(--status-success-subtle);
    color: var(--status-success);
  }

  .id-badge.unlinked {
    background: var(--status-warning-subtle);
    color: var(--status-warning);
  }

  .error-banner {
    padding: 10px;
    background: var(--status-danger-subtle);
    border: 1px solid var(--status-danger);
    border-radius: 8px;
    color: var(--status-danger);
    font-size: 12px;
  }

  .id-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .primary-btn {
    width: 100%;
    padding: 12px;
    background: var(--accent-primary);
    color: var(--accent-contrast, #ffffff);
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .primary-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover);
  }

  .primary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .secondary-btn {
    width: 100%;
    padding: 9px;
    background: transparent;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .secondary-btn.danger-btn {
    border-color: var(--status-danger-subtle);
    color: var(--status-danger);
  }

  .secondary-btn.danger-btn:hover:not(:disabled) {
    background: var(--status-danger-subtle);
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-top: 6px;
    margin-left: 4px;
  }

  .profile-info-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    font-size: 13px;
  }

  .info-label {
    color: var(--text-muted);
    min-width: 110px;
  }

  .info-value {
    color: var(--text-primary);
    text-align: right;
    word-break: break-word;
  }

  .service-card {
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .service-card:hover {
    background: var(--bg-surface-elevated);
  }

  .service-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .sferum-icon {
    background: var(--accent-subtle);
    color: var(--accent-primary);
  }

  .service-content {
    flex: 1;
  }

  .service-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .service-subtitle {
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .service-arrow {
    color: var(--icon-muted);
  }

  .docs-list {
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
  }

  .doc-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
  }

  .doc-icon {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    background: var(--accent-subtle);
    color: var(--accent-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .doc-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .doc-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .doc-status {
    font-size: 11px;
    color: var(--text-muted);
  }

  .doc-divider {
    height: 1px;
    background: var(--border-subtle);
  }

  .passes-card {
    padding: 8px 16px;
    display: flex;
    flex-direction: column;
  }

  .pass-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
  }

  .pass-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pass-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .pass-subtitle {
    font-size: 11px;
    color: var(--text-muted);
  }

  .pass-status-pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--status-success-subtle);
    color: var(--status-success);
  }

  .toast-popup {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    box-shadow: var(--shadow-elevated);
    z-index: var(--z-toast, 10);
    pointer-events: none;
  }
</style>
