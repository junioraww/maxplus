<script>
  import { onMount, onDestroy } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let mode = "sheet";
  export let title = "";
  export let maxHeight = "85vh";
  export let showClose = true;
  export let showHandle = true;
  export let showHeader = true;
  export let html = "";
  export let className = "";
  export let onMountCallback = null;
  export let close = null;
  export let setBackHandler = null;

  let containerEl = null;
  let pluginCleanup = null;
  let unregisterBack = null;
  let currentTitle = title;
  let customBackFn = null;

  function handleClose(result) {
    if (close) close(result);
  }

  $: if (mode !== "sheet" && setBackHandler) {
    setBackHandler(() => {
      if (typeof customBackFn === "function") {
        const res = customBackFn();
        if (res === false) return false;
      }
      handleClose(false);
      return false;
    });
  }

  onMount(() => {
    if (mode !== "sheet" && !setBackHandler) {
      unregisterBack = registerBackHandler(() => {
        if (typeof customBackFn === "function") {
          const res = customBackFn();
          if (res === false) return false;
        }
        handleClose(false);
        return false;
      });
    }

    if (containerEl && typeof onMountCallback === "function") {
      try {
        const controller = {
          close: (res) => handleClose(res),
          setTitle: (nextTitle) => {
            currentTitle = nextTitle || "";
          },
          setHtml: (nextHtml) => {
            if (containerEl) containerEl.innerHTML = nextHtml || "";
          },
          setBackHandler: (fn) => {
            customBackFn = fn;
          },
        };
        pluginCleanup = onMountCallback(containerEl, controller);
      } catch (e) {
        console.error("[plugin-portal] onMount error:", e);
      }
    }
  });

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
    if (typeof pluginCleanup === "function") {
      try {
        pluginCleanup();
      } catch (e) {
        console.error("[plugin-portal] cleanup error:", e);
      }
    }
  });
</script>

{#if mode === "sheet"}
  <BottomSheet
    title={currentTitle}
    {maxHeight}
    {showClose}
    {showHandle}
    {close}
    {setBackHandler}
  >
    <div
      class="plugin-portal-body {className}"
      bind:this={containerEl}
    >
      {@html html}
    </div>
  </BottomSheet>
{:else if mode === "tab"}
  <div class="plugin-portal-screen {className}">
    {#if showHeader && currentTitle}
      <div class="plugin-portal-topbar">
        <div class="plugin-portal-title">{currentTitle}</div>
      </div>
    {/if}
    <div class="plugin-portal-screen-content" bind:this={containerEl}>
      {@html html}
    </div>
  </div>
{:else if mode === "screen"}
  <div class="plugin-portal-screen {className}">
    {#if showHeader}
      <div class="plugin-portal-topbar">
        <button
          type="button"
          class="plugin-portal-back"
          on:click={() => handleClose(false)}
          aria-label="Назад"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <div class="plugin-portal-title">{currentTitle}</div>
        <div class="plugin-portal-topbar-spacer"></div>
      </div>
    {/if}
    <div class="plugin-portal-screen-content" bind:this={containerEl}>
      {@html html}
    </div>
  </div>
{:else}
  <div
    class="plugin-portal-dialog {className}"
    role="dialog"
    aria-modal="true"
  >
    {#if currentTitle || showClose}
      <div class="plugin-portal-dialog-header">
        <h3 class="plugin-portal-dialog-title">{currentTitle}</h3>
        {#if showClose}
          <button
            type="button"
            class="plugin-portal-close"
            on:click={() => handleClose(false)}
            aria-label="Закрыть"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        {/if}
      </div>
    {/if}
    <div class="plugin-portal-dialog-body" bind:this={containerEl}>
      {@html html}
    </div>
  </div>
{/if}

<style>
  .plugin-portal-body {
    width: 100%;
    color: var(--text-primary, #ffffff);
  }

  .plugin-portal-screen {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-app, #17181c);
    color: var(--text-primary, #ffffff);
    overflow: hidden;
  }

  .plugin-portal-topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: calc(10px + var(--safe-top, 0px)) 14px 10px;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    background: var(--bg-surface, #1e2025);
    flex-shrink: 0;
  }

  .plugin-portal-back,
  .plugin-portal-close {
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary, #ffffff);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .plugin-portal-back:hover,
  .plugin-portal-close:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .plugin-portal-title {
    flex: 1;
    font-size: 17px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plugin-portal-topbar-spacer {
    width: 34px;
    flex-shrink: 0;
  }

  .plugin-portal-screen-content {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px calc(20px + var(--safe-bottom, 0px));
  }

  .plugin-portal-dialog {
    width: min(92vw, 440px);
    max-height: 85vh;
    background: var(--bg-surface, #1e2025);
    border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text-primary, #ffffff);
  }

  .plugin-portal-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .plugin-portal-dialog-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .plugin-portal-dialog-body {
    padding: 14px 16px 16px;
    overflow-y: auto;
  }
</style>
