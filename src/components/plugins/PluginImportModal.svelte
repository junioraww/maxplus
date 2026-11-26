<script>
  import { getContext } from "svelte";
  import { pluginImportModal, closePluginImportModal } from "$lib/stores/plugins";

  const inPortal = Boolean(getContext("appPortalHost"));
  import { APP_VERSION, installPlugin } from "$lib/plugins/runtime";
  import { satisfies } from "$lib/plugins/semver";
  import { PERMISSION_LABELS, CATEGORY_LABELS } from "$lib/plugins/manifest";
  import { showAlert } from "$lib/utils/alert";

  export let data = null;
  export let close = null;
  export let onClose = null;
  export let setBackHandler = null;

  let isInstalling = false;

  $: modalData = data || $pluginImportModal;

  $: isCompatible = satisfies(
    APP_VERSION,
    modalData?.manifest?.minAppVersion,
    modalData?.manifest?.maxAppVersion
  );

  $: iconContent = modalData?.iconContent || null;

  $: if (setBackHandler) {
    setBackHandler(() => {
      handleCancel();
      return false;
    });
  }

  function getAuthor(author) {
    if (!author) return "";
    if (typeof author === "string") return author;
    return author.name || "";
  }

  async function handleInstall() {
    if (isInstalling || !isCompatible || !modalData?.arrayBuffer) return;
    isInstalling = true;
    try {
      await installPlugin(modalData.arrayBuffer);
      showAlert("Плагин установлен");
      if (typeof close === "function") {
        close(true);
      } else if (typeof onClose === "function") {
        onClose(true);
      }
      closePluginImportModal();
    } catch (error) {
      showAlert(error.message);
    } finally {
      isInstalling = false;
    }
  }

  function handleCancel() {
    if (typeof close === "function") {
      close(false);
    } else if (typeof onClose === "function") {
      onClose(false);
    }
    closePluginImportModal();
  }
</script>

{#if modalData}
  <div
    class="modal-backdrop"
    class:is-portal-child={Boolean(setBackHandler || inPortal)}
    on:click={handleCancel}
  >
    <div class="modal-sheet" on:click|stopPropagation>
      <div class="modal-header">
        <h2>Установить плагин</h2>
      </div>

      <div class="modal-content">
        <div class="plugin-info-header">
          {#if iconContent}
            {#if iconContent.trim().startsWith('<svg')}
              <div class="plugin-modal-icon-svg">{@html iconContent}</div>
            {:else}
              <img class="plugin-modal-icon-img" src={iconContent} alt="" />
            {/if}
          {:else}
            <div class="plugin-modal-icon-fallback">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
          {/if}
          <div class="plugin-info">
            {#if getAuthor(modalData.manifest.author)}
              <span class="plugin-author">{getAuthor(modalData.manifest.author)}</span>
            {/if}
            <span class="plugin-name">{modalData.manifest.name}</span>
            {#if modalData.manifest.category}
              <span class="badge category">{CATEGORY_LABELS[modalData.manifest.category] || modalData.manifest.category}</span>
            {/if}
            <div class="description">{modalData.manifest.description}</div>
          </div>
        </div>

        {#if !isCompatible}
          <div class="status-banner incompatible">
            ⚠ Несовместимая версия: требуется Max+ {modalData.manifest.minAppVersion || ''} (у вас установлена {APP_VERSION})
          </div>
        {/if}

        {#if modalData.verificationStatus === 'verified'}
          <div class="status-banner verified">
            ✓ Проверен командой Max+
          </div>
        {:else if modalData.verificationStatus === 'unverified_version'}
          <div class="status-banner warning">
            ⚠ Эта версия не проверена
          </div>
        {:else}
          <div class="status-banner danger">
            ⚠ Плагин не найден в каталоге Max+. Устанавливайте только из доверенных источников.
          </div>
        {/if}

        {#if modalData.manifest.permissions && modalData.manifest.permissions.length > 0}
          <div class="permissions-section">
            <div class="section-title">Запрашиваемые разрешения:</div>
            <ul class="permissions-list">
              {#each modalData.manifest.permissions as perm}
                <li>{PERMISSION_LABELS[perm] || perm}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>

      <div class="modal-actions">
        <button class="btn cancel" on:click={handleCancel} disabled={isInstalling}>Отмена</button>
        <button class="btn install" on:click={handleInstall} disabled={isInstalling || !isCompatible}>
          {#if !isCompatible}
            Не поддерживается
          {:else}
            {isInstalling ? 'Установка...' : 'Установить'}
          {/if}
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
    z-index: var(--z-modal, 7);
    animation: fadeIn 150ms ease;
  }

  .modal-backdrop.is-portal-child {
    position: relative;
    top: auto;
    left: auto;
    inset: auto;
    width: 100%;
    height: auto;
    background: transparent;
    z-index: auto;
    animation: none;
    display: block;
  }

  .modal-backdrop.is-portal-child .modal-sheet {
    animation: none;
    max-width: 100%;
  }

  .modal-sheet {
    background: var(--bg-surface);
    width: 100%;
    max-width: 500px;
    border-radius: 20px 20px 0 0;
    padding: 24px 24px calc(24px + var(--safe-bottom, env(safe-area-inset-bottom, 0px)));
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

  .plugin-info-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }

  .plugin-modal-icon-svg {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
    box-sizing: border-box;
  }

  .plugin-modal-icon-svg :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  .plugin-modal-icon-img {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    object-fit: contain;
    background: var(--bg-surface-2);
  }

  .plugin-modal-icon-fallback {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: var(--bg-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-primary);
  }

  .plugin-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    text-align: center;
  }

  .plugin-author {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }

  .plugin-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    word-break: break-word;
    max-width: 100%;
    line-height: 1.3;
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

  .status-banner.incompatible {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
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
