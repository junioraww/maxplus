<script>
  import { enablePlugin, disablePlugin, uninstallPlugin } from "$lib/plugins/runtime.js";
  import { PERMISSION_LABELS, CATEGORY_LABELS } from "$lib/plugins/manifest.js";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";

  export let plugin;

  let expanded = false;
  let showConfirmDelete = false;

  function getAuthor(author) {
    if (!author) return '';
    if (typeof author === 'string') return author;
    return author.name || '';
  }

  function getSourceCode(plugin) {
    const entry = plugin.manifest?.entry;
    if (!entry) return 'Исходный код недоступен';
    const files = plugin.files;
    if (!files) return 'Исходный код недоступен';
    const code = files instanceof Map ? files.get(entry) : files[entry];
    return code || 'Исходный код недоступен';
  }

  function toggleEnabled() {
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
</script>

<div class="plugin-card">
  <div class="card-header">
    <div class="header-info">
      <div class="title-row">
        <span class="plugin-name">{plugin.manifest.name}</span>
        <span class="plugin-author">{getAuthor(plugin.manifest.author)}</span>
      </div>
      <div class="description">{plugin.manifest.description}</div>
      <div class="badges">
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
    <div class="header-actions">
      <label class="toggle">
        <input type="checkbox" checked={plugin.enabled} on:change={toggleEnabled} />
        <span class="slider"></span>
      </label>
      <button class="expand-btn" class:expanded on:click={toggleExpand}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    </div>
  </div>

  {#if expanded}
    <div class="card-details">
      <div class="detail-row">
        <span class="detail-label">Версия:</span>
        <span class="detail-value">{plugin.manifest.version}</span>
      </div>

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

      <div class="source-section">
        <div class="detail-label">Исходный код ({plugin.manifest.entry}):</div>
        <pre class="source-code">{getSourceCode(plugin)}</pre>
      </div>
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

  .toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
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
    background-color: var(--bg-surface-2);
    transition: 150ms ease;
    border-radius: 24px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: var(--text-primary);
    transition: 150ms ease;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: var(--accent-primary);
  }

  input:checked + .slider:before {
    transform: translateX(20px);
    background-color: #fff;
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

  .detail-row, .permissions-section, .source-section {
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

  .permissions-list {
    margin: 0;
    padding-left: 20px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .source-code {
    background: var(--bg-app);
    padding: 10px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 12px;
    color: var(--text-secondary);
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    border: 1px solid var(--border-subtle);
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
</style>
