<script>
  import { onMount, createEventDispatcher } from "svelte";
  import { fade, scale } from "svelte/transition";
  import {
    favoriteSetIds,
    stickerSets,
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

  const dispatch = createEventDispatcher();

  let loading = true;
  let busy = false;
  let pack = null;

  $: isFavorite = pack ? $favoriteSetIds.includes(pack.id) : false;
  $: packStickers = pack
    ? (pack.stickerIds || []).map(id => $stickersById.get(id)).filter(Boolean)
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
    close();
  }

  function close() {
    dispatch("close");
  }
</script>

<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click|self={close}>
  <div class="modal-card" transition:scale={{ start: 0.95, duration: 200 }}>
    <div class="modal-header">
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
      <button class="close-btn" type="button" on:click={close}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>

    <div class="modal-body">
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
      <div class="modal-footer">
        <button
          type="button"
          class="btn-fav"
          class:is-remove={isFavorite}
          disabled={busy}
          on:click={toggleFavorite}
        >
          {#if busy}
            <span class="btn-spinner"></span>
          {:else}
            {isFavorite ? "Убрать из моих стикеров" : "Добавить стикеры"}
          {/if}
        </button>

        {#if pack.link}
          <button type="button" class="btn-copy" on:click={copyLink} title="Скопировать ссылку">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
            </svg>
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-card {
    background: #1e2126;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    width: 100%;
    max-width: 480px;
    max-height: 82vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .info-group {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .pack-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }

  .titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pack-title {
    font-size: 17px;
    font-weight: 700;
    color: #fff;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pack-count {
    font-size: 13px;
    color: #8b929e;
    margin-top: 2px;
  }

  .close-btn {
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: #8b929e;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .stickers-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
  }

  .sticker-grid-item {
    background: none;
    border: none;
    padding: 4px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1 / 1;
    box-sizing: border-box;
    overflow: hidden;
    transition: transform 0.15s ease, background-color 0.15s ease;
  }

  .sticker-grid-item:hover {
    background: rgba(255, 255, 255, 0.06);
    transform: scale(1.08);
  }

  .sticker-grid-item:active {
    transform: scale(0.96);
  }

  .loading-state,
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 0;
    color: #8b929e;
    font-size: 14px;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: #248bfe;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .modal-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .btn-fav {
    flex: 1;
    height: 44px;
    background: #248bfe;
    color: #fff;
    border: none;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s, opacity 0.15s;
  }

  .btn-fav:hover {
    background: #1b74d9;
  }

  .btn-fav.is-remove {
    background: rgba(255, 75, 75, 0.15);
    color: #ff5e5e;
  }

  .btn-fav.is-remove:hover {
    background: rgba(255, 75, 75, 0.25);
  }

  .btn-copy {
    width: 44px;
    height: 44px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 12px;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn-copy:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  @media (max-width: 480px) {
    .modal-backdrop {
      padding: 8px;
    }
    .modal-card {
      border-radius: 16px;
      max-height: 88vh;
    }
    .modal-header {
      padding: 12px 14px;
    }
    .modal-body {
      padding: 10px;
    }
    .stickers-grid {
      gap: 6px;
    }
    .modal-footer {
      padding: 10px 14px;
    }
  }
</style>
