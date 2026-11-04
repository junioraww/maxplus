<script>
  import { createEventDispatcher } from "svelte";
  import StickerMedia from "$components/ChatWindow/Stickers/StickerMedia.svelte";

  export let item;
  export let isSelected = false;
  export let isEditing = false;
  export let containerWidth = 360;
  export let containerHeight = 640;

  const dispatch = createEventDispatcher();

  let isDragging = false;
  let isTransforming = false;
  let isResizingWidth = false;
  let isThrowCandidate = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialItemX = 0;
  let initialItemY = 0;
  let transformCenter = { x: 0, y: 0 };
  let initialDistance = 1;
  let initialAngle = 0;
  let initialScale = 1;
  let initialRotation = 0;
  let initialBoxWidth = 240;
  let resizeSide = 1;
  let hasPopped = false;
  let hasVibrated = false;
  let movedDistance = 0;
  let editStartTime = 0;

  let dragSnapshot = null;
  let transformSnapshot = null;
  let widthSnapshot = null;

  $: pxX = item.x * containerWidth;
  $: pxY = item.y * containerHeight;
  $: currentScale = item.scale ?? 1;
  $: currentRotation = item.rotation ?? 0;

  function handleBodyPointerDown(e) {
    e.stopPropagation();
    movedDistance = 0;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    if (!isEditing) {
      isDragging = true;
      isThrowCandidate = false;
      hasVibrated = false;
      initialItemX = pxX;
      initialItemY = pxY;
      dragSnapshot = { x: item.x, y: item.y };
      window.addEventListener("pointermove", handleBodyPointerMove);
      window.addEventListener("pointerup", handleBodyPointerUp);
    }
  }

  function handleBodyPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    movedDistance += Math.hypot(dx, dy);

    const nextX = (initialItemX + dx) / containerWidth;
    const nextY = (initialItemY + dy) / containerHeight;

    const isOutOfBounds = nextX < -0.05 || nextX > 1.05 || nextY < -0.05 || nextY > 1.05;
    if (isOutOfBounds !== isThrowCandidate) {
      isThrowCandidate = isOutOfBounds;
      if (isOutOfBounds && !hasVibrated) {
        hasVibrated = true;
        try {
          if (navigator.vibrate) navigator.vibrate(40);
        } catch {}
      }
    }

    dispatch("change", { ...item, x: nextX, y: nextY });
  }

  function handleBodyPointerUp() {
    isDragging = false;
    window.removeEventListener("pointermove", handleBodyPointerMove);
    window.removeEventListener("pointerup", handleBodyPointerUp);

    if (isThrowCandidate) {
      try {
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      } catch {}
      dispatch("delete", item.id);
      return;
    }

    let clampedX = Math.max(0.08, Math.min(0.92, item.x));
    let clampedY = Math.max(0.08, Math.min(0.92, item.y));
    const finalItem = { ...item, x: clampedX, y: clampedY };
    dispatch("change", finalItem);

    if (
      dragSnapshot &&
      (Math.abs(clampedX - dragSnapshot.x) > 0.001 || Math.abs(clampedY - dragSnapshot.y) > 0.001)
    ) {
      dispatch("commit", finalItem);
    }
    dragSnapshot = null;
  }

  function handleClick(e) {
    e.stopPropagation();
    if (movedDistance >= 6) return;

    if (!isSelected && !isEditing) {
      dispatch("select", item.id);
      triggerBounce();
    } else if (isSelected && !isEditing) {
      if (item.type === "text" || item.type === "link") {
        editStartTime = Date.now();
        dispatch("edit", item);
      }
    } else if (isEditing) {
      if (Date.now() - editStartTime < 250) return;
      dispatch("stopEdit", item);
    }
  }

  function handleCornerPointerDown(e, corner) {
    e.stopPropagation();
    isTransforming = true;
    const rect = e.currentTarget.closest(".overlay-item-wrapper").getBoundingClientRect();
    transformCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
    const dx = e.clientX - transformCenter.x;
    const dy = e.clientY - transformCenter.y;
    initialDistance = Math.hypot(dx, dy) || 1;
    initialAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    initialScale = currentScale;
    initialRotation = currentRotation;
    transformSnapshot = { scale: initialScale, rotation: initialRotation };
    window.addEventListener("pointermove", handleCornerPointerMove);
    window.addEventListener("pointerup", handleCornerPointerUp);
  }

  function handleCornerPointerMove(e) {
    if (!isTransforming) return;
    const dx = e.clientX - transformCenter.x;
    const dy = e.clientY - transformCenter.y;
    const currentDist = Math.hypot(dx, dy) || 1;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const distRatio = currentDist / initialDistance;
    let nextScale = Math.max(0.35, Math.min(3.0, initialScale * distRatio));
    let nextRotation = initialRotation + (angle - initialAngle);
    while (nextRotation < -180) nextRotation += 360;
    while (nextRotation > 180) nextRotation -= 360;
    dispatch("change", { ...item, scale: nextScale, rotation: nextRotation });
  }

  function handleCornerPointerUp() {
    if (!isTransforming) return;
    isTransforming = false;
    window.removeEventListener("pointermove", handleCornerPointerMove);
    window.removeEventListener("pointerup", handleCornerPointerUp);

    let finalRot = currentRotation;
    const snapAngles = [-180, -90, 0, 90, 180];
    for (const target of snapAngles) {
      if (Math.abs(finalRot - target) <= 5) {
        finalRot = target;
        break;
      }
    }

    let finalScale = currentScale;
    if (finalScale >= 0.95 && finalScale <= 1.05) {
      finalScale = 1.0;
    }

    const finalItem = { ...item, scale: finalScale, rotation: finalRot };
    dispatch("change", finalItem);

    if (
      transformSnapshot &&
      (Math.abs(finalScale - transformSnapshot.scale) > 0.01 ||
        Math.abs(finalRot - transformSnapshot.rotation) > 0.5)
    ) {
      dispatch("commit", finalItem);
    }
    transformSnapshot = null;
  }

  function handleSidePointerDown(e, side) {
    e.stopPropagation();
    isResizingWidth = true;
    resizeSide = side;
    initialBoxWidth = item.boxWidth || 240;
    widthSnapshot = initialBoxWidth;
    dragStartX = e.clientX;
    window.addEventListener("pointermove", handleSidePointerMove);
    window.addEventListener("pointerup", handleSidePointerUp);
  }

  function handleSidePointerMove(e) {
    if (!isResizingWidth) return;
    const dx = (e.clientX - dragStartX) * resizeSide * 2;
    const nextWidth = Math.max(120, Math.min(containerWidth - 32, initialBoxWidth + dx));
    dispatch("change", { ...item, boxWidth: Math.round(nextWidth) });
  }

  function handleSidePointerUp() {
    if (!isResizingWidth) return;
    isResizingWidth = false;
    window.removeEventListener("pointermove", handleSidePointerMove);
    window.removeEventListener("pointerup", handleSidePointerUp);
    const finalWidth = item.boxWidth || initialBoxWidth;
    if (widthSnapshot && Math.abs(finalWidth - widthSnapshot) > 2) {
      dispatch("commit", item);
    }
    widthSnapshot = null;
  }

  function triggerBounce() {
    hasPopped = true;
    setTimeout(() => {
      hasPopped = false;
    }, 240);
  }

  function autoFocus(node) {
    node.focus();
    const len = node.value.length;
    node.setSelectionRange(len, len);
    function resize() {
      node.style.height = "auto";
      node.style.height = node.scrollHeight + "px";
    }
    resize();
    node.addEventListener("input", resize);
    return {
      destroy() {
        node.removeEventListener("input", resize);
      }
    };
  }
