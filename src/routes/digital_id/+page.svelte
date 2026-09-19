<script>
  import { currentUser, currentUserDetails } from "$lib/stores/api.js";
  import { openDigitalIdApp, openSferumApp } from "$lib/stores/webapp.js";
  import Avatar from "$components/main/Avatar.svelte";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";

  let loading = false;
  let error = null;
  let showUnbindConfirm = false;
  let isLinked = false;

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

  function handleUnbindDigitalId() {
    showUnbindConfirm = true;
  }

  function confirmUnbind() {
    showUnbindConfirm = false;
    try {
      localStorage.removeItem("max_app_digital_id");
      localStorage.removeItem("digital_id_biometry_token");
      isLinked = false;
      alert("Цифровой ID отвязан");
    } catch {
      alert("Ошибка при отвязке");
    }
  }

  $: userName =
    $currentUserDetails?.names?.[0]
      ? `${$currentUserDetails.names[0].firstName || ""} ${$currentUserDetails.names[0].lastName || ""}`.trim()
      : "Пользователь";

  $: userPhone = $currentUserDetails?.phone
    ? `+${$currentUserDetails.phone}`
    : "";
</script>

<div class="digital-id-page">
  <header class="header">
    <h3>Цифровой ID</h3>
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
          <button class="secondary-btn danger-btn" on:click={handleUnbindDigitalId}>
            Отвязать Цифровой ID
          </button>
        {/if}
      </div>
    </div>

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
    </div>
  </div>
</div>

{#if showUnbindConfirm}
  <ConfirmModal
    title="Отвязать Цифровой ID?"
    message="Данные авторизации ЕСИА будут удалены с этого устройства."
    confirmText="Отвязать"
    cancelText="Отмена"
    isDangerous={true}
    on:confirm={confirmUnbind}
    on:cancel={() => (showUnbindConfirm = false)}
  />
{/if}

<style>
  .digital-id-page {
    width: 100%;
    height: 100%;
    background: #111214;
    color: #e5e7eb;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    flex-shrink: 0;
  }

  .header h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: #f3f4f6;
  }

  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    padding-bottom: 90px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card {
    background: #1c1d21;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px;
  }

  .id-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: linear-gradient(135deg, #1f2229 0%, #16181c 100%);
    border: 1px solid rgba(59, 130, 246, 0.25);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
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
    color: #fff;
  }

  .id-phone {
    font-size: 13px;
    color: #9ca3af;
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
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  .id-badge.unlinked {
    background: rgba(234, 179, 8, 0.15);
    color: #facc15;
  }

  .error-banner {
    padding: 10px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #f87171;
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
    background: #2563eb;
    color: #fff;
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
    background: #1d4ed8;
  }

  .primary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .secondary-btn {
    width: 100%;
    padding: 9px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    font-size: 13px;
    color: #9ca3af;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .secondary-btn.danger-btn {
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .secondary-btn.danger-btn:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #6b7280;
    margin-top: 6px;
    margin-left: 4px;
  }

  .service-card {
    display: flex;
    align-items: center;
    gap: 14px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .service-card:hover {
    background: #23252a;
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
    background: rgba(59, 130, 246, 0.18);
    color: #60a5fa;
  }

  .service-content {
    flex: 1;
  }

  .service-title {
    font-size: 14px;
    font-weight: 600;
    color: #f3f4f6;
  }

  .service-subtitle {
    font-size: 12px;
    color: #9ca3af;
    margin-top: 2px;
  }

  .service-arrow {
    color: #6b7280;
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
    background: rgba(255, 255, 255, 0.06);
    color: #93c5fd;
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
    color: #e5e7eb;
  }

  .doc-status {
    font-size: 11px;
    color: #9ca3af;
  }

  .doc-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
  }
</style>
