<script>
  /**
   * Строка списка (настройки, контакты, меню). Кликабельна, если передан onclick или href.
   * @type {{
   *   title: string, subtitle?: string, href?: string, chevron?: boolean, danger?: boolean,
   *   onclick?: (e: MouseEvent) => void, class?: string,
   *   leading?: import('svelte').Snippet, trailing?: import('svelte').Snippet
   * }}
   */
  let { title, subtitle, href, chevron = false, danger = false, disabled = false, wrap = false, onclick, class: className = '', leading, trailing } = $props();
  const tag = $derived(href ? 'a' : onclick ? 'button' : 'div');
</script>

<svelte:element
  this={tag}
  {href}
  type={tag === 'button' ? 'button' : undefined}
  class="list-item {className}"
  class:list-item--interactive={tag !== 'div'}
  class:list-item--danger={danger}
  class:list-item--disabled={disabled}
  class:list-item--wrap={wrap}
  aria-disabled={disabled || undefined}
  {onclick}
  role={tag === 'div' ? 'listitem' : undefined}
>
  {#if leading}<span class="list-item__leading">{@render leading()}</span>{/if}
  <span class="list-item__text">
    <span class="list-item__title">{title}</span>
    {#if subtitle}<span class="list-item__subtitle">{subtitle}</span>{/if}
  </span>
  {#if trailing}<span class="list-item__trailing">{@render trailing()}</span>{/if}
  {#if chevron}
    <svg class="list-item__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6" /></svg>
  {/if}
</svelte:element>

<style>
  .list-item {
    display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box;
    min-height: 48px; padding: 10px 16px; border: none; background: none; text-align: left;
    font: inherit; color: var(--text-primary, #060708); text-decoration: none;
  }
  .list-item--interactive { cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background 0.15s ease; }
  .list-item--interactive:hover { background: var(--bg-surface-2, rgba(255,255,255,0.06)); }
  .list-item--danger { color: var(--status-danger, #ff3b30); }
  .list-item--disabled { opacity: 0.4; pointer-events: none; }
  .list-item--wrap { align-items: center; }
  .list-item--wrap .list-item__text { gap: 4px; }
  .list-item--wrap .list-item__title { white-space: normal; font-size: 1rem; font-weight: 500; }
  .list-item--wrap .list-item__subtitle { white-space: normal; font-size: 0.82rem; }
  .list-item__leading, .list-item__trailing { display: flex; align-items: center; flex-shrink: 0; }
  .list-item__text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .list-item__title { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list-item__subtitle { font-size: 13px; color: var(--text-secondary, #999); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list-item__chevron { color: var(--text-secondary, #999); flex-shrink: 0; }
</style>
