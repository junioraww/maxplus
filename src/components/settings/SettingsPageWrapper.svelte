<script>
  import { goto } from "$app/navigation";
  import { onMount, createEventDispatcher } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let title = "";
  export let from = "/?card=settings";
  export let isTab = false;
  export let canSwipe = () => true;
  $: void canSwipe;
  export let onBeforeClose = null;
  export let onClose = null;

  const dispatch = createEventDispatcher();

  let isClosing = false;

  function finishClose() {
    dispatch("close");
    if (onClose) {
      onClose();
    } else if (!isTab && from) {
      if (typeof window !== "undefined" && window.location.pathname.startsWith("/settings")) {
        goto(from);
      }
    }
  }

  export async function close() {
    if (isClosing) return;
    if (onBeforeClose) {
      await onBeforeClose();
    }
    isClosing = true;
    finishClose();
  }

  onMount(() => {
    let unregisterBack = null;
    if (!isTab && !onClose && typeof window !== "undefined" && window.location.pathname.startsWith("/settings")) {
      unregisterBack = registerBackHandler(() => {
        close();
        return true;
      });
    }

    return () => {
      if (unregisterBack) unregisterBack();
    };
  });
</script>

{#if isTab}
  <div class="settings-page-tab">
    <slot {close} />
  </div>
{:else}
  <div class="settings-page-wrapper">
    <div class="settings-topbar">
      <button class="settings-back-btn" on:click={close} aria-label="Назад">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>

      {#if title}
        <div class="settings-topbar-title">{title}</div>
      {:else}
        <slot name="title" />
      {/if}

      <div class="settings-topbar-extra">
        <slot name="header-extra" />
      </div>
    </div>

    <div class="settings-page-content">
      <slot {close} />
    </div>

    <slot name="footer" {close} />
  </div>
{/if}

<style>
  .settings-page-tab {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-app);
    color: var(--text-primary);
  }

  .settings-page-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    max-height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-app);
    color: var(--text-primary);
  }

  .settings-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: calc(52px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0;
    background: var(--bg-topbar);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    z-index: var(--z-header, 4);
  }

  .settings-back-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
    flex-shrink: 0;
  }

  .settings-back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary);
  }

  .settings-back-btn:active {
    transform: scale(0.92);
  }

  .settings-topbar-title {
    color: var(--text-primary);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.2px;
    flex: 1;
    margin: 0 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-topbar-extra {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .settings-page-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    padding-bottom: max(16px, calc(16px + var(--safe-bottom, 0px)));
  }
</style>
