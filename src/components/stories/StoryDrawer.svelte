<script>
  import { createEventDispatcher } from "svelte";
  import { slide, fade, fly } from "svelte/transition";

  export let activeDrawer = "none";
  export let hasTrimmer = false;

  export let filters = [];
  export let selectedFilter = "none";
  export let filterThumbnailUrl = "";
  export let mediaUrl = "";
  export let isVideoStory = false;

  export let cropAspects = [];
  export let cropAspectMode = "original";

  export let textBgOptions = [];
  export let selectedTextBg = "rgba(0,0,0,0.7)";
  export let presetColors = [];
  export let selectedTextColor = "#ffffff";
  export let availableFonts = [];
  export let selectedFontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  export let fontDropdownOpen = false;

  export let doodleColor = "#ff4444";
  export let doodleSize = 6;
  export let canUndoDoodle = false;
  export let canRedoDoodle = false;
  export let doodleCanvas = null;

  const dispatch = createEventDispatcher();
</script>

{#if activeDrawer !== "none"}
  <div
    class="story-drawer interactive-ctrl"
    class:has-trimmer={hasTrimmer}
    transition:slide={{ duration: 180 }}
  >
    {#if activeDrawer === "drawing"}
      <div class="drawing-action-row" transition:fly={{ y: 20, duration: 160 }}>
        <button
          type="button"
          class="color-preview-circle"
          style="background: {doodleColor};"
          on:click={() => dispatch("openColorPicker", "doodle")}
          title="Выбрать цвет"
        ></button>
        <input
          type="range"
          min="2"
          max="30"
          bind:value={doodleSize}
          class="brush-slider"
          title="Толщина кисти"
        />
        <button
          type="button"
          class="action-text-btn"
          disabled={!canUndoDoodle}
          on:click={() => doodleCanvas?.undo()}
          title="Отменить штрих"
        >
          Undo
        </button>
        <button
          type="button"
          class="action-text-btn"
          disabled={!canRedoDoodle}
          on:click={() => doodleCanvas?.redo()}
          title="Повторить штрих"
        >
          Redo
        </button>
        <button
          type="button"
          class="action-text-btn danger"
          on:click={() => doodleCanvas?.clear()}
          title="Очистить"
        >
          Очистить
        </button>
        <button
          type="button"
          class="drawer-done-btn"
          on:click={() => dispatch("close")}
          title="Готово"
        >
          <img src="/icons/check.svg" alt="" width="18" height="18" />
        </button>
      </div>

    {:else if activeDrawer === "filters"}
      <div class="filters-scroll-row">
        {#each filters as f}
          <button
            type="button"
            class="filter-card"
            class:active={selectedFilter === f.id}
            on:click={() => dispatch("selectFilter", f.id)}
          >
            <div class="filter-sample">
              {#if filterThumbnailUrl}
                <img src={filterThumbnailUrl} alt="" style="filter: {f.css};" />
              {:else if mediaUrl && !isVideoStory}
                <img src={mediaUrl} alt="" style="filter: {f.css};" />
              {:else}
                <div class="filter-sample-fallback" style="filter: {f.css};"></div>
              {/if}
            </div>
            <span class="filter-name">{f.name}</span>
          </button>
        {/each}
      </div>

    {:else if activeDrawer === "crop"}
      <div class="crop-options-row">
        {#each cropAspects as aspect}
          <button
            type="button"
            class="crop-aspect-btn"
            class:active={cropAspectMode === aspect.id}
            on:click={() => dispatch("selectCrop", aspect.id)}
          >
            {aspect.label}
          </button>
        {/each}
        <button
          type="button"
          class="drawer-done-btn"
          on:click={() => dispatch("close")}
          title="Готово"
        >
          <img src="/icons/check.svg" alt="" width="18" height="18" />
        </button>
      </div>

    {:else if activeDrawer === "text"}
      <div class="text-drawer-row">
        <div class="text-drawer-scrollable">
          <div class="bg-mode-group">
            {#each textBgOptions as bgOpt}
              <button
                type="button"
                class="bg-mode-btn"
                class:active={selectedTextBg === bgOpt.value}
                on:click={() => dispatch("setTextBg", bgOpt.value)}
              >
                {bgOpt.label}
              </button>
            {/each}
          </div>

          <div class="color-swatches-group">
            {#each presetColors as c}
              <button
                type="button"
                class="preset-color-dot"
                class:active={selectedTextColor === c}
                style="background: {c};"
                on:click={() => dispatch("setTextColor", c)}
              ></button>
            {/each}
            <button
              type="button"
              class="preset-color-dot custom-picker-dot"
              on:click={() => dispatch("openColorPicker", "text-color")}
              title="Палитра"
            >
              <img src="/icons/stories/palette.svg" alt="" width="14" height="14" />
            </button>
          </div>
        </div>

        <div class="font-dropdown-wrap">
          <button
            type="button"
            class="font-select-btn"
            on:click={() => (fontDropdownOpen = !fontDropdownOpen)}
          >
            <span style="font-family: {selectedFontFamily};">
              {availableFonts.find((f) => f.family === selectedFontFamily)?.name || "Шрифт"}
            </span>
            <img src="/icons/chevron-down.svg" alt="" width="14" height="14" />
          </button>

          {#if fontDropdownOpen}
            <div class="font-dropdown-list" transition:fade={{ duration: 120 }}>
              {#each availableFonts as font}
                <button
                  type="button"
                  class="font-item"
                  class:active={selectedFontFamily === font.family}
                  on:click={() => {
                    dispatch("setTextFont", font.family);
                    fontDropdownOpen = false;
                  }}
                >
                  <span style="font-family: {font.family};">{font.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <button
          type="button"
          class="drawer-done-btn"
          on:click={() => dispatch("finishText")}
          title="Готово"
        >
          <img src="/icons/check.svg" alt="" width="18" height="18" />
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .story-drawer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(22, 23, 28, 0.96);
    backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    padding: 10px 14px;
    z-index: var(--z-sheet, 7);
    box-sizing: border-box;
  }

  .story-drawer.has-trimmer {
    bottom: 74px;
  }

  .drawing-action-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-wrap: nowrap;
  }
  .drawing-action-row::-webkit-scrollbar {
    display: none;
  }

  .color-preview-circle {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid #ffffff;
    cursor: pointer;
    flex-shrink: 0;
  }

  .brush-slider {
    width: 90px;
    min-width: 60px;
    flex-shrink: 0;
    accent-color: #3b82f6;
  }

  .action-text-btn {
    padding: 6px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.16s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .action-text-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
  }
  .action-text-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .action-text-btn.danger {
    color: #f87171;
  }

  .drawer-done-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #10b981;
    border: none;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .filters-scroll-row {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    scrollbar-width: none;
    justify-content: center;
  }
  .filters-scroll-row::-webkit-scrollbar {
    display: none;
  }

  .filter-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    padding: 4px;
    border-radius: 8px;
    transition: transform 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .filter-card:hover {
    color: #ffffff;
    transform: translateY(-2px);
  }
  .filter-card.active {
    color: #3b82f6;
  }

  .filter-sample {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color 0.15s;
    background: #111;
  }
  .filter-card.active .filter-sample {
    border-color: #3b82f6;
  }
  .filter-sample img,
  .filter-sample-fallback {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .filter-sample-fallback {
    background: linear-gradient(135deg, #f59e0b, #ec4899);
  }

  .crop-options-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    overflow-x: auto;
  }

  .crop-aspect-btn {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.85);
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .crop-aspect-btn:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }
  .crop-aspect-btn.active {
    background: #ffffff;
    color: #000000;
    border-color: #ffffff;
    font-weight: 600;
  }

  .text-drawer-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    position: relative;
  }

  .text-drawer-scrollable {
    display: flex;
    align-items: center;
    gap: 12px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex: 1;
    min-width: 0;
  }
  .text-drawer-scrollable::-webkit-scrollbar {
    display: none;
  }

  .bg-mode-group {
    display: flex;
    gap: 4px;
    background: rgba(255, 255, 255, 0.08);
    padding: 3px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .bg-mode-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.65);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.16s, color 0.16s;
    white-space: nowrap;
  }
  .bg-mode-btn.active {
    background: rgba(255, 255, 255, 0.22);
    color: #ffffff;
  }

  .color-swatches-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .preset-color-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.15s, border-color 0.15s;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .preset-color-dot:hover {
    transform: scale(1.15);
  }
  .preset-color-dot.active {
    border-color: #ffffff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.7);
  }
  .custom-picker-dot {
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .font-dropdown-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .font-select-btn {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 10px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .font-dropdown-list {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 8px;
    background: rgba(22, 23, 28, 0.98);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 140px;
    max-height: 200px;
    overflow-y: auto;
    z-index: var(--z-dropdown, 6);
  }

  .font-item {
    width: 100%;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .font-item:hover, .font-item.active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }
</style>
