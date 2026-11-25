<script>
  import { createEventDispatcher, onMount } from "svelte";
  import {
    orderedSetIds,
    favoriteSetIds,
    stickerSets,
    stickersById,
    ensureLoaded,
    ensureStickers,
    favoriteSet,
    unfavoriteSet,
  } from "$lib/stores/stickers";
  import { showAlert } from "$lib/utils/alert";
  import { openScreen } from "$lib/services/layerManager";
  import StickerSettingsScreen from "./StickerSettingsScreen.svelte";
  import StickerPackModal from "./StickerPackModal.svelte";
  import StickerMedia from "./StickerMedia.svelte";

  const dispatch = createEventDispatcher();

  export let close = null;

  let isSearchActive = false;
  let query = "";
  let busySetIds = new Set();
  const requestedSetIds = new Set();

  onMount(() => {
    ensureLoaded().catch(() => {});
  });

  function handleClose() {
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
  }

  function handleOpenSettings() {
    openScreen(StickerSettingsScreen, {}, { canSwipe: true });
  }

  function handleOpenPack(setId) {
    openScreen(StickerPackModal, { setId });
  }

  async function togglePackFavorite(pack) {
    if (!pack || busySetIds.has(pack.id)) return;
    const isFav = $favoriteSetIds.includes(pack.id);
    const nextBusy = new Set(busySetIds);
    nextBusy.add(pack.id);
    busySetIds = nextBusy;
    try {
      const ok = isFav ? await unfavoriteSet(pack.id) : await favoriteSet(pack.id);
      if (ok) {
        showAlert(isFav ? "Набор удалён" : "Набор добавлен");
      }
    } catch {
      showAlert("Не удалось обновить набор");
    } finally {
      const cleaned = new Set(busySetIds);
      cleaned.delete(pack.id);
      busySetIds = cleaned;
    }
  }

  function ensurePreviewLoaded(pack) {
    if (!pack?.id || requestedSetIds.has(pack.id)) return;
    requestedSetIds.add(pack.id);
    const previewIds = (pack.stickerIds || []).slice(0, 8);
    if (previewIds.length > 0) {
      ensureStickers(previewIds).catch(() => {});
    }
  }

  $: allPacks = $orderedSetIds
    .map((id) => $stickerSets.get(id))
    .filter(Boolean);

  $: filteredPacks = query.trim()
    ? allPacks.filter((p) =>
        p.name?.toLowerCase().includes(query.trim().toLowerCase())
      )
    : allPacks;

  $: {
    for (const pack of filteredPacks.slice(0, 12)) {
      ensurePreviewLoaded(pack);
    }
  }
</script>

<div class="sticker-catalog-screen">
  <div class="screen-header">
    <div class="header-left">
      <button type="button" class="icon-btn" on:click={handleClose} aria-label="Назад">
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
      </button>
      <h2 class="header-title">Наборы стикеров</h2>
    </div>

    <div class="header-right">
      <button
        type="button"
        class="icon-btn"
        class:active={isSearchActive}
        on:click={() => {
          isSearchActive = !isSearchActive;
          if (!isSearchActive) query = "";
        }}
        aria-label="Поиск"
      >
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/search.svg'); mask-image: url('/icons/search.svg'); width: 20px; height: 20px;"></span>
      </button>
      <button
        type="button"
        class="icon-btn"
        on:click={handleOpenSettings}
        aria-label="Настройки стикеров"
      >
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/settings.svg'); mask-image: url('/icons/settings.svg'); width: 20px; height: 20px;"></span>
      </button>
    </div>
  </div>

  {#if isSearchActive}
    <div class="search-bar-wrap">
      <div class="search-input-box">
        <span class="mask-icon" style="-webkit-mask-image: url('/icons/search.svg'); mask-image: url('/icons/search.svg'); width: 16px; height: 16px;"></span>
        <input
          type="text"
          placeholder="Поиск наборов"
          bind:value={query}
          autofocus
        />
        {#if query}
          <button type="button" class="clear-btn" on:click={() => (query = "")}>
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 14px; height: 14px;"></span>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <div class="packs-scroll-content">
    {#if filteredPacks.length === 0}
      <div class="empty-state">
        <span>Наборы не найдены</span>
      </div>
    {:else}
      <div class="showcase-list">
        {#each filteredPacks as pack (pack.id)}
          {@const isFav = $favoriteSetIds.includes(pack.id)}
          {@const previewIds = (pack.stickerIds || []).slice(0, 8)}
          <div class="showcase-card">
            <div class="showcase-card-head">
              <button type="button" class="showcase-title-btn" on:click={() => handleOpenPack(pack.id)}>
                <span class="showcase-pack-name">{pack.name || "Набор стикеров"}</span>
                <span class="showcase-pack-count">{pack.stickerIds?.length || 0} стикеров</span>
              </button>
              <button
                type="button"
                class="showcase-action-pill"
                class:added={isFav}
                disabled={busySetIds.has(pack.id)}
                on:click={() => togglePackFavorite(pack)}
              >
                {isFav ? "Добавлено" : "Добавить"}
              </button>
            </div>

            <div class="showcase-strip" on:click={() => handleOpenPack(pack.id)}>
              {#each previewIds as sid (sid)}
                {@const st = $stickersById.get(sid)}
                <div class="showcase-sticker-cell">
                  {#if st}
                    <StickerMedia
                      url={st.url}
                      lottieUrl={st.lottieUrl}
                      size="68px"
                      autoplay={false}
                      loop={false}
                    />
                  {:else}
                    <div class="sticker-placeholder"></div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .sticker-catalog-screen {
    width: 100%;
    height: 100%;
    background: var(--bg-app, #101114);
    color: var(--text-primary, #ffffff);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }

  .screen-header {
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    background: var(--bg-app, #101114);
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .icon-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .icon-btn:hover,
  .icon-btn.active {
    background: rgba(255, 255, 255, 0.08);
  }

  .header-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-bar-wrap {
    padding: 8px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }

  .search-input-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.07);
    border-radius: 12px;
    padding: 8px 12px;
    color: rgba(255, 255, 255, 0.65);
  }

  .search-input-box input {
    flex: 1;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 14px;
    outline: none;
    min-width: 0;
  }

  .clear-btn {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }

  .packs-scroll-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px 24px;
  }

  .empty-state {
    padding: 48px 16px;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
  }

  .showcase-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .showcase-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 16px;
    padding: 12px 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .showcase-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .showcase-title-btn {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 0;
    color: inherit;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    cursor: pointer;
  }

  .showcase-pack-name {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .showcase-pack-count {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
  }

  .showcase-action-pill {
    border: none;
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 600;
    background: var(--accent-color, #2563eb);
    color: #ffffff;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s ease, background-color 0.15s ease;
  }

  .showcase-action-pill.added {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.78);
  }

  .showcase-action-pill:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .showcase-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
    cursor: pointer;
  }

  .showcase-strip::-webkit-scrollbar {
    height: 4px;
  }

  .showcase-sticker-cell {
    width: 68px;
    height: 68px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sticker-placeholder {
    width: 54px;
    height: 54px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
  }

  .mask-icon {
    display: inline-block;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
  }
</style>
