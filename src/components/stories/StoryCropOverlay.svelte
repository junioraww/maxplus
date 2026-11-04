<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade } from "svelte/transition";

  export let crop = { x: 0, y: 0, w: 1, h: 1 };
  export let containerWidth = 360;
  export let containerHeight = 640;
  export let imageBounds = null;

  const dispatch = createEventDispatcher();

  let tempCrop = { ...crop };
  let isInteracting = false;
  let activeHandle = null;
  let startPointer = { x: 0, y: 0 };
  let startCrop = { ...crop };

  $: imgX = imageBounds && imageBounds.w ? imageBounds.x : 0;
  $: imgY = imageBounds && imageBounds.h ? imageBounds.y : 0;
  $: imgW = imageBounds && imageBounds.w ? imageBounds.w : (containerWidth || 360);
  $: imgH = imageBounds && imageBounds.h ? imageBounds.h : (containerHeight || 640);

  $: boxLeft = imgX + tempCrop.x * imgW;
  $: boxTop = imgY + tempCrop.y * imgH;
  $: boxWidth = tempCrop.w * imgW;
  $: boxHeight = tempCrop.h * imgH;

  $: isModified = tempCrop.x > 0.01 || tempCrop.y > 0.01 || tempCrop.w < 0.99 || tempCrop.h < 0.99;

  function onPointerDown(e, handle) {
    e.stopPropagation();
    e.preventDefault();
    isInteracting = true;
    activeHandle = handle;
    startPointer = { x: e.clientX, y: e.clientY };
    startCrop = { ...tempCrop };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(e) {
    if (!isInteracting || !activeHandle) return;
    e.stopPropagation();

    const dx = (e.clientX - startPointer.x) / (imgW || 1);
    const dy = (e.clientY - startPointer.y) / (imgH || 1);
    const minSize = 0.15;

    let { x, y, w, h } = startCrop;

    if (activeHandle === "move") {
      x = Math.max(0, Math.min(1 - w, startCrop.x + dx));
      y = Math.max(0, Math.min(1 - h, startCrop.y + dy));
    } else {
      if (activeHandle.includes("l")) {
        const newX = Math.max(0, Math.min(startCrop.x + startCrop.w - minSize, startCrop.x + dx));
        w = startCrop.x + startCrop.w - newX;
        x = newX;
      }
      if (activeHandle.includes("r")) {
        w = Math.max(minSize, Math.min(1 - startCrop.x, startCrop.w + dx));
      }
      if (activeHandle.includes("t")) {
        const newY = Math.max(0, Math.min(startCrop.y + startCrop.h - minSize, startCrop.y + dy));
        h = startCrop.y + startCrop.h - newY;
        y = newY;
      }
      if (activeHandle.includes("b")) {
        h = Math.max(minSize, Math.min(1 - startCrop.y, startCrop.h + dy));
      }
    }

    tempCrop = { x, y, w, h };
    dispatch("change", { crop: { ...tempCrop }, isModified });
  }

  function onPointerUp(e) {
    if (!isInteracting) return;
    isInteracting = false;
    activeHandle = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    dispatch("change", { crop: { ...tempCrop }, isModified });
  }

  onDestroy(() => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  });

  export function reset() {
    tempCrop = { x: 0, y: 0, w: 1, h: 1 };
    dispatch("change", { crop: { ...tempCrop }, isModified: false });
  }

  export function getCrop() {
    return { ...tempCrop };
  }
</script>

