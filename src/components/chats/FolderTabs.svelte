<script>
  import { IconButton } from "$components/ui";
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";

  export let folders = [];
  export let activeFolder = null;
  export let counts = new Map();

  const dispatch = createEventDispatcher();

  let isEditing = false;
  let draggingIndex = null;

  let lastReorderTime = 0;
  const REORDER_COOLDOWN = 250;

  let tabElements = [];

  $: activeIndex = folders.findIndex(f => f === activeFolder);
  $: if (activeIndex === -1) activeIndex = 0;

  let tabsEl;
  let slideLeft = 0;
  let slideWidth = 0;
  let slideTransition = false;
  let resizeObserver;

  async function updateSlide() {
    await tick();
    const el = tabElements[activeIndex];
    if (!el) return;
    slideLeft = el.offsetLeft;
    slideWidth = el.offsetWidth;
    if (!slideTransition) requestAnimationFrame(() => (slideTransition = true));
  }

  $: activeIndex, folders, isEditing, updateSlide();

  onMount(() => {
    if (typeof ResizeObserver !== "undefined" && tabsEl) {
      resizeObserver = new ResizeObserver(() => updateSlide());
      resizeObserver.observe(tabsEl);
    }
    document.fonts?.ready?.then(updateSlide);
  });

  onDestroy(() => resizeObserver?.disconnect());

  function selectFolder(folder) {
    if (isEditing) return;
    activeFolder = folder;
    dispatch("folderChange", folder);
  }

  function toggleEditMode() {
    isEditing = !isEditing;
    if (!isEditing) draggingIndex = null;
    dispatch("editFolders", isEditing);
  }

  function handleStart(index, e) {
    if (!isEditing) return;
    draggingIndex = index;
  }

  function handleMove(e) {
    if (!isEditing || draggingIndex === null) return;

    if (Date.now() - lastReorderTime < REORDER_COOLDOWN) return;

    let clientX, clientY;
    if (e.type.startsWith("touch")) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
      e.preventDefault();
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const elementUnderCursor = document.elementFromPoint(clientX, clientY);
    const tabEl = elementUnderCursor?.closest(".tab-item");

    if (tabEl && tabEl.dataset.index) {
      const hoverIndex = parseInt(tabEl.dataset.index);

      if (hoverIndex !== draggingIndex) {
        const newFolders = [...folders];
        const [movedItem] = newFolders.splice(draggingIndex, 1);
        newFolders.splice(hoverIndex, 0, movedItem);

        folders = newFolders;
        draggingIndex = hoverIndex;

        lastReorderTime = Date.now();

        dispatch("reorder", folders);
      }
    }
  }

  function handleEnd() {
    draggingIndex = null;
  }
</script>

<svelte:window
  on:mouseup={handleEnd}
  on:mousemove={handleMove}
  on:touchend={handleEnd}
  on:touchmove|nonpassive={handleMove}
/>

