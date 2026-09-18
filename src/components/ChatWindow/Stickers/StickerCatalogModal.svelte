<script>
  import { createEventDispatcher } from "svelte";
  import { fade, scale } from "svelte/transition";
  import {
    orderedSetIds,
    favoriteSetIds,
    stickerSets,
    favoriteSet,
    unfavoriteSet,
  } from "$lib/stores/stickers";
  import { showAlert } from "$lib/utils/alert";

  const dispatch = createEventDispatcher();

  let query = "";
  let busySetId = null;

  $: allPacks = $orderedSetIds
    .map(id => $stickerSets.get(id))
    .filter(Boolean);

  $: filteredPacks = query.trim()
    ? allPacks.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : allPacks;

  async function handleToggle(pack) {
    if (busySetId) return;
    busySetId = pack.id;
    try {
      const isFav = $favoriteSetIds.includes(pack.id);
      if (isFav) {
        const ok = await unfavoriteSet(pack.id);
        if (ok) showAlert("Стикерпак удалён из моих");
      } else {
        const ok = await favoriteSet(pack.id);
        if (ok) showAlert("Стикерпак добавлен в мои");
      }
    } catch {
      showAlert("Не удалось обновить стикерпак");
    } finally {
      busySetId = null;
    }
  }

  function handleSelectPack(pack) {
    dispatch("openPack", { setId: pack.id });
  }

  function close() {
    dispatch("close");
  }
</script>

<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click|self={close}>
  <div class="modal-card" transition:scale={{ start: 0.95, duration: 200 }}>
    <div class="modal-header">
      <div class="title-group">
        <h3 class="modal-title">Каталог стикеров</h3>
        <span class="modal-subtitle">{filteredPacks.length} наборов</span>
      </div>
      <button class="close-btn" type="button" on:click={close}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>

    <div class="search-wrap">
      <svg viewBox="0 0 24 24" width="18" height="18" class="search-icon">
        <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <input
        type="text"
        placeholder="Поиск по наборам"
        bind:value={query}
        class="search-input"
      />
      {#if query}
        <button type="button" class="clear-btn" on:click={() => { query = ""; }}>
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      {/if}
    </div>

    <div class="modal-body">
      {#if filteredPacks.length === 0}
        <div class="empty-state">
          <span>Стикерпаки не найдены</span>
        </div>
      {:else}
        <div class="packs-list">
          {#each filteredPacks as pack (pack.id)}
            {@const isFav = $favoriteSetIds.includes(pack.id)}
            <div class="pack-row">
              <button
                type="button"
                class="pack-info-btn"
                on:click={() => handleSelectPack(pack)}
              >
                {#if pack.iconUrl}
                  <img src={pack.iconUrl} alt="" class="pack-avatar" />
                {:else}
                  <div class="pack-placeholder">{pack.name.slice(0, 1)}</div>
                {/if}
                <div class="pack-texts">
                  <span class="pack-title">{pack.name}</span>
                  <span class="pack-stickers-count">
                    {pack.stickerIds?.length || 0} стикеров
                  </span>
                </div>
              </button>

              <button
                type="button"
                class="action-btn"
                class:is-fav={isFav}
                disabled={busySetId === pack.id}
                on:click={() => handleToggle(pack)}
              >
                {#if busySetId === pack.id}
                  <span class="spinner-small"></span>
                {:else if isFav}
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19 13H5v-2h14v2z"/>
                  </svg>
                  <span>Удалить</span>
                {:else}
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                  <span>Добавить</span>
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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
    padding: 16px 20px 12px;
  }

  .title-group {
    display: flex;
    flex-direction: column;
  }

  .modal-title {
    font-size: 17px;
    font-weight: 700;
    color: #fff;
    margin: 0;
  }

  .modal-subtitle {
    font-size: 13px;
    color: #8b929e;
    margin-top: 2px;
  }

  .close-btn {
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: #8b929e;
    width: 32px;
    height: 32px;
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

  .search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 16px 12px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .search-icon {
    color: #8b929e;
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #fff;
    font-size: 14px;
    font-family: inherit;
  }

  .search-input::placeholder {
    color: #8b929e;
  }

  .clear-btn {
    background: none;
    border: none;
    color: #8b929e;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 16px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 0;
    color: #8b929e;
    font-size: 14px;
  }

  .packs-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pack-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    transition: background-color 0.15s;
  }

  .pack-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .pack-info-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    min-width: 0;
    flex: 1;
    text-align: left;
  }

  .pack-avatar {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.04);
    flex-shrink: 0;
  }

  .pack-placeholder {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }

  .pack-texts {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pack-title {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pack-stickers-count {
    font-size: 12px;
    color: #8b929e;
    margin-top: 2px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    background: #248bfe;
    color: #fff;
    flex-shrink: 0;
    transition: background-color 0.15s, opacity 0.15s;
  }

  .action-btn:hover {
    background: #1b74d9;
  }

  .action-btn.is-fav {
    background: rgba(255, 255, 255, 0.08);
    color: #8b929e;
  }

  .action-btn.is-fav:hover {
    background: rgba(255, 75, 75, 0.15);
    color: #ff5e5e;
  }

  .spinner-small {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
