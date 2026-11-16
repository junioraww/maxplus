<script>
  import { createEventDispatcher, onMount, afterUpdate } from "svelte";
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

  let indicatorLeft = 0;
  let indicatorWidth = 0;
  let isIndicatorVisible = false;

  let isTabsMouseDragging = false;
  let tabsMouseStartX = 0;
  let tabsMouseStartScrollLeft = 0;
  let tabsMouseHasMoved = false;

  function updateIndicator() {
    if (!tabsEl || !activeFolder || isEditing) {
      isIndicatorVisible = false;
      return;
    }
    const activeTabEl = tabsEl.querySelector(".tab.active");
    if (activeTabEl) {
      const parentWrapper = activeTabEl.closest(".tab-wrapper");
      const left = parentWrapper ? parentWrapper.offsetLeft : activeTabEl.offsetLeft;
      const width = activeTabEl.offsetWidth;
      indicatorLeft = left + 12;
      indicatorWidth = Math.max(16, width - 24);
      isIndicatorVisible = true;
    } else {
      isIndicatorVisible = false;
    }
  }

  $: if (activeFolder && tabsEl) {
    updateIndicator();
    const activeTabEl = tabsEl.querySelector(".tab.active");
    if (activeTabEl) {
      const parentWrapper = activeTabEl.closest(".tab-wrapper") || activeTabEl;
      const targetLeft = parentWrapper.offsetLeft - (tabsEl.clientWidth - parentWrapper.offsetWidth) / 2;
      tabsEl.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
    }
  }

  onMount(() => {
    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => {
      window.removeEventListener("resize", updateIndicator);
    };
  });

  afterUpdate(() => {
    updateIndicator();
  });

  let contextMenuFolder = null;
  let contextMenuPos = { x: 0, y: 0 };
  let isContextMenuOpen = false;

  function openContextMenu(folder, e) {
    if (e.stopPropagation) e.stopPropagation();
    const target = e.currentTarget || e.target;
    const rect = target?.getBoundingClientRect?.() || { left: 16, bottom: 40, width: 60 };
    contextMenuFolder = folder;
    contextMenuPos = {
      x: rect.left + rect.width / 2,
      y: rect.bottom + 4,
    };
    isContextMenuOpen = true;
  }

  function closeContextMenu() {
    isContextMenuOpen = false;
    contextMenuFolder = null;
  }

  function handleMenuAction(action) {
    if (!contextMenuFolder) return;
    const folder = contextMenuFolder;
    closeContextMenu();
    if (action === "edit") {
      dispatch("editFolder", folder);
    } else if (action === "read") {
      dispatch("readFolder", folder);
    } else if (action === "delete") {
      dispatch("deleteFolder", folder);
    }
  }

  function selectFolder(folder) {
    if (isEditing || isLongPress || tabsMouseHasMoved || isContextMenuOpen) return;
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
      openContextMenu(folder, e);
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

  function handleTabsMouseDown(e) {
    if (isEditing || e.button !== 0 || !tabsEl) return;
    isTabsMouseDragging = true;
    tabsMouseHasMoved = false;
    tabsMouseStartX = e.clientX;
    tabsMouseStartScrollLeft = tabsEl.scrollLeft;

    const onTabsMouseMove = (ev) => {
      if (!isTabsMouseDragging || !tabsEl) return;
      const dx = ev.clientX - tabsMouseStartX;
      if (Math.abs(dx) > 4) {
        tabsMouseHasMoved = true;
      }
      tabsEl.scrollLeft = tabsMouseStartScrollLeft - dx;
    };

    const onTabsMouseUp = () => {
      isTabsMouseDragging = false;
      window.removeEventListener("mousemove", onTabsMouseMove);
      window.removeEventListener("mouseup", onTabsMouseUp);
      setTimeout(() => {
        tabsMouseHasMoved = false;
      }, 50);
    };

    window.addEventListener("mousemove", onTabsMouseMove);
    window.addEventListener("mouseup", onTabsMouseUp);
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
  <div
    class="tabs"
    bind:this={tabsEl}
    on:mousedown={handleTabsMouseDown}
  >
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
        on:contextmenu|preventDefault={(e) => openContextMenu(folder, e)}
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
            <img
              src="/icons/edit.svg"
              width="12"
              height="12"
              alt=""
            />
          </button>
        {/if}
      </div>
    {/each}

    {#if isIndicatorVisible && !isEditing}
      <div
        class="tab-indicator"
        style="transform: translateX({indicatorLeft}px); width: {indicatorWidth}px;"
      ></div>
    {/if}

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

{#if isContextMenuOpen && contextMenuFolder}
  <div class="folder-context-backdrop" on:click={closeContextMenu}></div>
  <div
    class="folder-context-menu"
    style="top: {contextMenuPos.y}px; left: {Math.max(12, Math.min(contextMenuPos.x - 80, window.innerWidth - 180))}px;"
  >
    {#if contextMenuFolder.id !== 0 && contextMenuFolder.id !== "all.chat.folder"}
      <button class="folder-menu-item" on:click={() => handleMenuAction("edit")}>
        <img src="/icons/edit.svg" width="18" height="18" alt="" />
        <span>Изменить</span>
      </button>
    {/if}
    <button class="folder-menu-item" on:click={() => handleMenuAction("read")}>
      <img src="/icons/status-read.svg" width="18" height="18" alt="" />
      <span>Прочитать все</span>
    </button>
    {#if contextMenuFolder.id !== 0 && contextMenuFolder.id !== "all.chat.folder"}
      <button class="folder-menu-item danger" on:click={() => handleMenuAction("delete")}>
        <img src="/icons/trash.svg" width="18" height="18" alt="" />
        <span>Удалить</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .tabs-container {
    display: flex;
    width: 100%;
    height: 40px;
    align-items: center;
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
    position: relative;
    cursor: default;
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

  .tab-indicator {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    background-color: var(--accent-primary, #248bfe);
    border-radius: 4px 4px 0 0;
    transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1), width 0.25s cubic-bezier(0.25, 1, 0.5, 1);
    pointer-events: none;
    z-index: 5;
  }

  .tab-badge {
    font-size: 13px;
    font-weight: 600;
    font-feature-settings: "tnum";
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
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

  .folder-context-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-dropdown-backdrop, 5);
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  }

  .folder-context-menu {
    position: fixed;
    z-index: var(--z-dropdown, 6);
    min-width: 170px;
    background: var(--bg-surface-elevated, #232429);
    border-radius: 12px;
    padding: 6px 0;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    display: flex;
    flex-direction: column;
    animation: menu-appear 0.15s ease-out;
  }

  @keyframes menu-appear {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .folder-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 16px;
    border: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;
  }

  .folder-menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .folder-menu-item.danger {
    color: var(--danger, #ff4d4f);
  }

  .folder-menu-item img {
    flex-shrink: 0;
  }
</style>
