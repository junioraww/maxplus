<script>
  import { createEventDispatcher, onMount } from "svelte";
  import {
    favoriteSetIds,
    stickerSets,
    stickersById,
    recentStickerIds,
    ensureFavoritesLoaded,
    ensureStickers,
    unfavoriteSet,
    clearRecentStickers,
  } from "$lib/stores/stickers";
  import { openScreen } from "$lib/services/layerManager";
  import { showAlert } from "$lib/utils/alert";
  import StickerPackModal from "./StickerPackModal.svelte";
  import StickerMedia from "./StickerMedia.svelte";

  const dispatch = createEventDispatcher();

  export let close = null;

  let subview = "main";
  let busySetId = null;

  onMount(() => {
    ensureFavoritesLoaded().catch(() => {});
  });

  function handleBack() {
    if (subview !== "main") {
      subview = "main";
      return;
    }
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
  }

  function handleOpenPack(setId) {
    openScreen(StickerPackModal, { setId });
  }

  function openRecentView() {
    subview = "recent";
    if ($recentStickerIds?.length) {
      ensureStickers($recentStickerIds).catch(() => {});
    }
  }

  function handleClearRecent() {
    clearRecentStickers();
    showAlert("Недавние стикеры очищены");
  }

  function handleCopyLink(pack) {
    if (!pack?.link) return;
    const fullLink = pack.link.startsWith("http")
      ? pack.link
      : `https://max.ru/${pack.link}`;
    navigator.clipboard.writeText(fullLink);
    showAlert("Ссылка скопирована");
  }

  async function handleRemovePack(pack) {
    if (!pack?.id || busySetId === pack.id) return;
    busySetId = pack.id;
    try {
      const ok = await unfavoriteSet(pack.id);
      if (ok) {
        showAlert("Набор удалён");
      }
    } catch {
      showAlert("Не удалось удалить набор");
    } finally {
      busySetId = null;
    }
  }

  $: myPacks = $favoriteSetIds
    .map((id) => $stickerSets.get(id))
    .filter(Boolean);

  $: recentStickers = ($recentStickerIds || [])
    .map((id) => $stickersById.get(id))
    .filter(Boolean);

  $: recentCount = $recentStickerIds?.length || 0;
  $: headerTitle =
    subview === "recent"
      ? "Недавние"
      : subview === "favorites"
        ? "Избранные"
        : "Настройки стикеров";
</script>

