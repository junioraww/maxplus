<script>
  import { onMount, createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import {
    favoriteSetIds,
    stickersById,
    ensureSet,
    favoriteSet,
    unfavoriteSet,
    resolveSetIdForSticker,
    resolveSetByLink,
  } from "$lib/stores/stickers";
  import { showAlert } from "$lib/utils/alert";
  import StickerMedia from "./StickerMedia.svelte";

  export let setId = null;
  export let stickerId = null;
  export let link = null;
  export let close = null;

  const dispatch = createEventDispatcher();

  let loading = true;
  let busy = false;
  let pack = null;

  $: isFavorite = pack ? $favoriteSetIds.includes(pack.id) : false;
  $: packStickers = pack
    ? (pack.stickerIds || []).map((id) => $stickersById.get(id)).filter(Boolean)
    : [];

  onMount(async () => {
    try {
      let resolvedId = setId;
      if (!resolvedId && stickerId) {
        resolvedId = await resolveSetIdForSticker(stickerId);
      }
      if (!resolvedId && link) {
        const resolved = await resolveSetByLink(link);
        if (resolved) {
          resolvedId = resolved.id;
          pack = resolved;
        }
      }

      if (resolvedId) {
        pack = await ensureSet(resolvedId);
      }
    } catch (e) {
      console.error(e);
      showAlert("Не удалось загрузить стикерпак");
    } finally {
      loading = false;
    }
  });

  function handleClose() {
    dispatch("close");
    if (typeof close === "function") {
      close();
    }
  }

  async function toggleFavorite() {
    if (!pack || busy) return;
    busy = true;
    try {
      const wasFav = isFavorite;
      const ok = wasFav
        ? await unfavoriteSet(pack.id)
        : await favoriteSet(pack.id);

      if (ok) {
        showAlert(wasFav ? "Стикерпак удалён" : "Стикерпак добавлен");
      } else {
        showAlert("Не удалось выполнить действие");
      }
    } catch {
      showAlert("Произошла ошибка");
    } finally {
      busy = false;
    }
  }

  function copyLink() {
    if (!pack?.link) {
      showAlert("Ссылка недоступна");
      return;
    }
    const fullLink = pack.link.startsWith("http")
      ? pack.link
      : `https://max.ru/${pack.link}`;
    navigator.clipboard.writeText(fullLink);
    showAlert("Ссылка скопирована");
  }

  function handleStickerClick(sticker) {
    dispatch("select", { sticker });
    handleClose();
  }
</script>

<BottomSheet maxHeight="82vh" showClose={false} showHandle={true} close={handleClose}>
  <div class="pack-sheet-content">
    <div class="pack-sheet-header">
      <div class="info-group">
        {#if pack?.iconUrl}
          <img src={pack.iconUrl} alt="" class="pack-icon" />
        {/if}
        <div class="titles">
          <h3 class="pack-title">{pack?.name || (loading ? "Загрузка..." : "Стикерпак")}</h3>
          {#if pack}
            <span class="pack-count">
              {pack.stickerIds?.length || 0} стикеров
            </span>
          {/if}
        </div>
      </div>

      <div class="header-actions">
        {#if pack?.link}
          <button type="button" class="icon-action-btn" on:click={copyLink} title="Скопировать ссылку">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 20px; height: 20px;"></span>
          </button>
        {/if}
        <button type="button" class="icon-action-btn" on:click={handleClose} aria-label="Закрыть">
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 18px; height: 18px;"></span>
        </button>
      </div>
    </div>

    <div class="pack-sheet-body">
      {#if loading}
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Загрузка стикеров...</span>
        </div>
      {:else if !pack}
        <div class="empty-state">
          <span>Стикерпак не найден или недоступен</span>
        </div>
      {:else}
        <div class="stickers-grid">
          {#each packStickers as sticker (sticker.id)}
            <button
              type="button"
              class="sticker-grid-item"
              on:click={() => handleStickerClick(sticker)}
              title={sticker.tags?.join(", ") || ""}
            >
              <StickerMedia
                url={sticker.url}
                lottieUrl={sticker.lottieUrl}
                size="100%"
                autoplay={true}
                loop={true}
              />
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if pack}
      <div class="pack-sheet-footer">
        <button
          type="button"
          class="btn-fav"
          class:is-remove={isFavorite}
          disabled={busy}
          on:click={toggleFavorite}
        >
          {#if busy}
            <span class="btn-spinner"></span>
          {:else if isFavorite}
            Удалить {pack.stickerIds?.length || 0} стикеров
          {:else}
            Добавить {pack.stickerIds?.length || 0} стикеров
          {/if}
        </button>
      </div>
    {/if}
  </div>
</BottomSheet>

<style>
  .pack-sheet-content {
    display: flex;
    flex-direction: column;
    max-height: 76vh;
    overflow: hidden;
  }

  .pack-sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 16px 12px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .info-group {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .pack-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    object-fit: contain;
    background: var(--bg-hover);
    flex-shrink: 0;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .pack-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pack-count {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .icon-action-btn {
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--icon-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .icon-action-btn:hover {
    background: var(--bg-active);
  }

  .pack-sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    min-height: 180px;
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 16px;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .spinner,
  .btn-spinner {
    width: 22px;
    height: 22px;
    border: 2.5px solid var(--border-subtle);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .stickers-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .sticker-grid-item {
    aspect-ratio: 1;
    border: none;
    border-radius: 12px;
    background: var(--bg-hover);
    padding: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.12s ease, background-color 0.15s ease;
  }

  .sticker-grid-item:hover {
    background: var(--bg-active);
    transform: scale(1.04);
  }

  .pack-sheet-footer {
    padding: 12px 16px calc(14px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .btn-fav {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 12px;
    background: var(--accent-primary);
    color: var(--accent-contrast, #ffffff);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s ease, background-color 0.15s ease;
  }

  .btn-fav.is-remove {
    background: var(--status-danger-subtle);
    color: var(--status-danger);
  }

  .btn-fav:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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
