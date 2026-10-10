<script>
  /**
   * Пункт меню (контекстные меню, шиты, дропдауны).
   * Иконка — snippet `icon`, подпись — children, справа — snippet `trailing` (шорткат, стрелка).
   * preventPointer: preventDefault + stopPropagation на pointerdown (не терять фокус/выделение в инпуте).
   * @type {{
   *   active?: boolean, checked?: boolean, danger?: boolean, disabled?: boolean, preventPointer?: boolean,
   *   onclick?: (e: MouseEvent) => void, onpointerdown?: (e: PointerEvent) => void, class?: string,
   *   icon?: import('svelte').Snippet, trailing?: import('svelte').Snippet, children?: import('svelte').Snippet,
   *   [key: string]: any
   * }}
   */
  let {
    active = false, checked = false, danger = false, disabled = false, preventPointer = false,
    onclick, onpointerdown, class: className = '', icon, trailing, children, ...rest
  } = $props();

  function handlePointerDown(e) {
    if (preventPointer) { e.preventDefault(); e.stopPropagation(); }
    onpointerdown?.(e);
  }
</script>

<button
  type="button"
  role="menuitem"
  class="menu-item {className}"
  class:menu-item--active={active}
  class:menu-item--danger={danger}
  {disabled}
  {onclick}
  onpointerdown={handlePointerDown}
  {...rest}
>
  {#if icon}<span class="menu-item__icon">{@render icon()}</span>{/if}
  <span class="menu-item__label">{@render children?.()}</span>
  {#if trailing}<span class="menu-item__trailing">{@render trailing()}</span>{/if}
  {#if checked}
    <span class="menu-item__check" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
    </span>
  {/if}
</button>

<style>
  .menu-item {
    display: flex; align-items: center; gap: 12px;
    width: 100%; min-height: 40px; padding: 8px 12px;
    border: none; border-radius: 10px; background: transparent;
    color: var(--text-primary); font: inherit; font-size: 15px; text-align: left;
    cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .menu-item:hover:not(:disabled) { background: var(--bg-surface); }
  .menu-item:active:not(:disabled) { background: var(--bg-surface-2); }
  .menu-item:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: -2px; }
  .menu-item:disabled { opacity: 0.5; cursor: default; }
  .menu-item--active { color: var(--accent-primary); }
  .menu-item--danger { color: var(--status-danger); }
  .menu-item__icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; flex-shrink: 0; color: var(--text-muted);
  }
  .menu-item__icon :global(svg) { width: 20px; height: 20px; }
  .menu-item--active .menu-item__icon, .menu-item--danger .menu-item__icon { color: currentColor; }
  .menu-item__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-item__trailing { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 13px; }
  .menu-item__check { display: inline-flex; color: var(--accent-primary); }
</style>