<div class="crop-overlay-root" transition:fade={{ duration: 150 }}>
  <div class="mask-top" style="height: {boxTop}px;"></div>
  <div class="mask-bottom" style="top: {boxTop + boxHeight}px;"></div>
  <div class="mask-left" style="top: {boxTop}px; height: {boxHeight}px; width: {boxLeft}px;"></div>
  <div
    class="mask-right"
    style="top: {boxTop}px; height: {boxHeight}px; left: {boxLeft + boxWidth}px;"
  ></div>

  <div
    class="crop-box"
    class:interacting={isInteracting}
    style="left: {boxLeft}px; top: {boxTop}px; width: {boxWidth}px; height: {boxHeight}px;"
  >
    <div
      class="crop-box-move-zone"
      on:pointerdown={(e) => onPointerDown(e, "move")}
      role="button"
      tabindex="0"
      aria-label="Move crop"
    >
      <div class="grid-line grid-h1"></div>
      <div class="grid-line grid-h2"></div>
      <div class="grid-line grid-v1"></div>
      <div class="grid-line grid-v2"></div>
    </div>

    <div
      class="handle handle-edge handle-t"
      on:pointerdown={(e) => onPointerDown(e, "t")}
    ></div>
    <div
      class="handle handle-edge handle-b"
      on:pointerdown={(e) => onPointerDown(e, "b")}
    ></div>
    <div
      class="handle handle-edge handle-l"
      on:pointerdown={(e) => onPointerDown(e, "l")}
    ></div>
    <div
      class="handle handle-edge handle-r"
      on:pointerdown={(e) => onPointerDown(e, "r")}
    ></div>

    <div
      class="handle handle-corner handle-tl"
      on:pointerdown={(e) => onPointerDown(e, "tl")}
    ></div>
    <div
      class="handle handle-corner handle-tr"
      on:pointerdown={(e) => onPointerDown(e, "tr")}
    ></div>
    <div
      class="handle handle-corner handle-bl"
      on:pointerdown={(e) => onPointerDown(e, "bl")}
    ></div>
    <div
      class="handle handle-corner handle-br"
      on:pointerdown={(e) => onPointerDown(e, "br")}
    ></div>
  </div>
</div>

<style>
  .crop-overlay-root {
    position: absolute;
    inset: 0;
    z-index: var(--z-dropdown, 6);
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .mask-top,
  .mask-bottom,
  .mask-left,
  .mask-right {
    position: absolute;
    background: rgba(0, 0, 0, 0.72);
    pointer-events: none;
  }
  .mask-top {
    top: 0;
    left: 0;
    right: 0;
  }
  .mask-bottom {
    left: 0;
    right: 0;
    bottom: 0;
  }
  .mask-left {
    left: 0;
  }
  .mask-right {
    right: 0;
  }

  .crop-box {
    position: absolute;
    box-sizing: border-box;
    border: 2px solid rgba(255, 255, 255, 0.95);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
    touch-action: none;
  }
  .crop-box.interacting {
    border-color: #3b82f6;
  }

  .crop-box-move-zone {
    position: absolute;
    inset: 0;
    cursor: move;
    touch-action: none;
  }

  .grid-line {
    position: absolute;
    background: rgba(255, 255, 255, 0.28);
    pointer-events: none;
  }
  .grid-h1 {
    left: 0;
    right: 0;
    top: 33.33%;
    height: 1px;
  }
  .grid-h2 {
    left: 0;
    right: 0;
    top: 66.66%;
    height: 1px;
  }
  .grid-v1 {
    top: 0;
    bottom: 0;
    left: 33.33%;
    width: 1px;
  }
  .grid-v2 {
    top: 0;
    bottom: 0;
    left: 66.66%;
    width: 1px;
  }

  .handle {
    position: absolute;
    touch-action: none;
    z-index: 2;
  }

  .handle-edge {
    background: transparent;
  }
  .handle-t {
    top: -16px;
    left: 24px;
    right: 24px;
    height: 32px;
    cursor: ns-resize;
  }
  .handle-b {
    bottom: -16px;
    left: 24px;
    right: 24px;
    height: 32px;
    cursor: ns-resize;
  }
  .handle-l {
    left: -16px;
    top: 24px;
    bottom: 24px;
    width: 32px;
    cursor: ew-resize;
  }
  .handle-r {
    right: -16px;
    top: 24px;
    bottom: 24px;
    width: 32px;
    cursor: ew-resize;
  }

  .handle-corner {
    width: 34px;
    height: 34px;
    box-sizing: border-box;
    border-color: #ffffff;
    border-style: solid;
    border-width: 0;
    background: transparent;
  }
  .crop-box.interacting .handle-corner {
    border-color: #3b82f6;
  }

  .handle-tl {
    top: -3px;
    left: -3px;
    border-top-width: 4px;
    border-left-width: 4px;
    cursor: nwse-resize;
  }
  .handle-tr {
    top: -3px;
    right: -3px;
    border-top-width: 4px;
    border-right-width: 4px;
    cursor: nesw-resize;
  }
  .handle-bl {
    bottom: -3px;
    left: -3px;
    border-bottom-width: 4px;
    border-left-width: 4px;
    cursor: nesw-resize;
  }
  .handle-br {
    bottom: -3px;
    right: -3px;
    border-bottom-width: 4px;
    border-right-width: 4px;
    cursor: nwse-resize;
  }
</style>