<script>
  /**
   * Вкладка / сегмент / чип. Контейнер (ряд вкладок) остаётся в месте использования.
   * variant: 'underline' — вкладки с подчёркиванием, 'segment' — сегментированный переключатель,
   *          'pill' — чипы/фильтры.
   * @type {{ variant?: 'underline' | 'segment' | 'pill', active?: boolean, disabled?: boolean,
   *   onclick?: (e: MouseEvent) => void, class?: string, children?: import('svelte').Snippet, [key: string]: any }}
   */
  let { variant = 'underline', active = false, disabled = false, onclick, class: className = '', children, ...rest } = $props();
</script>

<button
  type="button"
  role="tab"
  aria-selected={active}
  class="tab tab--{variant} {className}"
  class:tab--active={active}
  {disabled}
  {onclick}
  {...rest}
>
  {@render children?.()}
</button>

<style>
  .tab {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 32px; padding: 6px 12px; border: none; background: transparent;
    color: var(--text-muted); font: inherit; font-size: 14px; font-weight: 500; white-space: nowrap;
    cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
    transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }
  .tab:disabled { opacity: 0.5; cursor: default; }
  .tab:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
  .tab:hover:not(:disabled):not(.tab--active) { color: var(--text-primary); }

  .tab--underline { border-radius: 0; border-bottom: 2px solid transparent; }
  .tab--underline.tab--active { color: var(--accent-primary); border-bottom-color: var(--accent-primary); }

  .tab--segment { flex: 1; border-radius: 9px; }
  .tab--segment.tab--active { background: var(--bg-sheet); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }

  .tab--pill { border-radius: 999px; background: var(--bg-surface); color: var(--text-secondary); }
  .tab--pill.tab--active { background: var(--accent-subtle); color: var(--accent-primary); }
</style>
