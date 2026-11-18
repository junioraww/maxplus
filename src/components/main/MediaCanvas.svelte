<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { MediaPool } from "$lib/services/MediaPool";
  import { getAssetUrl } from "$lib/utils/images";

  export let src = "";
  export let type = "auto";
  export let size = 48;
  export let poster = null;
  export let targetEntityId = null;
  export let alt = "";
  export let style = "";
  export let alwaysVisible = false;
  export let highRes = false;
  let className = "";
  export { className as class };

  const dispatch = createEventDispatcher();

  let canvasEl;
  let ctx = null;
  let observer = null;
  let currentKey = null;
  let isReady = false;
  let isPosterDrawn = false;
  let hasFrameDrawn = false;
  let isVisible = true;

  function drawCover(source) {
    if (!ctx || !canvasEl || !source) return;
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return;

    const side = Math.min(canvasEl.width, canvasEl.height);
    if (side <= 0) return;

    if (sw === sh) {
      ctx.drawImage(source, 0, 0, side, side);
      hasFrameDrawn = true;
      return;
    }

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

    ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, side, side);
    hasFrameDrawn = true;
  }

  async function loadAndDrawPoster(url) {
    if (!url || isReady || typeof Image === "undefined") return;
    try {
      const assetUrl = (await getAssetUrl(url).catch(() => null)) || url;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (isReady || !canvasEl) return;
        isPosterDrawn = true;
        drawCover(img);
      };
      img.src = assetUrl;
    } catch {}
  }

  const consumer = {
    size,
    highRes: Boolean(highRes || size > 128),
    onReady(entry) {
      isReady = true;
      dispatch("ready", entry);
      const readySource = (entry?.isBuffered && entry?.frames?.length > 0) ? entry.frames[entry.frameIndex] : (entry?.masterCanvas || entry?.source);
      if (readySource) {
        drawCover(readySource);
      }
    },
    onError(err) {
      isReady = false;
      dispatch("error", err);
    },
    onFrame(frameSource) {
      if (!isReady) isReady = true;
      if (isVisible) {
        drawCover(frameSource);
      }
    },
    drawStatic(imageSource) {
      if (!isReady) isReady = true;
      drawCover(imageSource);
    }
  };

  $: consumer.size = size;
  $: consumer.highRes = Boolean(highRes || size > 128);

  function handleContextLost(e) {
    e.preventDefault();
    ctx = null;
  }

  function handleContextRestored() {
    ctx = canvasEl.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "medium";
    }
    if (currentKey) {
      const item = MediaPool.getEntry(currentKey);
      const frameSource = (item?.isBuffered && item?.frames?.length > 0) ? item.frames[item.frameIndex] : (item?.masterCanvas || item?.source);
      if (frameSource) {
        drawCover(frameSource);
      }
    }
  }

  function updateCanvasSize() {
    if (!canvasEl) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const pixelSize = Math.max(1, Math.round(size * dpr));
    if (!ctx) {
      ctx = canvasEl.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
      }
    }
    if (canvasEl.width !== pixelSize || canvasEl.height !== pixelSize) {
      canvasEl.width = pixelSize;
      canvasEl.height = pixelSize;
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "medium";
      }
      if (currentKey) {
        const item = MediaPool.getEntry(currentKey);
        const frameSource = (item?.isBuffered && item?.frames?.length > 0) ? item.frames[item.frameIndex] : (item?.masterCanvas || item?.source);
        if (frameSource) {
          drawCover(frameSource);
        }
      }
    }
  }

  function detachMedia() {
    if (currentKey) {
      MediaPool.release(currentKey, consumer);
      currentKey = null;
      isReady = false;
      isPosterDrawn = false;
      hasFrameDrawn = false;
    }
  }

  function attachMedia() {
    if (!src || !canvasEl) {
      detachMedia();
      return;
    }

    updateCanvasSize();
    if (poster && !isReady) {
      loadAndDrawPoster(poster);
    }
    const newKey = MediaPool.getKey(src);
    if (newKey === currentKey) return;

    detachMedia();
    currentKey = newKey;

    const entry = MediaPool.acquire(newKey, { src, type, targetEntityId, highRes: Boolean(highRes || size > 128) }, consumer);
    if (isVisible) {
      MediaPool.setVisible(newKey, consumer, true);
    }
    const readySource = (entry?.isBuffered && entry?.frames?.length > 0) ? entry.frames[entry.frameIndex] : (entry?.masterCanvas || entry?.source);
    if (entry.status === "ready" && readySource) {
      isReady = true;
      isPosterDrawn = false;
      drawCover(readySource);
      dispatch("ready", entry);
    }
  }

  $: size, updateCanvasSize();
  $: if (poster && !isReady) {
    loadAndDrawPoster(poster);
  }
  $: src, type, targetEntityId, canvasEl && attachMedia();

  onMount(() => {
    updateCanvasSize();

    if (canvasEl) {
      canvasEl.addEventListener("contextlost", handleContextLost);
      canvasEl.addEventListener("contextrestored", handleContextRestored);
    }

    if (!alwaysVisible && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          isVisible = entry.isIntersecting;
          if (currentKey) {
            MediaPool.setVisible(currentKey, consumer, isVisible);
          }
          if (isVisible) {
            const item = MediaPool.getEntry(currentKey);
            const frameSource = (item?.isBuffered && item?.frames?.length > 0) ? item.frames[item.frameIndex] : (item?.masterCanvas || item?.source);
            if (frameSource) {
              drawCover(frameSource);
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
      if (canvasEl) {
        canvasEl.removeEventListener("contextlost", handleContextLost);
        canvasEl.removeEventListener("contextrestored", handleContextRestored);
      }
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
  {#if poster && !hasFrameDrawn}
    <img
      src={poster}
      class="media-poster-underlay"
      alt=""
      loading="eager"
      decoding="async"
    />
  {/if}
  {#if !isReady && !poster && !isPosterDrawn}
    <div class="media-shimmer-placeholder"></div>
  {/if}
  <canvas
    bind:this={canvasEl}
    width={size}
    height={size}
    class="media-canvas"
    class:loaded={isReady || isPosterDrawn || hasFrameDrawn}
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

  .media-poster-underlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    border-radius: inherit;
    object-fit: cover;
    z-index: 0;
  }

  .media-canvas {
    position: relative;
    z-index: 1;
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
