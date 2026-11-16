<script>
  import { createEventDispatcher } from "svelte";
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import { getMountStore } from "$lib/plugins/mount-registry";

  export let folders = [];
  export let activeFolder = null;
  export let unreadCounts = new Map();

  const dispatch = createEventDispatcher();
  const pluginChatListHeader = getMountStore("chat-list:header");

  let isEditing = false;
  let draggingIndex = null;
  let lastReorderTime = 0;
  const REORDER_COOLDOWN = 250;
  let longPressTimer = null;
  let isLongPress = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let tabsEl;

  $: if (activeFolder && tabsEl) {
    const activeTabEl = tabsEl.querySelector(".tab.active");
    if (activeTabEl) {
      const parentWrapper = activeTabEl.closest(".tab-wrapper") || activeTabEl;
      const targetLeft = parentWrapper.offsetLeft - (tabsEl.clientWidth - parentWrapper.offsetWidth) / 2;
      tabsEl.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
    }
  }

  function selectFolder(folder) {
    if (isEditing || isLongPress) return;
    activeFolder = folder;
    dispatch("folderChange", folder);
  }

  function handleTabTouchStart(index, folder, e) {
    if (isEditing) {
      draggingIndex = index;
      return;
    }
    const touch = e.touches ? e.touches[0] : e;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isLongPress = false;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      isLongPress = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(40);
        } catch {}
      }
      dispatch("editFolder", folder);
    }, 450);
  }

  function handleTabTouchMove(e) {
    if (!longPressTimer && !isLongPress) return;
    const touch = e.touches ? e.touches[0] : e;
    if (Math.abs(touch.clientX - touchStartX) > 8 || Math.abs(touch.clientY - touchStartY) > 8) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTabTouchEnd() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    if (isLongPress) {
      setTimeout(() => {
        isLongPress = false;
      }, 300);
    }
    draggingIndex = null;
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
    const tabWrapper = elementUnderCursor?.closest(".tab-wrapper");

    if (tabWrapper && tabWrapper.dataset.index) {
      const hoverIndex = parseInt(tabWrapper.dataset.index);
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

  function toggleEditMode() {
    isEditing = !isEditing;
    if (!isEditing) draggingIndex = null;
    dispatch("editFolders", isEditing);
  }
</script>

<svelte:window
  on:mouseup={handleTabTouchEnd}
  on:mousemove={handleMove}
  on:touchend={handleTabTouchEnd}
  on:touchmove|nonpassive={handleMove}
/>

{#each $pluginChatListHeader as item (item.id)}
  <div class="plugin-chat-list-header" data-plugin-mount={item.pluginId || item.id}>
    {@html item.html}
  </div>
{/each}

<div class="tabs-container">
  <div class="tabs" bind:this={tabsEl}>
    {#each folders as folder, index (folder.id)}
      {@const unread = unreadCounts.get(folder.id) || 0}
      <div
        animate:flip={{ duration: 250, easing: quintOut }}
        class="tab-wrapper"
        class:shaking={isEditing}
        class:dragging={draggingIndex === index}
        data-index={index}
        on:mousedown={(e) => handleTabTouchStart(index, folder, e)}
        on:touchstart|passive={(e) => handleTabTouchStart(index, folder, e)}
        on:touchmove|passive={handleTabTouchMove}
        on:contextmenu|preventDefault={() => dispatch("editFolder", folder)}
      >
        <button
          class="tab"
          class:active={activeFolder === folder && !isEditing}
          on:click={() => selectFolder(folder)}
        >
          <span class="tab-title">{folder.title}</span>
          {#if unread > 0}
            <span class="tab-badge">{unread > 99 ? '99+' : unread}</span>
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

    {#if isEditing}
      <button
        class="add-tab-btn"
        title="Добавить папку"
        on:click|stopPropagation={() => dispatch("addFolder")}
      >
        +
      </button>
    {/if}
  </div>

  {#if isEditing}
    <button class="done-btn" on:click={toggleEditMode}>
      Готово
    </button>
  {/if}
</div>

<style>
  .tabs-container {
    display: flex;
    width: 100%;
    height: 40px;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    position: relative;
    z-index: 10;
    user-select: none;
    -webkit-user-select: none;
    box-sizing: border-box;
    background: transparent;
    flex-shrink: 0;
  }

  .tabs {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
    height: 100%;
    min-width: 0;
    padding-left: 8px;
    padding-right: 8px;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    height: 100%;
    margin-right: 2px;
    touch-action: pan-x;
    flex-shrink: 0;
  }

  .tab-wrapper.dragging {
    opacity: 0.5;
    z-index: 100;
    pointer-events: none;
  }

  @keyframes shake {
    0% { transform: rotate(0deg); }
    25% { transform: rotate(1.5deg); }
    50% { transform: rotate(0deg); }
    75% { transform: rotate(-1.5deg); }
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
    top: 4px;
    right: -4px;
    background: var(--accent-primary, #248bfe);
    border: 2px solid #1e1e1e;
    border-radius: 50%;
    width: 18px;
    height: 18px;
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
    height: 100%;
    padding: 0 14px;
    background: none;
    border: none;
    font-size: 16px;
    font-weight: 500;
    line-height: 20px;
    cursor: pointer;
    color: var(--text-secondary, #8b929e);
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: color 0.15s ease;
    box-sizing: border-box;
  }

  .tab:hover {
    color: #cccccc;
  }

  .tab.active {
    color: var(--text-primary, #ffffff);
  }

  .tab.active:not(.shaking .tab)::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 12px;
    right: 12px;
    height: 3px;
    background-color: var(--accent-primary, #248bfe);
    border-radius: 4px 4px 0 0;
  }

  .tab-badge {
    font-size: 11px;
    font-weight: 600;
    font-feature-settings: "tnum";
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    line-height: 1;
  }

  .tab:not(.active) .tab-badge {
    background: #4b4b56;
    color: #dddddd;
  }

  .done-btn {
    padding: 0 14px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--accent-primary, #248bfe);
    font-weight: 600;
    font-size: 14px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .add-tab-btn {
    background: #282830;
    border: 1px dashed #555;
    color: #bbb;
    padding: 4px 10px;
    margin: 4px;
    border-radius: 6px;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
</style>