<div class="tabs-container">
  <div
    class="tabs"
    class:tabs--transition={slideTransition}
    role="tablist"
    bind:this={tabsEl}
    style="--active-tab-width: {slideWidth}px; --active-tab-left: {slideLeft}px;"
  >
    {#each folders as folder, index (folder.id)}
      <div
        animate:flip={{ duration: 250, easing: quintOut }}
        class="tab-item"
        class:shaking={isEditing}
        class:dragging={draggingIndex === index}
        data-index={index}
        on:mousedown={(e) => handleStart(index, e)}
        on:touchstart|passive={(e) => handleStart(index, e)}
        bind:this={tabElements[index]}
      >
        <button
          class="tab"
          class:tab--active={activeFolder === folder && !isEditing}
          type="button"
          role="tab"
          aria-selected={activeFolder === folder}
          tabindex={activeFolder === folder ? 0 : -1}
          on:click={() => selectFolder(folder)}
        >
          {folder.title}
          {#if !isEditing && (counts.get(folder.id) || 0) > 0}
            <span class="tab-badge">{counts.get(folder.id) > 99 ? "99+" : counts.get(folder.id)}</span>
          {/if}
        </button>

        {#if isEditing && folder.id !== 0 && folder.id !== "all.chat.folder"}
          <button
            class="edit-icon"
            on:click|stopPropagation={() => dispatch("editFolder", folder)}
            on:touchstart|stopPropagation
            on:mousedown|stopPropagation
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              stroke="currentColor"
              stroke-width="2"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        {/if}
      </div>
    {/each}

    {#if !isEditing && slideWidth > 0}
      <div class="active-slide" aria-hidden="true"></div>
    {/if}

    {#if isEditing}
      <IconButton class="foldertabs-add-tab-btn" title="Добавить папку" onclick={(e) => { e.stopPropagation(); (() => dispatch("addFolder"))(e); }}>
        +
      </IconButton>
    {/if}
  </div>
</div>

<style>
  .tabs-container {
    display: flex;
    width: 100%;
    align-items: center;
    background: var(--bg-topbar);
    position: relative;
    z-index: 10;
    user-select: none;
    -webkit-user-select: none;
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0 var(--size-4, 4px);
    scrollbar-width: none;
    -ms-overflow-style: none;
    position: relative;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  /* === Active indicator — ported from Max === */
  .active-slide {
    position: absolute;
    bottom: 0;
    left: 0;
    display: block;
    height: var(--size-2, 2px);
    width: calc(var(--active-tab-width) - var(--size-12, 12px) * 2);
    border-top-left-radius: var(--border-radius-common-xs, 4px);
    border-top-right-radius: var(--border-radius-common-xs, 4px);
    background: var(--icon-themed, var(--accent-primary));
    transform: translateX(calc(var(--active-tab-left) + var(--size-12, 12px)));
    pointer-events: none;
  }

  .tabs--transition .active-slide {
    transition: transform 0.25s ease-out, width 0.25s ease-out;
  }

  .tab-item {
    position: relative;
    display: flex;
    align-items: center;
    margin: 0;
    touch-action: pan-x;
    padding: 0;
    flex-shrink: 0;
  }

  .tab-item.dragging {
    opacity: 0.5;
    z-index: 100;
    pointer-events: none;
  }

  @keyframes shake {
    0% { transform: rotate(0deg); }
    25% { transform: rotate(1.5deg) translateY(-1px); }
    50% { transform: rotate(0deg); }
    75% { transform: rotate(-1.5deg) translateY(1px); }
    100% { transform: rotate(0deg); }
  }

  .shaking {
    animation: shake 0.3s infinite ease-in-out;
    cursor: grab;
  }

  .shaking.dragging {
    animation: none;
    transform: scale(1.05);
  }

  .edit-icon {
    position: absolute;
    top: -4px;
    right: -4px;
    background: var(--accent-primary);
    border: 2px solid var(--bg-topbar);
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    cursor: pointer;
    z-index: 2;
    padding: 0;
    pointer-events: auto;
  }

  .tab {
    position: relative;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    gap: var(--size-4, 4px);
    flex-shrink: 0;
    min-width: var(--size-40, 40px);
    min-height: var(--size-40, 40px);
    margin: 0;
    padding: 0 var(--size-12, 12px);
    border: none;
    border-radius: var(--border-radius-common-m, 12px);
    background: none;
    cursor: pointer;
    white-space: nowrap;
    font: var(--font-body-strong-weight, 500) var(--font-body-strong-size, 16px) / var(--font-body-strong-line-height, 20px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-body-strong-letter-spacing, 0.15px);
    color: var(--text-tertiary, #06070885);
    transition: color 0.2s, background-color 0.15s;
  }

  .shaking .tab {
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    padding: 5px 11px;
  }

  @media (hover: hover) {
    .tab:hover {
      background-color: var(--states-button-ghost-hover, #0d0d0d0a);
    }
  }

  .tab:active {
    background-color: var(--states-button-ghost-pressed, #0d0d0d14);
  }

  .tab--active {
    color: var(--text-themed, var(--accent-primary));
  }

  :global(.foldertabs-add-tab-btn)  { margin: 4px; flex-shrink: 0; }

  .tab-badge {
    display: inline-flex; align-items: center; justify-content: center; vertical-align: middle;
    min-width: 20px; height: 20px; margin-left: 6px; padding: 0 6px; box-sizing: border-box;
    border-radius: 10px; font-size: 13px; font-weight: 600; line-height: 1; color: #fff;
    background: var(--text-secondary, #8a8a93);
  }
  .tab--active .tab-badge { background: var(--accent-primary); }
</style>
