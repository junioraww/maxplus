<script>
  import { createEventDispatcher } from "svelte";

  export let isFallbackVideo = false;
  export let videoPreviewEl = null;
  export let fallbackCanvasEl = null;

  const dispatch = createEventDispatcher();

  function flipCamera() {
    dispatch("flipCamera");
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
    ></video>
  {/if}
  <button class="flip-camera-btn" type="button" on:click={flipCamera} title="Сменить камеру">
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>
      <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="m18 22-3-3 3-3"/>
      <path d="m6 2 3 3-3 3"/>
    </svg>
  </button>
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

  .flip-camera-btn {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
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
</style>
