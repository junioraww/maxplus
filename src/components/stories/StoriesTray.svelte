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

  export let isExpanded = true;

  const dispatch = createEventDispatcher();

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

  export function toggle() {
    isExpanded = !isExpanded;
  }
</script>

{#if isExpanded}
  <div
    class="stories-drawer-root"
    transition:slide={{ duration: 220 }}
  >
    <div class="stories-tray-content">
      <div class="stories-scroll-row">
        <div class="story-item-col" on:click={handleSelfClick} role="button" tabindex="0">
          <div class="ring-container self-ring-wrap">
            <StoryRing
              preview={selfPreview}
              size={62}
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
  </div>
{/if}

<style>
  .stories-drawer-root {
    width: 100%;
    user-select: none;
    background: transparent;
    z-index: var(--z-header, 4);
    overflow: hidden;
  }

  .stories-tray-content {
    width: 100%;
    height: 88px;
    background: transparent;
    box-sizing: border-box;
  }

  .stories-scroll-row {
    display: flex;
    align-items: center;
    height: 88px;
    gap: 12px;
    padding: 0 8px;
    box-sizing: border-box;
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
    width: 62px;
    height: 88px;
    cursor: pointer;
    flex-shrink: 0;
    box-sizing: border-box;
    outline: none;
    justify-content: flex-start;
    padding-bottom: 6px;
  }

  .ring-container {
    position: relative;
    width: 62px;
    height: 62px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
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
    z-index: var(--z-floating, 5);
  }

  .add-badge-btn:hover {
    transform: scale(1.12);
  }

  .owner-name-label {
    margin-top: auto;
    font-size: 12px;
    line-height: 16px;
    font-weight: 400;
    letter-spacing: 0.025em;
    color: rgba(255, 255, 255, 0.85);
    max-width: 62px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
</style>
