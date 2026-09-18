<script context="module">
  let sharedSectionObserver = null;
  const sectionCallbacks = new Map();

  function getSectionObserver() {
    if (!sharedSectionObserver && typeof IntersectionObserver !== "undefined") {
      sharedSectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const cb = sectionCallbacks.get(entry.target);
            if (cb) cb(entry);
          }
        },
        {
          rootMargin: "300px 0px",
          threshold: 0,
        }
      );
    }
    return sharedSectionObserver;
  }

  function observeSection(el, cb) {
    const obs = getSectionObserver();
    if (!obs) {
      cb({ isIntersecting: true });
      return () => {};
    }
    sectionCallbacks.set(el, cb);
    obs.observe(el);
    return () => {
      sectionCallbacks.delete(el);
      obs.unobserve(el);
    };
  }
</script>

<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { stickersById, favoriteSetIds, ensureStickers, favoriteSet, unfavoriteSet } from "$lib/stores/stickers";
  import { showAlert } from "$lib/utils/alert";
  import StickerMedia from "./StickerMedia.svelte";

  export let section;
  export let isFavorite = false;
  export let initialInView = false;

  const dispatch = createEventDispatcher();

  let sectionEl;
  let isInView = initialInView || section.id === "recents";
  let hasTriggeredLoad = false;
  let unobserve = null;
  let busy = false;

  $: isFav = section.id === "recents" ? false : $favoriteSetIds.includes(section.id);
  $: gridHeight = Math.max(82, Math.ceil((section.stickerIds?.length || 0) / 4) * 82);

  function loadStickers() {
    if (hasTriggeredLoad) return;
    hasTriggeredLoad = true;
    if (section.stickerIds?.length) {
      ensureStickers(section.stickerIds);
    }
  }

  onMount(() => {
    if (isInView) {
      loadStickers();
    }

    if (sectionEl) {
      unobserve = observeSection(sectionEl, (entry) => {
        if (entry.isIntersecting) {
          isInView = true;
          loadStickers();
        } else {
          isInView = false;
        }
      });
    }
  });

  onDestroy(() => {
    if (unobserve) {
      unobserve();
      unobserve = null;
    }
  });

  async function handleToggleFavorite() {
    if (busy || section.id === "recents") return;
    busy = true;
    try {
      if (isFav) {
        const ok = await unfavoriteSet(section.id);
        if (ok) showAlert("Стикерпак удалён из моих");
      } else {
        const ok = await favoriteSet(section.id);
        if (ok) showAlert("Стикерпак добавлен в мои");
      }
    } catch {
      showAlert("Не удалось обновить стикерпак");
    } finally {
      busy = false;
    }
  }

  function handleOpenPack() {
    if (section.id === "recents") return;
    dispatch("openPack", { setId: section.id });
  }

  function handleStickerClick(st) {
    if (!st) return;
    dispatch("select", { sticker: st });
  }

  function handlePeekStart(st) {
    if (!st) return;
    dispatch("peekStart", { sticker: st });
  }

  function handlePeekEnd() {
    dispatch("peekEnd");
  }
</script>

<div
  bind:this={sectionEl}
  class="sticker-section"
  class:is-favorite-card={isFavorite}
  data-section-id={section.id}
>
  <div class="section-header">
    <button type="button" class="header-info-btn" on:click={handleOpenPack}>
      {#if section.iconUrl}
        <img src={section.iconUrl} alt="" class="sec-icon" />
      {/if}
      <span class="sec-name">{section.name}</span>
    </button>

    {#if section.id !== "recents"}
      <div class="header-actions">
        {#if isFav}
          <button
            type="button"
            class="action-btn remove-btn"
            disabled={busy}
            on:click={handleToggleFavorite}
            title="Удалить из моих"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M19 13H5v-2h14v2z"/>
            </svg>
            <span class="action-text">Удалить</span>
          </button>
        {:else}
          <button
            type="button"
            class="action-btn add-btn"
            disabled={busy}
            on:click={handleToggleFavorite}
            title="Добавить в мои стикеры"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            <span class="action-text">Добавить</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if isInView}
    <div class="stickers-grid">
      {#each section.stickerIds as sid (sid)}
        {@const st = $stickersById.get(sid)}
        <button
          type="button"
          class="sticker-cell"
          on:click={() => handleStickerClick(st)}
          on:mousedown={() => handlePeekStart(st)}
          on:mouseup={handlePeekEnd}
          on:mouseleave={handlePeekEnd}
          on:touchstart={() => handlePeekStart(st)}
          on:touchend={handlePeekEnd}
          title={st?.tags?.join(", ") || ""}
        >
          <StickerMedia
            url={st?.url || ""}
            lottieUrl={st?.lottieUrl}
            size={76}
            autoplay={true}
            loop={true}
          />
        </button>
      {/each}
    </div>
  {:else}
    <div class="grid-placeholder" style="height: {gridHeight}px;"></div>
  {/if}
</div>

<style>
  .sticker-section {
    margin-bottom: 14px;
  }

  .sticker-section.is-favorite-card {
    background: rgba(255, 255, 255, 0.04);
    border-radius: 14px;
    padding: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 6px 8px;
  }

  .header-info-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }

  .sec-icon {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .sec-name {
    font-size: 13px;
    font-weight: 600;
    color: #8b929e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.15s;
  }

  .header-info-btn:hover .sec-name {
    color: #fff;
  }

  .header-actions {
    display: flex;
    align-items: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 4px 8px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .add-btn {
    color: #248bfe;
    background: rgba(36, 139, 254, 0.1);
  }

  .add-btn:hover {
    background: rgba(36, 139, 254, 0.2);
  }

  .remove-btn {
    color: #8b929e;
    background: rgba(255, 255, 255, 0.05);
  }

  .remove-btn:hover {
    color: #ff5e5e;
    background: rgba(255, 75, 75, 0.12);
  }

  .action-text {
    line-height: 1;
  }

  .stickers-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }

  .grid-placeholder {
    width: 100%;
    min-height: 82px;
  }

  .sticker-cell {
    background: none;
    border: none;
    padding: 4px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s, transform 0.15s;
    user-select: none;
    -webkit-user-select: none;
  }

  .sticker-cell:hover {
    background: rgba(255, 255, 255, 0.06);
    transform: scale(1.05);
  }

  .sticker-cell:active {
    transform: scale(0.95);
  }
</style>
