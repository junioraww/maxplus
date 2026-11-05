<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import { getCurrentAccount, getDatabaseFilesCount } from "$lib/stores/accounts";
  import { checkHardwareBiometry, formatBiometryName } from "$lib/services/hardwareSecurity";

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let encryption;
  let fileCount = null;
  let biometryStatus = { available: false, biometryType: 0 };
  let loading = true;

  onMount(async () => {
    try {
      const [account, biometry] = await Promise.all([
        getCurrentAccount(),
        checkHardwareBiometry(),
      ]);
      if (account) {
        encryption = account.encryption;
        fileCount = await getDatabaseFilesCount(account.id).catch(() => null);
      }
      biometryStatus = biometry;
    } finally {
      loading = false;
    }
  });
</script>

<SettingsPageWrapper title="Шифрование данных" {from} {onClose}>
  <div class="container">
    {#if loading || encryption === undefined}
      <div class="status-msg">Загрузка данных...</div>
    {:else if encryption === null}
      <div class="card">
        <p class="status warning">Статус: <b>неактивно</b></p>
        <p class="description">
          Шифрует все данные на устройстве и защищает их в случае взлома или утери телефона/компьютера.
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
        <p class="status success">Статус: <b>активно</b></p>

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

        <button class="danger-btn" on:click={() => goto("/auth/lock?mode=disable")}>
          Отключить
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
    max-width: 380px;
    background: #24252a;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .status {
    margin: 0;
    font-size: 1.05rem;
  }

  .status.success {
    color: #68d391;
  }

  .status.warning {
    color: #f6c453;
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

  .danger-btn {
    background: rgba(239, 68, 68, 0.15);
    color: #ff595a;
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  .danger-btn:hover {
    background: rgba(239, 68, 68, 0.25);
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
