<script>
  import IconButton from './IconButton.svelte';
  /**
   * Шапка страницы: «назад», заголовок, действия справа.
   * @type {{ title: string, subtitle?: string, onback?: () => void, backHref?: string, class?: string, actions?: import('svelte').Snippet }}
   */
  let { title, subtitle, onback, backHref, class: className = '', actions } = $props();
  function back() { if (onback) onback(); else if (backHref) location.href = backHref; else history.back(); }
</script>

<header class="page-header {className}">
  {#if onback || backHref}
    <IconButton aria-label="Назад" onclick={back}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 18-6-6 6-6" /></svg>
    </IconButton>
  {/if}
  <div class="page-header__text">
    <h1 class="page-header__title">{title}</h1>
    {#if subtitle}<span class="page-header__subtitle">{subtitle}</span>{/if}
  </div>
  {#if actions}<div class="page-header__actions">{@render actions()}</div>{/if}
</header>

<style>
  .page-header { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 8px 12px; }
  .page-header__text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .page-header__title { margin: 0; font-size: 20px; font-weight: 600; color: var(--text-primary, #060708); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .page-header__subtitle { font-size: 13px; color: var(--text-secondary, #999); }
  .page-header__actions { display: flex; align-items: center; gap: 4px; }
</style>
