<script>
  import { Button, MenuItem } from "$components/ui";
  import { createEventDispatcher, onMount, onDestroy, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { STYLE_KEYS } from "$lib/formatting/constants.js";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  export let clientX = 0;
  export let clientY = 0;
  export let hasSelection = false;
  export let activeStyles = [];
  export let isMobile = false;
  export let anchorEl = null;

  const dispatch = createEventDispatcher();

  let menuNode;
  let subNode;
  let menuPos = { top: 0, left: 0 };
  let subPos = { top: 0, left: 0 };
  let desktopSubmenuOpen = false;
  let mobileSubmenuOpen = false;
  let showLinkDialog = false;
  let linkInputUrl = "";
  let unregisterBack = null;
  let submenuOpenedAt = 0;

  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modLabel = isMac ? "⌘" : "Ctrl+";
  const shiftModLabel = isMac ? "⇧⌘" : "Ctrl+Shift+";

  async function adjustPosition() {
    await tick();
    if (!menuNode) return;
    const width = menuNode.offsetWidth || 216;
    const height = menuNode.offsetHeight || (menuNode.scrollHeight || 216);
    const vv = typeof window !== "undefined" && window.visualViewport ? window.visualViewport : null;
    const innerWidth = vv ? vv.width : (typeof window !== "undefined" ? window.innerWidth : 360);
    const innerHeight = vv ? vv.height : (typeof window !== "undefined" ? window.innerHeight : 640);
    const offsetTop = vv ? vv.offsetTop : 0;
    const offsetLeft = vv ? vv.offsetLeft : 0;

    let x = clientX;
    let y = clientY;

    let anchorRect = null;
    if (anchorEl && typeof anchorEl.getBoundingClientRect === "function") {
      anchorRect = anchorEl.getBoundingClientRect();
    }

    if (isMobile && anchorRect) {
      y = anchorRect.top - height - 8;
      if (y < offsetTop + 8) {
        if (anchorRect.bottom + height + 8 <= offsetTop + innerHeight - 8) {
          y = anchorRect.bottom + 8;
        } else {
          y = offsetTop + 8;
        }
      }
      x = Math.max(offsetLeft + 8, Math.min(anchorRect.left + (anchorRect.width - width) / 2, offsetLeft + innerWidth - width - 8));
    } else {
      if (x + width > offsetLeft + innerWidth - 8) {
        x = offsetLeft + innerWidth - width - 8;
      }
      if (x < offsetLeft + 8) x = offsetLeft + 8;

      if (y + height > offsetTop + innerHeight - 8) {
        y = offsetTop + innerHeight - height - 8;
      }
      if (y < offsetTop + 8) y = offsetTop + 8;
    }

    menuPos = { top: y, left: x };
  }

  async function updateSubmenuPosition() {
    await tick();
    if (!menuNode) return;
    const vv = typeof window !== "undefined" && window.visualViewport ? window.visualViewport : null;
    const innerWidth = vv ? vv.width : (typeof window !== "undefined" ? window.innerWidth : 360);
    const innerHeight = vv ? vv.height : (typeof window !== "undefined" ? window.innerHeight : 640);
    const offsetTop = vv ? vv.offsetTop : 0;
    const offsetLeft = vv ? vv.offsetLeft : 0;
    const mainRect = menuNode.getBoundingClientRect();
    const subWidth = subNode?.offsetWidth || 220;
    const subHeight = subNode?.offsetHeight || (subNode?.scrollHeight || 250);

    let subX = mainRect.right + 4;
    if (subX + subWidth > offsetLeft + innerWidth - 8) {
      subX = Math.max(offsetLeft + 8, mainRect.left - subWidth - 4);
    }

    const triggerNode = menuNode.querySelector(".format-menu-trigger");
    const triggerRect = triggerNode ? triggerNode.getBoundingClientRect() : mainRect;

    let subY = triggerRect.top;
    if (subY + subHeight > offsetTop + innerHeight - 8) {
      subY = Math.max(offsetTop + 8, mainRect.bottom - subHeight);
    }
    if (subY + subHeight > offsetTop + innerHeight - 8) {
      subY = Math.max(offsetTop + 8, offsetTop + innerHeight - subHeight - 8);
    }

    subPos = { top: subY, left: subX };
  }

  function handleOpenSubmenu(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    submenuOpenedAt = Date.now();
    if (isMobile) {
      mobileSubmenuOpen = true;
      adjustPosition();
    } else {
      desktopSubmenuOpen = true;
      updateSubmenuPosition();
    }
  }

  function handleSubmenuAction(actionFn, e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (Date.now() - submenuOpenedAt < 250) {
      return;
    }
    actionFn();
  }

  function handleBackToMainMenu(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    dispatch("restoreSelection");
    mobileSubmenuOpen = false;
    adjustPosition();
  }

  function handleCloseSubmenu() {
    if (!isMobile) {
      desktopSubmenuOpen = false;
    }
  }

  onMount(() => {
    adjustPosition();
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener("resize", adjustPosition);
      vv.addEventListener("scroll", adjustPosition);
    }
    unregisterBack = registerBackHandler(() => {
      if (showLinkDialog) {
        showLinkDialog = false;
        return false;
      }
      if (mobileSubmenuOpen) {
        handleBackToMainMenu();
        return false;
      }
      if (desktopSubmenuOpen) {
        desktopSubmenuOpen = false;
        return false;
      }
      closeMenu();
      return true;
    });
  });

  onDestroy(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (vv) {
      vv.removeEventListener("resize", adjustPosition);
      vv.removeEventListener("scroll", adjustPosition);
    }
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
  });

  function handleAction(name) {
    dispatch("action", { name });
  }

  function handleFormat(style, metadata = null) {
    dispatch("format", { style, metadata });
    closeMenu();
  }

  function submitLink() {
    if (!linkInputUrl.trim()) return;
    let target = linkInputUrl.trim();
    if (!/^https?:\/\//i.test(target) && !/^max:\/\//i.test(target)) {
      target = "https://" + target;
    }
    dispatch("format", {
      style: STYLE_KEYS.LINK,
      metadata: { attributes: { url: target } },
    });
    closeMenu();
  }

  function closeMenu() {
    dispatch("close");
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      if (mobileSubmenuOpen) {
        mobileSubmenuOpen = false;
        return;
      }
      if (desktopSubmenuOpen) {
        desktopSubmenuOpen = false;
        return;
      }
      closeMenu();
    }
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<div
  class="dropout-backdrop"
  on:click|preventDefault|stopPropagation={closeMenu}
  on:pointerdown|preventDefault|stopPropagation={closeMenu}
  on:touchstart|preventDefault|stopPropagation={closeMenu}
  on:touchend|preventDefault|stopPropagation={closeMenu}
  on:contextmenu|preventDefault|stopPropagation={closeMenu}
  transition:fade={{ duration: 120 }}
