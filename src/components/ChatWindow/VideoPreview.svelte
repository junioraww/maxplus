<script>
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";

  export let attach;

  let thumb = null;
  let loading = true;

  /*async function getVideoFrame(fileUrl) {
    const base64 = await invoke('thumbnail', { url: fileUrl })

    return `data:image/jpeg;base64,${base64}`
  }*/

  onMount(async () => {
    try {
      //thumb = await getVideoFrame(attach.path)
    } catch (e) {
      console.error("thumbnail error:", e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="video-wrapper" title={attach?.name || attach?.path || ""}>
  {#if loading}
    <div class="loading">...</div>
  {:else}
    <img src={thumb} alt={attach?.name || "video"} />
  {/if}

  <div class="overlay">▶</div>
</div>

<style>
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .video-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1 / 1;
  }

  .overlay {
    position: absolute;
    color: #fffc;
    font-size: 32px;
    transition: color 0.1s;
  }

  .video-wrapper:hover .overlay {
    color: #fff;
  }
</style>
