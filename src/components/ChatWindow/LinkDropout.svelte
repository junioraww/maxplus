<script>
  import { createEventDispatcher, onMount, tick } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { handleDeepLinkUrl } from "$lib/utils/deepLink.js";

  export let url = "";
  export let clientX = 0;
  export let clientY = 0;

  const dispatch = createEventDispatcher();
  let cardNode;
  let pos = { top: 0, left: 0 };
  let copied = false;

  async function adjustPosition() {
    await tick();
    if (!cardNode) return;
    const width = cardNode.offsetWidth || 260;
    const height = cardNode.offsetHeight || 120;
    const { innerWidth, innerHeight } = window;

    let x = clientX;
    let y = clientY;

    if (x + width > innerWidth - 12) {
      x = innerWidth - width - 12;
    }
    if (x < 12) x = 12;

    if (y + height > innerHeight - 12) {
      y = innerHeight - height - 12;
    }
    if (y < 12) y = 12;

    pos = { top: y, left: x };
  }

  onMount(() => {
    adjustPosition();
  });

  function close() {
    dispatch("close");
  }

  async function handleOpen() {
    close();
    if (!url) return;
    try {
      const handled = await handleDeepLinkUrl(url);
      if (handled) return;
    } catch (e) {
      console.error(e);
    }
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => {
        close();
      }, 500);
    } catch (e) {
      console.error(e);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      close();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="dropout-backdrop" on:click={close} transition:fade={{ duration: 120 }}></div>

<div
  class="link-dropout-card"
  bind:this={cardNode}
  style="top: {pos.top}px; left: {pos.left}px;"
  on:click|stopPropagation
  on:contextmenu|preventDefault|stopPropagation
  transition:scale={{ duration: 130, start: 0.95, opacity: 0 }}
>
  <div class="url-scroll-container">
    <span class="url-text" title={url}>{url}</span>
  </div>

  <div class="divider"></div>

  <div class="actions-container">
    <button type="button" class="action-btn" on:click={handleOpen}>
      <span class="btn-icon">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
        </svg>
      </span>
      <span class="btn-label">Открыть</span>
    </button>

    <button type="button" class="action-btn" class:is-copied={copied} on:click={handleCopy}>
      <span class="btn-icon">
        {#if copied}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
          </svg>
        {/if}
      </span>
      <span class="btn-label">{copied ? "Скопировано!" : "Копировать ссылку"}</span>
    </button>
  </div>
</div>

<style>
  .dropout-backdrop {
    position: fixed;
    inset: 0;
    z-index: 3999;
    background: transparent;
  }

  .link-dropout-card {
    position: fixed;
    z-index: 4000;
    max-width: 290px;
    min-width: 220px;
    background: rgba(28, 30, 42, 0.96);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 2px 10px rgba(0, 0, 0, 0.3);
    padding: 8px 0 6px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .url-scroll-container {
    padding: 4px 12px 6px;
    max-width: 100%;
    box-sizing: border-box;
    overflow-x: auto;
    overflow-y: hidden;
    white-space: nowrap;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .url-scroll-container::-webkit-scrollbar {
    height: 4px;
  }

  .url-scroll-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }

  .url-text {
    font-size: 12.5px;
    line-height: 18px;
    color: #60a5fa;
    user-select: text;
    display: inline-block;
  }

  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 4px 0 2px;
  }

  .actions-container {
    display: flex;
    flex-direction: column;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .action-btn:active {
    background: rgba(255, 255, 255, 0.15);
  }

  .action-btn.is-copied {
    color: #4ade80;
  }

  .btn-icon {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.8);
    flex-shrink: 0;
  }

  .action-btn.is-copied .btn-icon {
    color: #4ade80;
  }

  .btn-label {
    flex: 1;
    white-space: nowrap;
  }
</style>
