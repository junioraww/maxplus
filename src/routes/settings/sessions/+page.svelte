<script>
  import { onMount } from "svelte";
  import { slide, fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import API from "$lib/stores/api";

  let sessions = [];
  let current = null;
  let loading = true;
  let expandedId = null;

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  onMount(async () => {
    sessions = [];
    try {
      const res = await $API.getSessions();
      sessions = res?.sessions || res || [];
      current = sessions.find((x) => x.current);
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  });

  const toggleSession = (id) => {
    expandedId = expandedId === id ? null : id;
  };

  async function handleTerminateAll() {
    const account = await getCurrentAccount();
    if (!account) throw new Error("Ошибка получения данных аккаунта");

    if (account.meta.added + 1000 * 60 * 60 * 24 > Date.now()) {
      alert("Должно пройти 24 часа со входа в аккаунт!");
      return;
    }

    try {
      await $API.closeAllSessions();
      const res = await $API.getSessions();
      sessions = res?.sessions || res || [];
    } catch (e) {
      console.error(e);
      alert("Ошибка при завершении сессий.");
    }
  }

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

<SettingsPageWrapper title="Активные сессии" {from} {onClose}>
  <span class="count" slot="header-extra">{sessions.length}</span>

  <div class="sessions-container">
    {#if loading}
      <div class="status-msg">Загрузка данных...</div>
    {:else if sessions.length === 0}
      <div class="status-msg">Список сессий пуст</div>
    {:else}
      {#each sessions as session, i (session.time + i)}
        <div
          animate:flip={{ duration: 300 }}
          in:fly={{ x: 20, duration: 400, opacity: 0 }}
          class="session-card"
          class:expanded={expandedId === session.time}
          on:click={() => toggleSession(session.time)}
        >
          <div class="session-header">
            <div class="main-info">
              <span class="client-name">{session.client || "Unknown Client"}</span>
              <span class="location-brief">
                {session.location
                  ? session.location.split(",").slice(0, 2).join(",")
                  : "Unknown Location"}
              </span>
            </div>
            <div class="time-badge">
              {formatDate(session.time).split(" ")[0]}
            </div>
          </div>

          {#if expandedId === session.time}
            <div class="session-details" transition:slide={{ duration: 200 }}>
              <div class="detail-row">
                <span class="label">Информация:</span>
                <span class="val">{session.info}</span>
              </div>
              <div class="detail-row">
                <span class="label">Локация и IP:</span>
                <span class="val">{session.location}</span>
              </div>
              <div class="detail-row">
                <span class="label">Дата входа:</span>
                <span class="val">{formatDate(session.time)}</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <svelte:fragment slot="footer">
    {#if sessions.length > 1}
      <div class="actions-panel">
        <button class="terminate-btn" on:click|stopPropagation={handleTerminateAll}>
          Завершить все другие сессии
        </button>
      </div>
    {/if}
  </svelte:fragment>
</SettingsPageWrapper>

<style>
  .count {
    font-size: 0.75rem;
    background: #2c2c35;
    padding: 3px 9px;
    border-radius: 999px;
    color: #bbb;
    font-weight: 600;
  }

  .sessions-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
  }

  .session-card {
    background: #24252a;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
    transition: border-color 0.2s;
    flex-shrink: 0;
  }

  .session-card.expanded {
    border-color: #3390ec;
  }

  .session-header {
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .main-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .client-name {
    font-weight: 600;
    color: #fff;
    font-size: 0.95rem;
  }

  .location-brief {
    font-size: 0.8rem;
    color: #888;
  }

  .time-badge {
    font-size: 0.75rem;
    color: #666;
  }

  .session-details {
    padding: 0 16px 14px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #1e1e24;
    border-bottom-left-radius: 14px;
    border-bottom-right-radius: 14px;
  }

  .detail-row {
    display: flex;
    flex-direction: column;
    padding-top: 8px;
  }

  .label {
    font-size: 0.7rem;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .val {
    font-size: 0.85rem;
    color: #bbb;
    line-height: 1.3;
    word-break: break-all;
  }

  .status-msg {
    text-align: center;
    margin-top: 40px;
    color: #666;
  }

  .actions-panel {
    padding: 14px 16px;
    background: #212126;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .terminate-btn {
    width: 100%;
    height: 44px;
    background: rgba(239, 68, 68, 0.15);
    color: #ff595a;
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-radius: 12px;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.92rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.12s, opacity 0.15s, background 0.15s;
  }

  .terminate-btn:hover {
    background: rgba(239, 68, 68, 0.25);
  }

  .terminate-btn:active {
    transform: scale(0.98);
  }

  .sessions-container::-webkit-scrollbar {
    width: 4px;
  }

  .sessions-container::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 10px;
  }
</style>
