<script>
  import { APP_VERSION, enablePlugin, disablePlugin, uninstallPlugin } from "$lib/plugins/runtime";
  import { satisfies } from "$lib/plugins/semver";
  import { PERMISSION_LABELS, CATEGORY_LABELS } from "$lib/plugins/manifest";
  import { showAlert } from "$lib/utils/alert";
  import { pluginSettingsStore } from "$lib/stores/plugins";
  import { applyPluginUpdate } from "$lib/plugins/updater";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import Switch from "$components/common/Switch.svelte";

  export let plugin;

  let expanded = false;
  let showConfirmDelete = false;
  let updating = false;

  $: isCompatible = satisfies(APP_VERSION, plugin.manifest?.minAppVersion, plugin.manifest?.maxAppVersion);
  $: updateInfo = $pluginSettingsStore.availableUpdates.get(plugin.id);

  function getIconContent(p) {
    const iconFile = p.manifest?.icon;
    if (!iconFile) return null;
    const files = p.files;
    if (!files) return null;
    return files instanceof Map ? files.get(iconFile) : files[iconFile];
  }

  $: iconContent = getIconContent(plugin);

  function getAuthor(author) {
    if (!author) return '';
    if (typeof author === 'string') return author;
    return author.name || '';
  }

  function toggleEnabled() {
    if (!isCompatible) {
      const required = plugin.manifest?.minAppVersion ? `требуется Max+ ${plugin.manifest.minAppVersion}` : "несовместимо";
      showAlert(`Неподдерживаемая версия: ${required} (у вас ${APP_VERSION})`);
      return;
    }
    if (plugin.enabled) {
      disablePlugin(plugin.id);
    } else {
      enablePlugin(plugin.id);
    }
  }

  function confirmUninstall() {
    showConfirmDelete = false;
    uninstallPlugin(plugin.id);
  }

  function toggleExpand() {
    expanded = !expanded;
  }

  async function handleUpdateClick() {
    if (!updateInfo || updating) return;
    updating = true;
    try {
      await applyPluginUpdate(updateInfo);
      showAlert(`Плагин "${plugin.manifest.name}" успешно обновлен до v${updateInfo.target_version}`);
    } catch (err) {
      showAlert(err?.message || "Ошибка обновления плагина");
    } finally {
      updating = false;
    }
  }
</script>

