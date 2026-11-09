<script>
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsDropout from "$components/settings/SettingsDropout.svelte";
  import { getCurrentAccount, getDatabaseFilesCount } from "$lib/stores/accounts";
  import { checkHardwareBiometry, formatBiometryName } from "$lib/services/hardwareSecurity";
  import { openLockScreen } from "$lib/stores/lockScreen";
  import {
    autoLockTimer,
    setAutoLockTimer,
    loadAccountAutoLockTimer,
    AUTO_LOCK_OPTIONS,
  } from "$lib/stores/autoLock";

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let account = null;
  let encryption = undefined;
  let fileCount = null;
  let biometryStatus = { available: false, biometryType: 0 };
  let loading = true;

  onMount(async () => {
    await loadData();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", loadData);
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", loadData);
    }
  });

  async function loadData() {
    try {
      const [acc, biometry] = await Promise.all([
        getCurrentAccount(),
        checkHardwareBiometry(),
      ]);
      account = acc;
      if (acc) {
        encryption = acc.encryption;
        await loadAccountAutoLockTimer(acc);
        fileCount = await getDatabaseFilesCount(acc.id).catch(() => null);
      }
      biometryStatus = biometry;
    } finally {
      loading = false;
    }
  }

  async function handleAutoLockChange(seconds) {
    if (!account) return;
    await setAutoLockTimer(seconds, account.id);
  }

  async function lockNow() {
    openLockScreen({ mode: "decrypt" });
  }
</script>

<SettingsPageWrapper title="Шифрование данных" {from} {onClose}>
  <div class="container">
    {#if loading || encryption === undefined}
      <div class="status-msg">Загрузка данных...</div>
    {:else if encryption === null}
      <div class="card">
        <div class="status-badge warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>Статус: неактивно</span>
        </div>

        <p class="description">
          Шифрует все данные на устройстве и защищает их в случае утери или взлома устройства.
        </p>

        {#if fileCount !== null}
          <div class="info-row">
            <span>Файлы базы данных</span>
            <strong>{fileCount}</strong>
          </div>
        {/if}

        {#if biometryStatus.available}
          <button class="primary-btn" on:click={() => goto("/auth/lock?mode=create&type=hardware")}>
            Аппаратный ключ ({formatBiometryName(biometryStatus.biometryType)})
          </button>
          <button class="secondary-btn" on:click={() => goto("/auth/lock?mode=create&type=pin")}>
            Графический ключ
          </button>
        {:else}
          <div class="info-note">
            Аппаратная биометрия недоступна на этом устройстве. Вы можете использовать графический ключ.
          </div>
          <button class="primary-btn" on:click={() => goto("/auth/lock?mode=create&type=pin")}>
            Установить графический ключ
          </button>
        {/if}
      </div>
    {:else}
      <div class="card">
        <div class="status-badge success">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>Статус: активно</span>
        </div>

        <div class="info-row">
          <span>Тип защиты</span>
          <strong>
            {encryption.type === "hardware-1" ? "Аппаратный ключ (Биометрия)" : "Графический ключ"}
          </strong>
        </div>

        {#if fileCount !== null}
          <div class="info-row">
            <span>Файлы базы данных</span>
            <strong>{fileCount}</strong>
          </div>
        {/if}

        <div class="section-divider"></div>

        <SettingsDropout
          label="Автоблокировка"
          description="Блокировать аккаунт при неактивности или скрытии окна"
          options={AUTO_LOCK_OPTIONS}
          value={$autoLockTimer}
          on:change={(e) => handleAutoLockChange(e.detail)}
        />

        <div class="section-divider"></div>

        <button class="action-btn" on:click={lockNow}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
          <span>Заблокировать сейчас</span>
        </button>

        <button class="danger-btn" on:click={() => goto("/auth/lock?mode=disable")}>
          Отключить шифрование
        </button>
      </div>
    {/if}
  </div>
</SettingsPageWrapper>

<style>
  .container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px 16px;
    box-sizing: border-box;
    width: 100%;
    min-height: 100%;
  }

  .card {
    width: 100%;
    max-width: 400px;
    background: #24252a;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.88rem;
    font-weight: 600;
    width: fit-content;
  }

  .status-badge.success {
    background: rgba(104, 211, 145, 0.15);
    color: #68d391;
    border: 1px solid rgba(104, 211, 145, 0.25);
  }

  .status-badge.warning {
    background: rgba(246, 196, 83, 0.15);
    color: #f6c453;
    border: 1px solid rgba(246, 196, 83, 0.25);
  }

  .description {
    margin: 0;
    color: #9ca3af;
    line-height: 1.5;
    font-size: 0.92rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #1b1c21;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 14px 16px;
  }

  .info-row span {
    color: #888;
    font-size: 0.9rem;
  }

  .info-row strong {
    color: white;
    font-size: 0.95rem;
  }

  .section-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 2px 0;
  }

  .info-note {
    font-size: 0.85rem;
    color: #9ca3af;
    background: #1b1c21;
    border-radius: 10px;
    padding: 10px 12px;
    line-height: 1.4;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    cursor: pointer;
    font-weight: 600;
    width: 100%;
    height: 44px;
    border-radius: 12px;
    font-size: 0.95rem;
    transition: transform 0.12s, opacity 0.15s, background 0.15s;
  }

  button:active {
    transform: scale(0.98);
  }

  .primary-btn {
    background: #3390ec;
    color: white;
  }

  .primary-btn:hover {
    background: #2b7ecf;
  }

  .secondary-btn {
    background: rgba(255, 255, 255, 0.08);
    color: white;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .secondary-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .action-btn {
    background: rgba(51, 144, 236, 0.12);
    color: #3390ec;
    border: 1px solid rgba(51, 144, 236, 0.25);
  }

  .action-btn:hover {
    background: rgba(51, 144, 236, 0.2);
  }

  .danger-btn {
    background: rgba(239, 68, 68, 0.12);
    color: #ff595a;
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  .danger-btn:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  .status-msg {
    color: #888;
    font-size: 0.95rem;
  }

  @media (max-width: 400px) {
    .container {
      padding: 0;
      align-items: center;
    }

    .card {
      max-width: 100%;
      border-radius: 0;
      border-left: none;
      border-right: none;
      padding: 20px 16px;
    }
  }
</style>
