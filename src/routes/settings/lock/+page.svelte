<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { slide, fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { page } from "$app/stores";

  import { getCurrentAccount, getDatabaseFilesCount } from "$lib/stores/accounts";
  import API, { currentUser } from "$lib/stores/api";

  $: from = $page.url.searchParams.get("from") || "/auth/login";

  let encryption;
  let fileCount = null;

  onMount(async () => {
    const account = await getCurrentAccount();
    encryption = account.encryption;
    fileCount = await getDatabaseFilesCount(account.id).catch(() => null);
  });

  function formatDate(ms) {
    if (!ms) return "";
    const date = new Date(ms);
    return (
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }
</script>

<div class="page">
  <header>
    <h1>Защитный пин-код</h1>
  </header>

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

        <button class="secondary-btn" on:click={() => goto("/auth/lock?mode=disable")}>
          Отключить
        </button>
      </div>
    {/if}
  </div>

  <div class="actions-panel">
    <button class="back-btn" on:click={() => history.back()}>
      Назад
    </button>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background-color: #1a1a1f;
    color: #ddd;
    box-sizing: border-box;
    overflow: hidden;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    flex-shrink: 0;
  }

  h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
  }

  .container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .card {
    width: 100%;
    max-width: 360px;
    background: #24242d;
    border-radius: 18px;
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  @media(max-width: 400px) {
    .card {
      border-radius: 0;
    }
  }

  .status {
    margin: 0;
    font-size: 1.1rem;
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
    font-size: .92rem;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #1d1d25;
    border: 1px solid #31313b;
    border-radius: 12px;
    padding: 14px 16px;
  }

  .info-row span {
    color: #888;
    font-size: .9rem;
  }

  .info-row strong {
    color: white;
    font-size: .95rem;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: .2s;
    font-weight: 600;
  }

  .primary-btn,
  .secondary-btn {
    width: 100%;
    padding: 13px 18px;
    border-radius: 12px;
    font-size: .95rem;
  }

  .primary-btn {
    background: #6366f1;
    color: white;
  }

  .secondary-btn {
    background: #313244;
    color: #ddd;
  }

  .primary-btn:hover,
  .secondary-btn:hover {
    background: #4f46e5;
  }

  .status-msg {
    color: #888;
    font-size: .95rem;
  }

  .actions-panel {
    padding: 20px;
    flex-shrink: 0;
    display: flex;
    gap: 20px;
    padding: 16px;
    border-top: 1px solid #2c2c35;
  }

  .back-btn {
    gap: 8px;
    background: #6366f1;
    color: white;
    border: none;
    padding: 10px 40px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    transition: background 0.2s;
    margin-left: auto;
  }

  .back-btn:hover {
    background: #4f46e5;
  }
</style>
