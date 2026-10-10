<script>
  import { Button, Tab } from "$components/ui";
  import IconButton from "$components/ui/IconButton.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import logs, { total, clear as clearLogs } from "$lib/stores/logs";
  import {
    webappLogs,
    filterRules,
    initWebAppLogs,
    clearWebAppLogs,
    exportWebAppLogs,
    exportServerLogs,
    exportFilterRules,
    importFilterRules,
    addFilterRule,
    updateFilterRule,
    removeFilterRule,
    toggleFilterRule,
  } from "$lib/stores/webappLogs";
  import FilterRulesModal from "$components/logs/FilterRulesModal.svelte";
  import { fade } from "svelte/transition";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";

  export let isTab = false;
  export let onClose = null;

  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let activeTab = "max_api";
  let expandedId = null;
  let expandedWebAppId = null;

  let isFilterModalOpen = false;
  let editingRule = null;
  let toastMessage = "";
  let toastTimer = null;

  let logsContainer;

  onMount(() => {
    initWebAppLogs();
  });

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage = msg;
    toastTimer = setTimeout(() => {
      toastMessage = "";
    }, 2000);
  }

  $: expandedFormatted = expandedId !== null
    ? (() => {
        const item = $logs.find((l) => l.id === expandedId);
        return item ? JSON.stringify(item.data, null, 1) : "";
      })()
    : "";

  function toggleLog(id) {
    expandedId = expandedId === id ? null : id;
  }

  function toggleWebAppLog(id) {
    expandedWebAppId = expandedWebAppId === id ? null : id;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Скопировано");
    } catch {}
  }

  async function handleExport() {
    try {
      if (activeTab === "max_api") {
        const res = await exportServerLogs($logs);
        if (res?.success) showToast("Логи экспортированы");
      } else if (activeTab === "webapps") {
        const res = await exportWebAppLogs($webappLogs);
        if (res?.success) showToast("Логи экспортированы");
      } else if (activeTab === "filters") {
        const res = await exportFilterRules();
        if (res?.success) showToast("Фильтры экспортированы");
      }
    } catch (err) {
      showToast(err.message || "Ошибка экспорта");
    }
  }

  async function handleImport() {
    try {
      const res = await importFilterRules();
      if (res) showToast(`Импортировано правил: ${res.count}`);
    } catch (err) {
      showToast(err.message || "Ошибка импорта");
    }
  }

  async function handleClear() {
    if (activeTab === "max_api") {
      clearLogs();
      expandedId = null;
      showToast("Логи очищены");
    } else if (activeTab === "webapps") {
      await clearWebAppLogs();
      expandedWebAppId = null;
      showToast("Логи очищены");
    }
  }

  function openCreateRule() {
    editingRule = null;
    isFilterModalOpen = true;
  }

  function openEditRule(rule) {
    editingRule = rule;
    isFilterModalOpen = true;
  }

  function handleSaveRule(event) {
    const data = event.detail;
    if (data.id) {
      updateFilterRule(data.id, data);
      showToast("Правило обновлено");
    } else {
      addFilterRule(data);
      showToast("Правило добавлено");
    }
    isFilterModalOpen = false;
    editingRule = null;
  }

  function handleQuickBlock(log) {
    let defaultPattern = log.url;
    let targetMode = "url";
    try {
      const parsed = new URL(log.url);
      if (parsed.host) {
        defaultPattern = parsed.host;
        targetMode = "host";
      }
    } catch {}

    editingRule = {
      name: `Блокировка ${defaultPattern}`,
      pattern: defaultPattern,
      target: targetMode,
      is_regex: false,
      enabled: true,
    };
    isFilterModalOpen = true;
  }
</script>

