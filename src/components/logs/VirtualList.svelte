<script>
  import { onMount, tick } from "svelte";

  export let items = [];
  export let itemHeight = 46;
  export let overscan = 8;

  let container;
  let viewportHeight = 500;
  let scrollTop = 0;

  let startIndex = 0;
  let endIndex = 0;
  let topPadding = 0;
  let bottomPadding = 0;

  let visibleItems = [];

  function updateVisibleRange() {
    if (!container) return;
    scrollTop = container.scrollTop;
    viewportHeight = container.clientHeight || 500;

    const total = items.length;
    if (total === 0) {
      startIndex = 0;
      endIndex = 0;
      topPadding = 0;
      bottomPadding = 0;
      visibleItems = [];
      return;
    }

    const calculatedStart = Math.floor(scrollTop / itemHeight) - overscan;
    startIndex = Math.max(0, calculatedStart);

    const calculatedEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan;
    endIndex = Math.min(total, calculatedEnd);

    topPadding = startIndex * itemHeight;
    bottomPadding = Math.max(0, (total - endIndex) * itemHeight);

    visibleItems = items.slice(startIndex, endIndex).map((item, i) => ({
      item,
      index: startIndex + i,
    }));
  }

  $: {
    items;
    itemHeight;
    overscan;
    updateVisibleRange();
  }

  export function scrollToBottom() {
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }

  export function scrollToTop() {
    if (!container) return;
    container.scrollTop = 0;
  }

  function handleScroll() {
    updateVisibleRange();
  }

  onMount(() => {
    updateVisibleRange();
    const ro = new ResizeObserver(() => {
      updateVisibleRange();
    });
    ro.observe(container);
    return () => ro.disconnect();
  });
</script>

<div class="virtual-list-viewport" bind:this={container} on:scroll={handleScroll}>
  <div class="virtual-list-spacer" style="padding-top: {topPadding}px; padding-bottom: {bottomPadding}px;">
    {#each visibleItems as { item, index } (item.id !== undefined ? item.id : index)}
      <slot {item} {index} />
    {/each}
  </div>
</div>

<style>
  .virtual-list-viewport {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    position: relative;
    box-sizing: border-box;
    -webkit-overflow-scrolling: touch;
  }

  .virtual-list-spacer {
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
</style>
