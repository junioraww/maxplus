<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import { getCurrentAccount, getDatabaseFilesCount } from "$lib/stores/accounts";

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let encryption;
  let fileCount = null;

  onMount(async () => {
    const account = await getCurrentAccount();
    if (account) {
      encryption = account.encryption;
      fileCount = await getDatabaseFilesCount(account.id).catch(() => null);
    }
  });
</script>

<SettingsPageWrapper title="Защита пин-кодом" {from} {onClose}>
  <div class="container">
    {#if encryption === undefined}
      <div class="status-msg">Загрузка данных...</div>
    {:else if encryption === null}
      <div class="card">
        <p class="status warning">🔓 Статус: <b>неактивно</b></p>
        <p class="description">
          Шифрует все данные на устройстве и поможет защитить их в случае взлома или кражи телефона.
        </p>

        {#if fileCount !== null}
          <div class="info-row">
            <span>Файлы базы данных</span>
            <strong>{fileCount}</strong>
          </div>
        {/if}

        <button class="primary-btn" on:click={() => goto("/auth/lock?mode=create")}>
          Установить PIN
        </button>
      </div>
    {:else}
      <div class="card">
        <p class="status success">🔒 Статус: <b>активно</b></p>

        <div class="info-row">
          <span>Версия</span>
          <strong>{encryption.type.toUpperCase()}</strong>
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
    gap: 18px;
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
</style>
