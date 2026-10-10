<script>
  import { Button, Tab } from "$components/ui";
  import { onMount } from "svelte";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import PluginCard from "$components/plugins/PluginCard.svelte";
  import { pluginStore, showPluginImportModal } from "$lib/stores/plugins.js";
  import { CATEGORY_LABELS } from "$lib/plugins/manifest.js";
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { showAlert } from "$lib/utils/alert.js";

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
      const response = await fetch("https://maxplus.dev/api/plugins?status=approved");
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

  onMount(() => {
    fetchStorePlugins();
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
        const entryCode = manifest.entry ? (files[manifest.entry] || '') : '';

        showPluginImportModal({
          arrayBuffer,
          manifest,
          verificationStatus: 'unverified_plugin',
          entryCode,
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
      const entryCode = manifest.entry ? (files[manifest.entry] || '') : '';

      showPluginImportModal({
        arrayBuffer,
        manifest,
        verificationStatus: 'verified',
        entryCode,
      });
    } catch (error) {
      console.error(error);
      showAlert("Ошибка установки из каталога");
    }
  }
</script>

<SettingsPageWrapper title="Плагины" {onClose}>
  <div slot="header-extra" class="tabs-container">
    <Tab variant="underline" active={activeTab === 'installed'} class="pg-plugins-tab-btn" onclick={() => activeTab = 'installed'}>
      Установленные
    </Tab>
    <Tab variant="underline" active={activeTab === 'store'} class="pg-plugins-tab-btn" onclick={() => activeTab = 'store'}>
      Каталог
    </Tab>
  </div>

  <div class="content">
    {#if activeTab === 'installed'}
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
        <Button class="pg-plugins-import-btn" onclick={handleImport}>
          Импортировать .mxp
        </Button>
      </div>
    {:else}
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
            <div class="store-card">
              <div class="store-card-header">
                <div class="store-card-title-group">
                  <span class="plugin-name">{plugin.name}</span>
                  <span class="plugin-author">{getAuthor(plugin.author)}</span>
                  {#if plugin.category}
                    <span class="badge category">{CATEGORY_LABELS[plugin.category] || plugin.category}</span>
                  {/if}
                </div>
                <button
                  class="install-store-btn"
                  class:rate-limited={rateLimited && (rateLimitPluginId === plugin.id || !rateLimitPluginId)}
                  disabled={rateLimited}
                  on:click={() => installFromStore(plugin)}
                >
                  {#if rateLimited && (rateLimitPluginId === plugin.id || !rateLimitPluginId)}
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
    {/if}
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




  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px;
    gap: 16px;
    overflow-y: auto;
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

  :global(.pg-plugins-import-btn)  { width: 100%; }



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
</style>
