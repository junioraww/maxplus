<script>
  import { createEventDispatcher } from "svelte";
  import { STYLE_KEYS } from "$lib/formatting/constants.js";

  export let activeStyles = [];
  export let position = null;

  const dispatch = createEventDispatcher();

  let showLinkInput = false;
  let linkUrl = "";

  function triggerStyle(style) {
    if (style === STYLE_KEYS.LINK) {
      showLinkInput = !showLinkInput;
      linkUrl = "";
      return;
    }
    dispatch("toggle", { style });
  }

  function submitLink() {
    if (!linkUrl.trim()) return;
    let finalUrl = linkUrl.trim();
    if (!/^https?:\/\//i.test(finalUrl)) {
      finalUrl = "https://" + finalUrl;
    }
    dispatch("toggle", {
      style: STYLE_KEYS.LINK,
      metadata: { attributes: { url: finalUrl } },
    });
    showLinkInput = false;
    linkUrl = "";
  }
</script>

<div
  class="formatting-bar"
  style={position ? `top: ${position.top}px; left: ${position.left}px;` : ""}
  on:mousedown|preventDefault
>
  {#if showLinkInput}
    <div class="link-entry">
      <input
        type="text"
        placeholder="https://..."
        bind:value={linkUrl}
        on:keydown={(e) => {
          if (e.key === "Enter") submitLink();
          if (e.key === "Escape") showLinkInput = false;
        }}
      />
      <button type="button" class="btn-submit" on:click={submitLink}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      </button>
      <button type="button" class="btn-cancel" on:click={() => (showLinkInput = false)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
  {:else}
    <div class="button-group">
      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.BOLD)}
        on:click={() => triggerStyle(STYLE_KEYS.BOLD)}
        title="Жирный (Ctrl+B)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/>
        </svg>
      </button>

      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.ITALIC)}
        on:click={() => triggerStyle(STYLE_KEYS.ITALIC)}
        title="Курсив (Ctrl+I)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z"/>
        </svg>
      </button>

      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.UNDERLINE)}
        on:click={() => triggerStyle(STYLE_KEYS.UNDERLINE)}
        title="Подчёркнутый (Ctrl+U)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z"/>
        </svg>
      </button>

      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.STRIKE)}
        on:click={() => triggerStyle(STYLE_KEYS.STRIKE)}
        title="Зачёркнутый (Ctrl+Shift+X)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z"/>
        </svg>
      </button>

      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.CODE)}
        on:click={() => triggerStyle(STYLE_KEYS.CODE)}
        title="Моноширинный (Ctrl+Shift+M)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
        </svg>
      </button>

      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.QUOTE)}
        on:click={() => triggerStyle(STYLE_KEYS.QUOTE)}
        title="Цитата (Ctrl+Shift+Q)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/>
        </svg>
      </button>

      <button
        type="button"
        class="fmt-btn"
        class:is-active={activeStyles.includes(STYLE_KEYS.LINK)}
        on:click={() => triggerStyle(STYLE_KEYS.LINK)}
        title="Ссылка (Ctrl+K)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .formatting-bar {
    position: absolute;
    bottom: calc(100% + 2px);
    left: 12px;
    z-index: 1000;
    background: #232530;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    border-radius: 10px;
    padding: 3px 4px;
    display: flex;
    align-items: center;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .button-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .fmt-btn {
    background: transparent;
    border: none;
    color: #e0e0e0;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .fmt-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .fmt-btn.is-active {
    background: #7b4cd6;
    color: #ffffff;
  }

  .link-entry {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px;
  }

  .link-entry input {
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    outline: none;
    width: 180px;
  }

  .btn-submit,
  .btn-cancel {
    background: transparent;
    border: none;
    color: #fff;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .btn-submit:hover {
    background: rgba(76, 175, 80, 0.3);
  }

  .btn-cancel:hover {
    background: rgba(244, 67, 54, 0.3);
  }
</style>
