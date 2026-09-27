<script>
  import { pluginImportModal, closePluginImportModal } from "$lib/stores/plugins.js";
  import { installPlugin } from "$lib/plugins/runtime.js";
  import { PERMISSION_LABELS, CATEGORY_LABELS } from "$lib/plugins/manifest.js";
  import { showAlert } from "$lib/utils/alert.js";

  let isInstalling = false;
  let showCode = false;

  function getAuthor(author) {
    if (!author) return "";
    if (typeof author === "string") return author;
    return author.name || "";
  }

  async function handleInstall() {
    if (isInstalling) return;
    isInstalling = true;
    try {
      await installPlugin($pluginImportModal.arrayBuffer);
      showAlert("Плагин установлен");
      closePluginImportModal();
    } catch (error) {
      showAlert(error.message);
    } finally {
      isInstalling = false;
    }
  }

  function handleCancel() {
    closePluginImportModal();
  }
</script>

{#if $pluginImportModal}
  <div class="modal-backdrop" on:click={handleCancel}>
    <div class="modal-sheet" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Установить плагин</h2>
      </div>

      <div class="modal-content">
        <div class="plugin-info">
          <div class="title-row">
            <span class="plugin-name">{$pluginImportModal.manifest.name}</span>
            <span class="plugin-author">{getAuthor($pluginImportModal.manifest.author)}</span>
          </div>
          {#if $pluginImportModal.manifest.category}
            <span class="badge category">{CATEGORY_LABELS[$pluginImportModal.manifest.category] || $pluginImportModal.manifest.category}</span>
          {/if}
          <div class="description">{$pluginImportModal.manifest.description}</div>
        </div>

        {#if $pluginImportModal.verificationStatus === 'verified'}
          <div class="status-banner verified">
            ✓ Проверен командой Max+
          </div>
        {:else if $pluginImportModal.verificationStatus === 'unverified_version'}
          <div class="status-banner warning">
            ⚠ Эта версия не проверена
          </div>
        {:else}
          <div class="status-banner danger">
            ⚠ Плагин не найден в каталоге Max+. Устанавливайте только из доверенных источников.
          </div>
        {/if}

        {#if $pluginImportModal.manifest.permissions && $pluginImportModal.manifest.permissions.length > 0}
          <div class="permissions-section">
            <div class="section-title">Запрашиваемые разрешения:</div>
            <ul class="permissions-list">
              {#each $pluginImportModal.manifest.permissions as perm}
                <li>{PERMISSION_LABELS[perm] || perm}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if $pluginImportModal.entryCode}
          <div class="source-section">
            <div class="source-header" on:click={() => showCode = !showCode}>
              <span class="section-title">Исходный код ({$pluginImportModal.manifest.entry || 'main.js'})</span>
              <span class="code-toggle">{showCode ? 'Скрыть' : 'Показать'}</span>
            </div>
            {#if showCode}
              <pre class="source-code">{$pluginImportModal.entryCode}</pre>
            {/if}
          </div>
        {/if}
      </div>

      <div class="modal-actions">
        <button class="btn cancel" on:click={handleCancel} disabled={isInstalling}>Отмена</button>
        <button class="btn install" on:click={handleInstall} disabled={isInstalling}>
          {isInstalling ? 'Установка...' : 'Установить'}
        </button>
      </div>
    </div>
  </div>
{/if}


<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 150ms ease;
  }

  .modal-sheet {
    background: var(--bg-surface);
    width: 100%;
    max-width: 500px;
    border-radius: 20px 20px 0 0;
    padding: 24px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 20px;
    animation: slideUp 150ms ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .modal-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    text-align: center;
  }

  .modal-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .plugin-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    text-align: center;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    justify-content: center;
  }

  .plugin-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .plugin-author {
    font-size: 14px;
    color: var(--text-muted);
  }

  .badge {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  }

  .badge.category {
    background: var(--bg-surface-2);
    color: var(--text-secondary);
    align-self: center;
  }

  .description {
    font-size: 14px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .status-banner {
    padding: 12px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 500;
    text-align: center;
  }

  .status-banner.verified {
    background: rgba(46, 204, 113, 0.15);
    color: var(--status-success);
    border: 1px solid rgba(46, 204, 113, 0.3);
  }

  .status-banner.warning {
    background: rgba(241, 196, 15, 0.15);
    color: #f1c40f;
    border: 1px solid rgba(241, 196, 15, 0.3);
  }

  .status-banner.danger {
    background: rgba(231, 76, 60, 0.15);
    color: var(--status-danger);
    border: 1px solid rgba(231, 76, 60, 0.3);
  }

  .permissions-section {
    background: var(--bg-surface-2);
    padding: 16px;
    border-radius: 12px;
    border: 1px solid var(--border-subtle);
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .permissions-list {
    margin: 0;
    padding-left: 20px;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .source-section {
    background: var(--bg-surface-2);
    padding: 14px;
    border-radius: 12px;
    border: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .source-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    user-select: none;
  }

  .code-toggle {
    font-size: 12px;
    color: var(--accent-primary);
    font-weight: 500;
  }

  .source-code {
    background: var(--bg-app);
    padding: 10px;
    border-radius: 8px;
    font-family: monospace;
    font-size: 12px;
    color: var(--text-secondary);
    max-height: 180px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    border: 1px solid var(--border-subtle);
    margin: 0;
  }

  .modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }

  .btn {
    flex: 1;
    padding: 14px;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 150ms ease;
  }

  .btn:active {
    opacity: 0.8;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.cancel {
    background: var(--bg-surface-2);
    color: var(--text-primary);
  }

  .btn.install {
    background: var(--accent-primary);
    color: #fff;
  }
</style
