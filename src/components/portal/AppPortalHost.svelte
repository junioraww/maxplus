<script>
  import { onDestroy, setContext } from "svelte";
  import {
    layerStack,
    dismissLayer,
    finalizeLayer,
  } from "$lib/services/layerManager";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { getSafeAreaInsets } from "$lib/utils/safeArea";

  setContext("appPortalHost", true);

  let unregisterBack = null;
  let enteredLayers = new Set();

  function markEntered(id) {
    if (!enteredLayers.has(id)) {
      enteredLayers.add(id);
      enteredLayers = new Set(enteredLayers);
    }
  }

  $: {
    for (const l of $layerStack) {
      if (!enteredLayers.has(l.id)) {
        setTimeout(() => markEntered(l.id), 280);
      }
    }
  }

  $: activeLayers = $layerStack.filter((l) => !l.isClosing);
  $: hasLayers = activeLayers.length > 0;

  let lastActiveLayerCount = 0;
  let lastTopLayerId = null;

  $: {
    const count = activeLayers.length;
    const topId = count > 0 ? activeLayers[count - 1].id : null;
    if (count !== lastActiveLayerCount || topId !== lastTopLayerId) {
      lastActiveLayerCount = count;
      lastTopLayerId = topId;
      if (count > 0) {
        if (typeof unregisterBack === "function") {
          const fn = unregisterBack;
          unregisterBack = null;
          fn();
        }
        unregisterBack = registerBackHandler(handleBackPress);
      } else {
        if (typeof unregisterBack === "function") {
          const fn = unregisterBack;
          unregisterBack = null;
          fn();
        }
      }
    }
  }

  onDestroy(() => {
    if (typeof unregisterBack === "function") {
      const fn = unregisterBack;
      unregisterBack = null;
      fn();
    }
  });

  async function handleBackPress() {
    const active = $layerStack.filter((l) => !l.isClosing);
    if (active.length === 0) return true;

    const top = active[active.length - 1];

    if (typeof top.customBackHandler === "function") {
      const handled = await top.customBackHandler();
      if (handled === false) return false;
    } else if (typeof top.options?.onBack === "function") {
      const handled = await top.options.onBack();
      if (handled === false) return false;
    }

    dismissLayer(top.id);
    return false;
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      const active = $layerStack.filter((l) => !l.isClosing);
      if (active.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleBackPress();
      }
    }
  }

  function handleScrimClick() {
    const active = $layerStack.filter((l) => !l.isClosing);
    if (active.length === 0) return;
    const top = active[active.length - 1];
    if (top.options?.dismissOnDim !== false) {
      dismissLayer(top.id);
    }
  }

  $: allDimmingLayers = $layerStack.filter((l) => l.options?.dim && l.type !== "screen" && l.type !== "viewer");
  $: hasDimmingLayer = allDimmingLayers.length > 0;
  $: anyDimmingActive = allDimmingLayers.some((l) => !l.isClosing);
  $: topDimLayer = allDimmingLayers[allDimmingLayers.length - 1];
  $: topDimLayerIndex = topDimLayer ? $layerStack.indexOf(topDimLayer) : -1;
  $: scrimOpacity = anyDimmingActive
    ? (topDimLayer?.options?.dimOpacity ?? 0.65)
    : 0;

  $: topOpaqueScreenIndex = (() => {
    for (let i = $layerStack.length - 1; i >= 0; i--) {
      const l = $layerStack[i];
      if (l.type === "screen" && !l.isClosing && !l.options?.transparent) {
        return i;
      }
    }
    return -1;
  })();

  function getLayerZIndex(layer, idx) {
    const offset =
      layer.type === "screen"
        ? 1
        : layer.type === "drawer"
        ? 2
        : layer.type === "sheet"
        ? 4
        : layer.type === "dialog"
        ? 6
        : layer.type === "dropout"
        ? 15
        : layer.type === "viewer"
        ? 20
        : 25;
    return `calc(var(--z-modal) + ${idx * 10 + offset})`;
  }

  $: scrimZIndex = topDimLayerIndex >= 0
    ? `calc(var(--z-modal) + ${topDimLayerIndex * 10})`
    : "var(--z-modal-backdrop)";

  let activeSwipeLayerId = null;
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartTime = 0;
  let swipeOffsetX = 0;
  let isSwiping = false;
  let isFinishingSwipe = false;

  function isInteractiveElement(target) {
    return Boolean(
      target.closest(
        "input, textarea, select, button, a, [role='button'], .chips-scroll, .tg-seg-btn, .clickable, .tab-btn, .avatar-camera-badge, .btn"
      )
    );
  }

  function onScreenPointerDown(e, layer) {
    if ((layer.type !== "screen" && layer.type !== "drawer") || layer.isClosing || layer.options?.canSwipe === false) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const winWidth = typeof window !== "undefined" ? window.innerWidth : 380;
    const targetRect = e.currentTarget.getBoundingClientRect();
    const edgeThreshold = Math.max(120, winWidth * 0.35);
    const isEdge = (e.clientX - targetRect.left) <= edgeThreshold;
    const isHeader = Boolean(e.target.closest("header, [class*='topbar'], [class*='toolbar'], [class*='header'], .nav-bar, .settings-topbar, .toolbar, .top-nav, .tg-topbar, .settings-header"));

    if (!isEdge && !isHeader) return;

    if (isHeader && !isEdge && Boolean(e.target.closest("button, a, input, select, textarea, [role='button']"))) {
      return;
    }

    if (isEdge && Boolean(e.target.closest("input, select, textarea"))) {
      return;
    }

    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swipeStartTime = Date.now();
    swipeOffsetX = 0;
    isSwiping = false;
    isFinishingSwipe = false;
    activeSwipeLayerId = layer.id;
  }

  function onScreenTouchMove(e, layer) {
    if (activeSwipeLayerId !== layer.id || isFinishingSwipe) return;
    const touch = e.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    if ((isSwiping || (dx > 6 && dx > Math.abs(dy) * 0.75)) && e.cancelable) {
      e.preventDefault();
    }
  }

  function onScreenPointerMove(e, layer) {
    if (activeSwipeLayerId !== layer.id || isFinishingSwipe) return;
    const dx = e.clientX - swipeStartX;
    const dy = e.clientY - swipeStartY;

    if (!isSwiping) {
      if (dx > 7 && dx > Math.abs(dy) * 0.75) {
        isSwiping = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
      } else if (Math.abs(dy) > 38 || dx < -14) {
        activeSwipeLayerId = null;
        return;
      }
    }

    if (isSwiping && dx >= 0) {
      if (e.cancelable) e.preventDefault();
      swipeOffsetX = dx;
    }
  }

  function onScreenPointerUp(e, layer) {
    try {
      if (e.currentTarget?.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}

    if (activeSwipeLayerId !== layer.id || !isSwiping || isFinishingSwipe) {
      activeSwipeLayerId = null;
      isSwiping = false;
      swipeOffsetX = 0;
      return;
    }

    const winWidth = typeof window !== "undefined" ? window.innerWidth : 380;
    const dt = Math.max(1, Date.now() - swipeStartTime);
    const velocity = swipeOffsetX / dt;
    const threshold = Math.min(winWidth * 0.28, 110);
    const shouldClose = swipeOffsetX >= threshold || (velocity > 0.42 && swipeOffsetX >= 28);
    const targetX = shouldClose ? winWidth : 0;

    isFinishingSwipe = true;
    requestAnimationFrame(() => {
      swipeOffsetX = targetX;
      setTimeout(() => {
        if (shouldClose) {
          finalizeLayer(layer.id, layer.result);
        }
        activeSwipeLayerId = null;
        isSwiping = false;
        isFinishingSwipe = false;
        swipeOffsetX = 0;
      }, 210);
    });
  }

  let activeSheetLayerId = null;
  let sheetStartY = 0;
  let sheetStartTime = 0;
  let sheetCurrentDy = 0;
  let isDraggingSheet = false;
  let isFinishingSheet = false;

  function onSheetPointerDown(e, layer) {
    if (layer.type !== "sheet" || layer.isClosing || layer.options?.canSwipe === false) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isInteractiveElement(e.target)) return;

    const target = e.target;
    const isHandle = target.closest(".bottom-sheet-handle, .drag-pill, .sheet-header, .bottom-sheet-header, .sheet-drag-handle, .modal-header, .sheet-handle");
    const scrollParent = target.closest(".bottom-sheet-content, .scrollable, .sheet-content, .modal-content");
    const isAtTop = !scrollParent || scrollParent.scrollTop <= 0;

    if (!isHandle && !isAtTop) return;

    sheetStartY = e.clientY;
    sheetStartTime = Date.now();
    sheetCurrentDy = 0;
    isDraggingSheet = false;
    isFinishingSheet = false;
    activeSheetLayerId = layer.id;
  }

  function onSheetPointerMove(e, layer) {
    if (activeSheetLayerId !== layer.id || isFinishingSheet) return;
    const dy = e.clientY - sheetStartY;

    if (!isDraggingSheet) {
      if (dy > 6) {
        isDraggingSheet = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {}
      } else if (dy < -20) {
        activeSheetLayerId = null;
        return;
      }
    }

    if (isDraggingSheet && dy >= 0) {
      if (e.cancelable) e.preventDefault();
      sheetCurrentDy = dy;
    }
  }

  function onSheetPointerUp(e, layer) {
    try {
      if (e.currentTarget?.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}

    if (activeSheetLayerId !== layer.id || !isDraggingSheet || isFinishingSheet) {
      activeSheetLayerId = null;
      isDraggingSheet = false;
      sheetCurrentDy = 0;
      return;
    }

    const dt = Math.max(1, Date.now() - sheetStartTime);
    const velocity = sheetCurrentDy / dt;
    const threshold = 82;
    const shouldClose = sheetCurrentDy >= threshold || (velocity > 0.42 && sheetCurrentDy >= 25);
    const targetDy = shouldClose ? (typeof window !== "undefined" ? window.innerHeight : 600) : 0;

    isFinishingSheet = true;
    requestAnimationFrame(() => {
      sheetCurrentDy = targetDy;
      setTimeout(() => {
        if (shouldClose) {
          finalizeLayer(layer.id);
        }
        activeSheetLayerId = null;
        isDraggingSheet = false;
        isFinishingSheet = false;
        sheetCurrentDy = 0;
      }, 210);
    });
  }

  function onTransitionEnd(e, layer) {
    if (e && e.target !== e.currentTarget) return;
    if (layer.isClosing) {
      finalizeLayer(layer.id, layer.result);
    }
  }

  function computeDropoutPosition(coords) {
    const safe = getSafeAreaInsets();
    const minX = safe.left + 8;
    const minY = safe.top + 8;
    if (!coords) return `top: ${minY + 52}px; left: ${minX + 8}px;`;
    const w = typeof window !== "undefined" ? window.innerWidth : 360;
    const h = typeof window !== "undefined" ? window.innerHeight : 640;
    const maxX = Math.max(minX, w - safe.right - 228);
    const maxY = Math.max(minY, h - safe.bottom - 268);
    const x = Math.max(minX, Math.min(maxX, coords.x ?? minX + 8));
    const y = Math.max(minY, Math.min(maxY, coords.y ?? minY + 8));
    return `top: ${y}px; left: ${x}px; max-width: calc(100vw - ${safe.left + safe.right + 16}px); max-height: calc(100dvh - ${safe.top + safe.bottom + 16}px);`;
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if $layerStack.length > 0}
  <div class="portal-root" role="region" aria-label="Portals">
    {#if hasDimmingLayer}
      <div
        class="portal-global-scrim"
        style="opacity: {scrimOpacity}; z-index: {scrimZIndex};"
        on:click={handleScrimClick}
        role="presentation"
      ></div>
    {/if}

    {#each $layerStack as layer, idx (layer.id)}
      {@const isScreen = layer.type === "screen"}
      {@const isDormant = isScreen && topOpaqueScreenIndex > idx}
      {@const isDirectlyUnderSwiping = isDormant && activeSwipeLayerId && topOpaqueScreenIndex === idx + 1 && isSwiping}

      {#if layer.type === "screen"}
        <div
          class="portal-layer-screen"
          class:layer-entering={!enteredLayers.has(layer.id)}
          class:layer-closing={layer.isClosing}
          class:layer-dormant={isDormant}
          class:layer-transparent={layer.options?.transparent}
          class:layer-no-anim={layer.options?.noAnimation}
          class:swiping={activeSwipeLayerId === layer.id && isSwiping}
          inert={isDormant || layer.isClosing ? true : null}
          style="z-index: {getLayerZIndex(layer, idx)}; {activeSwipeLayerId === layer.id && isSwiping ? `transform: translate3d(${swipeOffsetX}px, 0, 0); opacity: ${isFinishingSwipe && swipeOffsetX > 0 ? 0 : Math.max(0, 1 - (swipeOffsetX / (typeof window !== 'undefined' ? window.innerWidth : 380)) * 0.9)}; ${isFinishingSwipe ? 'transition: transform 210ms cubic-bezier(0.15, 0.9, 0.25, 1), opacity 210ms ease;' : 'transition: none;'}` : isDirectlyUnderSwiping ? `transform: translate3d(${-14 + (swipeOffsetX / (typeof window !== 'undefined' ? window.innerWidth : 380)) * 14}px, 0, 0); opacity: 1; visibility: visible; ${isFinishingSwipe ? 'transition: transform 210ms cubic-bezier(0.15, 0.9, 0.25, 1);' : 'transition: none;'}` : ''}"
          on:pointerdown={(e) => onScreenPointerDown(e, layer)}
          on:touchmove={(e) => onScreenTouchMove(e, layer)}
          on:pointermove={(e) => onScreenPointerMove(e, layer)}
          on:pointerup={(e) => onScreenPointerUp(e, layer)}
          on:pointercancel={(e) => onScreenPointerUp(e, layer)}
          on:transitionend={(e) => onTransitionEnd(e, layer)}
          on:animationend={(e) => {
            if (e.target !== e.currentTarget) return;
            markEntered(layer.id);
            onTransitionEnd(e, layer);
          }}
        >
          <svelte:component
            this={layer.component}
            {...layer.props}
            setBackHandler={(fn) => {
              layer.customBackHandler = fn;
            }}
            close={(res) => dismissLayer(layer.id, res)}
            onClose={(res) => dismissLayer(layer.id, res)}
            on:close={(e) => dismissLayer(layer.id, e?.detail)}
            on:cancel={() => dismissLayer(layer.id, false)}
            on:confirm={(e) => dismissLayer(layer.id, e?.detail ?? true)}
          />
        </div>

      {:else if layer.type === "sheet"}
        <div
          class="portal-layer-sheet-container"
          class:layer-closing={layer.isClosing}
          style="z-index: {getLayerZIndex(layer, idx)};"
          on:transitionend={(e) => onTransitionEnd(e, layer)}
          on:animationend={(e) => onTransitionEnd(e, layer)}
        >
          <div
            class="portal-sheet-wrapper"
            class:sheet-entering={!enteredLayers.has(layer.id)}
            class:dragging={activeSheetLayerId === layer.id && isDraggingSheet}
            style={activeSheetLayerId === layer.id && isDraggingSheet ? `transform: translate3d(0, ${sheetCurrentDy}px, 0); opacity: ${isFinishingSheet && sheetCurrentDy > 0 ? 0 : 1}; ${isFinishingSheet ? 'transition: transform 210ms cubic-bezier(0.15, 0.9, 0.25, 1), opacity 210ms ease;' : 'transition: none;'}` : ''}
            on:pointerdown={(e) => onSheetPointerDown(e, layer)}
            on:pointermove={(e) => onSheetPointerMove(e, layer)}
            on:pointerup={(e) => onSheetPointerUp(e, layer)}
            on:pointercancel={(e) => onSheetPointerUp(e, layer)}
            on:animationend={(e) => {
              markEntered(layer.id);
              onTransitionEnd(e, layer);
            }}
          >
            <svelte:component
              this={layer.component}
              {...layer.props}
              setBackHandler={(fn) => {
                layer.customBackHandler = fn;
              }}
              close={(res) => dismissLayer(layer.id, res)}
              onClose={(res) => dismissLayer(layer.id, res)}
              on:close={(e) => dismissLayer(layer.id, e?.detail)}
              on:cancel={() => dismissLayer(layer.id, false)}
              on:confirm={(e) => dismissLayer(layer.id, e?.detail ?? true)}
            />
          </div>
        </div>

      {:else if layer.type === "dialog"}
        <div
          class="portal-layer-dialog-container"
          class:layer-closing={layer.isClosing}
          style="z-index: {getLayerZIndex(layer, idx)};"
          on:transitionend={(e) => onTransitionEnd(e, layer)}
          on:animationend={(e) => onTransitionEnd(e, layer)}
        >
          <svelte:component
            this={layer.component}
            {...layer.props}
            setBackHandler={(fn) => {
              layer.customBackHandler = fn;
            }}
            close={(res) => dismissLayer(layer.id, res)}
            onClose={(res) => dismissLayer(layer.id, res)}
            on:close={(e) => dismissLayer(layer.id, e?.detail)}
            on:cancel={() => dismissLayer(layer.id, false)}
            on:confirm={(e) => dismissLayer(layer.id, e?.detail ?? true)}
          />
        </div>

      {:else if layer.type === "dropout"}
        <div
          class="portal-layer-dropout-container"
          class:layer-closing={layer.isClosing}
          style="z-index: {getLayerZIndex(layer, idx)};"
          on:transitionend={(e) => onTransitionEnd(e, layer)}
          on:animationend={(e) => onTransitionEnd(e, layer)}
        >
          <div
            class="portal-dropout-backdrop"
            on:click={() => dismissLayer(layer.id)}
            role="presentation"
          ></div>
          <div
            class="portal-dropout-wrapper"
            style={computeDropoutPosition(layer.options?.coords)}
          >
            <svelte:component
              this={layer.component}
              {...layer.props}
              setBackHandler={(fn) => {
                layer.customBackHandler = fn;
              }}
              close={(res) => dismissLayer(layer.id, res)}
              onClose={(res) => dismissLayer(layer.id, res)}
              on:close={(e) => dismissLayer(layer.id, e?.detail)}
              on:cancel={() => dismissLayer(layer.id, false)}
              on:confirm={(e) => dismissLayer(layer.id, e?.detail ?? true)}
            />
          </div>
        </div>

      {:else if layer.type === "drawer"}
        <div
          class="portal-layer-drawer-container"
          class:layer-closing={layer.isClosing}
          style="z-index: {getLayerZIndex(layer, idx)};"
          on:transitionend={(e) => onTransitionEnd(e, layer)}
          on:animationend={(e) => onTransitionEnd(e, layer)}
        >
          <div
            class="portal-drawer-wrapper"
            class:drawer-entering={!enteredLayers.has(layer.id)}
            class:swiping={activeSwipeLayerId === layer.id && isSwiping}
            style={activeSwipeLayerId === layer.id && isSwiping && swipeOffsetX > 0
              ? `transform: translate3d(${swipeOffsetX}px, 0, 0); opacity: ${isFinishingSwipe && swipeOffsetX > 0 ? 0.3 : 1}; ${isFinishingSwipe ? 'transition: transform 190ms cubic-bezier(0.2, 0.8, 0.3, 1), opacity 190ms ease;' : 'transition: none;'}`
              : ""}
            on:pointerdown={(e) => onScreenPointerDown(e, layer)}
            on:pointermove={(e) => onScreenPointerMove(e, layer)}
            on:pointerup={(e) => onScreenPointerUp(e, layer)}
            on:pointercancel={(e) => onScreenPointerUp(e, layer)}
            on:animationend={(e) => {
              markEntered(layer.id);
              onTransitionEnd(e, layer);
            }}
          >
            <svelte:component
              this={layer.component}
              {...layer.props}
              setBackHandler={(fn) => {
                layer.customBackHandler = fn;
              }}
              close={(res) => dismissLayer(layer.id, res)}
              onClose={(res) => dismissLayer(layer.id, res)}
              on:close={(e) => dismissLayer(layer.id, e?.detail)}
              on:cancel={() => dismissLayer(layer.id, false)}
              on:confirm={(e) => dismissLayer(layer.id, e?.detail ?? true)}
            />
          </div>
        </div>

      {:else if layer.type === "viewer"}
        <div
          class="portal-layer-viewer-container"
          class:layer-closing={layer.isClosing}
          style="z-index: {getLayerZIndex(layer, idx)};"
          on:transitionend={(e) => onTransitionEnd(e, layer)}
          on:animationend={(e) => onTransitionEnd(e, layer)}
        >
          <svelte:component
            this={layer.component}
            {...layer.props}
            setBackHandler={(fn) => {
              layer.customBackHandler = fn;
            }}
            close={(res) => dismissLayer(layer.id, res)}
            onClose={(res) => dismissLayer(layer.id, res)}
            on:close={(e) => dismissLayer(layer.id, e?.detail)}
            on:cancel={() => dismissLayer(layer.id, false)}
            on:confirm={(e) => dismissLayer(layer.id, e?.detail ?? true)}
          />
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .portal-root {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    pointer-events: none;
    user-select: none;
  }

  .portal-global-scrim {
    position: fixed;
    inset: 0;
    background: #000000;
    pointer-events: auto;
    transition: opacity 220ms cubic-bezier(0.2, 0, 0, 1);
  }

  .portal-layer-screen {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    background: var(--bg-main, #101114);
    color: var(--text-color, #ffffff);
    box-sizing: border-box;
    pointer-events: auto;
    overflow: hidden;
    touch-action: pan-y;
    will-change: transform, opacity;
  }

  .portal-layer-screen.layer-entering {
    animation: pushInScreen 255ms cubic-bezier(0.12, 0.94, 0.22, 1) forwards;
  }

  .portal-layer-screen.swiping {
    animation: none !important;
    transition: none !important;
    touch-action: none !important;
  }

  .portal-layer-screen.layer-transparent {
    background: transparent;
  }

  .portal-layer-screen.layer-no-anim {
    animation: none;
    will-change: auto;
  }

  .portal-layer-screen.layer-no-anim.layer-closing {
    animation: none;
  }

  .portal-layer-screen > :global(*:not(.profile-toast):not(.toast-popup):not(.tg-toast):not(.toast-notification)) {
    width: 100%;
    height: 100%;
  }

  .portal-layer-screen.layer-closing {
    animation: pushOutScreen 190ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }

  .portal-layer-screen.layer-dormant {
    transform: translate3d(-14px, 0, 0);
    pointer-events: none;
  }

  @keyframes pushInScreen {
    from {
      opacity: 0;
      transform: translate3d(32px, 0, 0);
    }
    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes pushOutScreen {
    from {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    to {
      opacity: 0;
      transform: translate3d(100%, 0, 0);
    }
  }

  .portal-layer-sheet-container {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-top: var(--safe-top, 0px);
    box-sizing: border-box;
    pointer-events: none;
  }

  .portal-sheet-wrapper {
    pointer-events: auto;
    width: 100%;
    max-width: 520px;
    touch-action: pan-y;
    will-change: transform, opacity;
  }

  .portal-sheet-wrapper.sheet-entering {
    animation: sheetEnter 250ms cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
  }

  .portal-sheet-wrapper.dragging {
    animation: none !important;
  }

  .portal-layer-sheet-container.layer-closing .portal-sheet-wrapper {
    animation: sheetExit 180ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }

  @keyframes sheetEnter {
    from {
      transform: translate3d(0, 100%, 0);
    }
    to {
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes sheetExit {
    from {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
    to {
      opacity: 0;
      transform: translate3d(0, 100%, 0);
    }
  }

  .portal-layer-dialog-container {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    padding: calc(20px + var(--safe-top, 0px)) calc(20px + var(--safe-right, 0px)) calc(20px + var(--safe-bottom, 0px)) calc(20px + var(--safe-left, 0px));
    box-sizing: border-box;
  }

  .portal-layer-dialog-container > :global(*) {
    pointer-events: auto;
    animation: dialogEnter 190ms cubic-bezier(0.14, 0.95, 0.25, 1) forwards;
    will-change: transform, opacity;
  }

  .portal-layer-dialog-container.layer-closing > :global(*) {
    animation: dialogExit 160ms cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
  }

  @keyframes dialogEnter {
    from {
      opacity: 0;
      transform: scale(0.93);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes dialogExit {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.95) translate3d(24px, 0, 0);
    }
  }

  .portal-layer-dropout-container {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .portal-dropout-backdrop {
    position: fixed;
    inset: 0;
    background: transparent;
    pointer-events: auto;
  }

  .portal-dropout-wrapper {
    pointer-events: auto;
    position: absolute;
    animation: dropoutEnter 165ms cubic-bezier(0.15, 0.98, 0.3, 1) forwards;
    will-change: transform, opacity;
    transform-origin: top left;
  }

  .portal-layer-dropout-container.layer-closing .portal-dropout-wrapper {
    animation: dropoutExit 130ms cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  @keyframes dropoutEnter {
    from {
      opacity: 0;
      transform: scale(0.88);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes dropoutExit {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.9);
    }
  }

  .portal-layer-drawer-container {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    pointer-events: none;
  }

  .portal-drawer-wrapper {
    position: relative;
    width: 100%;
    max-width: 420px;
    height: 100%;
    pointer-events: auto;
    overflow: hidden;
    will-change: transform;
    touch-action: pan-y;
  }

  .portal-drawer-wrapper.drawer-entering {
    animation: drawerEnter 260ms cubic-bezier(0.12, 0.95, 0.22, 1) forwards;
  }

  .portal-drawer-wrapper.swiping {
    animation: none !important;
  }

  .portal-layer-drawer-container.layer-closing .portal-drawer-wrapper {
    animation: drawerExit 195ms cubic-bezier(0.36, 0.05, 0.95, 0.9) forwards;
  }

  @keyframes drawerEnter {
    from {
      transform: translate3d(100%, 0, 0);
    }
    to {
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes drawerExit {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(100%, 0, 0);
    }
  }

  .portal-layer-viewer-container {
    position: fixed;
    inset: 0;
    pointer-events: auto;
  }
</style>
