<script>
  import { Button, IconButton, Modal } from "$components/ui";
  import { createEventDispatcher } from "svelte";
  import { flip } from "svelte/animate";
  import { quintOut, cubicOut } from "svelte/easing";
  import { fade, fly } from "svelte/transition";
  import { panelConfig, CATALOG } from "$lib/stores/panel.js";

  const dispatch = createEventDispatcher();

  export let pages = [];
  export let active = 0;

  let isEditing = false;
  let draggingIndex = null;
  let showAddModal = false;
  let longPressTimer = null;
  let startX = 0;
  let startY = 0;
  let isLongPressTriggered = false;
  let lastReorderTime = 0;
  const REORDER_COOLDOWN = 180;

  $: currentDefault = $panelConfig.defaultItem;
  $: availableCatalogItems = Object.values(CATALOG).filter(
    (item) => !pages.some((p) => p.id === item.id)
  );

  function handleClick(index, page) {
    if (isEditing || isLongPressTriggered) return;
    dispatch("open", { index, page });
  }

  function startLongPress(index, e) {
    if (isEditing) {
      draggingIndex = index;
      return;
    }
    isLongPressTriggered = false;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;

    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      isEditing = true;
      isLongPressTriggered = true;
      draggingIndex = index;
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        try {
          navigator.vibrate(35);
        } catch {}
      }
    }, 450);
  }

  function cancelLongPress(e) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handlePointerMove(e) {
    if (!isEditing) {
      if (longPressTimer) {
        const pt = e.touches ? e.touches[0] : e;
        if (Math.abs(pt.clientX - startX) > 10 || Math.abs(pt.clientY - startY) > 10) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
      return;
    }

    if (draggingIndex === null) return;
    if (Date.now() - lastReorderTime < REORDER_COOLDOWN) return;

    let clientX;
    if (e.type.startsWith("touch")) {
      clientX = e.touches[0].clientX;
      if (e.cancelable) e.preventDefault();
    } else {
      clientX = e.clientX;
    }

    let hoverIndex = -1;
    const wrappers = document.querySelectorAll(".panel .option-wrapper");
    if (wrappers.length > 0) {
      const firstRect = wrappers[0].getBoundingClientRect();
      const lastRect = wrappers[wrappers.length - 1].getBoundingClientRect();
      if (clientX <= firstRect.left) {
        hoverIndex = 0;
      } else if (clientX >= lastRect.right) {
        hoverIndex = wrappers.length - 1;
      } else {
        for (let i = 0; i < wrappers.length; i++) {
          const rect = wrappers[i].getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right) {
            hoverIndex = parseInt(wrappers[i].dataset.index, 10);
            break;
          }
        }
      }
    }

    if (hoverIndex !== -1 && hoverIndex !== draggingIndex && hoverIndex >= 0 && hoverIndex < pages.length) {
      const nextIds = pages.map((p) => p.id);
      const [moved] = nextIds.splice(draggingIndex, 1);
      nextIds.splice(hoverIndex, 0, moved);
      draggingIndex = hoverIndex;
      lastReorderTime = Date.now();
      panelConfig.reorder(nextIds);
    }
  }

  function handlePointerEnd() {
    cancelLongPress();
    draggingIndex = null;
    setTimeout(() => {
      isLongPressTriggered = false;
    }, 100);
  }

  function exitEditing() {
    isEditing = false;
    showAddModal = false;
    draggingIndex = null;
  }

  function handleRemove(e, pageId) {
    e.stopPropagation();
    if (pageId === "settings") return;
    panelConfig.removeItem(pageId);
  }

  function handleSetDefault(e, pageId) {
    e.stopPropagation();
    panelConfig.setDefaultItem(pageId);
  }

  function handleAddItem(catalogId) {
    panelConfig.addItem(catalogId);
    showAddModal = false;
  }
</script>

<svelte:window
  on:mouseup={handlePointerEnd}
  on:mousemove={handlePointerMove}
  on:touchend={handlePointerEnd}
  on:touchmove|nonpassive={handlePointerMove}
/>

