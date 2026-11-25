<script>
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { openQrScanner, closeQrScanner } from "$lib/stores/session";
  import API from "$lib/stores/api";
  import { showAlert } from "$lib/utils/alert";

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let sessions = [];
  let loading = true;
  let expandedId = null;
  let isHandlingQR = false;

  $: currentSession = sessions.find((x) => x.current) || null;
  $: otherSessions = sessions.filter((x) => !x.current);

  async function loadSessions() {
    loading = true;
    try {
      const res = await $API.getSessions();
      sessions = res?.sessions || res || [];
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadSessions();
  });

  function toggleSession(id) {
    expandedId = expandedId === id ? null : id;
  }

  async function handleTerminateAll() {
    const account = await getCurrentAccount();
    if (!account) {
      showAlert("Ошибка получения данных аккаунта");
      return;
    }

    if (account.meta.added + 1000 * 60 * 60 * 24 > Date.now()) {
      showAlert("Должно пройти 24 часа со входа в аккаунт!");
      return;
    }

    try {
      await $API.closeAllSessions();
      await loadSessions();
    } catch (e) {
      console.error(e);
      showAlert("Ошибка при завершении сессий.");
    }
  }

  function formatDate(ms) {
    if (!ms) return "";
    const date = new Date(ms);
    return (
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false })
    );
  }

  function openScanner() {
    openQrScanner({
      onScan: handleQRScan,
    });
  }

  function handleQRScan(content) {
    closeQrScanner();
    if (!content || isHandlingQR) return;
    isHandlingQR = true;
    if (content.includes(":auth")) {
      $API.call(1, { interactive: true });
      $API.call(96, {});
      $API
        .call(290, { qrLink: content })
        .then((response) => {
          if (response?.error) showAlert(response.title || "Ошибка авторизации");
          else loadSessions();
        })
        .finally(() => {
          isHandlingQR = false;
        });
    } else {
      isHandlingQR = false;
      showAlert(content);
    }
  }
</script>

<SettingsPageWrapper title="Устройства" {from} {isTab} {onClose}>
  <span class="sessions-count" slot="header-extra">{sessions.length}</span>

  <div class="devices-page">
    {#if loading}
      <div class="devices-status">Загрузка данных...</div>
    {:else if sessions.length === 0}
      <div class="devices-status">Список сессий пуст</div>
    {:else}
      {#if currentSession}
        <SettingsSection title="Это устройство">
          <SettingsRow
            icon="devices.png"
            title={currentSession.client || "Текущее устройство"}
            subtitle={currentSession.location || "Неизвестная локация"}
            value="В сети"
            chevron={false}
            on:click={() => toggleSession(currentSession.time)}
          />
          {#if expandedId === currentSession.time}
            <div class="session-details" transition:slide={{ duration: 180 }}>
              {#if currentSession.info}
                <div class="detail-row">
                  <span class="detail-label">Устройство</span>
                  <span class="detail-val">{currentSession.info}</span>
                </div>
              {/if}
              <div class="detail-row">
                <span class="detail-label">Локация</span>
                <span class="detail-val">{currentSession.location || "—"}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Вход</span>
                <span class="detail-val">{formatDate(currentSession.time)}</span>
              </div>
            </div>
          {/if}

          {#if otherSessions.length > 0}
            <SettingsRow
              title="Завершить все другие сеансы"
              danger={true}
              chevron={false}
              on:click={handleTerminateAll}
            />
          {/if}
        </SettingsSection>
      {/if}

      {#if otherSessions.length > 0}
        <SettingsSection title="Активные сессии">
          {#each otherSessions as session, i (session.time + "-" + i)}
            {@const itemKey = session.time + "-" + i}
            <SettingsRow
              icon="devices.png"
              title={session.client || "Неизвестный клиент"}
              subtitle={session.location
                ? session.location.split(",").slice(0, 2).join(",")
                : "Неизвестная локация"}
              value={formatDate(session.time).split(" ")[0]}
              chevron={false}
              on:click={() => toggleSession(itemKey)}
            />
            {#if expandedId === itemKey}
              <div class="session-details" transition:slide={{ duration: 180 }}>
                {#if session.info}
                  <div class="detail-row">
                    <span class="detail-label">Информация</span>
                    <span class="detail-val">{session.info}</span>
                  </div>
                {/if}
                <div class="detail-row">
                  <span class="detail-label">Локация</span>
                  <span class="detail-val">{session.location || "—"}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Время входа</span>
                  <span class="detail-val">{formatDate(session.time)}</span>
                </div>
              </div>
            {/if}
          {/each}
        </SettingsSection>
      {/if}
    {/if}
  </div>

  <div class="devices-footer" slot="footer">
    <button type="button" class="qr-scan-btn" on:click={openScanner}>
      <img src="/icons/qr.svg" alt="" class="qr-btn-icon" />
      <span>Сканировать QR-код</span>
    </button>
  </div>
</SettingsPageWrapper>

<style>
  .sessions-count {
    min-width: 24px;
    height: 24px;
    padding: 0 8px;
    border-radius: 12px;
    background: var(--settings-card-elevated, #25262d);
    color: var(--settings-text-secondary);
    font-size: 13px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .devices-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 8px;
  }

  .devices-status {
    text-align: center;
    padding: 48px 16px;
    color: var(--settings-text-muted);
    font-size: 14px;
  }

  .session-details {
    padding: 10px 16px 14px 54px;
    border-bottom: 1px solid var(--settings-separator);
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--settings-card-hover);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }

  .detail-label {
    color: var(--settings-text-muted);
    flex-shrink: 0;
  }

  .detail-val {
    color: var(--settings-text-primary);
    text-align: right;
    word-break: break-word;
  }

  .devices-footer {
    padding: 10px 12px max(16px, calc(16px + var(--safe-bottom, 0px)));
    background: var(--settings-bg, #0f0f12);
    border-top: 1px solid var(--settings-separator);
    flex-shrink: 0;
  }

  .qr-scan-btn {
    width: 100%;
    height: 52px;
    border: none;
    border-radius: 14px;
    background: var(--settings-accent, #007aff);
    color: #ffffff;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 16px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    transition: background-color 0.15s, transform 0.1s;
  }

  .qr-scan-btn:hover {
    background: var(--settings-accent-hover, #1a88ff);
  }

  .qr-scan-btn:active {
    transform: scale(0.985);
  }

  .qr-btn-icon {
    width: 20px;
    height: 20px;
    filter: brightness(0) invert(1);
  }
</style>
