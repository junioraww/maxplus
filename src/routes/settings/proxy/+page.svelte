<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import Switch from "$components/common/Switch.svelte";
  import {
    proxyConfig,
    proxyLoading,
    loadProxyConfig,
    saveProxyConfig,
    testProxy,
    vpnStatus,
    checkVpn,
    toggleVpnBypass,
    DEFAULT_BYPASS_HOSTS,
    sanitizeBypassHosts,
  } from "$lib/stores/proxySettings";

  export let isTab = false;
  export let onClose = null;

  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let proxyType = "none";
  let host = "";
  let port = 1080;
  let username = "";
  let password = "";
  let bypassHosts = [...DEFAULT_BYPASS_HOSTS];
  let newBypassInput = "";
  let vpnBypassEnabled = false;

  let testRunning = false;
  let testResult = null;

  function isEssential(h) {
    const lower = (h || "").toLowerCase();
    return lower === "localhost" || lower === "127.0.0.1";
  }

  function addBypassHost() {
    const trimmed = newBypassInput.trim();
    if (!trimmed) return;
    if (!bypassHosts.some(h => h.toLowerCase() === trimmed.toLowerCase())) {
      bypassHosts = [...bypassHosts, trimmed];
    }
    newBypassInput = "";
  }

  function removeBypassHost(index) {
    const item = bypassHosts[index];
    if (isEssential(item)) return;
    bypassHosts = bypassHosts.filter((_, i) => i !== index);
  }

  function resetBypassHosts() {
    bypassHosts = [...DEFAULT_BYPASS_HOSTS];
  }

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
    bypassHosts = cfg.bypass_hosts?.length ? [...cfg.bypass_hosts] : [...DEFAULT_BYPASS_HOSTS];
    vpnBypassEnabled = Boolean(cfg.vpn_bypass_enabled);
  });

  async function handleSave() {
    await saveProxyConfig({
      proxy_type: proxyType,
      host,
      port: Number(port) || 1080,
      username,
      password,
      bypass_hosts: bypassHosts,
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
        bypass_hosts: bypassHosts,
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
            {#if $proxyConfig.bypass_hosts?.length}
              • исключений: {$proxyConfig.bypass_hosts.length}
            {/if}
          {:else}
            Прямое подключение
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
          <div class="input-field-group">
            <label for="proxy-host" class="input-label">Хост / IP</label>
            <input
              id="proxy-host"
              type="text"
              class="text-input"
              placeholder="127.0.0.1 или хост"
              bind:value={host}
            />
          </div>

          <div class="input-field-group">
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
              placeholder="Логин"
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

        <div class="bypass-section">
          <div class="bypass-header">
            <div class="bypass-title-col">
              <span class="bypass-title">Исключения (обход прокси)</span>
              <span class="bypass-desc">
                Сайты и IP-адреса, запросы к которым отправляются напрямую без прокси
              </span>
            </div>
            <button
              type="button"
              class="bypass-reset-btn"
              title="Восстановить список по умолчанию"
              on:click={resetBypassHosts}
            >
              Сбросить
            </button>
          </div>

          <div class="bypass-tags-container">
            {#each bypassHosts as bHost, idx}
              <div class="bypass-chip" class:essential={isEssential(bHost)}>
                <span class="bypass-chip-text">{bHost}</span>
                {#if isEssential(bHost)}
                  <span class="bypass-chip-lock" title="Обязательный системный адрес">🔒</span>
                {:else}
                  <button
                    type="button"
                    class="bypass-chip-remove"
                    title="Удалить"
                    on:click={() => removeBypassHost(idx)}
                  >
                    ✕
                  </button>
                {/if}
              </div>
            {/each}
          </div>

          <div class="bypass-input-row">
            <input
              type="text"
              class="text-input bypass-input"
              placeholder="Добавить домен или IP (например: api.example.com)"
              bind:value={newBypassInput}
              on:keydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addBypassHost();
                }
              }}
            />
            <button
              type="button"
              class="bypass-add-btn"
              disabled={!newBypassInput.trim()}
              on:click={addBypassHost}
            >
              Добавить
            </button>
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
            <span class="toggle-title">Обход VPN</span>
            <span class="toggle-desc">
              Трафик через Wi-Fi или сотовую сеть в обход VPN
            </span>
          </div>
          <Switch checked={vpnBypassEnabled} ariaLabel="Обход VPN" />
        </div>
      </div>
    {/if}

    <div class="section-header">
      <h2>Статус сети</h2>
    </div>

    <div class="settings-card">
      <div class="status-row">
        <span class="status-label">VPN на сервере:</span>
        <span class="status-val" class:warn={$vpnStatus?.server_detected}>
          {$vpnStatus?.server_detected ? "Обнаружен VPN" : "Прямое подключение"}
        </span>
      </div>
      {#if isAndroid}
        <div class="card-divider"></div>
        <div class="status-row">
          <span class="status-label">Системный VPN:</span>
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
    width: 100%;
    box-sizing: border-box;
  }

  .input-field-group {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-sizing: border-box;
  }

  .input-label {
    font-size: 13px;
    color: #9ca3af;
    font-weight: 500;
  }

  .text-input {
    width: 100%;
    min-width: 0;
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

  .bypass-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .bypass-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .bypass-title-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .bypass-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #fff;
  }

  .bypass-desc {
    font-size: 0.8rem;
    color: #888;
    line-height: 1.35;
  }

  .bypass-reset-btn {
    background: transparent;
    border: none;
    color: #248bfe;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 6px;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }

  .bypass-reset-btn:hover {
    background: rgba(36, 139, 254, 0.1);
  }

  .bypass-tags-container {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 10px;
    background: #1c1c21;
    border: 1px solid #333;
    border-radius: 10px;
    min-height: 42px;
    align-items: center;
  }

  .bypass-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #2a2a34;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 12.5px;
    color: #e5e7eb;
    line-height: 1.4;
  }

  .bypass-chip.essential {
    background: rgba(16, 185, 129, 0.1);
    border-color: rgba(16, 185, 129, 0.25);
    color: #10b981;
  }

  .bypass-chip-lock {
    font-size: 10px;
    opacity: 0.8;
  }

  .bypass-chip-remove {
    background: transparent;
    border: none;
    color: #9ca3af;
    font-size: 11px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;
  }

  .bypass-chip-remove:hover {
    color: #ef4444;
  }

  .bypass-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .bypass-input {
    flex: 1;
    height: 38px;
  }

  .bypass-add-btn {
    height: 38px;
    padding: 0 16px;
    background: #2a2a34;
    border: 1px solid #3a3a44;
    border-radius: 10px;
    color: #fff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
  }

  .bypass-add-btn:hover:not(:disabled) {
    background: #343440;
    border-color: #248bfe;
  }

  .bypass-add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  @media (max-width: 600px) {
    .content-container {
      padding: 12px 14px;
      gap: 12px;
    }

    .settings-card {
      padding: 14px;
    }

    .form-grid {
      flex-direction: column;
      gap: 10px;
      margin-bottom: 10px;
    }

    .input-field-group {
      width: 100%;
      flex: none;
    }

    .status-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
    }

    .status-sub {
      white-space: normal;
      word-break: break-word;
    }

    .test-row {
      flex-direction: column;
      align-items: stretch;
    }

    .test-badge {
      text-align: center;
    }
  }
</style>
