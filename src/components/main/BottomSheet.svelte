<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let title = "";
  export let maxHeight = "85vh";
  export let showClose = true;
  export let showHandle = true;
  export let setBackHandler = null;
  export let close = null;

  const dispatch = createEventDispatcher();
  let isClosing = false;
  let unregisterBack = null;

  $: if (setBackHandler) {
    setBackHandler(() => {
      handleClose();
      return false;
    });
  }

  onMount(() => {
    if (!setBackHandler) {
      unregisterBack = registerBackHandler(() => {
        handleClose();
        return false;
      });
    }
  });

  function handleClose() {
    if (isClosing) return;
    isClosing = true;
    dispatch("close");
    if (close) close();
  }

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
  });
</script>

<div
  class="bottom-sheet-backdrop"
  class:is-portal-child={Boolean(setBackHandler || close)}
  class:sheet-closing={isClosing}
  on:click={handleClose}
  role="presentation"
>
  <div
    class="bottom-sheet-panel"
    class:sheet-closing={isClosing}
    style="max-height: {maxHeight};"
    on:click|stopPropagation
    role="dialog"
  >
    {#if showHandle}<div class="bottom-sheet-handle"></div>{/if}
    {#if title || showClose || $$slots.header}
      <div class="bottom-sheet-header">
        {#if $$slots.header}
          <slot name="header" />
        {:else}
          <h3 class="bottom-sheet-title">{title}</h3>
          {#if showClose}
            <button class="bottom-sheet-close" on:click={handleClose} aria-label="Закрыть" type="button">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          {/if}
        {/if}
      </div>
    {/if}
    <div class="bottom-sheet-content"><slot /></div>
    {#if $$slots.footer}<div class="bottom-sheet-footer"><slot name="footer" /></div>{/if}
  </div>
</div>

<style>
  .bottom-sheet-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: var(--z-modal, 7);
    display: flex;
    justify-content: center;
    align-items: flex-end;
  }

  .bottom-sheet-backdrop.is-portal-child {
    position: relative;
    inset: auto;
    width: 100%;
    background: transparent;
    z-index: auto;
  }

  .bottom-sheet-backdrop.is-portal-child .bottom-sheet-panel {
    animation: none;
    box-shadow: none;
  }

  .bottom-sheet-panel {
    width: 100%;
    max-width: 480px;
    background: var(--bg-surface, #1e2025);
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.5);
    padding-bottom: calc(16px + var(--safe-bottom, 0px));
    box-sizing: border-box;
    will-change: transform;
    animation: sheetSlideUp 0.24s cubic-bezier(0.2, 0, 0, 1) forwards;
  }

  .bottom-sheet-panel.sheet-closing {
    animation: sheetSlideDown 0.20s cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  @keyframes sheetSlideUp {
    from {
      transform: translate3d(0, 100%, 0);
    }
    to {
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes sheetSlideDown {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(0, 100%, 0);
    }
  }

  @keyframes sheetFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes sheetFadeOut {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  .bottom-sheet-handle {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.2);
    margin: 10px auto 4px;
    flex-shrink: 0;
  }

  .bottom-sheet-header {
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 16px 8px;
    flex-shrink: 0;
  }

  .bottom-sheet-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
  }

  .bottom-sheet-close {
    background: transparent;
    border: none;
    color: var(--text-secondary, #8b929e);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 50%;
  }

  .bottom-sheet-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px;
    -webkit-overflow-scrolling: touch;
  }

  .bottom-sheet-footer {
    padding: 12px 16px 0;
    flex-shrink: 0;
  }
</style>
