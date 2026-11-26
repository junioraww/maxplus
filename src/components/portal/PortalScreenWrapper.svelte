<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let title = "";
  export let subtitle = "";
  export let showHeader = true;
  export let showBack = true;
  export let scrollable = true;
  export let close = null;
  export let setBackHandler = null;
  export let onBack = null;
  export let bg = "var(--bg-app)";

  const dispatch = createEventDispatcher();
  let unregisterBack = null;

  async function handleBack() {
    if (typeof onBack === "function") {
      const res = await onBack();
      if (res === false) return false;
    }
    dispatch("back");
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
    return false;
  }

  $: if (typeof setBackHandler === "function") {
    setBackHandler(() => handleBack());
  }

  onMount(() => {
    if (!setBackHandler && typeof close === "function") {
      unregisterBack = registerBackHandler(() => handleBack());
    }
  });

  onDestroy(() => {
    if (typeof unregisterBack === "function") {
      unregisterBack();
      unregisterBack = null;
    }
  });
</script>

<div class="portal-screen-wrapper" style:--psw-bg={bg}>
  {#if showHeader}
    <header class="psw-topbar">
      {#if showBack}
        <button
          type="button"
          class="psw-back-btn"
          on:click={handleBack}
          aria-label="Назад"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
      {/if}

      <div class="psw-title-area">
        {#if title}
          <div class="psw-title">{title}</div>
          {#if subtitle}
            <div class="psw-subtitle">{subtitle}</div>
          {/if}
        {:else}
          <slot name="title" />
        {/if}
      </div>

      <div class="psw-extra">
        <slot name="header-extra" />
      </div>
    </header>
  {/if}

  <div class="psw-body" class:scrollable>
    <slot {close} {handleBack} />
  </div>

  <slot name="footer" {close} {handleBack} />
</div>

<style>
  .portal-screen-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--psw-bg, var(--bg-app));
    color: var(--text-primary);
    font-family: var(--font-family-base);
    box-sizing: border-box;
  }

  .psw-topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: calc(var(--settings-topbar-height, 56px) + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0;
    background: var(--bg-topbar, var(--bg-surface));
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    box-sizing: border-box;
    z-index: var(--z-header, 4);
  }

  .psw-back-btn {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--icon-primary, var(--text-primary));
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s ease;
  }

  .psw-back-btn:hover {
    background: var(--bg-hover);
  }

  .psw-title-area {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .psw-title {
    font-family: var(--font-family-title);
    font-size: var(--font-size-toolbar, 17px);
    line-height: var(--line-height-toolbar, 24px);
    font-weight: var(--font-weight-title, 600);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .psw-subtitle {
    font-size: 12px;
    line-height: 15px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .psw-extra {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .psw-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .psw-body.scrollable {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
</style>
