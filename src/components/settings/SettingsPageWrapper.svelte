<script>
  import { goto } from "$app/navigation";
  import { onMount, createEventDispatcher } from "svelte";
  import { swipeToClose } from "$components/ChatWindow/swipeToClose.js";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  export let title = "";
  export let from = "/?card=settings";
  export let isTab = false;
  export let canSwipe = () => true;
  export let onBeforeClose = null;
  export let onClose = null;

  const dispatch = createEventDispatcher();

  let currentDragX = 0;
  let isSwiping = false;
  let isClosingBySwipe = false;
  let isClosing = false;
  let isOpening = true;

  function finishClose() {
    dispatch("close");
    if (onClose) {
      onClose();
    } else if (from) {
      goto(from);
    }
  }

  export async function close() {
    if (isClosing || isClosingBySwipe) return;
    if (onBeforeClose) {
      await onBeforeClose();
    }
    isClosing = true;
    setTimeout(() => {
      finishClose();
    }, 260);
  }

  function handleSwipeClose() {
    if (onBeforeClose) {
      onBeforeClose();
    }
    finishClose();
  }

  function handleAnimationEnd() {
    isOpening = false;
  }

  onMount(() => {
    const timer = setTimeout(() => {
      isOpening = false;
    }, 280);

    let unregisterBack = null;
    if (!isTab) {
      unregisterBack = registerBackHandler(() => {
        close();
      });
    }

    return () => {
      clearTimeout(timer);
      if (unregisterBack) unregisterBack();
    };
  });

  $: swipeStyle = isSwiping && currentDragX > 0 ? `transform: translate3d(${currentDragX}px, 0, 0);` : "";
</script>

{#if isTab}
  <div class="settings-page-tab">
    <slot {close} />
  </div>
{:else}
  <div
    class="settings-page-wrapper"
    class:opening={isOpening}
    class:swiping={isSwiping}
    class:closing={isClosing || isClosingBySwipe}
    style={swipeStyle}
    on:animationend={handleAnimationEnd}
    use:swipeToClose={{
      canSwipe: () => !isClosing && !isClosingBySwipe && canSwipe(),
      onClose: handleSwipeClose,
      onStateChange: (state) => {
        currentDragX = state.currentDragX;
        isSwiping = state.isSwipingChat;
        isClosingBySwipe = state.isClosingBySwipe;
      },
    }}
  >
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
    background-color: #1a1a1f;
    color: #ffffff;
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
    background-color: #1a1a1f;
    color: #ffffff;
    will-change: transform;
    transform: translate3d(0, 0, 0);
    box-shadow: -4px 0 25px rgba(0, 0, 0, 0.45);
  }

  .settings-page-wrapper.opening {
    animation: slideInRight 0.26s cubic-bezier(0.25, 1, 0.5, 1) forwards;
  }

  .settings-page-wrapper.swiping {
    transition: none !important;
    animation: none !important;
  }

  .settings-page-wrapper.closing {
    transform: translate3d(100%, 0, 0) !important;
    transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1) !important;
    animation: none !important;
  }

  .settings-page-wrapper:not(.opening):not(.swiping):not(.closing) {
    transition: transform 0.24s cubic-bezier(0.32, 0.72, 0, 1);
  }

  .settings-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 52px;
    padding: 0 12px;
    background: #212126;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    z-index: 10;
  }

  .settings-back-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #aaaaaa;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
    flex-shrink: 0;
  }

  .settings-back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .settings-back-btn:active {
    transform: scale(0.92);
  }

  .settings-topbar-title {
    color: #ffffff;
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
  }

  @keyframes slideInRight {
    from {
      transform: translate3d(100%, 0, 0);
    }
    to {
      transform: translate3d(0, 0, 0);
    }
  }
</style>
