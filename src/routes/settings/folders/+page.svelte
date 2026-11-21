<script>
  import { flip } from "svelte/animate";
  import { quintOut } from "svelte/easing";
  import API, { currentFolders } from "$lib/stores/api";
  import { openFolderEdit, showConfirm, closeSettingsPage } from "$lib/stores/session";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";

  export let onClose = null;
  export let isTab = false;

  let isOpening = true;
  let isClosing = false;
  let activeMenuFolderId = null;
  let activeMenuFolder = null;
  let menuPosition = { top: 0, right: 16 };
  let creatingFolder = false;
  let draggingFolderIndex = null;
  let unregisterBack = null;

  let touchStartX = 0;
  let touchStartY = 0;
  let swipeTranslateX = 0;
  let isSwiping = false;

  const RECOMMENDED_PRESETS = [
    {
      title: "Личные",
      subtitle: "Чаты 1 на 1 и боты",
      filters: [8, 9],
    },
    {
      title: "Группы",
      subtitle: "Групповые беседы",
      filters: [3],
    },
    {
      title: "Каналы",
      subtitle: "Информационные каналы",
      filters: [2],
    },
    {
      title: "Боты",
      subtitle: "Полезные боты",
      filters: [10],
    },
  ];

  $: userFolders = ($currentFolders || []).filter(
    (item) => item && item.id !== 0 && item.id !== "all.chat.folder"
  );

  $: availableRecommendations = RECOMMENDED_PRESETS.filter(
    (rec) =>
      !userFolders.some(
        (cur) => cur?.title?.trim().toLowerCase() === rec.title.toLowerCase()
      )
  );

  function finishClose() {
    if (onClose) {
      onClose();
    }
    closeSettingsPage();
    if (typeof window !== "undefined" && window.location.pathname.includes("/settings/folders")) {
      goto("/?card=settings");
    }
  }

  function handleBack(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (isClosing) return;
    isClosing = true;
    setTimeout(() => {
      finishClose();
    }, 200);
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (activeMenuFolderId) {
        closeMenu();
      } else {
        handleBack();
      }
    }
  }

  onMount(() => {
    const timer = setTimeout(() => {
      isOpening = false;
    }, 260);

    if (!isTab) {
      unregisterBack = registerBackHandler(() => {
        if (activeMenuFolderId) {
          closeMenu();
          return false;
        }
        handleBack();
        return true;
      });
    }

    return () => {
      clearTimeout(timer);
      if (unregisterBack) unregisterBack();
    };
  });

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
  });

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    swipeTranslateX = 0;
    isSwiping = false;
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const dx = currentX - touchStartX;
    const dy = currentY - touchStartY;

    if (!isSwiping) {
      if (dx > 12 && dx > Math.abs(dy) * 1.5 && touchStartX < 70) {
        isSwiping = true;
      }
    }

    if (isSwiping && dx > 0) {
      swipeTranslateX = dx;
    }
  }

  function onTouchEnd() {
    if (isSwiping) {
      if (swipeTranslateX > 90) {
        handleBack();
      } else {
        swipeTranslateX = 0;
      }
      isSwiping = false;
    }
  }

  function openCreateFolder() {
    openFolderEdit({ isNew: true });
  }

  function openEditFolder(folder) {
    activeMenuFolderId = null;
    openFolderEdit(folder);
  }

  async function handleDeleteFolder(folder) {
    activeMenuFolderId = null;
    const confirmed = await showConfirm({
      title: `Удалить папку «${folder.title}»?`,
      message: "Чаты при этом не удалятся.",
      confirmText: "Удалить",
      cancelText: "Отмена",
      confirmDanger: true,
    });
    if (confirmed) {
      const api = typeof $API === "function" ? $API() : $API;
      await api.deleteFolders([folder.id]);
    }
  }

  async function addRecommendedFolder(preset) {
    if (creatingFolder) return;
    creatingFolder = true;
    try {
      const api = typeof $API === "function" ? $API() : $API;
      await api.createFolder({
        title: preset.title,
        filters: preset.filters,
        include: [],
      });
    } catch (e) {
      console.error(e);
    } finally {
      creatingFolder = false;
    }
  }

  function closeMenu() {
    activeMenuFolderId = null;
    activeMenuFolder = null;
  }

  function toggleFolderMenu(e, folder) {
    e.stopPropagation();
    if (activeMenuFolderId === folder.id) {
      closeMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = 96;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < menuHeight + 16;
    const top = openUpward ? Math.max(10, rect.top - menuHeight - 4) : (rect.bottom + 4);
    const right = Math.max(16, window.innerWidth - rect.right);

    menuPosition = { top, right };
    activeMenuFolderId = folder.id;
    activeMenuFolder = folder;
  }

  function handleWindowClick(e) {
    if (activeMenuFolderId && !e.target.closest(".fixed-dropdown-menu")) {
      closeMenu();
    }
  }

  function startItemDrag(idx) {
    draggingFolderIndex = idx;
  }

  async function reorderFolders(sourceIdx, destIdx) {
    if (
      destIdx < 0 ||
      destIdx >= userFolders.length ||
      sourceIdx === destIdx
    ) {
      return;
    }
    const list = [...userFolders];
    const [moved] = list.splice(sourceIdx, 1);
    list.splice(destIdx, 0, moved);
    currentFolders.set(list);

    const api = typeof $API === "function" ? $API() : $API;
    const order = list.map((f) => String(f.id));
    await api.reorderFolders(order);
  }

  function onDragOver(e, destIdx) {
    e.preventDefault();
    if (draggingFolderIndex !== null && draggingFolderIndex !== destIdx) {
      const s = draggingFolderIndex;
      draggingFolderIndex = destIdx;
      reorderFolders(s, destIdx);
    }
  }

  function endDrag() {
    draggingFolderIndex = null;
  }

  function formatCountLabel(folder) {
    const count = (folder.include || []).length;
    if (!count) return "";
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${count} чатов`;
    if (mod10 === 1) return `${count} чат`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} чата`;
    return `${count} чатов`;
  }
</script>

<svelte:window on:keydown={handleKeyDown} on:click={handleWindowClick} />

<div
  class="folders-screen"
  class:screen-opening={isOpening}
  class:screen-closing={isClosing}
  on:touchstart={onTouchStart}
  on:touchmove={onTouchMove}
  on:touchend={onTouchEnd}
  style={swipeTranslateX > 0 ? `transform: translate3d(${swipeTranslateX}px, 0, 0); transition: none;` : ""}
>
  <header class="toolbar">
    <button type="button" class="icon-btn" on:click={handleBack} aria-label="Назад">
      <img src="/icons/arrow.svg" alt="" class="back-arrow" />
    </button>
    <h1 class="toolbar-title">Папки</h1>
  </header>

  <div class="scroll-content">
    <div class="card-block">
      <div class="folder-row static-row">
        <div class="left-icon-box">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <div class="row-info">
          <span class="row-title">Все чаты</span>
        </div>
      </div>

      <div class="row-divider"></div>

      {#each userFolders as folder, idx (folder.id)}
        <div
          animate:flip={{ duration: 220, easing: quintOut }}
          class="folder-row draggable-row"
          class:is-dragging={draggingFolderIndex === idx}
          on:click={() => openEditFolder(folder)}
          on:dragover={(e) => onDragOver(e, idx)}
          on:dragend={endDrag}
        >
          <button
            type="button"
            class="drag-handle-btn"
            on:mousedown|stopPropagation={() => startItemDrag(idx)}
            on:touchstart|passive={() => startItemDrag(idx)}
            title="Изменить порядок"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="4" y1="8" x2="20" y2="8"></line>
              <line x1="4" y1="16" x2="20" y2="16"></line>
            </svg>
          </button>

          <div class="row-info">
            <span class="row-title">{folder.title}</span>
            {#if formatCountLabel(folder)}
              <span class="row-sub">{formatCountLabel(folder)}</span>
            {/if}
          </div>

          <div class="action-menu-wrapper">
            <button
              type="button"
              class="dots-btn"
              on:click={(e) => toggleFolderMenu(e, folder)}
              aria-label="Меню папки"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        </div>
      {/each}

      <div class="folder-row create-row" on:click={openCreateFolder}>
        <div class="left-icon-box accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </div>
        <div class="row-info">
          <span class="create-text">Создать папку</span>
        </div>
      </div>
    </div>

    {#if availableRecommendations.length > 0}
      <div class="section-label">РЕКОМЕНДУЕМЫЕ ПАПКИ</div>

      <div class="card-block">
        {#each availableRecommendations as rec, idx (rec.title)}
          {#if idx > 0}
            <div class="row-divider recommendation-divider"></div>
          {/if}
          <div class="recommendation-row" on:click={() => addRecommendedFolder(rec)}>
            <div class="row-info">
              <span class="row-title">{rec.title}</span>
              <span class="row-sub">{rec.subtitle}</span>
            </div>
            <button
              type="button"
              class="add-circle-btn"
              disabled={creatingFolder}
              on:click|stopPropagation={() => addRecommendedFolder(rec)}
              aria-label="Добавить папку"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if activeMenuFolderId && activeMenuFolder}
    <div class="fixed-menu-backdrop" on:click={closeMenu}></div>
    <div
      class="fixed-dropdown-menu"
      style="top: {menuPosition.top}px; right: {menuPosition.right}px;"
      on:click|stopPropagation
    >
      <button
        type="button"
        class="dropdown-item"
        on:click={() => {
          const f = activeMenuFolder;
          closeMenu();
          openEditFolder(f);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        <span>Изменить</span>
      </button>
      <button
        type="button"
        class="dropdown-item danger"
        on:click={() => {
          const f = activeMenuFolder;
          closeMenu();
          handleDeleteFolder(f);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>Удалить</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .folders-screen {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    max-height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: var(--bg-app, #17181c);
    color: var(--text-primary, #ffffff);
    z-index: var(--z-panel, 2);
    will-change: transform, opacity;
  }

  .folders-screen.screen-opening {
    animation: pushInScreen 0.26s cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
  }

  .folders-screen.screen-closing {
    animation: popOutScreen 0.22s cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  @keyframes pushInScreen {
    from {
      opacity: 0;
      transform: translate3d(30px, 0, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes popOutScreen {
    from {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    to {
      opacity: 0;
      transform: translate3d(30px, 0, 0);
    }
  }

  .toolbar {
    display: flex;
    align-items: center;
    height: calc(52px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0;
    background: var(--bg-topbar, #212126);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    border-radius: 50%;
    cursor: pointer;
    color: inherit;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .back-arrow {
    width: 14px;
    height: 14px;
    transform: scaleX(-1);
  }

  .toolbar-title {
    margin: 0 0 0 14px;
    font-size: 19px;
    font-weight: 600;
    color: var(--text-primary, #ffffff);
    letter-spacing: -0.2px;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .scroll-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    padding: 12px 16px calc(24px + var(--safe-bottom, 0px));
    gap: 16px;
    scrollbar-width: thin;
    box-sizing: border-box;
  }

  .card-block {
    background: var(--bg-surface-secondary, #26262e);
    border-radius: 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  .folder-row {
    height: 48px;
    min-height: 48px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    transition: background 0.14s ease;
  }

  .static-row {
    user-select: none;
  }

  .draggable-row {
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    border-bottom: 0.5px solid rgba(255, 255, 255, 0.08);
  }

  .draggable-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .draggable-row.is-dragging {
    opacity: 0.45;
  }

  .create-row {
    cursor: pointer;
    user-select: none;
  }

  .create-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .row-divider {
    height: 0.5px;
    background: rgba(255, 255, 255, 0.08);
    margin-left: 56px;
    flex-shrink: 0;
  }

  .recommendation-divider {
    margin-left: 16px;
  }

  .left-icon-box {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--text-secondary, #8b929e);
  }

  .left-icon-box.accent {
    color: var(--accent-primary, #248bfe);
  }

  .drag-handle-btn {
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #8b929e);
    cursor: grab;
    flex-shrink: 0;
    opacity: 0.7;
    transition: opacity 0.14s ease;
  }

  .drag-handle-btn:hover {
    opacity: 1;
  }

  .row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .row-title {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
  }

  .row-sub {
    font-size: 13px;
    color: var(--text-secondary, #8b929e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
    margin-top: 2px;
  }

  .create-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--accent-primary, #248bfe);
  }

  .action-menu-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .dots-btn {
    width: 36px;
    height: 36px;
    background: none;
    border: none;
    padding: 0;
    border-radius: 50%;
    color: var(--text-secondary, #8b929e);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
  }

  .dots-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-primary, #ffffff);
  }

  .fixed-menu-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    background: transparent;
  }

  .fixed-dropdown-menu {
    position: fixed;
    z-index: 101;
    min-width: 154px;
    background: var(--bg-surface-elevated, #2a2b33);
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: menuFadeIn 0.12s ease-out;
  }

  @keyframes menuFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: none;
    border: none;
    border-radius: 8px;
    color: var(--text-primary, #ffffff);
    font-size: 14px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .dropdown-item.danger {
    color: var(--danger, #ff4d4f);
  }

  .dropdown-item.danger:hover {
    background: rgba(255, 77, 79, 0.12);
  }

  .section-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary, #8b929e);
    text-transform: uppercase;
    padding: 8px 4px 0;
    letter-spacing: 0.3px;
    flex-shrink: 0;
  }

  .recommendation-row {
    height: 56px;
    min-height: 56px;
    flex-shrink: 0;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: background 0.14s ease;
    box-sizing: border-box;
  }

  .recommendation-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .add-circle-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.14s ease, transform 0.12s ease;
  }

  .add-circle-btn:hover:not(:disabled) {
    background: var(--accent-primary-hover, #1a7ae6);
    transform: scale(1.05);
  }

  .add-circle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
