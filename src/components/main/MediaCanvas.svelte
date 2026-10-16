<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { MediaPool } from "$lib/services/MediaPool";

  export let src = "";
  export let type = "auto";
  export let size = 48;
  export let targetEntityId = null;
  export let alt = "";
  export let style = "";
  let className = "";
  export { className as class };

  const dispatch = createEventDispatcher();

  let canvasEl;
  let ctx = null;
  let observer = null;
  let currentKey = null;
  let isReady = false;
  let isVisible = false;

  function drawCover(source) {
    if (!ctx || !canvasEl || !source) return;
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return;

    const side = Math.min(canvasEl.width, canvasEl.height);
    if (side <= 0) return;

    let sx = 0;
    let sy = 0;
    let sWidth = sw;
    let sHeight = sh;

    if (sw > sh) {
      sWidth = sh;
      sx = (sw - sWidth) / 2;
    } else if (sh > sw) {
      sHeight = sw;
      sy = (sh - sHeight) / 2;
    }

    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, side, side);
  }

  const consumer = {
    onReady(entry) {
      isReady = true;
      dispatch("ready", entry);
      if (entry.source) {
        drawCover(entry.source);
      }
    },
    onError(err) {
      isReady = false;
      dispatch("error", err);
    },
    onFrame(videoSource) {
      if (!isReady) isReady = true;
      if (isVisible) {
        drawCover(videoSource);
      }
    },
    drawStatic(imageSource) {
      drawCover(imageSource);
    }
  };

  function updateCanvasSize() {
    if (!canvasEl) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const pixelSize = Math.max(1, Math.round(size * dpr));
    if (canvasEl.width !== pixelSize || canvasEl.height !== pixelSize) {
      canvasEl.width = pixelSize;
      canvasEl.height = pixelSize;
    }
    if (!ctx) {
      ctx = canvasEl.getContext("2d", { alpha: false, desynchronized: true });
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
      }
    }
  }

  function detachMedia() {
    if (currentKey) {
      MediaPool.release(currentKey, consumer);
      currentKey = null;
      isReady = false;
    }
  }

  function attachMedia() {
    if (!src || !canvasEl) {
      detachMedia();
      return;
    }

    updateCanvasSize();
    const newKey = MediaPool.getKey(src, type);
    if (newKey === currentKey) return;

    detachMedia();
    currentKey = newKey;

    const entry = MediaPool.acquire(newKey, { src, type, targetEntityId }, consumer);
    if (isVisible) {
      MediaPool.setVisible(newKey, consumer, true);
    }
    if (entry.status === "ready" && entry.source) {
      isReady = true;
      drawCover(entry.source);
      dispatch("ready", entry);
    }
  }

  $: size, updateCanvasSize();
  $: src, type, targetEntityId, canvasEl && attachMedia();

  onMount(() => {
    updateCanvasSize();

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          isVisible = entry.isIntersecting;
          if (currentKey) {
            MediaPool.setVisible(currentKey, consumer, isVisible);
          }
          if (isVisible) {
            const item = MediaPool.getEntry(currentKey);
            if (item?.source) {
              drawCover(item.source);
            }
          }
        }
      }, { rootMargin: "60px 0px" });

      if (canvasEl) {
        observer.observe(canvasEl);
      }
    } else {
      isVisible = true;
      if (currentKey) {
        MediaPool.setVisible(currentKey, consumer, true);
      }
    }

    attachMedia();

    return () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      detachMedia();
    };
  });
</script>

<div
  class="media-canvas-wrapper {className}"
  style="width: {size ? `${size}px` : '100%'}; height: {size ? `${size}px` : '100%'}; aspect-ratio: 1 / 1; {style}"
>
  {#if !isReady}
    <div class="media-shimmer-placeholder"></div>
  {/if}
  <canvas
    bind:this={canvasEl}
    width={size}
    height={size}
    class="media-canvas"
    class:loaded={isReady}
    style="aspect-ratio: 1 / 1;"
    aria-label={alt}
  ></canvas>
</div>

<style>
  .media-canvas-wrapper {
    position: relative;
    aspect-ratio: 1 / 1;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    max-width: 100%;
    max-height: 100%;
  }

  .media-canvas {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    display: block;
    border-radius: inherit;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.15s ease-out;
  }

  .media-canvas.loaded {
    opacity: 1;
  }

  .media-shimmer-placeholder {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 35%,
      rgba(79, 195, 247, 0.16) 50%,
      rgba(255, 255, 255, 0.12) 65%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: mediaShimmer 1.6s infinite linear;
    pointer-events: none;
    z-index: 1;
  }

  @keyframes mediaShimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
