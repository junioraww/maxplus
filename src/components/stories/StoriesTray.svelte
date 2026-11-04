<script>
  import { onMount, createEventDispatcher } from "svelte";
  import { slide } from "svelte/transition";
  import {
    sortedStoriesFeed,
    selfStoryPreview,
    openStoriesViewer,
    refreshStoriesFeed
  } from "$lib/stores/stories";
  import API, { currentUser } from "$lib/stores/api";
  import StoryRing from "./StoryRing.svelte";
  import StoriesTrayItem from "./StoriesTrayItem.svelte";

  export let isExpanded = false;

  const dispatch = createEventDispatcher();

  let touchStartY = 0;
  let currentPullY = 0;
  let isPulling = false;

  onMount(() => {
    refreshStoriesFeed($API);
  });

  $: myId = Number($currentUser);
  $: selfPreview = $selfStoryPreview;
  $: otherPreviews = $sortedStoriesFeed.filter((p) => Number(p.owner?.ownerId) !== myId);
  $: hasStories = otherPreviews.length > 0 || (selfPreview && (selfPreview.totalCount || 0) > 0);

  function handleSelfClick() {
    if (selfPreview && (selfPreview.totalCount || 0) > 0) {
      openStoriesViewer(myId);
    } else {
      dispatch("compose");
    }
  }

  function handleAddClick(e) {
    e.stopPropagation();
    dispatch("compose");
  }

  function handleOwnerClick(preview) {
    if (preview?.owner?.ownerId) {
      openStoriesViewer(preview.owner.ownerId);
    }
  }

  function toggleTray() {
    isExpanded = !isExpanded;
  }

  function handleTouchStart(e) {
    touchStartY = e.touches[0].clientY;
    isPulling = true;
    currentPullY = 0;
  }

  function handleTouchMove(e) {
    if (!isPulling) return;
    const dy = e.touches[0].clientY - touchStartY;
    if (!isExpanded && dy > 0) {
      currentPullY = Math.min(dy * 0.45, 60);
    } else if (isExpanded && dy < 0) {
      currentPullY = Math.max(dy * 0.45, -60);
    }
  }

  function handleTouchEnd() {
    if (!isPulling) return;
    isPulling = false;
    if (!isExpanded && currentPullY > 24) {
      isExpanded = true;
    } else if (isExpanded && currentPullY < -24) {
      isExpanded = false;
    }
    currentPullY = 0;
  }

  function handleWheel(e) {
    if (!isExpanded && e.deltaY < -15) {
      isExpanded = true;
    } else if (isExpanded && e.deltaY > 15) {
      isExpanded = false;
    }
  }

  export function collapse() {
    if (isExpanded) {
      isExpanded = false;
    }
  }

  export function expand() {
    if (!isExpanded) {
      isExpanded = true;
    }
  }
</script>

<div
  class="stories-drawer-root"
  on:touchstart={handleTouchStart}
  on:touchmove={handleTouchMove}
  on:touchend={handleTouchEnd}
  on:wheel={handleWheel}
  style="transform: translateY({currentPullY}px);"
>
  <button
    type="button"
    class="drawer-pull-handle-bar"
    class:has-stories={hasStories}
    on:click={toggleTray}
    title={isExpanded ? "Свернуть истории" : "Развернуть истории"}
    aria-label={isExpanded ? "Свернуть истории" : "Развернуть истории"}
  >
    <div class="handle-pill"></div>
    {#if !isExpanded && hasStories}
      <div class="mini-stories-indicator">
        <span class="indicator-dot"></span>
        <span class="indicator-text">Истории</span>
      </div>
    {/if}
  </button>

  {#if isExpanded}
    <div
      class="stories-tray-content"
      transition:slide={{ duration: 240 }}
    >
      <div class="stories-scroll-row">
        <div class="story-item-col" on:click={handleSelfClick} role="button" tabindex="0">
          <div class="ring-container self-ring-wrap">
            <StoryRing
              preview={selfPreview}
              size={56}
              isSelf={true}
              on:click={handleSelfClick}
            />
            <button
              type="button"
              class="add-badge-btn"
              on:click={handleAddClick}
              aria-label="Добавить историю"
            >
              <img src="/icons/stories/plus.svg" alt="" width="14" height="14" />
            </button>
          </div>
          <span class="owner-name-label">Вы</span>
        </div>

        {#each otherPreviews as preview (preview.owner?.ownerId)}
          <StoriesTrayItem {preview} onOwnerClick={handleOwnerClick} />
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .stories-drawer-root {
    width: 100%;
    user-select: none;
    background: transparent;
    transition: transform 0.15s ease-out;
    z-index: var(--z-header, 4);
  }

  .drawer-pull-handle-bar {
    width: 100%;
    height: 14px;
    background: transparent;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 2px 0 4px 0;
    gap: 2px;
  }

  .handle-pill {
    width: 34px;
    height: 3.5px;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 3px;
    transition: background 0.15s, width 0.15s;
  }
  .drawer-pull-handle-bar:hover .handle-pill {
    background: rgba(255, 255, 255, 0.35);
    width: 42px;
  }

  .mini-stories-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.45);
    font-weight: 500;
  }
  .indicator-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #2481cc;
  }

  .stories-tray-content {
    width: 100%;
    padding: 6px 0 10px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(0, 0, 0, 0.18);
  }

  .stories-scroll-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 16px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .stories-scroll-row::-webkit-scrollbar {
    display: none;
  }

  .story-item-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    flex-shrink: 0;
    width: 66px;
    outline: none;
  }

  .ring-container {
    position: relative;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .self-ring-wrap {
    position: relative;
  }

  .add-badge-btn {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #3b82f6;
    color: #ffffff;
    border: 2px solid #1c1d24;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: transform 0.15s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  }
  .add-badge-btn:hover {
    transform: scale(1.12);
  }

  .owner-name-label {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.85);
    max-width: 66px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-weight: 500;
  }
</style>
