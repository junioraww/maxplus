<script>
  import { IconButton, MenuItem } from "$components/ui";
  let { commands = [], filter = "", onSelect, onClose } = $props();

  let filtered = $derived(
    commands.filter((cmd) => {
      if (!filter) return true;
      const q = filter.startsWith("/") ? filter.slice(1).toLowerCase() : filter.toLowerCase();
      return (
        cmd.name.toLowerCase().includes(q) ||
        (cmd.description && cmd.description.toLowerCase().includes(q))
      );
    })
  );
</script>

{#if filtered.length > 0}
  <div class="bot-commands-menu">
    <div class="menu-header">
      <span class="menu-title">Команды бота</span>
      <IconButton class="botcommandsmenu-close-btn" onclick={onClose}>✕</IconButton>
    </div>
    <div class="commands-list">
      {#each filtered as cmd}
        <MenuItem class="botcommandsmenu-command-item" onclick={() => onSelect(cmd)}><span class="cmd-name">/{cmd.name.replace(/^\//, "")}</span>
          {#if cmd.description}
            <span class="cmd-desc">{cmd.description}</span>
          {/if}</MenuItem>
      {/each}
    </div>
  </div>
{/if}

<style>
  .bot-commands-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 12px;
    right: 12px;
    max-height: 240px;
    background: #252830;
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 50;
  }

  .menu-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .menu-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }



  .commands-list {
    overflow-y: auto;
    max-height: 200px;
    padding: 4px;
  }

  :global(.botcommandsmenu-command-item)  { width: 100%; }


  .cmd-name {
    font-weight: 600;
    color: var(--accent-primary);
    flex-shrink: 0;
  }

  .cmd-desc {
    color: var(--text-muted);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
