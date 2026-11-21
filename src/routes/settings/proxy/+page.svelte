<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import {
    proxyConfig,
    proxyLoading,
    loadProxyConfig,
    saveProxyConfig,
    testProxy,
    vpnStatus,
    checkVpn,
    toggleVpnBypass,
  } from "$lib/stores/proxySettings";

  export let isTab = false;
  export let onClose = null;

  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let proxyType = "none";
  let host = "";
  let port = 1080;
  let username = "";
  let password = "";
  let proxyMaxplusSite = true;
  let vpnBypassEnabled = false;

  let testRunning = false;
  let testResult = null;

  $: isAndroid = $vpnStatus?.vpn_bypass_supported;

  $: currentSavedActive =
    $proxyConfig?.proxy_type &&
    $proxyConfig.proxy_type !== "none" &&
    Boolean($proxyConfig.host?.trim());

  $: currentSavedStatusLabel = currentSavedActive
    ? ($proxyConfig.proxy_type === "socks5" ? "SOCKS5 активен" : "HTTP(S) активен")
    : "Прокси выключен";

  onMount(async () => {
    await loadProxyConfig();
    await checkVpn();
    const cfg = $proxyConfig;
    proxyType = cfg.proxy_type || "none";
    host = cfg.host || "";
    port = cfg.port || 1080;
    username = cfg.username || "";
    password = cfg.password || "";
    proxyMaxplusSite = cfg.proxy_maxplus_site !== false;
    vpnBypassEnabled = Boolean(cfg.vpn_bypass_enabled);
  });

  async function handleSave() {
    await saveProxyConfig({
      proxy_type: proxyType,
      host,
      port: Number(port) || 1080,
      username,
      password,
      proxy_maxplus_site: proxyMaxplusSite,
      vpn_bypass_enabled: vpnBypassEnabled,
    });
  }

  async function handleTest() {
    testRunning = true;
    testResult = null;
    try {
      testResult = await testProxy({
        proxy_type: proxyType,
        host,
        port: Number(port) || 1080,
        username,
        password,
        proxy_maxplus_site: proxyMaxplusSite,
      });
    } finally {
      testRunning = false;
    }
  }

  async function toggleBypass() {
    vpnBypassEnabled = !vpnBypassEnabled;
    await toggleVpnBypass(vpnBypassEnabled);
  }
</script>

