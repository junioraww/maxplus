<script>
  import { createEventDispatcher } from "svelte";
  import StickerMedia from "./StickerMedia.svelte";

  export let suggestions = [];

  const dispatch = createEventDispatcher();

  function handleSelect(sticker) {
    dispatch("select", { sticker });
  }
</script>

{#if suggestions.length > 0}
  <div class="sticker-suggestions-dropout">
    <div class="header">
      <span class="title">Стикеры</span>
      <span class="count">{suggestions.length}</span>
    </div>
    <div class="list">
      {#each suggestions as sticker (sticker.id)}
        <button
          type="button"
          class="sticker-suggestion-item"
          on:click={() => handleSelect(sticker)}
          title={sticker.tags?.join(", ") || "Стикер"}
        >
          <StickerMedia
            url={sticker.url}
            lottieUrl={sticker.lottieUrl}
            size={64}
            autoplay={true}
            loop={true}
          />
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .sticker-suggestions-dropout {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 8px;
    right: 8px;
    max-width: 600px;
    background: #1e2025;
    border: none;
    border-radius: 14px;
    padding: 6px 10px 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: popup-fade 0.12s ease-out;
  }

  @keyframes popup-fade {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  }

  .title {
    font-size: 12px;
    font-weight: 600;
    color: #8b929e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .count {
    font-size: 11px;
    color: #636b77;
    font-variant-numeric: tabular-nums;
  }

  .list {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px 2px 6px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .list::-webkit-scrollbar {
    height: 4px;
  }

  .list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }

  .sticker-suggestion-item {
    background: none;
    border: none;
    padding: 4px;
    border-radius: 12px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.15s ease;
  }

  .sticker-suggestion-item:hover {
    transform: scale(1.15);
    background: rgba(255, 255, 255, 0.08);
  }

  .sticker-suggestion-item:active {
    transform: scale(0.95);
  }
</style>
