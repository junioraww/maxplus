<script>
  import { onMount } from "svelte";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import PluginCard from "$components/plugins/PluginCard.svelte";
  import { pluginStore, pluginSettingsStore, showPluginImportModal } from "$lib/stores/plugins";
  import { checkPluginUpdates, updateAllAvailablePlugins } from "$lib/plugins/updater";
  import { APP_VERSION } from "$lib/plugins/runtime";
  import { satisfies } from "$lib/plugins/semver";
  import { CATEGORY_LABELS } from "$lib/plugins/manifest";
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { showAlert } from "$lib/utils/alert";

  export let onClose = null;

  let activeTab = 'installed';
  let searchQuery = '';
  let storePlugins = [];
  let isFetchingStore = false;

  function getAuthor(author) {
    if (!author) return "";
    if (typeof author === "string") return author;
    return author.name || "";
  }

  $: installedPlugins = Array.from($pluginStore.plugins.values()).sort((a, b) => (a.order || 0) - (b.order || 0));

  $: filteredStorePlugins = storePlugins.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  let rateLimited = false;
  let rateLimitCooldown = 0;
  let rateLimitTimer = null;
  let rateLimitPluginId = null;

  function handleRateLimit(pluginId = null) {
    rateLimited = true;
    rateLimitPluginId = pluginId;
    rateLimitCooldown = 3;
    if (rateLimitTimer) clearInterval(rateLimitTimer);
    rateLimitTimer = setInterval(() => {
      rateLimitCooldown -= 1;
      if (rateLimitCooldown <= 0) {
        clearInterval(rateLimitTimer);
        rateLimited = false;
        rateLimitPluginId = null;
      }
    }, 1000);
  }

  async function fetchStorePlugins() {
    isFetchingStore = true;
    try {
      const response = await fetch(`https://maxplus.dev/api/plugins?status=approved&app_version=${encodeURIComponent(APP_VERSION)}`);
      if (response.status === 429) {
        handleRateLimit();
        return;
      }
      if (response.ok) {
        const data = await response.json();
        storePlugins = Array.isArray(data) ? data : (data.plugins || []);
      }
    } catch (e) {
      console.error("Failed to fetch store plugins:", e);
    } finally {
      isFetchingStore = false;
    }
  }

  let viewportEl;
  let isProgrammaticScroll = false;
  let scrollTimeout = null;

  function selectTab(tab) {
    activeTab = tab;
    if (!viewportEl) return;
    const targetLeft = tab === 'installed' ? 0 : viewportEl.clientWidth;
    isProgrammaticScroll = true;
    viewportEl.scrollTo({
      left: targetLeft,
      behavior: 'smooth'
    });
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isProgrammaticScroll = false;
    }, 350);
  }

  function handleScroll() {
    if (isProgrammaticScroll || !viewportEl) return;
    const width = viewportEl.clientWidth;
    if (width <= 0) return;
    const currentTab = viewportEl.scrollLeft > width * 0.5 ? 'store' : 'installed';
    if (activeTab !== currentTab) {
      activeTab = currentTab;
    }
  }

  function handleResize() {
    if (!viewportEl) return;
    const targetLeft = activeTab === 'installed' ? 0 : viewportEl.clientWidth;
    viewportEl.scrollTo({ left: targetLeft, behavior: 'auto' });
  }

  onMount(() => {
    fetchStorePlugins();
    checkPluginUpdates({ silent: true, autoApply: true });
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  });

  async function handleImport() {
    try {
      const path = await open({
        filters: [{ name: 'Max Plugin', extensions: ['mxp'] }]
      });

      if (path) {
        const bytes = await invoke("read_file", { path });
        const arrayBuffer = new Uint8Array(bytes).buffer;

        const result = await invoke("parse_mxp", { bytes: Array.from(new Uint8Array(arrayBuffer)) });
        const { manifest, files } = result;
        const iconContent = manifest.icon ? (files[manifest.icon] || '') : '';

        showPluginImportModal({
          arrayBuffer,
          manifest,
          verificationStatus: 'unverified_plugin',
          iconContent,
        });
      }
    } catch (error) {
      console.error(error);
      showAlert("Ошибка импорта плагина");
    }
  }

  async function installFromStore(plugin) {
    if (rateLimited) return;
    try {
      const response = await fetch(`https://maxplus.dev/api/plugins/${plugin.plugin_id || plugin.id}/download`);
      if (response.status === 429) {
        handleRateLimit(plugin.id);
        return;
      }
      if (!response.ok) throw new Error("Не удалось скачать плагин");

      const arrayBuffer = await response.arrayBuffer();

      const result = await invoke("parse_mxp", { bytes: Array.from(new Uint8Array(arrayBuffer)) });
      const { manifest, files } = result;
      const iconContent = manifest.icon ? (files[manifest.icon] || '') : (plugin.icon_url || '');

      showPluginImportModal({
        arrayBuffer,
        manifest,
        verificationStatus: 'verified',
        iconContent,
      });
    } catch (error) {
      console.error(error);
      showAlert("Ошибка установки из каталога");
    }
  }
