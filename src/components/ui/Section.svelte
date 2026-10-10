<script>
  /**
   * Группа элементов с заголовком и подписью (как в настройках iOS/Max).
   * @type {{ title?: string, footer?: string, class?: string, children?: import('svelte').Snippet }}
   */
  let { title, footer, padded = false, class: className = '', children } = $props();
</script>

<section class="section {className}">
  {#if title}<h3 class="section__title">{title}</h3>{/if}
  <div class="section__body" class:section__body--padded={padded}>{@render children?.()}</div>
  {#if footer}<p class="section__footer">{footer}</p>{/if}
</section>

<style>
  .section { margin: 0; }
  .section__title { margin: 0 0 6px; padding: 0 16px; font-size: 13px; font-weight: 500; text-transform: uppercase; color: var(--text-secondary, #999); }
  .section__body { background: var(--bg-surface-2, rgba(255,255,255,0.04)); border: 1px solid var(--border-subtle, #333); border-radius: 12px; overflow: hidden; }
  .section__body--padded { padding: 16px; }
  .section__body:not(.section__body--padded) > :global(* + *) { border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.06)); }
  .section__footer { margin: 6px 0 0; padding: 0 16px; font-size: 12px; color: var(--text-secondary, #999); }
</style>
