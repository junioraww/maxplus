<script>
  /**
   * Пустое состояние списка/страницы.
   * @type {{ title: string, description?: string, class?: string, icon?: import('svelte').Snippet, action?: import('svelte').Snippet }}
   */
  let { title, description, class: className = '', icon, action } = $props();
</script>

<div class="empty {className}">
  {#if icon}<div class="empty__icon">{@render icon()}</div>{/if}
  <p class="empty__title">{title}</p>
  {#if description}<p class="empty__desc">{description}</p>{/if}
  {#if action}<div class="empty__action">{@render action()}</div>{/if}
</div>

<style>
  .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 40px 24px; text-align: center; }
  .empty__icon { color: var(--text-secondary, #999); margin-bottom: 8px; }
  .empty__title { margin: 0; font-size: 16px; font-weight: 500; color: var(--text-primary, #060708); }
  .empty__desc { margin: 0; font-size: 14px; color: var(--text-secondary, #999); }
  .empty__action { margin-top: 12px; }
</style>