></div>

<div
  class="dropout-container"
  bind:this={menuNode}
  style="top: {menuPos.top}px; left: {menuPos.left}px;"
  on:click|stopPropagation
  on:contextmenu|preventDefault|stopPropagation
  transition:fade={{ duration: 150 }}
>
  <div class="telegram-dropout-card">
    {#if showLinkDialog}
      <div class="link-modal-view">
        <div class="link-modal-title">Добавить ссылку</div>
        <input
          type="text"
          class="link-text-input"
          placeholder="https://..."
          bind:value={linkInputUrl}
          on:keydown={(e) => {
            if (e.key === "Enter") submitLink();
            if (e.key === "Escape") showLinkDialog = false;
          }}
          autofocus
        />
        <div class="link-modal-buttons">
          <Button class="inputcontextmenu-btn-dialog inputcontextmenu-cancel" onclick={() => (showLinkDialog = false)}>
            Отмена
          </Button>
          <Button variant="primary" class="inputcontextmenu-btn-dialog" onclick={submitLink}>
            Применить
          </Button>
        </div>
      </div>
    {:else if isMobile && mobileSubmenuOpen}
      <div class="mobile-submenu-header">
        <button
          type="button"
          class="btn-back"
          on:pointerdown|preventDefault|stopPropagation
          on:click={handleBackToMainMenu}
        >
          <svg viewBox="0 0 24 24" class="action-icon">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/>
          </svg>
        </button>
        <span class="header-title">Форматирование</span>
      </div>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.BOLD)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.BOLD)} preventPointer onclick={(e) => handleSubmenuAction(() => handleFormat(STYLE_KEYS.BOLD), e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label bold-label">Жирный</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.ITALIC)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.ITALIC)} preventPointer onclick={(e) => handleSubmenuAction(() => handleFormat(STYLE_KEYS.ITALIC), e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label italic-label">Курсив</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.UNDERLINE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.UNDERLINE)} preventPointer onclick={(e) => handleSubmenuAction(() => handleFormat(STYLE_KEYS.UNDERLINE), e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label underline-label">Подчёркнутый</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.STRIKE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.STRIKE)} preventPointer onclick={(e) => handleSubmenuAction(() => handleFormat(STYLE_KEYS.STRIKE), e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label strike-label">Зачёркнутый</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.CODE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.CODE)} preventPointer onclick={(e) => handleSubmenuAction(() => handleFormat(STYLE_KEYS.CODE), e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label code-label">Моноширинный</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.QUOTE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.QUOTE)} preventPointer onclick={(e) => handleSubmenuAction(() => handleFormat(STYLE_KEYS.QUOTE), e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label">Цитата</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.LINK)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.LINK)} preventPointer onclick={(e) => handleSubmenuAction(() => { showLinkDialog = true; linkInputUrl = ""; }, e)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label">Добавить ссылку...</span></MenuItem>

      {#if activeStyles.length > 0}
        <MenuItem danger class="inputcontextmenu-action-row" preventPointer onclick={(e) => handleSubmenuAction(() => {
            dispatch("clearFormat");
            closeMenu();
          }, e)}>{#snippet icon()}<span class="action-icon">
            <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H18V5H6z" fill="currentColor"/></svg>
          </span>{/snippet}<span class="action-label">Очистить форматирование</span></MenuItem>
      {/if}
    {:else}
      {#if hasSelection}
        <MenuItem class="inputcontextmenu-action-row" preventPointer onclick={() => handleAction("cut")} onmouseenter={handleCloseSubmenu}>{#snippet icon()}<span class="action-icon">
            <svg viewBox="0 0 24 24" class="action-svg" fill="currentColor">
              <path d="M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm0 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm6-7.5c-.28 0-.5-.22-.5-.5s.22-.5.5-.5.5.22.5.5-.22.5-.5.5zM19 3l-6 6 2 2 7-7V3h-3z"/>
            </svg>
          </span>{/snippet}<span class="action-label">Вырезать</span>
          <span class="action-shortcut">{modLabel}X</span></MenuItem>

        <MenuItem class="inputcontextmenu-action-row" preventPointer onclick={() => handleAction("copy")} onmouseenter={handleCloseSubmenu}>{#snippet icon()}<span class="action-icon">
            <svg viewBox="0 0 24 24" class="action-svg" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
          </span>{/snippet}<span class="action-label">Копировать</span>
          <span class="action-shortcut">{modLabel}C</span></MenuItem>
      {/if}

      <MenuItem class="inputcontextmenu-action-row" preventPointer onclick={() => handleAction("paste")} onmouseenter={handleCloseSubmenu}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="action-svg" fill="currentColor">
            <path d="M19 2h-4.18C14.4.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z"/>
          </svg>
        </span>{/snippet}<span class="action-label">Вставить</span>
        <span class="action-shortcut">{modLabel}V</span></MenuItem>

      {#if hasSelection}
        <MenuItem class="inputcontextmenu-action-row" preventPointer onclick={() => handleAction("delete")} onmouseenter={handleCloseSubmenu}>{#snippet icon()}<span class="action-icon">
            <svg viewBox="0 0 24 24" class="action-svg" fill="currentColor">
              <path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7.07L2.4 12l4.66-7H22v14zm-11.59-2L14 13.41 17.59 17 19 15.59 15.41 12 19 8.41 17.59 7 14 10.59 10.41 7 9 8.41 12.59 12 9 15.59z"/>
            </svg>
          </span>{/snippet}<span class="action-label">Стереть</span>
          <span class="action-shortcut">Del</span></MenuItem>
      {/if}

      <MenuItem class="inputcontextmenu-action-row" preventPointer onclick={() => handleAction("selectAll")} onmouseenter={handleCloseSubmenu}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="action-svg" fill="currentColor">
            <path d="M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zm-6 18h2v-2h-2v2zm-8-8h10V7H5v6zm2-4h6v2H7V9zm8 12h2v-2h-2v2zm4-4h2v-2h-2v2zm0-4h2v-2h-2v2zm0-4h2V7h-2v2zm0 12c1.1 0 2-.9 2-2h-2v2z"/>
          </svg>
        </span>{/snippet}<span class="action-label">Выделить все</span>
        <span class="action-shortcut">{modLabel}A</span></MenuItem>

      {#if hasSelection}
        <div class="divider"></div>

        <MenuItem active={desktopSubmenuOpen} class="inputcontextmenu-action-row inputcontextmenu-format-menu-trigger" onmouseenter={handleOpenSubmenu} preventPointer onpointerdown={handleOpenSubmenu} onclick={(e) => { e.preventDefault(); e.stopPropagation(); (handleOpenSubmenu)(e); }}>{#snippet icon()}<span class="action-icon">
            <svg viewBox="0 0 24 24" class="action-svg" fill="currentColor">
              <path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z"/>
            </svg>
          </span>{/snippet}<span class="action-label">Форматирование</span>
          <span class="action-arrow">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
          </span></MenuItem>
      {/if}
    {/if}
  </div>
</div>

{#if !isMobile && desktopSubmenuOpen && !showLinkDialog}
  <div
    class="dropout-container submenu-container"
    bind:this={subNode}
    style="top: {subPos.top}px; left: {subPos.left}px;"
    on:click|stopPropagation
    on:contextmenu|preventDefault|stopPropagation
    transition:fade={{ duration: 130 }}
  >
    <div class="telegram-dropout-card">
      <MenuItem active={activeStyles.includes(STYLE_KEYS.BOLD)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.BOLD)} onclick={() => handleFormat(STYLE_KEYS.BOLD)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label bold-label">Жирный</span>
        <span class="action-shortcut">{modLabel}B</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.ITALIC)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.ITALIC)} onclick={() => handleFormat(STYLE_KEYS.ITALIC)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label italic-label">Курсив</span>
        <span class="action-shortcut">{modLabel}I</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.UNDERLINE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.UNDERLINE)} onclick={() => handleFormat(STYLE_KEYS.UNDERLINE)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label underline-label">Подчёркнутый</span>
        <span class="action-shortcut">{modLabel}U</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.STRIKE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.STRIKE)} onclick={() => handleFormat(STYLE_KEYS.STRIKE)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M10 19h4v-3h-4v3zM5 4v3h5v3h4V7h5V4H5zM3 14h18v-2H3v2z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label strike-label">Зачёркнутый</span>
        <span class="action-shortcut">{shiftModLabel}X</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.CODE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.CODE)} onclick={() => handleFormat(STYLE_KEYS.CODE)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label code-label">Моноширинный</span>
        <span class="action-shortcut">{shiftModLabel}M</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.QUOTE)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.QUOTE)} onclick={() => handleFormat(STYLE_KEYS.QUOTE)}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label">Цитата</span>
        <span class="action-shortcut">{shiftModLabel}Q</span></MenuItem>

      <MenuItem active={activeStyles.includes(STYLE_KEYS.LINK)} class="inputcontextmenu-action-row" checked={activeStyles.includes(STYLE_KEYS.LINK)} onclick={() => { showLinkDialog = true; linkInputUrl = ""; }}>{#snippet icon()}<span class="action-icon">
          <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" fill="currentColor"/></svg>
        </span>{/snippet}<span class="action-label">Добавить ссылку...</span>
        <span class="action-shortcut">{modLabel}K</span></MenuItem>

      {#if activeStyles.length > 0}
        <MenuItem danger class="inputcontextmenu-action-row" onclick={() => {
            dispatch("clearFormat");
            closeMenu();
          }}>{#snippet icon()}<span class="action-icon">
            <svg viewBox="0 0 24 24" class="svg-glyph"><path d="M3.27 5L2 6.27l6.97 6.97L6.5 19h3l1.57-3.66L16.73 21 18 19.73 3.27 5zM6 5v.18L8.82 8h2.4l-.72 1.68 2.1 2.1L14.21 8H18V5H6z" fill="currentColor"/></svg>
          </span>{/snippet}<span class="action-label">Очистить форматирование</span></MenuItem>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dropout-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2999;
    background: transparent;
  }

  .dropout-container {
    position: fixed;
    z-index: 3000;
  }

  .submenu-container {
    z-index: 3001;
  }

  .telegram-dropout-card {
    display: flex;
    flex-direction: column;
    width: 216px;
    max-height: calc(100vh - 24px);
    overflow-y: auto;
    background: #1c1e2a;
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6), 0 2px 10px rgba(0, 0, 0, 0.3);
    padding: 6px 0;
  }

  .mobile-submenu-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .btn-back {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
  }

  .header-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  :global(.inputcontextmenu-action-row)  { width: 100%; }

  .action-icon {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .action-svg {
    width: 16px;
    height: 16px;
  }

  .svg-glyph {
    width: 17px;
    height: 17px;
  }

  .action-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bold-label {
    font-weight: 700;
  }

  .italic-label {
    font-style: italic;
  }

  .underline-label {
    text-decoration: underline;
  }

  .strike-label {
    text-decoration: line-through;
  }

  .code-label {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12.5px;
  }

  .action-shortcut {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    margin-left: auto;
    flex-shrink: 0;
  }

  .action-arrow {
    margin-left: auto;
    color: rgba(255, 255, 255, 0.4);
    display: flex;
    align-items: center;
  }

  .divider {
    height: 1px;
    background: var(--bg-surface);
    margin: 4px 0;
  }

  .link-modal-view {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .link-modal-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .link-text-input {
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 13px;
    padding: 7px 10px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  .link-text-input:focus {
    border-color: var(--accent-violet);
  }

  .link-modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
