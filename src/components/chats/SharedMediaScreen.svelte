<script>
  import { createEventDispatcher } from "svelte";
  import GroupSharedMedia from "./GroupSharedMedia.svelte";

  export let chat = null;
  export let close = () => {};

  const dispatch = createEventDispatcher();

  function handleBack() {
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
  }
</script>

<div class="shared-media-screen">
  <header class="shared-media-toolbar">
    <button type="button" class="icon-btn" on:click={handleBack} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <div class="toolbar-title">Вложения</div>
  </header>

  <div class="shared-media-screen-body">
    {#if chat}
      <GroupSharedMedia {chat} />
    {/if}
  </div>
</div>

<style>
  .shared-media-screen {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-surface, #1e2025);
    overflow: hidden;
  }

  .shared-media-toolbar {
    height: calc(60px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 16px 0 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--bg-surface, #1e2025);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    box-sizing: border-box;
    z-index: 2;
  }

  .icon-btn {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--text-color, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background-color: var(--bg-hover, rgba(255, 255, 255, 0.08));
  }

  .toolbar-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color, #ffffff);
    letter-spacing: -0.2px;
  }

  .shared-media-screen-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 12px 16px calc(24px + var(--safe-bottom, 0px));
    box-sizing: border-box;
  }

  .mask-icon {
    display: inline-block;
    background-color: currentColor;
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
  }
</style>
