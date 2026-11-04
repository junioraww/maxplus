<script>
  import { createEventDispatcher } from "svelte";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import VideoPreview from "$components/ChatWindow/VideoPreview.svelte";
  import { openStoryComposer } from "$lib/stores/stories";
  import { getAttachType } from "$lib/utils/mediaUtils";

  export let attaches = [];

  const dispatch = createEventDispatcher();

  function removeAttach(index) {
    dispatch("remove", { index });
  }

  function handleEditAttach(attach, index) {
    openStoryComposer({
      attach,
      onSave: ({ path, isVideo }) => {
        attach.path = path;
        attach.localPath = path;
        if (isVideo) {
          attach.type = "VIDEO";
          attach._type = "VIDEO";
          attach.mime = "video/mp4";
        }
        attaches = [...attaches];
        dispatch("update", { index, attach });
      }
    });
  }

  function handlePreview(attach, event) {
    const type = getAttachType(attach);
    if (type === "PHOTO" || type === "VIDEO") {
      dispatch("preview", { attach, originEl: event?.currentTarget || null });
    }
  }


</script>

{#if attaches && attaches.length > 0}
  <div class="selected-attaches">
    {#each attaches as attach, i}
      {@const attachType = attach.type || attach._type}
      <div class="attach-card">
        {#if (attachType === "PHOTO" || attachType === "VIDEO") && !attach.uploading && !attach.uploaded}
          <button
            type="button"
            class="edit-btn"
            on:click={() => handleEditAttach(attach, i)}
            aria-label="Edit attachment"
            title="Редактировать"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        {/if}

        <button
          class="remove"
          class:hidden={attach.uploading || attach.uploaded}
          on:click={() => removeAttach(i)}
          aria-label="Remove attachment"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {#if attachType === "PHOTO"}
          <img
            src={attach.path ? getProxiedMediaUrl(attach.path) : (attach.url || attach.baseUrl)}
            alt="preview"
            class="clickable-media"
            on:click={(e) => handlePreview(attach, e)}
          />
        {:else if attachType === "VIDEO"}
          {#if attach.path}
            <div class="clickable-media" on:click={(e) => handlePreview(attach, e)} role="presentation">
              <VideoPreview {attach} />
            </div>
          {:else}
            <div class="file-preview">
              <div class="file-icon">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div class="file-name">Видео</div>
            </div>
          {/if}
        {:else if attachType === "AUDIO"}
          <div class="file-preview">
            <div class="file-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>
            <div class="file-name">Голосовое</div>
          </div>
        {:else if attachType === "POLL"}
          <div class="file-preview">
            <div class="file-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </div>
            <div class="file-name">
              {attach.title || "Опрос"}
            </div>
          </div>
        {:else}
          <div class="file-preview">
            <div class="file-icon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
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
    z-index: var(--z-base, 1);
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

  .attach-card .edit-btn {
    position: absolute;
    bottom: 3px;
    right: 3px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    border: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: var(--z-header, 4);
    transition: transform 0.15s ease;
  }
  .attach-card .edit-btn:hover {
    transform: scale(1.15);
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
    z-index: var(--z-header, 4);
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
    z-index: var(--z-panel, 2);
  }

  .upload-loader-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: var(--z-chat, 3);
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

  .clickable-media {
    width: 100%;
    height: 100%;
    cursor: zoom-in;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
