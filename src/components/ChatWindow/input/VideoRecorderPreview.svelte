<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import { mediaPipeline } from "$lib/services/MediaPipelineHost";

  export let isFallbackVideo = false;
  export let videoPreviewEl = null;
  export let fallbackCanvasEl = null;
  export let mediaStream = null;

  let effectsCircleCanvasEl = null;
  let isEffectsActive = false;
  let unsubEffects = null;
  let previewAnimId = null;

  onMount(() => {
    isEffectsActive = mediaPipeline.hasActiveVideoEffects?.() || false;
    unsubEffects = mediaPipeline.addEffectsChangeListener?.((active) => {
      isEffectsActive = active;
    });

    const drawCircleLoop = () => {
      if (isEffectsActive && effectsCircleCanvasEl) {
        const src = mediaPipeline.getProcessedCanvas?.();
        if (src && src.width > 0 && src.height > 0) {
          const ctx = effectsCircleCanvasEl.getContext('2d');
          if (ctx) {
            const size = Math.min(src.width, src.height);
            const sx = Math.floor((src.width - size) / 2);
            const sy = Math.floor((src.height - size) / 2);
            ctx.drawImage(src, sx, sy, size, size, 0, 0, 480, 480);
          }
        }
      }
      previewAnimId = requestAnimationFrame(drawCircleLoop);
    };
    previewAnimId = requestAnimationFrame(drawCircleLoop);
  });

  onDestroy(() => {
    if (unsubEffects) {
      unsubEffects();
      unsubEffects = null;
    }
    if (previewAnimId) {
      cancelAnimationFrame(previewAnimId);
      previewAnimId = null;
    }
    if (videoPreviewEl && videoPreviewEl.srcObject) {
      try {
        videoPreviewEl.srcObject.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      } catch {}
      videoPreviewEl.srcObject = null;
    }
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      } catch {}
    }
  });

  const pluginVideoNoteActions = getMountStore("video-note:action");
  const dispatch = createEventDispatcher();

  function flipCamera() {
    dispatch("flipCamera");
  }

  $: if (videoPreviewEl && mediaStream) {
    if (videoPreviewEl.srcObject !== mediaStream) {
      videoPreviewEl.srcObject = mediaStream;
      videoPreviewEl.play().catch(() => {});
    }
  }
</script>

<div class="video-recorder-preview-wrap">
  {#if isFallbackVideo}
    <canvas
      bind:this={fallbackCanvasEl}
      width="480"
      height="480"
      class="video-recorder-circle"
    ></canvas>
  {:else}
    <video
      bind:this={videoPreviewEl}
      class="video-recorder-circle"
      autoplay
      playsinline
      muted
      poster="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>"
      style="opacity: {isEffectsActive ? 0 : 1}; pointer-events: {isEffectsActive ? 'none' : 'auto'};"
    ></video>
    <canvas
      bind:this={effectsCircleCanvasEl}
      width="480"
      height="480"
      class="video-recorder-circle effects-circle-canvas"
      style="opacity: {isEffectsActive ? 1 : 0}; pointer-events: none;"
    ></canvas>
  {/if}
  <button class="flip-camera-btn" type="button" on:click={flipCamera} title="Сменить камеру">
    <img src="/icons/flip-camera.svg" alt="" width="20" height="20" />
  </button>
  {#each $pluginVideoNoteActions as item (item.id)}
    <div class="plugin-video-note-action-wrapper" data-plugin-mount={item.pluginId || item.id}>
      {@html item.html}
    </div>
  {/each}
</div>

<style>
  .video-recorder-preview-wrap {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 200px;
    z-index: 50;
    pointer-events: none;
  }

  .plugin-video-note-action-wrapper {
    position: absolute;
    bottom: 8px;
    left: 8px;
    pointer-events: auto;
    z-index: 2;
  }

  .flip-camera-btn {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 0.15s, background-color 0.15s;
    z-index: 2;
  }

  .flip-camera-btn:hover {
    background: rgba(0, 0, 0, 0.85);
    transform: scale(1.08);
  }

  .video-recorder-circle {
    width: 200px;
    height: 200px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #248bfe;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    background: #000;
  }

  .effects-circle-canvas {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 1;
  }
</style>
