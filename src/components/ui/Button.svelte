<script>
  import Spinner from './Spinner.svelte';
  /**
   * Базовая кнопка приложения. Используй её вместо <button class="..."> на страницах.
   * @type {{
   *   variant?: 'primary' | 'secondary' | 'danger' | 'ghost',
   *   size?: 'sm' | 'md' | 'lg',
   *   full?: boolean, loading?: boolean, disabled?: boolean,
   *   href?: string, type?: 'button' | 'submit' | 'reset',
   *   onclick?: (e: MouseEvent) => void, class?: string,
   *   icon?: import('svelte').Snippet, children?: import('svelte').Snippet,
   *   [key: string]: any
   * }}
   */
  let {
    variant = 'primary', size = 'md', full = false, loading = false, disabled = false,
    href, type = 'button', onclick, class: className = '', icon, children, ...rest
  } = $props();
  const cls = $derived(`btn btn--${variant} btn--${size} ${full ? 'btn--full' : ''} ${className}`);
</script>

{#if href && !disabled}
  <a {href} class={cls} {onclick} {...rest}>
    {#if icon}<span class="btn__icon">{@render icon()}</span>{/if}
    {@render children?.()}
  </a>
{:else}
  <button {type} class={cls} disabled={disabled || loading} aria-busy={loading} {onclick} {...rest}>
    {#if loading}<Spinner size={16} />{:else if icon}<span class="btn__icon">{@render icon()}</span>{/if}
    {@render children?.()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    border: none; border-radius: 12px; font: inherit; font-weight: 500;
    cursor: pointer; text-decoration: none; user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: background 0.15s ease, opacity 0.15s ease, transform 0.1s ease;
  }
  .btn:active:not(:disabled) { transform: scale(0.98); }
  .btn:focus-visible { outline: 2px solid var(--stroke-themed, #007aff); outline-offset: 2px; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn--full { width: 100%; }
  .btn--sm { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 10px; }
  .btn--md { height: 40px; padding: 0 16px; font-size: 15px; }
  .btn--lg { height: 48px; padding: 0 20px; font-size: 16px; border-radius: 14px; }
  .btn--primary { background: var(--accent-primary, #007aff); color: #fff; }
  .btn--primary:hover:not(:disabled) { opacity: 0.9; }
  .btn--secondary { background: var(--bg-surface, rgba(255,255,255,0.08)); color: var(--text-primary, #060708); }
  .btn--secondary:hover:not(:disabled) { background: var(--bg-surface-2, rgba(255,255,255,0.14)); }
  .btn--danger { background: var(--status-danger, #ff3b30); color: #fff; }
  .btn--danger:hover:not(:disabled) { opacity: 0.9; }
  .btn--ghost { background: transparent; color: var(--accent-primary, #007aff); }
  .btn--ghost:hover:not(:disabled) { background: var(--bg-surface-2, rgba(255,255,255,0.08)); }
  .btn__icon { display: inline-flex; }
</style>