</script>

<div
  class="overlay-item-wrapper"
  class:selected={isSelected && !isEditing}
  class:editing={isEditing}
  class:popped={hasPopped}
  class:throwing={isThrowCandidate}
  style="
    left: {pxX}px;
    top: {pxY}px;
    transform: translate(-50%, -50%) rotate({currentRotation}deg) scale({currentScale});
  "
  on:pointerdown={handleBodyPointerDown}
  on:click={handleClick}
  role="presentation"
>
  <div class="inner-content-box">
    {#if item.type === "text"}
      {#if isEditing}
        <textarea
          class="text-content inline-editor"
          class:transparent-bg={item.bg === "transparent"}
          bind:value={item.text}
          on:input={(e) => {
            dispatch("change", { ...item, text: e.currentTarget.value });
          }}
          on:click={handleClick}
          style="
            color: {item.color || '#ffffff'};
            background: {item.bg === 'transparent' ? 'transparent' : (item.bg || 'rgba(0,0,0,0.65)')};
            font-family: {item.fontFamily || 'inherit'};
            width: {item.boxWidth ? `${item.boxWidth}px` : '240px'};
            max-width: {containerWidth - 32}px;
          "
          use:autoFocus
          rows="1"
        ></textarea>
      {:else}
        <div
          class="text-content"
          class:transparent-bg={item.bg === "transparent"}
          style="
            color: {item.color || '#ffffff'};
            background: {item.bg === 'transparent' ? 'transparent' : (item.bg || 'rgba(0,0,0,0.65)')};
            font-family: {item.fontFamily || 'inherit'};
            width: {item.boxWidth ? `${item.boxWidth}px` : 'auto'};
            max-width: {containerWidth - 32}px;
          "
        >
          {item.text}
        </div>
      {/if}
    {:else if item.type === "link"}
      <div class="link-content">
        <img src="/icons/link.svg" alt="" width="16" height="16" />
        <span>{item.url}</span>
      </div>
    {:else if item.type === "sticker"}
      <div class="sticker-content">
        {#if item.sticker?.url || item.sticker?.lottieUrl}
          <StickerMedia
            url={item.sticker.url || ""}
            lottieUrl={item.sticker.lottieUrl || null}
            size={120}
          />
        {:else if item.sticker?.emoji}
          <span class="sticker-emoji">{item.sticker.emoji}</span>
        {/if}
      </div>
    {:else if item.type === "emoji"}
      <div class="emoji-content">
        <span>{item.emoji}</span>
      </div>
    {/if}
  </div>

  {#if isSelected && !isEditing}
    <div class="selection-outline"></div>

    <div
      class="corner-handle top-left"
      on:pointerdown={(e) => handleCornerPointerDown(e, "tl")}
      role="presentation"
    ></div>
    <div
      class="corner-handle top-right"
      on:pointerdown={(e) => handleCornerPointerDown(e, "tr")}
      role="presentation"
    ></div>
    <div
      class="corner-handle bottom-left"
      on:pointerdown={(e) => handleCornerPointerDown(e, "bl")}
      role="presentation"
    ></div>
    <div
      class="corner-handle bottom-right"
      on:pointerdown={(e) => handleCornerPointerDown(e, "br")}
      role="presentation"
    ></div>

    {#if item.type === "text"}
      <div
        class="side-handle left"
        on:pointerdown={(e) => handleSidePointerDown(e, -1)}
        title="Изменить ширину"
        aria-label="Изменить ширину"
      ></div>
      <div
        class="side-handle right"
        on:pointerdown={(e) => handleSidePointerDown(e, 1)}
        title="Изменить ширину"
        aria-label="Изменить ширину"
      ></div>
    {/if}
  {/if}
</div>

<style>
  .overlay-item-wrapper {
    position: absolute;
    cursor: grab;
    user-select: none;
    touch-action: none;
    z-index: var(--z-panel, 2);
    transition: opacity 0.16s ease;
    transform-origin: center center;
  }

  .overlay-item-wrapper.selected {
    cursor: grabbing;
    z-index: var(--z-header, 4);
  }

  .overlay-item-wrapper.editing {
    z-index: var(--z-header, 4);
  }

  .overlay-item-wrapper.throwing {
    opacity: 0.35;
    filter: grayscale(1);
  }

  .overlay-item-wrapper.popped {
    animation: popOnce 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes popOnce {
    0% { transform: translate(-50%, -50%) scale(0.96); }
    50% { transform: translate(-50%, -50%) scale(1.06); }
    100% { transform: translate(-50%, -50%) scale(1); }
  }

  .inner-content-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .text-content {
    display: inline-block;
    padding: 8px 14px;
    border-radius: 10px;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.3;
    white-space: pre-wrap;
    text-align: center;
    word-break: break-word;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    box-sizing: border-box;
  }

  .text-content.transparent-bg {
    background: transparent !important;
    box-shadow: none !important;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.95), 0 0 4px rgba(0, 0, 0, 0.9);
  }

  .inline-editor {
    border: none;
    outline: none;
    resize: none;
    overflow: hidden;
    font-family: inherit;
    border-radius: 10px;
  }

  .link-content {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: #2481cc;
    color: #ffffff;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    max-width: 280px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }
  .link-content span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sticker-content {
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.45));
    min-width: 100px;
    min-height: 100px;
  }
  .sticker-emoji {
    font-size: 80px;
    line-height: 1;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.45));
  }

  .emoji-content span {
    font-size: 64px;
    line-height: 1;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.45));
  }

  .selection-outline {
    position: absolute;
    inset: -8px;
    border: 2px dashed rgba(255, 255, 255, 0.95);
    border-radius: 12px;
    pointer-events: none;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.45);
  }

  .corner-handle {
    position: absolute;
    width: 18px;
    height: 18px;
    background: #ffffff;
    border: 2.5px solid #2481cc;
    border-radius: 50%;
    cursor: nwse-resize;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    touch-action: none;
    z-index: var(--z-dropdown, 6);
  }
  .corner-handle.top-left {
    top: -16px;
    left: -16px;
  }
  .corner-handle.top-right {
    top: -16px;
    right: -16px;
    cursor: nesw-resize;
  }
  .corner-handle.bottom-left {
    bottom: -16px;
    left: -16px;
    cursor: nesw-resize;
  }
  .corner-handle.bottom-right {
    bottom: -16px;
    right: -16px;
  }

  .side-handle {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 8px;
    height: 28px;
    background: #ffffff;
    border: 2px solid #3b82f6;
    border-radius: 4px;
    cursor: ew-resize;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    touch-action: none;
    z-index: var(--z-dropdown, 6);
  }
  .side-handle.left {
    left: -14px;
  }
  .side-handle.right {
    right: -14px;
  }
</style>
