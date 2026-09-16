<script>
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
      <button type="button" class="close-btn" onclick={onClose}>✕</button>
    </div>
    <div class="commands-list">
      {#each filtered as cmd}
        <button
          type="button"
          class="command-item"
          onclick={() => onSelect(cmd)}
        >
          <span class="cmd-name">/{cmd.name.replace(/^\//, "")}</span>
          {#if cmd.description}
            <span class="cmd-desc">{cmd.description}</span>
          {/if}
        </button>
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
    border: 1px solid rgba(255, 255, 255, 0.1);
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
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .menu-title {
    font-size: 12px;
    font-weight: 600;
    color: #8e8e93;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .close-btn {
    background: none;
    border: none;
    color: #8e8e93;
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .commands-list {
    overflow-y: auto;
    max-height: 200px;
    padding: 4px;
  }

  .command-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    background: none;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 14px;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;
  }

  .command-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .cmd-name {
    font-weight: 600;
    color: #248bfe;
    flex-shrink: 0;
  }

  .cmd-desc {
    color: #8e8e93;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
