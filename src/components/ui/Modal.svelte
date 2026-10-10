<script>
  /**
   * Единая модалка: фон, Esc, заголовок, кнопка закрытия, слот footer.
   * @type {{
   *   open?: boolean, title?: string, size?: 'sm' | 'md' | 'lg',
   *   closeOnBackdrop?: boolean, showClose?: boolean, onclose?: () => void, class?: string,
   *   children?: import('svelte').Snippet, footer?: import('svelte').Snippet
   * }}
   */
  let {
    open = $bindable(false), title = '', size = 'md', closeOnBackdrop = true, showClose = true, closeOnEsc = true, bare = false, zIndex = 1000, position = 'center',
    onclose, class: className = '', children, footer
  } = $props();

  function close() { open = false; onclose?.(); }
  /** @param {KeyboardEvent} e */
  function onkeydown(e) { if (open && closeOnEsc && e.key === 'Escape') close(); }
  /** @param {MouseEvent} e */
  function onBackdrop(e) { if (closeOnBackdrop && e.target === e.currentTarget) close(); }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-backdrop" class:modal-backdrop--bottom={position === 'bottom'} style:z-index={zIndex} role="presentation" onclick={onBackdrop}>
    <div class="modal modal--{size} {className}" class:modal--bare={bare} role="dialog" aria-modal="true" aria-label={title || undefined}>
      {#if !bare && (title || showClose)}
        <header class="modal__header">
          <h2 class="modal__title">{title}</h2>
          {#if showClose}
            <button type="button" class="modal__close" aria-label="Закрыть" onclick={close}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          {/if}
        </header>
      {/if}
      <div class="modal__body">{@render children?.()}</div>
      {#if footer}<footer class="modal__footer">{@render footer()}</footer>{/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    display: flex; align-items: center; justify-content: center; padding: 16px;
    background: rgba(0, 0, 0, 0.5);
    animation: fade 0.15s ease;
  }
  .modal {
    display: flex; flex-direction: column; width: 100%; max-height: calc(100vh - 32px);
    background: var(--bg-sheet, #1c1c1e); color: var(--text-primary, #060708);
    border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    animation: pop 0.18s ease;
  }
  .modal-backdrop--bottom { align-items: flex-end; padding: 0; }
  .modal-backdrop--bottom .modal { animation: slideup 0.24s cubic-bezier(0.2, 0.8, 0.2, 1); }
  @keyframes slideup { from { transform: translateY(100%); } }
  .modal--sm { max-width: 360px; }
  .modal--md { max-width: 480px; }
  .modal--lg { max-width: 720px; }
  .modal__header { display: flex; align-items: center; gap: 8px; padding: 16px 16px 8px 20px; }
  .modal__title { flex: 1; margin: 0; font-size: 18px; font-weight: 600; }
  .modal__close {
    display: flex; align-items: center; justify-content: center; width: 32px; height: 32px;
    border: none; border-radius: 50%; background: none; color: var(--text-secondary, #999); cursor: pointer;
  }
  .modal__close:hover { background: var(--bg-surface-2, rgba(255,255,255,0.1)); }
  .modal__body { padding: 8px 20px 16px; overflow-y: auto; }
  .modal__footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 16px; }
  .modal--bare { background: none; box-shadow: none; max-width: none; width: auto; max-height: none; border-radius: 0; overflow: visible; }
  .modal--bare .modal__body { padding: 0; overflow: visible; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: scale(0.96); } }
</style>
