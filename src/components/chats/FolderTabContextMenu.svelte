<script>
  export let folder;
  export let onAction = null;
  export let close = () => {};

  function handleSelect(action) {
    if (onAction) onAction(action);
    close();
  }
</script>

<div class="folder-context-menu" role="menu">
  {#if folder && folder.id !== 0 && folder.id !== "all.chat.folder"}
    <button type="button" class="folder-menu-item" on:click={() => handleSelect("edit")}>
      <img src="/icons/edit.svg" width="18" height="18" alt="" class="theme-icon" />
      <span>Изменить</span>
    </button>
  {/if}
  <button type="button" class="folder-menu-item" on:click={() => handleSelect("read")}>
    <img src="/icons/status-read.svg" width="18" height="18" alt="" class="theme-icon" />
    <span>Прочитать все</span>
  </button>
  {#if folder && folder.id !== 0 && folder.id !== "all.chat.folder"}
    <button type="button" class="folder-menu-item danger" on:click={() => handleSelect("delete")}>
      <img src="/icons/trash.svg" width="18" height="18" alt="" class="theme-icon" />
      <span>Удалить</span>
    </button>
  {/if}
</div>

<style>
  .folder-context-menu {
    min-width: 170px;
    background: var(--bg-surface-elevated, #232429);
    border-radius: 12px;
    padding: 6px 0;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    display: flex;
    flex-direction: column;
    user-select: none;
    overflow: hidden;
  }

  .folder-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 16px;
    border: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;
  }

  .folder-menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .folder-menu-item.danger {
    color: var(--danger, #ff4d4f);
  }

  .folder-menu-item img {
    flex-shrink: 0;
  }
</style>