<div class="plugin-card">
  <div class="card-header">
    <div class="card-identity">
      {#if iconContent}
        {#if iconContent.trim().startsWith('<svg')}
          <div class="plugin-card-icon-svg">{@html iconContent}</div>
        {:else}
          <img class="plugin-card-icon-img" src={iconContent} alt="" />
        {/if}
      {:else}
        <div class="plugin-card-icon-fallback">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
      {/if}
      <div class="header-info">
        <div class="title-row">
          <span class="plugin-name">{plugin.manifest.name}</span>
          <span class="plugin-author">{getAuthor(plugin.manifest.author)}</span>
        </div>
        {#if !expanded}
          <div class="description">{plugin.manifest.description}</div>
        {/if}
        <div class="badges">
          {#if !isCompatible}
            <span class="badge incompatible" title="Требуется Max+ {plugin.manifest.minAppVersion || ''}">Неподдерживаемая версия</span>
          {/if}
          {#if plugin.verificationStatus === 'verified'}
            <span class="badge verified">✓ Проверен</span>
          {:else}
            <span class="badge unverified">⚠ Не проверен</span>
          {/if}
          {#if plugin.manifest.category}
            <span class="badge category">{CATEGORY_LABELS[plugin.manifest.category] || plugin.manifest.category}</span>
          {/if}
        </div>
      </div>
    </div>
    <div class="header-actions">
      {#if !isCompatible}
        <button class="incompatible-badge-btn" on:click={toggleEnabled}>
          Недоступно
        </button>
      {:else}
        <Switch checked={plugin.enabled} on:change={toggleEnabled} ariaLabel="Включить плагин" />
      {/if}
      <button class="expand-btn" class:expanded on:click={toggleExpand}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    </div>
  </div>

  {#if updateInfo}
    <div class="update-banner">
      <div class="update-info">
        <div class="update-title">Доступно обновление v{updateInfo.target_version}</div>
        {#if updateInfo.changelog}
          <div class="update-changelog">{updateInfo.changelog}</div>
        {/if}
      </div>
      <button class="update-btn" disabled={updating} on:click={handleUpdateClick}>
        {updating ? "Обновление..." : "Обновить"}
      </button>
    </div>
  {/if}

  {#if expanded}
    <div class="card-details">
      <div class="detail-row">
        <span class="detail-label">Версия:</span>
        <span class="detail-value">{plugin.manifest.version}</span>
      </div>

      {#if plugin.manifest.description}
        <div class="detail-description-section">
          <div class="detail-label">Описание:</div>
          <div class="full-description">{plugin.manifest.description}</div>
        </div>
      {/if}

      {#if plugin.manifest.permissions && plugin.manifest.permissions.length > 0}
        <div class="permissions-section">
          <div class="detail-label">Разрешения:</div>
          <ul class="permissions-list">
            {#each plugin.manifest.permissions as perm}
              <li>{PERMISSION_LABELS[perm] || perm}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}

  <button class="trash-btn" type="button" on:click={() => showConfirmDelete = true} title="Удалить плагин">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  </button>

  {#if showConfirmDelete}
    <ConfirmModal
      title="Удаление плагина"
      message={`Вы уверены, что хотите удалить плагин "${plugin.manifest?.name || plugin.id}"?`}
      confirmText="Удалить"
      cancelText="Отмена"
      isDangerous={true}
      on:confirm={confirmUninstall}
      on:cancel={() => showConfirmDelete = false}
    />
  {/if}
</div>


<style>
  .plugin-card {
    position: relative;
    background: var(--bg-surface);
    border: 1px solid var(--border-card);
    border-radius: 12px;
    padding: 14px;
    padding-bottom: 22px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }

  .card-identity {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .plugin-card-icon-svg {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 7px;
    box-sizing: border-box;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .plugin-card-icon-svg :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  .plugin-card-icon-img {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    object-fit: contain;
    background: var(--bg-surface-2);
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .plugin-card-icon-fallback {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .header-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .plugin-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 16px;
  }

  .plugin-author {
    color: var(--text-muted);
    font-size: 14px;
  }

  .description {
    color: var(--text-secondary);
    font-size: 14px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }

  .badges {
    display: flex;
    gap: 8px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .badge {
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  }

  .badge.verified {
    background: rgba(46, 204, 113, 0.15);
    color: var(--status-success);
  }

  .badge.unverified {
    background: rgba(241, 196, 15, 0.15);
    color: #f1c40f;
  }

  .badge.category {
    background: var(--bg-surface-2);
    color: var(--text-secondary);
  }

  .badge.incompatible {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .incompatible-badge-btn {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .expand-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 150ms ease;
  }

  .expand-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary);
  }

  .expand-btn svg {
    transition: transform 150ms ease;
  }

  .expand-btn.expanded svg {
    transform: rotate(180deg);
  }

  .card-details {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--border-card);
    padding-top: 12px;
    animation: fadeIn 150ms ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .detail-row, .detail-description-section, .permissions-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .detail-label {
    color: var(--text-muted);
    font-size: 13px;
  }

  .detail-value {
    color: var(--text-primary);
    font-size: 14px;
  }

  .full-description {
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .permissions-list {
    margin: 0;
    padding-left: 20px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .trash-btn {
    position: absolute;
    bottom: 12px;
    right: 12px;
    background: var(--bg-surface-2, rgba(255, 255, 255, 0.05));
    color: var(--text-muted, #71717a);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    z-index: 2;
  }

  .trash-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-primary, #ffffff);
    border-color: rgba(255, 255, 255, 0.25);
  }

  .trash-btn:active {
    opacity: 0.8;
  }

  .update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: rgba(6, 182, 212, 0.1);
    border: 1px solid rgba(6, 182, 212, 0.3);
    border-radius: 8px;
    padding: 8px 12px;
    margin-top: 8px;
  }

  .update-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .update-title {
    font-size: 13px;
    font-weight: 600;
    color: #38bdf8;
  }

  .update-changelog {
    font-size: 12px;
    color: var(--text-muted, #a1a1aa);
    line-height: 1.3;
  }

  .update-btn {
    flex-shrink: 0;
    background: #0284c7;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 150ms ease, opacity 150ms ease;
  }

  .update-btn:hover:not(:disabled) {
    background: #0369a1;
  }

  .update-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