<div class="sticker-settings-screen">
  <div class="screen-header">
    <button type="button" class="back-btn" on:click={handleBack} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <h2 class="header-title">{headerTitle}</h2>
    {#if subview === "recent" && recentCount > 0}
      <button type="button" class="header-text-btn" on:click={handleClearRecent}>
        Очистить
      </button>
    {/if}
  </div>

  <div class="settings-scroll-content">
    {#if subview === "main"}
      <div class="settings-card">
        <button type="button" class="settings-row" on:click={openRecentView}>
          <div class="row-left">
            <span class="mask-icon row-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 22px; height: 22px;"></span>
            <div class="row-texts">
              <span class="row-title">Недавние</span>
              <span class="row-subtitle">{recentCount} стикеров</span>
            </div>
          </div>
          <span class="mask-icon chevron-icon" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg'); width: 16px; height: 16px;"></span>
        </button>

        <div class="row-divider"></div>

        <button type="button" class="settings-row" on:click={() => (subview = "favorites")}>
          <div class="row-left">
            <span class="mask-icon row-icon" style="-webkit-mask-image: url('/icons/bookmark.svg'); mask-image: url('/icons/bookmark.svg'); width: 22px; height: 22px;"></span>
            <div class="row-texts">
              <span class="row-title">Избранные</span>
              <span class="row-subtitle">{myPacks.length} наборов</span>
            </div>
          </div>
          <span class="mask-icon chevron-icon" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg'); width: 16px; height: 16px;"></span>
        </button>
      </div>

      <div class="section-title">МОИ НАБОРЫ</div>

      <div class="settings-card packs-card">
        {#if myPacks.length === 0}
          <div class="empty-packs-label">Нет добавленных наборов</div>
        {:else}
          {#each myPacks as pack, idx (pack.id)}
            {#if idx > 0}
              <div class="row-divider"></div>
            {/if}
            <div class="settings-row pack-row" on:click={() => handleOpenPack(pack.id)}>
              <div class="row-left">
                {#if pack.iconUrl}
                  <img src={pack.iconUrl} alt="" class="pack-thumb" />
                {:else}
                  <div class="pack-thumb-placeholder">{pack.name?.slice(0, 1) || "★"}</div>
                {/if}
                <div class="row-texts">
                  <span class="row-title">{pack.name}</span>
                  <span class="row-subtitle">{pack.stickerIds?.length || 0} стикеров</span>
                </div>
              </div>
              <div class="row-right" on:click|stopPropagation>
                {#if pack.link}
                  <button
                    type="button"
                    class="row-action-btn"
                    title="Скопировать ссылку"
                    on:click={() => handleCopyLink(pack)}
                  >
                    <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 18px; height: 18px;"></span>
                  </button>
                {/if}
                <button
                  type="button"
                  class="row-action-btn danger"
                  title="Удалить набор"
                  disabled={busySetId === pack.id}
                  on:click={() => handleRemovePack(pack)}
                >
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 18px; height: 18px;"></span>
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    {:else if subview === "recent"}
      {#if recentStickers.length === 0}
        <div class="empty-subview">
          <span class="mask-icon empty-subview-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 42px; height: 42px;"></span>
          <div class="empty-subview-title">Нет недавних стикеров</div>
          <div class="empty-subview-subtitle">Отправленные стикеры появятся здесь</div>
        </div>
      {:else}
        <div class="stickers-grid">
          {#each recentStickers as sticker (sticker.id)}
            <div class="sticker-cell">
              <StickerMedia
                url={sticker.url}
                lottieUrl={sticker.lottieUrl}
                size="100%"
                autoplay={true}
                loop={true}
              />
            </div>
          {/each}
        </div>
      {/if}
    {:else if subview === "favorites"}
      {#if myPacks.length === 0}
        <div class="empty-subview">
          <span class="mask-icon empty-subview-icon" style="-webkit-mask-image: url('/icons/bookmark.svg'); mask-image: url('/icons/bookmark.svg'); width: 42px; height: 42px;"></span>
          <div class="empty-subview-title">Нет избранных наборов</div>
          <div class="empty-subview-subtitle">Добавляйте наборы из каталога стикеров</div>
        </div>
      {:else}
        <div class="settings-card packs-card">
          {#each myPacks as pack, idx (pack.id)}
            {#if idx > 0}
              <div class="row-divider"></div>
            {/if}
            <div class="settings-row pack-row" on:click={() => handleOpenPack(pack.id)}>
              <div class="row-left">
                {#if pack.iconUrl}
                  <img src={pack.iconUrl} alt="" class="pack-thumb" />
                {:else}
                  <div class="pack-thumb-placeholder">{pack.name?.slice(0, 1) || "★"}</div>
                {/if}
                <div class="row-texts">
                  <span class="row-title">{pack.name}</span>
                  <span class="row-subtitle">{pack.stickerIds?.length || 0} стикеров</span>
                </div>
              </div>
              <div class="row-right" on:click|stopPropagation>
                <button
                  type="button"
                  class="row-action-btn danger"
                  title="Удалить набор"
                  disabled={busySetId === pack.id}
                  on:click={() => handleRemovePack(pack)}
                >
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 18px; height: 18px;"></span>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .sticker-settings-screen {
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
    gap: 10px;
    padding: 0 12px;
    background: var(--bg-app, #101114);
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .back-btn {
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
    flex-shrink: 0;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .header-title {
    flex: 1;
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-text-btn {
    border: none;
    background: transparent;
    color: var(--accent-color, #3b82f6);
    font-size: 14px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: 8px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .header-text-btn:hover {
    background: rgba(59, 130, 246, 0.12);
  }

  .settings-scroll-content {
    flex: 1;
    overflow-y: auto;
    padding: 14px 14px 28px;
  }

  .settings-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 16px;
    overflow: hidden;
  }

  .settings-row {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease;
    box-sizing: border-box;
  }

  .settings-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .row-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .row-icon {
    color: rgba(255, 255, 255, 0.72);
    flex-shrink: 0;
  }

  .row-texts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .row-title {
    font-size: 15px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-subtitle {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.55);
  }

  .chevron-icon {
    color: rgba(255, 255, 255, 0.45);
    transform: rotate(-90deg);
    flex-shrink: 0;
  }

  .row-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 0 14px;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.5);
    margin: 18px 8px 8px;
  }

  .empty-packs-label {
    padding: 20px 14px;
    text-align: center;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
  }

  .pack-thumb {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }

  .pack-thumb-placeholder {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .row-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .row-action-btn {
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  .row-action-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .row-action-btn.danger:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .stickers-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }

  .sticker-cell {
    aspect-ratio: 1;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    padding: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-subview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 56px 20px;
    gap: 8px;
  }

  .empty-subview-icon {
    color: rgba(255, 255, 255, 0.38);
    margin-bottom: 4px;
  }

  .empty-subview-title {
    font-size: 16px;
    font-weight: 600;
  }

  .empty-subview-subtitle {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
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