</script>

<SettingsPageWrapper title="Плагины" {onClose} canSwipe={() => false}>
  <div slot="header-extra" class="tabs-container">
    <button 
      class="tab-btn" 
      class:active={activeTab === 'installed'} 
      on:click={() => selectTab('installed')}
    >
      Мои
    </button>
    <button 
      class="tab-btn" 
      class:active={activeTab === 'store'} 
      on:click={() => selectTab('store')}
    >
      Каталог
    </button>
  </div>

  <div class="tabs-viewport" bind:this={viewportEl} on:scroll={handleScroll}>
    <div class="tab-pane">
      <div class="plugin-settings-bar">
        <div class="auto-update-row">
          <div class="auto-update-label-group">
            <span class="auto-update-title">Авто-обновление плагинов</span>
            <span class="auto-update-desc">Автоматически скачивать проверенные совместимые обновления</span>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              checked={$pluginSettingsStore.autoUpdate}
              on:change={(e) => pluginSettingsStore.setAutoUpdate(e.target.checked)}
            />
            <span class="slider"></span>
          </label>
        </div>

        <div class="update-actions-row">
          <button
            class="check-updates-btn"
            disabled={$pluginSettingsStore.checkingUpdates}
            on:click={() => checkPluginUpdates({ silent: false, autoApply: true })}
          >
            {#if $pluginSettingsStore.checkingUpdates}
              <span class="spinner-icon"></span>
              <span>Проверка...</span>
            {:else}
              <span>Проверить обновления</span>
            {/if}
          </button>

          {#if $pluginSettingsStore.availableUpdates.size > 0}
            <button
              class="update-all-btn"
              on:click={updateAllAvailablePlugins}
            >
              Обновить все ({$pluginSettingsStore.availableUpdates.size})
            </button>
          {/if}
        </div>
      </div>

      {#if installedPlugins.length === 0}
        <div class="empty-state">
          <div class="empty-title">Нет установленных плагинов</div>
          <div class="empty-desc">Установите плагины из каталога или импортируйте файл .mxp, чтобы расширить возможности приложения.</div>
        </div>
      {:else}
        <div class="plugin-list">
          {#each installedPlugins as plugin (plugin.id)}
            <PluginCard {plugin} />
          {/each}
        </div>
      {/if}

      <div class="import-container">
        <button class="import-btn" on:click={handleImport}>
          Импортировать .mxp
        </button>
      </div>
    </div>

    <div class="tab-pane">
      <div class="search-container">
        <input 
          type="text" 
          class="search-input" 
          placeholder="Поиск плагинов..." 
          bind:value={searchQuery} 
        />
      </div>

      {#if rateLimited}
        <div class="rate-limit-banner">
          Слишком много запросов (429)! Подождите {rateLimitCooldown}с...
        </div>
      {/if}

      {#if isFetchingStore}
        <div class="loading-state">Загрузка...</div>
      {:else if filteredStorePlugins.length === 0}
        <div class="empty-state">
          <div class="empty-title">Ничего не найдено</div>
        </div>
      {:else}
        <div class="plugin-list">
          {#each filteredStorePlugins as plugin (plugin.id)}
            {@const isCompatible = satisfies(APP_VERSION, plugin.min_app_version, plugin.max_app_version)}
            <div class="store-card">
              <div class="store-card-header">
                <div class="store-card-identity">
                  {#if plugin.icon_url}
                    <img class="store-card-icon-img" src={plugin.icon_url} alt="" />
                  {:else}
                    <div class="store-card-icon-fallback">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                      </svg>
                    </div>
                  {/if}
                  <div class="store-card-title-group">
                    <span class="plugin-name">{plugin.name}</span>
                    <span class="plugin-author">{getAuthor(plugin.author)}</span>
                    {#if !isCompatible}
                      <span class="badge incompatible">Не поддерживается</span>
                    {/if}
                    {#if plugin.category}
                      <span class="badge category">{CATEGORY_LABELS[plugin.category] || plugin.category}</span>
                    {/if}
                  </div>
                </div>
                <button
                  class="install-store-btn"
                  class:incompatible={!isCompatible}
                  class:rate-limited={rateLimited && (rateLimitPluginId === plugin.id || !rateLimitPluginId)}
                  disabled={rateLimited || !isCompatible}
                  on:click={() => installFromStore(plugin)}
                >
                  {#if !isCompatible}
                    Требуется {plugin.min_app_version}
                  {:else if rateLimited && (rateLimitPluginId === plugin.id || !rateLimitPluginId)}
                    Лимит 429 ({rateLimitCooldown}с)
                  {:else}
                    Установить
                  {/if}
                </button>
              </div>
              {#if plugin.description}
                <div class="description">{plugin.description}</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</SettingsPageWrapper>

<style>
  .tabs-container {
    display: flex;
    gap: 4px;
    background: var(--bg-surface);
    padding: 4px;
    border-radius: 8px;
  }

  .tab-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .tab-btn:hover {
    color: var(--text-primary);
  }

  .tab-btn.active {
    background: var(--bg-surface-2);
    color: var(--accent-primary);
  }

  :global(.settings-page-content:has(.tabs-viewport)) {
    overflow-y: hidden !important;
    padding-bottom: 0 !important;
  }

  .tabs-viewport {
    display: flex;
    flex-direction: row;
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .tabs-viewport::-webkit-scrollbar {
    display: none;
  }

  .tab-pane {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    max-height: 100%;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 16px;
    padding-bottom: calc(16px + var(--safe-bottom, 0px));
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    flex: 1;
    padding: 40px 20px;
    gap: 8px;
  }

  .empty-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-desc {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.4;
    max-width: 300px;
  }

  .loading-state {
    text-align: center;
    padding: 40px;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .plugin-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .import-container {
    margin-top: auto;
    padding-top: 16px;
  }

  .import-btn {
    width: 100%;
    padding: 14px;
    background: var(--bg-surface-2);
    color: var(--text-primary);
    border: 1px solid var(--border-card);
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 150ms ease;
  }

  .import-btn:hover {
    background: var(--border-subtle);
  }

  .import-btn:active {
    opacity: 0.8;
  }

  .search-container {
    position: relative;
  }

  .search-input {
    width: 100%;
    padding: 12px 16px;
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: 12px;
    color: var(--text-primary);
    font-size: 15px;
    box-sizing: border-box;
    transition: border-color 150ms ease;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .store-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .store-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .store-card-identity {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .store-card-icon-img {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    object-fit: contain;
    background: var(--bg-surface-2);
    flex-shrink: 0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  }

  .store-card-icon-fallback {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .store-card-title-group {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .plugin-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 15px;
  }

  .plugin-author {
    color: var(--text-muted);
    font-size: 13px;
  }

  .badge {
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
  }

  .badge.category {
    background: var(--bg-surface-2);
    color: var(--text-secondary);
  }

  .badge.incompatible {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .description {
    color: var(--text-secondary);
    font-size: 13px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.35;
  }

  .install-store-btn {
    background: var(--accent-primary);
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 7px;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: opacity 150ms ease;
  }

  .install-store-btn.incompatible {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    cursor: not-allowed;
  }

  .install-store-btn:active {
    opacity: 0.8;
  }

  .install-store-btn.rate-limited {
    background: rgba(231, 76, 60, 0.9) !important;
    border: 1px solid #e74c3c !important;
    color: #fff !important;
    cursor: not-allowed;
  }

  .rate-limit-banner {
    background: rgba(231, 76, 60, 0.15);
    border: 1px solid rgba(231, 76, 60, 0.4);
    color: #e74c3c;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    text-align: center;
  }

  .plugin-settings-bar {
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .auto-update-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .auto-update-label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .auto-update-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .auto-update-desc {
    font-size: 12px;
    color: var(--text-muted, #71717a);
  }

  .toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--bg-surface-2, #27272a);
    transition: 200ms ease;
    border-radius: 24px;
    border: 1px solid var(--border-card);
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    transition: 200ms ease;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: var(--accent-primary, #0284c7);
  }

  input:checked + .slider:before {
    transform: translateX(20px);
  }

  .update-actions-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border-card);
  }

  .check-updates-btn {
    background: var(--bg-surface-2);
    color: var(--text-primary);
    border: 1px solid var(--border-card);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 150ms ease;
  }

  .check-updates-btn:hover:not(:disabled) {
    background: var(--border-subtle);
  }

  .check-updates-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .update-all-btn {
    background: var(--accent-primary, #0284c7);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .update-all-btn:hover {
    opacity: 0.9;
  }

  .spinner-icon {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 600ms linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