{#if isEditing}
  <div class="edit-backdrop" on:click={exitEditing} transition:fade={{ duration: 180 }}></div>
{/if}

<div class="panel-container" class:editing={isEditing}>
  {#if isEditing}
    <div class="edit-toolbar" transition:fly={{ y: 20, duration: 200, easing: cubicOut }}>
      <Button variant="ghost" class="panel-toolbar-btn panel-add-btn" disabled={availableCatalogItems.length === 0} onclick={(e) => { e.stopPropagation(); (() => (showAddModal = true))(e); }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span>Добавить</span>
      </Button>

      <span class="toolbar-hint">Зажмите и тяните</span>

      <Button variant="ghost" class="panel-toolbar-btn panel-done-btn" onclick={(e) => { e.stopPropagation(); (exitEditing)(e); }}>
        <span>Готово</span>
      </Button>
    </div>
  {/if}

  <div class="panel">
    {#each pages as page, index (page.id || page.name)}
      <div
        animate:flip={{ duration: 220, easing: quintOut }}
        class="option-wrapper"
        class:shaking={isEditing}
        class:dragging={draggingIndex === index}
        data-index={index}
        on:mousedown={(e) => startLongPress(index, e)}
        on:touchstart|passive={(e) => startLongPress(index, e)}
      >
        <div
          class="option"
          class:active={index === active && !isEditing}
          class:editing-item={isEditing}
          on:click={() => handleClick(index, page)}
        >
          {#if isEditing}
            <button
              class="star-badge"
              class:is-default={currentDefault === page.id}
              title={currentDefault === page.id ? "Главная страница" : "Сделать главной"}
              on:click|stopPropagation={(e) => handleSetDefault(e, page.id)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill={currentDefault === page.id ? "#ffd700" : "none"}
                stroke={currentDefault === page.id ? "#ffd700" : "#bbb"}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </button>

            {#if page.id !== "settings"}
              <button
                class="remove-badge"
                title="Удалить из меню"
                on:click|stopPropagation={(e) => handleRemove(e, page.id)}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            {:else}
              <div class="lock-badge" title="Настройки нельзя удалить">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
            {/if}
          {/if}

          <div class="icon-box">
            <span
              class="icon-mask"
              aria-hidden="true"
              style="--icon-url: url('icons/{page.icon}.svg')"
            ></span>
            {#if page.dot}
              <span class="dot" aria-hidden="true"></span>
            {/if}
          </div>
          <span class="label">{page.name}</span>
        </div>
      </div>
    {/each}
  </div>
</div>

{#if showAddModal}
  <Modal open={true} bare closeOnEsc={true} position="bottom" zIndex={1100} onclose={() => (showAddModal = false)}>
    <div class="modal-sheet">
      <div class="sheet-top">
        <span class="sheet-title">Добавить в меню</span>
        <IconButton class="panel-sheet-close" onclick={() => (showAddModal = false)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </IconButton>
      </div>

      <div class="catalog-list">
        {#each availableCatalogItems as item}
          <div class="catalog-item" on:click={() => handleAddItem(item.id)}>
            <div class="catalog-icon">
              <img src={"icons/" + item.icon + ".svg"} alt={item.name} />
            </div>
            <div class="catalog-info">
              <span class="catalog-name">{item.name}</span>
            </div>
            <IconButton class="panel-add-action-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </IconButton>
          </div>
        {/each}
        {#if availableCatalogItems.length === 0}
          <div class="empty-hint">Все доступные пункты уже добавлены в меню</div>
        {/if}
      </div>
    </div>
  </Modal>
{/if}

<style>
  .edit-backdrop {
    position: fixed;
    inset: 0;
    z-index: 998;
    background: rgba(0, 0, 0, 0.45);
  }

  .panel-container {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .panel-container.editing {
    z-index: 999;
  }

  .edit-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: calc(100% - 24px);
    max-width: 500px;
    margin-bottom: 8px;
    padding: 6px 12px;
    background: #25262c;
    border: 1px solid #383a45;
    border-radius: 14px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    box-sizing: border-box;
  }

  .toolbar-hint {
    font-size: 12px;
    color: var(--text-muted);
  }







  /* === Tabbar — ported from Max (svelte-1wa3uxr / svelte-xwrwgf) === */
  .panel {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: 8px;
    padding-left: 12px;
    padding-right: 12px;
    background: var(--float-primary-flat, var(--bg-panel));
    box-shadow: 0 -1px 24px var(--shadow-tabbar-color, #0000001a);
    color: var(--tabbar-inactive, #969699);
    box-sizing: border-box;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .panel-container.editing .panel {
    background: var(--float-primary-flat, var(--bg-panel));
  }

  .option-wrapper {
    flex: 1 1 0;
    min-width: 0;
    height: 56px;
    box-sizing: content-box;
    padding: 10px 0 var(--panel-safe-bottom, max(env(safe-area-inset-bottom, 0px), 10px));
    display: flex;
    align-items: stretch;
    justify-content: center;
    position: relative;
    touch-action: pan-y;
    transform-origin: 50% 50%;
  }

  .option-wrapper.dragging {
    opacity: 0.5;
    transform: scale(1.08);
    z-index: 100;
  }

  @keyframes shake {
    0% {
      transform: rotate(-1.5deg);
    }
    50% {
      transform: rotate(1.5deg);
    }
    100% {
      transform: rotate(-1.5deg);
    }
  }

  .option-wrapper.shaking {
    transform-origin: 50% 50%;
    animation: shake 0.5s infinite ease-in-out;
    cursor: grab;
    touch-action: none;
  }

  .option-wrapper:nth-child(even).shaking {
    animation-duration: 0.54s;
    animation-delay: -0.27s;
  }

  .option {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    height: 100%;
    padding: 8px 2px;
    gap: 2px;
    font: 400 var(--font-tag-size, 11px) / var(--font-tag-line-height, 16px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-tag-letter-spacing, 0.3px);
    color: var(--tabbar-inactive, #969699);
    text-align: center;
    cursor: pointer;
    position: relative;
    box-sizing: border-box;
    border-radius: 12px;
    border: 1px solid transparent;
    transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.1s;
    transform-origin: 50% 50%;
  }

  .option.active {
    color: var(--tabbar-active, var(--accent-primary));
  }

  .option.editing-item {
    background: var(--bg-surface);
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  .option.editing-item:hover {
    background: var(--bg-surface-2);
    border-color: rgba(255, 255, 255, 0.26);
  }

  .option-wrapper.dragging .option {
    background: rgba(0, 119, 255, 0.18);
    border-color: rgba(0, 119, 255, 0.55);
    box-shadow: 0 4px 14px rgba(0, 119, 255, 0.25);
  }

  .star-badge {
    position: absolute;
    top: -5px;
    left: -2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #25262c;
    border: 1px solid #4a4d5e;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    cursor: pointer;
    z-index: 10;
    line-height: 0;
    transition: transform 0.15s, background-color 0.15s, border-color 0.15s;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
  }

  .star-badge.is-default {
    background: #2b2612;
    border-color: #ffd700;
    box-shadow: 0 2px 8px rgba(255, 215, 0, 0.3);
  }

  .star-badge:hover {
    transform: scale(1.15);
  }

  .star-badge svg {
    display: block;
    margin: auto;
    pointer-events: none;
    transform: translateY(0.5px);
  }

  .remove-badge {
    position: absolute;
    top: -5px;
    right: -2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ef4444;
    color: #fff;
    border: 1px solid #b91c1c;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    cursor: pointer;
    z-index: 10;
    line-height: 0;
    transition: transform 0.15s;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
  }

  .remove-badge:hover {
    transform: scale(1.15);
    background: #dc2626;
  }

  .remove-badge svg {
    display: block;
    margin: auto;
    pointer-events: none;
  }

  .lock-badge {
    position: absolute;
    top: -5px;
    right: -2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #374151;
    color: var(--text-muted);
    border: 1px solid #4b5563;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    z-index: 10;
    line-height: 0;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
  }

  .lock-badge svg {
    display: block;
    margin: auto;
    pointer-events: none;
  }

  .icon-box {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  /* SVG из static/icons красится в currentColor через маску */
  .icon-mask {
    display: block;
    width: 24px;
    height: 24px;
    background-color: currentColor;
    -webkit-mask: var(--icon-url) center / contain no-repeat;
    mask: var(--icon-url) center / contain no-repeat;
    pointer-events: none;
  }

  .dot {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--counter-attention, #ff303c);
    outline: 2px solid var(--float-primary-flat, var(--bg-panel, #fff));
    pointer-events: none;
  }


  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    padding: 0 4px;
    box-sizing: border-box;
    text-align: center;
    color: inherit;
  }




  .modal-sheet {
    background: var(--bg-sheet);
    width: 100%;
    max-width: 480px;
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    border: 1px solid #32343e;
    border-bottom: none;
    display: flex;
    flex-direction: column;
    max-height: 70vh;
    padding-bottom: env(safe-area-inset-bottom, 20px);
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.5);
  }

  .sheet-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .sheet-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }


  .catalog-list {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
  }

  .catalog-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    background: #272830;
    border: 1px solid #363844;
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .catalog-item:hover {
    background: #2e303a;
    border-color: var(--accent-primary);
  }

  .catalog-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--bg-surface);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .catalog-icon img {
    width: 20px;
    height: 20px;
    filter: invert(70%);
  }

  .catalog-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .catalog-name {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  :global(.panel-add-action-btn)  { width: 32px; }

  .empty-hint {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
  }
</style>
