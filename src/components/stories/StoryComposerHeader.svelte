<script>
  import { createEventDispatcher } from "svelte";

  export let mode = "camera";
  export let canUndoOverlay = false;
  export let canRedoOverlay = false;
  export let activeDrawer = "none";
  export let isAttachmentMode = false;
  export let mediaType = null;
  export let isAudioMuted = false;

  const dispatch = createEventDispatcher();

  function handleAudioChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      dispatch("selectAudio", { file });
    }
  }
</script>

<div class="composer-header">
  <button
    type="button"
    class="header-icon-btn close-btn"
    on:click={() => dispatch("close")}
    title="Закрыть"
    aria-label="Закрыть редактор"
  >
    <img src="/icons/close.svg" alt="" width="20" height="20" />
  </button>

  {#if mode === "edit"}
    <div class="header-action-group">
      <button
        type="button"
        class="header-icon-btn"
        disabled={!canUndoOverlay}
        on:click={() => dispatch("undo")}
        title="Отменить действие (Undo)"
        aria-label="Undo"
      >
        <img src="/icons/stories/undo.svg" alt="" width="18" height="18" />
      </button>

      <button
        type="button"
        class="header-icon-btn"
        disabled={!canRedoOverlay}
        on:click={() => dispatch("redo")}
        title="Повторить действие (Redo)"
        aria-label="Redo"
      >
        <img class="icon-flip-h" src="/icons/stories/undo.svg" alt="" width="18" height="18" />
      </button>

      <div class="header-tools-divider" aria-hidden="true"></div>

      <button
        type="button"
        class="header-icon-btn"
        class:active={activeDrawer === "text"}
        on:click={() => dispatch("toggleDrawer", "text")}
        title="Текст"
        aria-label="Добавить текст"
      >
        <img src="/icons/stories/text.svg" alt="" width="18" height="18" />
      </button>

      <button
        type="button"
        class="header-icon-btn"
        class:active={activeDrawer === "stickers"}
        on:click={() => dispatch("toggleDrawer", "stickers")}
        title="Стикеры"
        aria-label="Стикеры"
      >
        <img src="/icons/smile.svg" alt="" width="18" height="18" />
      </button>

      {#if !isAttachmentMode}
        <button
          type="button"
          class="header-icon-btn"
          class:active={activeDrawer === "link"}
          on:click={() => dispatch("toggleDrawer", "link")}
          title="Ссылка"
          aria-label="Добавить ссылку"
        >
          <img src="/icons/link.svg" alt="" width="18" height="18" />
        </button>
      {/if}

      <button
        type="button"
        class="header-icon-btn"
        class:active={activeDrawer === "drawing"}
        on:click={() => dispatch("toggleDrawer", "drawing")}
        title="Рисование"
        aria-label="Рисование"
      >
        <img src="/icons/stories/pencil.svg" alt="" width="18" height="18" />
      </button>

      <button
        type="button"
        class="header-icon-btn"
        class:active={activeDrawer === "filters"}
        on:click={() => dispatch("toggleDrawer", "filters")}
        title="Фильтры"
        aria-label="Фильтры"
      >
        <img src="/icons/stories/filters.svg" alt="" width="18" height="18" />
      </button>

      {#if isAttachmentMode}
        <button
          type="button"
          class="header-icon-btn"
          class:active={activeDrawer === "crop"}
          on:click={() => dispatch("toggleDrawer", "crop")}
          title="Кадрирование (Crop)"
          aria-label="Кадрирование"
        >
          <img src="/icons/stories/crop.svg" alt="" width="18" height="18" />
        </button>
      {/if}

      {#if mediaType === "video"}
        <button
          type="button"
          class="header-icon-btn"
          class:active={isAudioMuted}
          on:click={() => dispatch("toggleMute")}
          title={isAudioMuted ? "Включить звук" : "Выключить звук"}
          aria-label="Звук"
        >
          <img src={isAudioMuted ? "/icons/stories/sound-off.svg" : "/icons/stories/sound-on.svg"} alt="" width="18" height="18" />
        </button>
      {/if}

      {#if mediaType === "photo"}
        <label
          class="header-icon-btn file-input-label"
          title="Музыка"
          aria-label="Добавить музыку"
        >
          <img src="/icons/stories/music.svg" alt="" width="18" height="18" />
          <input
            type="file"
            accept="audio/*"
            on:change={handleAudioChange}
            style="display: none;"
          />
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .composer-header {
    height: 52px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0) 100%);
    z-index: var(--z-header, 4);
    flex-shrink: 0;
  }

  .header-icon-btn.close-btn {
    margin-right: 12px;
  }

  .header-tools-divider {
    width: 1px;
    height: 18px;
    background: rgba(255, 255, 255, 0.18);
    margin: 0 4px;
    flex-shrink: 0;
  }

  .header-icon-btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.18s, transform 0.18s;
    flex-shrink: 0;
  }
  .header-icon-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.22);
    transform: scale(1.05);
  }
  .header-icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .header-icon-btn.active {
    background: #3b82f6;
    color: #ffffff;
  }

  .header-action-group {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    max-width: calc(100vw - 64px);
    padding: 2px 0;
  }
  .header-action-group::-webkit-scrollbar {
    display: none;
  }

  .icon-flip-h {
    transform: scaleX(-1);
  }

  .file-input-label {
    cursor: pointer;
  }
</style>
