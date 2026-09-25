<script>
  import { createEventDispatcher } from "svelte";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import VideoPreview from "$components/ChatWindow/VideoPreview.svelte";

  export let attaches = [];

  const dispatch = createEventDispatcher();

  function removeAttach(index) {
    dispatch("remove", { index });
  }
</script>

{#if attaches && attaches.length > 0}
  <div class="selected-attaches">
    {#each attaches as attach, i}
      {@const attachType = attach.type || attach._type}
      <div class="attach-card">
        <button
          class="remove"
          class:hidden={attach.uploading || attach.uploaded}
          on:click={() => removeAttach(i)}
          aria-label="Remove attachment"
        >✕</button>

        {#if attachType === "PHOTO"}
          <img src={attach.path ? getProxiedMediaUrl(attach.path) : (attach.url || attach.baseUrl)} alt="preview" />
        {:else if attachType === "VIDEO"}
          {#if attach.path}
            <VideoPreview {attach} />
          {:else}
            <div class="file-preview"><div class="file-icon">🎥</div><div class="file-name">Видео</div></div>
          {/if}
        {:else if attachType === "AUDIO"}
          <div class="file-preview"><div class="file-icon">🎵</div><div class="file-name">Голосовое</div></div>
        {:else}
          <div class="file-preview">
            <div class="file-icon">📄</div>
            <div class="file-name">
              {attach.name || (attach.path ? attach.path.split("/").pop() : "Файл")}
            </div>
          </div>
        {/if}

        {#if attach.uploading || attach.uploaded}
          <div
            class="upload-overlay"
            style="height: {Math.max(0, Math.min(100, attach.progress ?? 0))}%;"
          ></div>
          <div class="upload-loader-wrap">
            <div class="upload-loader"></div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .selected-attaches {
    width: 100%;
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    flex-shrink: 0;
    overflow-x: auto;
    z-index: 1;
    background-color: #17191d;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .attach-card {
    position: relative;
    width: 70px;
    height: 70px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .attach-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .attach-card .remove {
    position: absolute;
    top: 3px;
    right: 3px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    cursor: pointer;
    z-index: 4;
    opacity: 1;
    transform: scale(1);
    transition: opacity 0.2s ease, transform 0.2s ease;
  }

  .attach-card .remove.hidden {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.7);
  }

  .upload-overlay {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
    transition: height 0.12s ease-out;
    z-index: 2;
  }

  .upload-loader-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 3;
  }

  .upload-loader {
    width: 24px;
    height: 24px;
    border: 2.5px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: upload-spin 0.8s linear infinite;
  }

  @keyframes upload-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .file-preview {
    text-align: center;
    padding: 4px;
  }

  .file-icon {
    font-size: 18px;
  }

  .file-name {
    font-size: 10px;
    color: #aaa;
    max-width: 60px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
