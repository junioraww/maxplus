<script>
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import { vpnStatus, vpnWarningDismissed, toggleVpnBypass } from "$lib/stores/proxySettings";
  import { openSettingsPage } from "$lib/stores/session";
  import { slide } from "svelte/transition";

  export let isOpen = false;

  const dispatch = createEventDispatcher();
  let showDetails = false;
  let isTogglingBypass = false;

  $: isAndroid = $vpnStatus?.vpn_bypass_supported;
  $: isBypassActive = $vpnStatus?.vpn_bypass_active;

  function close() {
    vpnWarningDismissed.set(true);
    dispatch("close");
  }

  async function handleToggleBypass() {
    if (isTogglingBypass) return;
    isTogglingBypass = true;
    try {
      await toggleVpnBypass(!isBypassActive);
      if (!isBypassActive) {
        setTimeout(close, 400);
      }
    } finally {
      isTogglingBypass = false;
    }
  }

  function handleOpenProxySettings() {
    close();
    openSettingsPage("proxy");
  }
</script>

{#if isOpen}
  <BottomSheet title="" showClose={true} on:close={close}>
    <div class="vpn-sheet">
      <div class="icon-badge">
        <svg class="signal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a10 10 0 0 0-7.07 2.93l1.41 1.41A8 8 0 0 1 12 4a8 8 0 0 1 5.66 2.34l1.41-1.41A10 10 0 0 0 12 2z"/>
          <path d="M12 6a6 6 0 0 0-4.24 1.76l1.41 1.41A4 4 0 0 1 12 8a4 4 0 0 1 2.83 1.17l1.41-1.41A6 6 0 0 0 12 6z"/>
          <circle cx="12" cy="14" r="2"/>
          <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444" stroke-width="2.5"/>
        </svg>
      </div>

      <h2 class="title">Включён VPN</h2>

      <p class="desc">
        Сервер Мах думает, что у вас включен VPN.
        <button type="button" class="info-toggle" on:click={() => showDetails = !showDetails} aria-label="Подробнее">
          <i>i</i>
        </button>
      </p>

      {#if showDetails}
        <div class="details-panel" transition:slide={{ duration: 180 }}>
          <p class="details-text">
            Рекомендуем настроить обход в вашем VPN-клиенте (хотя бы на домен <strong>max.ru</strong>), включить встроенный обход или настроить прокси!
          </p>
        </div>
      {/if}

      <div class="actions">
        {#if isAndroid}
          <button
            type="button"
            class="btn btn-primary"
            class:active={isBypassActive}
            on:click={handleToggleBypass}
            disabled={isTogglingBypass}
          >
            {isBypassActive ? "Обход VPN активен" : "Включить обход VPN"}
          </button>
        {/if}

        <button type="button" class="btn btn-secondary" on:click={handleOpenProxySettings}>
          Настроить прокси
        </button>

        <button type="button" class="btn btn-ghost" on:click={close}>
          Понятно
        </button>
      </div>
    </div>
  </BottomSheet>
{/if}

<style>
  .vpn-sheet {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 16px 12px;
    text-align: center;
  }

  .icon-badge {
    width: 80px;
    height: 80px;
    border-radius: 38px;
    background: rgba(245, 158, 11, 0.16);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 8px 0 18px;
    color: #f59e0b;
  }

  .signal-icon {
    width: 40px;
    height: 40px;
  }

  .title {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary, #ffffff);
    letter-spacing: -0.2px;
  }

  .desc {
    margin: 0 0 16px;
    font-size: 15px;
    line-height: 1.45;
    color: var(--text-secondary, #9ca3af);
    max-width: 340px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .info-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid var(--accent, #007aff);
    background: transparent;
    color: var(--accent, #007aff);
    cursor: pointer;
    padding: 0;
    transition: transform 0.15s, background 0.15s;
    vertical-align: middle;
  }

  .info-toggle i {
    font-style: normal;
    font-weight: 700;
    font-size: 12px;
    line-height: 1;
    font-family: serif;
  }

  .info-toggle:active {
    transform: scale(0.92);
    background: rgba(0, 122, 255, 0.15);
  }

  .details-panel {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 12px 14px;
    margin-bottom: 20px;
    text-align: left;
    box-sizing: border-box;
  }

  .details-text {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--text-primary, #e5e7eb);
  }

  .details-text strong {
    color: var(--accent, #38bdf8);
  }

  .actions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 4px;
  }

  .btn {
    width: 100%;
    height: 48px;
    border-radius: 14px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: transform 0.12s, opacity 0.15s, background 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn:active {
    transform: scale(0.98);
  }

  .btn-primary {
    background: var(--accent, #007aff);
    color: #ffffff;
  }

  .btn-primary.active {
    background: #10b981;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ffffff);
  }

  .btn-ghost {
    background: transparent;
    color: var(--text-secondary, #9ca3af);
    height: 40px;
  }
</style>