<SettingsPageWrapper title="Сетевые логи" {from} {isTab} {onClose}>
  {#if toastMessage}
    <div class="toast-popup" transition:fade={{ duration: 120 }}>
      {toastMessage}
    </div>
  {/if}

  <svelte:fragment slot="header-extra">
    {#if !isTab}
      <div class="header-controls">
        {#if activeTab === "max_api"}
          <span class="count">Всего {$total} запросов</span>
          <IconButton variant="square" onclick={handleExport} title="Экспорт логов">
            <img src="/icons/export.svg" alt="Экспорт" />
          </IconButton>
          <IconButton variant="square" danger class="pg-logs-icon-btn" onclick={handleClear} title="Очистить логи">
            ✕
          </IconButton>
        {:else if activeTab === "webapps"}
          <span class="count">Всего {$webappLogs.length}</span>
          <IconButton variant="square" onclick={handleExport} title="Экспорт логов">
            <img src="/icons/export.svg" alt="Экспорт" />
          </IconButton>
          <IconButton variant="square" danger class="pg-logs-icon-btn" onclick={handleClear} title="Очистить логи">
            ✕
          </IconButton>
        {:else}
          <span class="count">Всего {$filterRules.length}</span>
          <IconButton variant="square" onclick={handleImport} title="Импорт правил">
            <img src="/icons/import.svg" alt="Импорт" />
          </IconButton>
          <IconButton variant="square" class="pg-logs-icon-btn pg-logs-filter-export-btn" onclick={handleExport} title="Экспорт правил">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </IconButton>
          <IconButton variant="square" class="pg-logs-icon-btn pg-logs-add-icon" onclick={openCreateRule} title="Добавить правило">
            +
          </IconButton>
        {/if}
      </div>
    {/if}
  </svelte:fragment>

  {#if isTab}
    <header class="tab-header">
      <h1>Сетевые логи</h1>
      <div class="header-controls">
        {#if activeTab === "max_api"}
          <span class="count">Всего {$total} запросов</span>
          <IconButton variant="square" onclick={handleExport} title="Экспорт логов">
            <img src="/icons/export.svg" alt="Экспорт" />
          </IconButton>
          <IconButton variant="square" danger class="pg-logs-icon-btn" onclick={handleClear} title="Очистить логи">
            ✕
          </IconButton>
        {:else if activeTab === "webapps"}
          <span class="count">Всего {$webappLogs.length}</span>
          <IconButton variant="square" onclick={handleExport} title="Экспорт логов">
            <img src="/icons/export.svg" alt="Экспорт" />
          </IconButton>
          <IconButton variant="square" danger class="pg-logs-icon-btn" onclick={handleClear} title="Очистить логи">
            ✕
          </IconButton>
        {:else}
          <span class="count">Всего {$filterRules.length}</span>
          <IconButton variant="square" onclick={handleImport} title="Импорт правил">
            <img src="/icons/import.svg" alt="Импорт" />
          </IconButton>
          <IconButton variant="square" class="pg-logs-icon-btn pg-logs-filter-export-btn" onclick={handleExport} title="Экспорт правил">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </IconButton>
          <IconButton variant="square" class="pg-logs-icon-btn pg-logs-add-icon" onclick={openCreateRule} title="Добавить правило">
            +
          </IconButton>
        {/if}
      </div>
    </header>
  {/if}

  <div class="logs-body">

  <div class="tabs">
    <Tab variant="underline" active={activeTab === "max_api"} class="pg-logs-tab" onclick={() => (activeTab = "max_api")}>
      Max API
    </Tab>
    <Tab variant="underline" active={activeTab === "webapps"} class="pg-logs-tab" onclick={() => (activeTab = "webapps")}>
      WebApps
    </Tab>
    <Tab variant="underline" active={activeTab === "filters"} class="pg-logs-tab" onclick={() => (activeTab = "filters")}>
      Фильтры
    </Tab>
  </div>

  <div class="logs-container" bind:this={logsContainer}>
    {#if activeTab === "max_api"}
      {#each $logs as log (log.id)}
        <div
          class="log-item {log.type}"
          class:expanded={expandedId === log.id}
        >
          <div class="log-header" on:click={() => toggleLog(log.id)}>
            <span class="badge">{log.type.toUpperCase()}</span>
            <span class="preview">{log.timestamp} | {log.preview}...</span>
          </div>

          {#if expandedId === log.id}
            <div class="log-content" transition:fade={{ duration: 100 }}>
              <pre>{expandedFormatted}</pre>
              <img
                class="copy"
                on:click={() => copy(expandedFormatted)}
                src="/icons/copy.svg"
                alt="Копировать"
              />
            </div>
          {/if}
        </div>
      {/each}

    {:else if activeTab === "webapps"}
      {#each $webappLogs as log (log.id)}
        <div
          class="log-item {log.blocked ? 'error' : (log.status >= 400 ? 'error' : (log.status >= 200 && log.status < 300 ? 'response' : 'generic'))}"
          class:expanded={expandedWebAppId === log.id}
        >
          <div class="log-header" on:click={() => toggleWebAppLog(log.id)}>
            <span class="badge">{log.blocked ? "DROPPED" : `${log.method} ${log.status}`}</span>
            <span class="preview">{log.timestamp} | {log.duration_ms}ms | {log.url}</span>
          </div>

          {#if expandedWebAppId === log.id}
            <div class="log-content" transition:fade={{ duration: 100 }}>
              <div class="quick-row">
                <Button class="pg-logs-quick-btn pg-logs-block-color" onclick={() => handleQuickBlock(log)}>
                  Заблокировать
                </Button>
                <Button class="pg-logs-quick-btn" onclick={() => copy(log.url)}>
                  URL
                </Button>
              </div>

              <pre>{JSON.stringify({
  url: log.url,
  method: log.method,
  status: log.status,
  status_text: log.status_text,
  duration_ms: log.duration_ms,
  block_reason: log.block_reason,
  content_type: log.content_type,
  content_length: log.content_length,
  request_headers: log.request_headers,
  request_body: log.request_body,
  response_headers: log.response_headers,
  response_body: log.response_body
}, null, 1)}</pre>

              <img
                class="copy"
                on:click={() => copy(JSON.stringify(log, null, 2))}
                src="/icons/copy.svg"
                alt="Копировать"
              />
            </div>
          {/if}
        </div>
      {/each}

    {:else if activeTab === "filters"}
      {#each $filterRules as rule (rule.id)}
        <div
          in:fade={{ duration: 200 }}
          class="log-item {rule.enabled ? 'response' : 'generic'}"
        >
          <div class="log-header rule-header">
            <span
              class="badge toggle-badge"
              on:click={() => toggleFilterRule(rule.id)}
            >
              {rule.enabled ? "ON" : "OFF"}
            </span>
            <span
              class="preview rule-title"
              on:click={() => openEditRule(rule)}
            >
              {rule.name} ({rule.target}) | {rule.pattern}
            </span>
            <Button class="pg-logs-rule-del-btn" onclick={() => removeFilterRule(rule.id)}>
              ✕
            </Button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
  </div>

  {#if isFilterModalOpen}
    <FilterRulesModal
      initialRule={editingRule}
      on:save={handleSaveRule}
      on:close={() => {
        isFilterModalOpen = false;
        editingRule = null;
      }}
    />
  {/if}
</SettingsPageWrapper>

<style>
  .tab-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--bg-topbar);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    gap: 8px;
  }

  .tab-header h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .logs-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 16px;
    box-sizing: border-box;
    color: var(--text-primary);
  }

  .toast-popup {
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent-violet);
    color: white;
    padding: 5px 14px;
    border-radius: 16px;
    font-size: 0.8rem;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 2000;
    pointer-events: none;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count {
    font-size: 0.75rem;
    color: var(--text-primary);
    opacity: 0.85;
    background: var(--bg-surface-2);
    padding: 3px 8px;
    border-radius: 20px;
    white-space: nowrap;
  }

  :global(.pg-logs-icon-btn)  { width: 28px; flex-shrink: 0; }


  :global(.pg-logs-icon-btn) img  { width: 14px; }


  .danger-icon:hover {
    color: var(--status-danger);
  }




  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
    flex-shrink: 0;
  }

  :global(.pg-logs-tab)  { flex: 1; }


  .logs-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 6px;
  }

  .log-item {
    background: #2b2b33;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.1s;
    overflow: hidden;
    flex-shrink: 0;
    content-visibility: auto;
    contain-intrinsic-size: auto 40px;
  }

  .log-item:hover {
    background: #32323b;
    border-color: #4a4a55;
  }

  .log-item.expanded {
    border-color: var(--accent-violet);
    background: #2d2d38;
    white-space: normal;
    height: auto;
  }

  .log-header {
    display: flex;
    align-items: center;
    padding: 9px 12px;
    gap: 10px;
    font-family: "Fira Code", monospace;
    font-size: 0.82rem;
  }

  .preview {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-primary);
    opacity: 0.9;
  }

  .badge {
    font-size: 0.68rem;
    font-weight: bold;
    padding: 2px 6px;
    border-radius: 4px;
    min-width: 64px;
    text-align: center;
    flex-shrink: 0;
  }

  .request .badge {
    background: var(--accent-primary);
    color: white;
  }

  .response .badge {
    background: #10b981;
    color: white;
  }

  .error .badge {
    background: #f22727;
    color: white;
  }

  .generic .badge {
    background: #6b7280;
    color: white;
  }

  .toggle-badge {
    cursor: pointer;
  }

  .log-content {
    padding: 10px 12px 22px 12px;
    border-top: 1px solid #3a3a42;
    background: #1e1e24;
    overflow: auto;
    position: relative;
    cursor: default;
  }

  .quick-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }




  pre {
    margin: 6px 0 0;
    font-size: 0.8rem;
    color: #a5b4fc;
    line-height: 1.4;
    font-family: "Fira Code", monospace;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 300px;
    overflow-y: auto;
  }

  .copy {
    position: absolute;
    right: 10px;
    bottom: 12px;
    opacity: 0.6;
    cursor: pointer;
    transition: opacity 0.05s transform 0.2s;
    width: 16px;
    height: 16px;
  }

  .copy:active {
    opacity: 0.5;
    transform: scale(0.95);
  }

  .rule-header {
    justify-content: space-between;
  }

  .rule-title {
    flex: 1;
    min-width: 0;
    color: var(--text-primary);
  }

  :global(.pg-logs-rule-del-btn)  { flex-shrink: 0; }


  .logs-container::-webkit-scrollbar {
    width: 5px;
  }

  .logs-container::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 10px;
  }

  @media (max-width: 360px) {
    .logs-body {
      padding: 10px;
    }
    .header-controls {
      gap: 4px;
    }
    .count {
      display: none;
    }
    .tab-header h1 {
      font-size: 1.05rem;
    }
  }
</style>
