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

  export let textBgOptions = [];
  export let selectedTextBg = "rgba(0,0,0,0.7)";
  export let presetColors = [];
  export let selectedTextColor = "#ffffff";
  export let availableFonts = [];
  export let selectedFontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  export let fontDropdownOpen = false;

  export let doodleColor = "#ff4444";
  export let doodleSize = 6;
  export let doodleCanvas = null;

  export let cropModified = false;

  let bgDropdownOpen = false;

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
      <div class="filters-drawer-row">
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
        <div class="bg-dropdown-wrap">
          <button
            type="button"
            class="drawer-dropdown-btn"
            on:click={() => {
              bgDropdownOpen = !bgDropdownOpen;
              if (bgDropdownOpen) fontDropdownOpen = false;
            }}
          >
            <span>
              {textBgOptions.find((b) => b.value === selectedTextBg)?.label || "Фон"}
            </span>
            <img src="/icons/chevron-down.svg" alt="" width="14" height="14" />
          </button>

          {#if bgDropdownOpen}
            <div class="drawer-dropdown-list" transition:fade={{ duration: 120 }}>
              {#each textBgOptions as bgOpt}
                <button
                  type="button"
                  class="dropdown-item"
                  class:active={selectedTextBg === bgOpt.value}
                  on:click={() => {
                    dispatch("setTextBg", bgOpt.value);
                    bgDropdownOpen = false;
                  }}
                >
                  <span>{bgOpt.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="text-drawer-scrollable">
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
            class="drawer-dropdown-btn"
            on:click={() => {
              fontDropdownOpen = !fontDropdownOpen;
              if (fontDropdownOpen) bgDropdownOpen = false;
            }}
          >
            <span style="font-family: {selectedFontFamily};">
              {availableFonts.find((f) => f.family === selectedFontFamily)?.name || "Шрифт"}
            </span>
            <img src="/icons/chevron-down.svg" alt="" width="14" height="14" />
          </button>

          {#if fontDropdownOpen}
            <div class="drawer-dropdown-list font-list" transition:fade={{ duration: 120 }}>
              {#each availableFonts as font}
                <button
                  type="button"
                  class="dropdown-item"
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

    {:else if activeDrawer === "crop"}
      <div class="crop-drawer-row" transition:fly={{ y: 20, duration: 160 }}>
        <button
          type="button"
          class="action-text-btn"
          on:click={() => dispatch("cropCancel")}
        >
          Отмена
        </button>
        {#if cropModified}
          <button
            type="button"
            class="action-text-btn"
            on:click={() => dispatch("cropReset")}
          >
            Сбросить
          </button>
        {/if}
        <button
          type="button"
          class="drawer-done-btn"
          on:click={() => dispatch("cropApply")}
          title="Применить"
        >
          <img src="/icons/check.svg" alt="" width="18" height="18" />
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .story-drawer {
    width: 100%;
    display: flex;
    align-items: center;
    box-sizing: border-box;
  }

  .drawing-action-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    width: 100%;
    flex-wrap: nowrap;
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
    font-size: 13px;
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
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #10b981;
    border: none;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: auto;
    transition: transform 0.14s ease, background 0.14s ease;
  }
  .drawer-done-btn:active {
    transform: scale(0.92);
  }

  .filters-drawer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }

  .filters-scroll-row {
    display: flex;
    align-items: center;
    gap: 12px;
    overflow-x: auto;
    scrollbar-width: none;
    justify-content: flex-start;
    padding: 2px 4px;
    flex: 1;
    min-width: 0;
  }
  .filters-scroll-row::-webkit-scrollbar {
    display: none;
  }

  .filter-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    font-size: 11px;
    padding: 2px;
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
    width: 44px;
    height: 44px;
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

  .text-drawer-row {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    width: 100%;
  }

  .text-drawer-scrollable {
    display: flex;
    align-items: center;
    gap: 10px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex: 1;
    min-width: 0;
  }
  .text-drawer-scrollable::-webkit-scrollbar {
    display: none;
  }

  .bg-dropdown-wrap,
  .font-dropdown-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .drawer-dropdown-btn {
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
    white-space: nowrap;
  }

  .drawer-dropdown-list {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 8px;
    background: rgba(22, 23, 28, 0.98);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 130px;
    max-height: 200px;
    overflow-y: auto;
    z-index: var(--z-dropdown, 6);
  }

  .drawer-dropdown-list.font-list {
    left: auto;
    right: 0;
  }

  .dropdown-item {
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
  .dropdown-item:hover, .dropdown-item.active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .crop-drawer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
  }
</style>