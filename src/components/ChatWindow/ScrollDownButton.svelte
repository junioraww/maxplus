<script>
  import { createEventDispatcher } from "svelte";
  import { fade } from "svelte/transition";

  export let showScrollDown = false;
  export let chatType = "";
  export let hasReply = false;
  export let showStickerPanel = false;
  export let unreadBadgeCount = 0;

  const dispatch = createEventDispatcher();

  function handleClick() {
    dispatch("click");
  }
</script>

{#if showScrollDown}
  <div
    in:fade={{ duration: 100 }}
    out:fade={{ duration: 100 }}
    class="scroll-down-container"
    class:nije={chatType === "CHANNEL"}
    class:vise={hasReply}
    class:with-stickers={showStickerPanel}
  >
    <button
      class="scroll-down-btn"
      on:click={handleClick}
      aria-label="Scroll to bottom"
    >
      <svg viewBox="0 0 640 640">
        <path
          fill="#777"
          d="M297.4 470.6C309.9 483.1 330.2 483.1 342.7 470.6L534.7 278.6C547.2 266.1 547.2 245.8 534.7 233.3C522.2 220.8 501.9 220.8 489.4 233.3L320 402.7L150.6 233.4C138.1 220.9 117.8 220.9 105.3 233.4C92.8 245.9 92.8 266.2 105.3 278.7L297.3 470.7z"
        />
      </svg>
    </button>
    {#if unreadBadgeCount > 0}
      <div class="scroll-down-badge" on:click={handleClick} role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Enter') handleClick(); }}>
        {unreadBadgeCount > 99 ? "99+" : unreadBadgeCount}
      </div>
    {/if}
  </div>
{/if}

<style>
  .scroll-down-container {
    position: fixed;
    bottom: 80px;
    right: 10px;
    width: 55px;
    height: 55px;
    z-index: 100;
    transition: bottom 0.2s ease;
  }

  .scroll-down-container.nije {
    bottom: 20px;
  }

  .scroll-down-container.vise {
    bottom: 140px;
  }

  .scroll-down-container.with-stickers {
    bottom: 420px;
  }

  .scroll-down-container.with-stickers.vise {
    bottom: 480px;
  }

  .scroll-down-btn {
    width: 55px;
    height: 55px;
    background: #1e2024;
    opacity: 0.9;
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.1s;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .scroll-down-btn:hover {
    opacity: 1;
  }

  .scroll-down-btn svg {
    width: 36px;
  }

  .scroll-down-badge {
    position: absolute;
    top: -5px;
    left: -5px;
    min-width: 22px;
    height: 22px;
    box-sizing: border-box;
    padding: 0 5px;
    background: #2b7fc3;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    text-align: center;
    border-radius: 11px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
  }
</style>