<SettingsPageWrapper title="Прокси и сеть" {from} {isTab} {onClose}>
  {#if isTab}
    <header class="tab-header">
      <h1>Прокси и сеть</h1>
    </header>
  {/if}

  <div class="content-container">
    <div class="status-summary-card" class:active-mode={currentSavedActive}>
      <div class="status-dot" class:online={currentSavedActive}></div>
      <div class="status-meta">
        <div class="status-title-row">
          <span class="status-title">{currentSavedStatusLabel}</span>
          <span class="status-badge" class:badge-active={currentSavedActive}>
            {currentSavedActive ? "АКТИВЕН" : "ВЫКЛ"}
          </span>
        </div>
        <div class="status-sub">
          {#if currentSavedActive}
            {$proxyConfig.host}:{$proxyConfig.port || 1080}
            {#if $proxyConfig.proxy_maxplus_site}
              • полный проксинг включая Max+
            {/if}
          {:else}
            Прямое подключение к серверам Max без прокси
          {/if}
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Прокси-сервер</h2>
    </div>

    <div class="settings-card">
      <div class="segment-container">
        <button
          type="button"
          class="segment-btn"
          class:active={proxyType === "none"}
          on:click={() => proxyType = "none"}
        >
          <span>Выключен</span>
          {#if !currentSavedActive}
            <span class="active-dot"></span>
          {/if}
        </button>
        <button
          type="button"
          class="segment-btn"
          class:active={proxyType === "socks5"}
          on:click={() => proxyType = "socks5"}
        >
          <span>SOCKS5</span>
          {#if currentSavedActive && $proxyConfig.proxy_type === "socks5"}
            <span class="active-dot"></span>
          {/if}
        </button>
        <button
          type="button"
          class="segment-btn"
          class:active={proxyType === "http"}
          on:click={() => proxyType = "http"}
        >
          <span>HTTP(S)</span>
          {#if currentSavedActive && $proxyConfig.proxy_type === "http"}
            <span class="active-dot"></span>
          {/if}
        </button>
      </div>

      {#if proxyType !== "none"}
        <div class="card-divider"></div>

        <div class="form-grid">
          <div class="input-field-group host-group">
            <label for="proxy-host" class="input-label">Хост / IP</label>
            <input
              id="proxy-host"
              type="text"
              class="text-input"
              placeholder="127.0.0.1 или proxy.example.com"
              bind:value={host}
            />
          </div>

          <div class="input-field-group port-group">
            <label for="proxy-port" class="input-label">Порт</label>
            <input
              id="proxy-port"
              type="number"
              min="1"
              max="65535"
              class="text-input"
              placeholder="1080"
              bind:value={port}
            />
          </div>
        </div>

        <div class="form-grid">
          <div class="input-field-group">
            <label for="proxy-user" class="input-label">Логин (опционально)</label>
            <input
              id="proxy-user"
              type="text"
              class="text-input"
              placeholder="Пользователь"
              autocomplete="off"
              bind:value={username}
            />
          </div>

          <div class="input-field-group">
            <label for="proxy-pass" class="input-label">Пароль (опционально)</label>
            <input
              id="proxy-pass"
              type="password"
              class="text-input"
              placeholder="••••••••"
              autocomplete="off"
              bind:value={password}
            />
          </div>
        </div>

        <div class="card-divider"></div>

        <div
          class="toggle-row"
          on:click={() => proxyMaxplusSite = !proxyMaxplusSite}
        >
          <div class="toggle-info">
            <span class="toggle-title">Проксировать запросы к сайту Max+</span>
            <span class="toggle-desc">
              Направлять запросы к плагинам, аватаркам и API maxplus.dev через прокси
            </span>
          </div>
          <div class="toggle-track" class:active={proxyMaxplusSite}>
            <div class="toggle-thumb" class:active={proxyMaxplusSite}></div>
          </div>
        </div>

        <div class="card-divider"></div>

        <div class="test-row">
          <button
            type="button"
            class="action-btn secondary"
            disabled={testRunning || !host.trim()}
            on:click={handleTest}
          >
            {testRunning ? "Проверка..." : "Проверить подключение"}
          </button>

          {#if testResult}
            <div class="test-badge" class:success={testResult.success} class:error={!testResult.success}>
              {#if testResult.success}
                <span>Подключено ({testResult.latency_ms} мс)</span>
              {:else}
                <span>Ошибка: {testResult.error || "Сбой соединения"}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if isAndroid}
      <div class="section-header">
        <h2>Обход VPN</h2>
      </div>

      <div class="settings-card">
        <div class="toggle-row" on:click={toggleBypass}>
          <div class="toggle-info">
            <span class="toggle-title">Обход VPN (привязка процесса к сети)</span>
            <span class="toggle-desc">
              Принудительно направляет весь трафик приложения через физический Wi-Fi или LTE в обход активного VPN-туннеля
            </span>
          </div>
          <div class="toggle-track" class:active={vpnBypassEnabled}>
            <div class="toggle-thumb" class:active={vpnBypassEnabled}></div>
          </div>
        </div>
      </div>
    {/if}

    <div class="section-header">
      <h2>Статус сети</h2>
    </div>

    <div class="settings-card">
      <div class="status-row">
        <span class="status-label">Детектирование VPN сервером Max:</span>
        <span class="status-val" class:warn={$vpnStatus?.server_detected}>
          {$vpnStatus?.server_detected ? "Обнаружен VPN" : "Прямое подключение"}
        </span>
      </div>
      {#if isAndroid}
        <div class="card-divider"></div>
        <div class="status-row">
          <span class="status-label">Системный VPN интерфейс (Android):</span>
          <span class="status-val" class:warn={$vpnStatus?.local_detected}>
            {$vpnStatus?.local_detected ? "Активен" : "Не обнаружен"}
          </span>
        </div>
      {/if}
    </div>

    <button
      type="button"
      class="action-btn primary save-btn"
      disabled={$proxyLoading}
      on:click={handleSave}
    >
      {$proxyLoading ? "Сохранение..." : "Сохранить и применить"}
    </button>
  </div>
</SettingsPageWrapper>

<style>
  .tab-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #212126;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .tab-header h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #fff;
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
    min-height: 0;
  }

  .status-summary-card {
    background: #26262e;
    border-radius: 12px;
    border: 1px solid #333;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .status-summary-card.active-mode {
    border-color: rgba(16, 185, 129, 0.35);
    background: rgba(16, 185, 129, 0.06);
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #6b7280;
    flex-shrink: 0;
  }

  .status-dot.online {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
  }

  .status-meta {
    flex: 1;
    min-width: 0;
  }

  .status-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .status-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
  }

  .status-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    color: #8e8e93;
    letter-spacing: 0.5px;
  }

  .status-badge.badge-active {
    background: rgba(16, 185, 129, 0.18);
    color: #10b981;
  }

  .status-sub {
    font-size: 0.8rem;
    color: #9ca3af;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .section-header {
    display: flex;
    align-items: center;
    margin-top: 4px;
    flex-shrink: 0;
  }

  .section-header h2 {
    font-size: 0.86rem;
    font-weight: 600;
    text-transform: uppercase;
    color: #888;
    margin: 0;
    letter-spacing: 0.5px;
  }

  .settings-card {
    background: #26262e;
    border-radius: 12px;
    border: 1px solid #333;
    padding: 16px;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .card-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 14px 0;
  }

  .segment-container {
    display: flex;
    background: #1c1c21;
    border-radius: 10px;
    padding: 3px;
    gap: 4px;
  }

  .segment-btn {
    flex: 1;
    height: 36px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #8e8e93;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .segment-btn.active {
    background: #2c2c34;
    color: #ffffff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  }

  .active-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
    display: inline-block;
    margin-left: 6px;
    flex-shrink: 0;
  }

  .form-grid {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
  }

  .input-field-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .host-group {
    flex: 2.5;
  }

  .port-group {
    flex: 1;
  }

  .input-label {
    font-size: 13px;
    color: #9ca3af;
    font-weight: 500;
  }

  .text-input {
    height: 42px;
    background: #1c1c21;
    border: 1px solid #3a3a42;
    border-radius: 10px;
    color: #fff;
    padding: 0 12px;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .text-input:focus {
    border-color: #248bfe;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    user-select: none;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .toggle-title {
    font-size: 1rem;
    font-weight: 500;
    color: #fff;
  }

  .toggle-desc {
    font-size: 0.82rem;
    color: #888;
    line-height: 1.35;
  }

  .toggle-track {
    width: 44px;
    height: 24px;
    background: #3a3a3c;
    border-radius: 12px;
    position: relative;
    transition: background-color 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-track.active {
    background: #248bfe;
  }

  .toggle-thumb {
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toggle-thumb.active {
    transform: translateX(20px);
  }

  .test-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .test-badge {
    font-size: 13px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 8px;
  }

  .test-badge.success {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }

  .test-badge.error {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
  }

  .status-label {
    color: #9ca3af;
  }

  .status-val {
    font-weight: 600;
    color: #10b981;
  }

  .status-val.warn {
    color: #f59e0b;
  }

  .action-btn {
    height: 44px;
    border-radius: 10px;
    border: none;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    flex-shrink: 0;
  }

  .action-btn:active {
    transform: scale(0.98);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.secondary {
    background: #3a3a42;
    color: #fff;
  }

  .action-btn.primary {
    background: #248bfe;
    color: #fff;
  }

  .save-btn {
    height: 48px;
    min-height: 48px;
    width: 100%;
    font-size: 15px;
    border-radius: 12px;
    margin-top: 8px;
    margin-bottom: 24px;
    flex-shrink: 0;
    box-sizing: border-box;
  }
</style>
