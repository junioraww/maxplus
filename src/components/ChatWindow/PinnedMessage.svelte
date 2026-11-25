<script>
  import { createEventDispatcher } from "svelte";
  import { fly } from "svelte/transition";
  import MessagePreview from "$components/main/MessagePreview.svelte";

  export let msg = null;
  export let messages = [];
  export let chat = null;
  export let canUnpin = false;

  const dispatch = createEventDispatcher();

  let activeIndex = 0;

  $: pinList = Array.isArray(messages) && messages.length > 0
    ? messages
    : (msg ? [msg] : []);

  $: if (activeIndex >= pinList.length) {
    activeIndex = Math.max(0, pinList.length - 1);
  }

  $: activeMsg = pinList[activeIndex] || msg;
  $: isMulti = pinList.length > 1;
  $: visibleSegments = Math.min(pinList.length, 5);
  $: activeSegment = (() => {
    if (!isMulti) return 0;
    if (pinList.length <= 5) return activeIndex;
    if (activeIndex < 2) return activeIndex;
    if (activeIndex >= pinList.length - 2) return 5 - (pinList.length - activeIndex);
    return 2;
  })();

  function handleBannerClick() {
    if (!activeMsg) return;
    if (isMulti) {
      activeIndex = (activeIndex + 1) % pinList.length;
      const next = pinList[activeIndex];
      if (next) {
        dispatch("jump", { id: next.id, time: next.time });
      }
    } else {
      dispatch("jump", { id: activeMsg.id, time: activeMsg.time });
    }
  }

  function handleUnpin(e) {
    e.stopPropagation();
    if (!activeMsg) return;
    dispatch("unpin", { id: activeMsg.id });
  }

  function handleOpenList(e) {
    e.stopPropagation();
    dispatch("openList");
  }
</script>

{#if activeMsg}
  <div
    class="pinbar"
    role="button"
    tabindex="0"
    on:click={handleBannerClick}
    on:keydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleBannerClick();
      }
    }}
  >
    {#if isMulti}
      <div class="pinbar-segments" aria-hidden="true">
        {#each Array(visibleSegments) as _, idx (idx)}
          <span
            class="pinbar-segment"
            class:active={idx === activeSegment}
          ></span>
        {/each}
      </div>
    {/if}

    <div class="pinbar-content" class:no-action={!canUnpin && !isMulti}>
      <div class="pinbar-title">
        {#if chat?.type === "CHANNEL"}
          {#if isMulti}
            Закреплённый пост #{activeIndex + 1}
          {:else}
            Закреплённый пост
          {/if}
        {:else if isMulti}
          Закреплённое сообщение #{activeIndex + 1}
        {:else}
          Закреплённое сообщение
        {/if}
      </div>
      {#key activeMsg.id}
        <div class="pinbar-subtitle" in:fly={{ y: 8, duration: 160 }}>
          <MessagePreview {chat} msg={activeMsg} />
        </div>
      {/key}
    </div>

    {#if isMulti}
      <button
        type="button"
        class="pinbar-action-btn"
        on:click={handleOpenList}
        title="Все закреплённые сообщения"
        aria-label="Все закреплённые сообщения"
      >
        <span
          class="pinbar-icon mask-icon"
          style="-webkit-mask-image: url('/icons/pin.svg'); mask-image: url('/icons/pin.svg');"
        ></span>
      </button>
    {:else if canUnpin}
      <button
        type="button"
        class="pinbar-action-btn"
        on:click={handleUnpin}
        title="Открепить сообщение"
        aria-label="Открепить сообщение"
      >
        <span
          class="pinbar-icon mask-icon"
          style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg');"
        ></span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .pinbar {
    position: relative;
    z-index: var(--z-header, 4);
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 52px;
    min-height: 52px;
    padding: 5px 0 5px 12px;
    box-sizing: border-box;
    background: var(--bg-header, var(--surface-bg, #161722));
    border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
    cursor: pointer;
    user-select: none;
    transition: background-color 0.15s ease;
  }

  .pinbar:hover {
    background: var(--bg-header-hover, rgba(255, 255, 255, 0.04));
  }

  .pinbar-segments {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 3px;
    width: 2px;
    height: 36px;
  }

  .pinbar-segment {
    flex: 1;
    width: 2px;
    border-radius: 2px;
    background: var(--accent-color, #8b5cf6);
    opacity: 0.35;
    transition: opacity 0.2s ease;
  }

  .pinbar-segment.active {
    opacity: 1;
  }

  .pinbar-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }

  .pinbar-content.no-action {
    padding-right: 12px;
  }

  .pinbar-title {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--accent-color, #8b5cf6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pinbar-subtitle {
    font-size: 13px;
    line-height: 1.3;
    color: var(--text-primary, #f4f4f6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .pinbar-action-btn {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
    cursor: pointer;
    border-radius: 50%;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .pinbar-action-btn:hover {
    background: var(--hover-bg, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #ffffff);
  }

  .pinbar-icon {
    width: 20px;
    height: 20px;
    background-color: currentColor;
  }
</style>
