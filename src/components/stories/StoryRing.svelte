<script>
  import { createEventDispatcher } from "svelte";
  import Avatar from "$components/main/Avatar.svelte";

  export let preview = null;
  export let size = 56;
  export let strokeWidth = 2.5;
  export let isSelf = false;

  const dispatch = createEventDispatcher();

  $: total = preview?.totalCount || 0;
  $: hasStory = Boolean(total > 0);
  $: read = Math.min(total, preview?.readCount || 0);
  $: unread = total - read;
  $: hasUnread = unread > 0;

  $: radius = (size - strokeWidth) / 2;
  $: circumference = 2 * Math.PI * radius;

  $: segmentGap = total > 1 ? 4 : 0;
  $: totalGaps = total * segmentGap;
  $: segmentLength = total > 0 ? Math.max(2, (circumference - totalGaps) / total) : 0;

  function handleClick(e) {
    e.stopPropagation();
    dispatch("click", preview);
  }
</script>

<button
  type="button"
  class="story-ring-btn"
  class:has-story={hasStory}
  style="width: {size}px; height: {size}px;"
  on:click={handleClick}
>
  {#if hasStory}
    <svg
      class="story-ring-svg"
      viewBox="0 0 {size} {size}"
      width={size}
      height={size}
    >
      <defs>
        <linearGradient id="storyRingGrad_{size}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3b82f6" />
          <stop offset="50%" stop-color="#8b5cf6" />
          <stop offset="100%" stop-color="#ec4899" />
        </linearGradient>
      </defs>

      {#each Array(total) as _, i}
        {@const isSegUnread = i >= read}
        {@const offset = -i * (segmentLength + segmentGap)}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isSegUnread ? `url(#storyRingGrad_${size})` : "rgba(142, 142, 147, 0.4)"}
          stroke-width={strokeWidth}
          stroke-linecap="round"
          stroke-dasharray="{segmentLength} {circumference - segmentLength}"
          stroke-dashoffset={offset}
          class:unread-seg={isSegUnread}
        />
      {/each}
    </svg>
  {/if}

  <div
    class="avatar-slot"
    style="inset: {hasStory ? strokeWidth + 2 : 0}px;"
  >
    {#if isSelf}
      <Avatar
        size={hasStory ? size - (strokeWidth + 2) * 2 : size}
        isSelf={true}
        enableStoryRing={false}
      />
    {:else if preview?.owner}
      <Avatar
        size={hasStory ? size - (strokeWidth + 2) * 2 : size}
        contactId={preview.owner.ownerId}
        userId={preview.owner.ownerId}
        enableStoryRing={false}
      />
    {/if}
  </div>
</button>

<style>
  .story-ring-btn {
    position: relative;
    padding: 0;
    margin: 0;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    outline: none;
    transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .story-ring-btn:active {
    transform: scale(0.94);
  }

  .story-ring-svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
    pointer-events: none;
  }

  .avatar-slot {
    position: absolute;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .unread-seg {
    filter: drop-shadow(0 0 4px rgba(59, 130, 246, 0.45));
  }
</style>
