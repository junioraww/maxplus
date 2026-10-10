<script>
  /**
   * Контейнер меню: карточка с тенью, внутри — MenuItem.
   * @type {{ class?: string, children?: import('svelte').Snippet, [key: string]: any }}
   */
  let { class: className = '', children, ...rest } = $props();
</script>

<div role="menu" class="menu {className}" {...rest}>
  {@render children?.()}
</div>

<style>
  .menu {
    display: flex; flex-direction: column; gap: 2px;
    min-width: 200px; padding: 6px;
    background: var(--bg-sheet); border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--border-subtle);
  }
  .menu :global(hr) { margin: 4px 8px; border: none; border-top: 1px solid var(--border-subtle); }
</style>
