<script>
  import { onMount } from "svelte";
  import { fade, slide } from "svelte/transition";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { getUplinkUrl, getSafeAvatarMediaUrl, getSafeAvatarPreviewUrl } from "$lib/services/uplink";
  import { installSafeAvatar } from "$lib/services/AvatarInstallService";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let onClose = () => {};
  export let onApplySuccess = () => {};
  export let onUploadStandard = null;
  export let initialTab = "standard";
  export let initialUid = "";

  let activeTab = initialTab;
  let avatars = [];
  let loading = true;
  let searchInput = "";
  let debouncedSearch = "";
  let directUid = initialUid;
  let isApplying = false;
  let isStandardUploading = false;
  let applyStatus = "";
  let errorMessage = "";
  let selectedAvatar = null;
  let previewLoading = false;
  let directPreviewData = null;

  const unregisterBack = registerBackHandler(() => {
    if (selectedAvatar) {
      selectedAvatar = null;
      return false;
    }
    onClose();
    return false;
  });

  let searchTimeout = null;
  $: {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (debouncedSearch !== searchInput) {
        debouncedSearch = searchInput;
        fetchCatalog(debouncedSearch);
      }
    }, 500);
  }

  async function fetchCatalog(query = "") {
    loading = true;
    errorMessage = "";
    try {
      const params = new URLSearchParams({ limit: "48", sort: "downloads" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(getUplinkUrl(`/api/avatars?${params}`));
      if (res.ok) {
        const data = await res.json();
        avatars = Array.isArray(data) ? data : (data.avatars || []);
      } else {
        errorMessage = "Не удалось загрузить каталог";
      }
    } catch {
      errorMessage = "Ошибка подключения к серверу";
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (initialUid) {
      checkDirectPreview(initialUid);
    }
    fetchCatalog();
    return () => {
      unregisterBack();
      if (searchTimeout) clearTimeout(searchTimeout);
    };
  });

  async function handleStandardUpload() {
    if (isStandardUploading) return;
    isStandardUploading = true;
    errorMessage = "";
    try {
      if (typeof onUploadStandard === "function") {
        await onUploadStandard();
      } else {
        await $API.uploadProfilePhoto();
      }
      onApplySuccess();
      onClose();
    } catch (e) {
      errorMessage = e?.message || "Не удалось загрузить фото профиля";
    } finally {
      isStandardUploading = false;
    }
  }

  async function handleApplyUid(uid) {
    if (isApplying || !uid) return;
    isApplying = true;
    errorMessage = "";
    applyStatus = "Инициализация...";

    try {
      const targetId = Number($currentUser || $currentUserDetails?.id || 0);
      await installSafeAvatar(uid, targetId, (status) => {
        applyStatus = status;
      });
      onApplySuccess();
      onClose();
    } catch (e) {
      errorMessage = e?.message || "Не удалось установить аватарку";
    } finally {
      isApplying = false;
    }
  }

  async function handlePasteUid() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        directUid = text.trim();
        checkDirectPreview(directUid);
      }
    } catch {}
  }

  async function checkDirectPreview(uid) {
    if (!uid || uid.length < 4) {
      directPreviewData = null;
      return;
    }
    previewLoading = true;
    try {
      const res = await fetch(getUplinkUrl(`/api/avatars/${encodeURIComponent(uid)}`));
      if (res.ok) {
        directPreviewData = await res.json();
      } else {
        directPreviewData = null;
      }
    } catch {
      directPreviewData = null;
    } finally {
      previewLoading = false;
    }
  }
</script>

<div class="avatar-modal-backdrop" transition:fade={{ duration: 160 }} on:click={onClose}>
  <div class="avatar-modal-sheet" on:click|stopPropagation>
    <div class="sheet-drag-handle"></div>

    <div class="modal-header">
      <div class="modal-title-group">
        <h2 class="modal-title">Аватарка профиля</h2>
        <span class="modal-subtitle">Установка фото или анимированной аватарки</span>
      </div>
      <button type="button" class="close-btn" on:click={onClose} aria-label="Закрыть">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2.2" fill="none">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="tab-bar">
      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === "standard"}
        on:click={() => (activeTab = "standard")}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <span>Обычная</span>
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === "catalog"}
        on:click={() => (activeTab = "catalog")}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <span>Каталог</span>
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={activeTab === "id"}
        on:click={() => (activeTab = "id")}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" y1="9" x2="20" y2="9"/>
          <line x1="4" y1="15" x2="20" y2="15"/>
          <line x1="10" y1="3" x2="8" y2="21"/>
          <line x1="16" y1="3" x2="14" y2="21"/>
        </svg>
        <span>По ID</span>
      </button>
    </div>

    {#if errorMessage}
      <div class="error-banner" transition:slide={{ duration: 150 }}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>{errorMessage}</span>
      </div>
    {/if}

    {#if isApplying}
      <div class="apply-overlay" transition:fade={{ duration: 120 }}>
        <div class="spinner"></div>
        <p class="apply-text">{applyStatus}</p>
      </div>
    {/if}

    <div class="modal-content">
      {#if activeTab === "standard"}
        <div class="standard-tab-panel">
          <div class="standard-card">
            <div class="standard-icon-circle">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <h3 class="standard-title">Фото из галереи устройства</h3>
            <p class="standard-desc">
              Стандартная фотография профиля Max. Отображается у всех пользователей мессенджера.
            </p>
            <button
              type="button"
              class="primary-action-btn"
              disabled={isStandardUploading}
              on:click={handleStandardUpload}
            >
              {#if isStandardUploading}
                <div class="btn-spinner"></div>
                <span>Загрузка...</span>
              {:else}
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span>Выбрать файл</span>
              {/if}
            </button>
          </div>
        </div>
      {:else if activeTab === "catalog"}
        <div class="catalog-tab-panel">
          <div class="search-box">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              placeholder="Поиск аватарок..."
              bind:value={searchInput}
              class="search-input"
            />
            {#if searchInput}
              <button type="button" class="clear-search-btn" on:click={() => (searchInput = "")}>
                ✕
              </button>
            {/if}
          </div>

          <div class="avatars-scroll-grid">
            {#each avatars as avatar (avatar.id)}
              <button
                type="button"
                class="avatar-grid-item"
                on:click={() => (selectedAvatar = avatar)}
              >
                <div class="item-preview-wrap">
                  {#if avatar.media_type && avatar.media_type.startsWith("video")}
                    <video
                      src={getSafeAvatarMediaUrl(avatar.avatar_uid)}
                      poster={getSafeAvatarPreviewUrl(avatar.avatar_uid)}
                      autoplay
                      loop
                      muted
                      playsinline
                      class="grid-video"
                    />
                  {:else}
                    <img
                      src={getSafeAvatarPreviewUrl(avatar.avatar_uid)}
                      alt={avatar.title}
                      loading="lazy"
                      class="grid-img"
                    />
                  {/if}
                  <div class="grid-badge">
                    ★ {avatar.stars || 0}
                  </div>
                </div>
                <span class="item-title">{avatar.title}</span>
              </button>
            {/each}

            {#if loading && avatars.length === 0}
              <div class="state-msg">
                <div class="spinner"></div>
                <span>Загрузка каталога...</span>
              </div>
            {:else if !loading && avatars.length === 0}
              <div class="state-msg">Аватарки не найдены</div>
            {/if}
          </div>
        </div>
      {:else if activeTab === "id"}
        <div class="id-tab-panel">
          <div class="id-input-card">
            <label class="input-label" for="avatar-uid-input">Уникальный ID аватарки</label>
            <div class="id-input-row">
              <input
                id="avatar-uid-input"
                type="text"
                placeholder="Например: c0a91f4d2e"
                bind:value={directUid}
                on:input={() => checkDirectPreview(directUid)}
                class="uid-field"
              />
              <button type="button" class="paste-btn" on:click={handlePasteUid}>
                Вставить
              </button>
            </div>

            {#if directPreviewData}
              <div class="direct-preview-card" transition:slide={{ duration: 150 }}>
                <div class="preview-media-box">
                  {#if directPreviewData.media_type && directPreviewData.media_type.startsWith("video")}
                    <video
                      src={getSafeAvatarMediaUrl(directPreviewData.avatar_uid)}
                      autoplay
                      loop
                      muted
                      playsinline
                      class="direct-preview-video"
                    />
                  {:else}
                    <img
                      src={getSafeAvatarPreviewUrl(directPreviewData.avatar_uid)}
                      alt={directPreviewData.title}
                      class="direct-preview-img"
                    />
                  {/if}
                </div>
                <div class="preview-info">
                  <span class="preview-name">{directPreviewData.title}</span>
                  <span class="preview-author">{directPreviewData.author || "Автор неизвестен"}</span>
                </div>
              </div>
            {/if}
          </div>

          <button
            type="button"
            class="primary-action-btn"
            disabled={!directUid.trim() || isApplying}
            on:click={() => handleApplyUid(directUid.trim())}
          >
            Установить эту аватарку
          </button>

          <div class="instructions-box">
            <h4 class="instructions-title">Как это работает?</h4>
            <ol class="instructions-list">
              <li>Откройте сайт <strong>maxplus.dev</strong> в браузере.</li>
              <li>Выберите понравившуюся аватарку или загрузите свою в каталог.</li>
              <li>Нажмите кнопку копирования уникального ID.</li>
              <li>Вставьте скопированный ID в поле выше и нажмите «Установить».</li>
            </ol>
          </div>
        </div>
      {/if}
    </div>

    {#if selectedAvatar}
      <div class="preview-overlay" transition:fade={{ duration: 150 }} on:click={() => (selectedAvatar = null)}>
        <div class="preview-sheet" on:click|stopPropagation>
          <div class="preview-sheet-header">
            <h3 class="preview-sheet-title">{selectedAvatar.title}</h3>
            <button type="button" class="close-sheet-btn" on:click={() => (selectedAvatar = null)}>
              ✕
            </button>
          </div>

          <div class="sheet-avatar-circle">
            {#if selectedAvatar.media_type && selectedAvatar.media_type.startsWith("video")}
              <video
                src={getSafeAvatarMediaUrl(selectedAvatar.avatar_uid)}
                poster={getSafeAvatarPreviewUrl(selectedAvatar.avatar_uid)}
                autoplay
                loop
                muted
                playsinline
                class="sheet-media"
              />
            {:else}
              <img
                src={getSafeAvatarPreviewUrl(selectedAvatar.avatar_uid)}
                alt={selectedAvatar.title}
                class="sheet-media"
              />
            {/if}
          </div>

          {#if selectedAvatar.description}
            <p class="sheet-desc">{selectedAvatar.description}</p>
          {/if}

          <div class="sheet-meta">
            <span>Автор: {selectedAvatar.author}</span>
            <span>ID: {selectedAvatar.avatar_uid}</span>
          </div>

          <div class="sheet-actions">
            <button
              type="button"
              class="primary-action-btn"
              disabled={isApplying}
              on:click={() => handleApplyUid(selectedAvatar.avatar_uid)}
            >
              Установить в профиль
            </button>
            <button
              type="button"
              class="secondary-action-btn"
              on:click={() => (selectedAvatar = null)}
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .avatar-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30000;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    touch-action: pan-y;
  }

  @media (min-width: 640px) {
    .avatar-modal-backdrop {
      align-items: center;
      padding: 20px;
    }
  }

  .avatar-modal-sheet {
    width: 100%;
    max-width: 560px;
    max-height: 88dvh;
    background: rgba(22, 22, 28, 0.96);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    padding-bottom: max(16px, env(safe-area-inset-bottom, 16px));
  }

  @media (min-width: 640px) {
    .avatar-modal-sheet {
      border-radius: 24px;
      max-height: 80dvh;
      box-shadow: 0 16px 50px rgba(0, 0, 0, 0.7);
    }
  }

  .sheet-drag-handle {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.2);
    margin: 8px auto 4px;
  }

  @media (min-width: 640px) {
    .sheet-drag-handle {
      display: none;
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.2px;
  }

  .modal-subtitle {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
  }

  .close-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  @media (hover: hover) and (pointer: fine) {
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }
  }

  .tab-bar {
    display: flex;
    background: rgba(0, 0, 0, 0.3);
    padding: 4px;
    margin: 12px 20px 8px;
    border-radius: 12px;
    gap: 4px;
  }

  .tab-btn {
    flex: 1 1 0;
    min-width: 0;
    min-height: 40px;
    border: none;
    background: transparent;
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.55);
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 4px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }

  .tab-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .error-banner {
    margin: 6px 20px 0;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .modal-content {
    flex: 1;
    overflow-y: auto;
    padding: 12px 20px 8px;
  }

  .standard-tab-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
  }

  .standard-card {
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    padding: 32px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .standard-icon-circle {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: rgba(56, 189, 248, 0.1);
    color: #38bdf8;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  .standard-title {
    margin: 0 0 6px;
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
  }

  .standard-desc {
    margin: 0 0 20px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    max-width: 320px;
    line-height: 1.4;
  }

  .search-box {
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 0 12px;
    margin-bottom: 12px;
    color: rgba(255, 255, 255, 0.4);
    min-height: 44px;
  }

  .search-input {
    flex: 1;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 16px;
    padding: 10px 8px;
    outline: none;
  }

  @media (min-width: 640px) {
    .search-input {
      font-size: 13px;
    }
  }

  .clear-search-btn {
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    padding: 4px;
  }

  .avatars-scroll-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    max-height: 380px;
    overflow-y: auto;
    padding-bottom: 12px;
  }

  @media (min-width: 480px) {
    .avatars-scroll-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .avatar-grid-item {
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(255, 255, 255, 0.03);
    border-radius: 14px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    cursor: pointer;
    transition: transform 0.12s, border-color 0.15s, background 0.15s;
    touch-action: manipulation;
  }

  .avatar-grid-item:active {
    transform: scale(0.96);
  }

  @media (hover: hover) and (pointer: fine) {
    .avatar-grid-item:hover {
      background: rgba(255, 255, 255, 0.07);
      border-color: rgba(56, 189, 248, 0.4);
    }
  }

  .item-preview-wrap {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 10px;
    overflow: hidden;
    position: relative;
    background: #000000;
  }

  .grid-video,
  .grid-img {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
  }

  .grid-badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.65);
    border-radius: 6px;
    padding: 1px 5px;
    font-size: 9px;
    color: #fbbf24;
    font-weight: 700;
  }

  .item-title {
    margin-top: 6px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    font-weight: 500;
  }

  .state-msg {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px 0;
    color: rgba(255, 255, 255, 0.4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .id-tab-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .id-input-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 16px;
  }

  .input-label {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    display: block;
    margin-bottom: 8px;
  }

  .id-input-row {
    display: flex;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    gap: 8px;
  }

  .uid-field {
    flex: 1 1 0%;
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    color: #38bdf8;
    font-family: monospace;
    font-size: 16px;
    padding: 10px 12px;
    outline: none;
    letter-spacing: 0.5px;
  }

  @media (min-width: 640px) {
    .uid-field {
      font-size: 13px;
    }
  }

  .paste-btn {
    border: none;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    padding: 0 14px;
    cursor: pointer;
    min-height: 44px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .direct-preview-card {
    margin-top: 14px;
    padding: 10px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .preview-media-box {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    overflow: hidden;
    background: #000000;
    flex-shrink: 0;
  }

  .direct-preview-video,
  .direct-preview-img {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
  }

  .preview-name {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
  }

  .preview-author {
    display: block;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.45);
  }

  .instructions-box {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 14px;
    padding: 16px;
  }

  .instructions-title {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 700;
    color: #ffffff;
  }

  .instructions-list {
    margin: 0;
    padding-left: 20px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
    line-height: 1.6;
  }

  .primary-action-btn {
    width: 100%;
    min-height: 44px;
    border: none;
    border-radius: 12px;
    background: #0284c7;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    touch-action: manipulation;
  }

  .primary-action-btn:active {
    transform: scale(0.98);
  }

  @media (hover: hover) and (pointer: fine) {
    .primary-action-btn:hover {
      background: #0369a1;
    }
  }

  .primary-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .secondary-action-btn {
    width: 100%;
    min-height: 44px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .preview-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10;
  }

  .preview-sheet {
    width: 100%;
    background: rgba(24, 24, 30, 0.98);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px 20px 0 0;
    padding: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .preview-sheet-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .preview-sheet-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
  }

  .close-sheet-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
  }

  .sheet-avatar-circle {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    overflow: hidden;
    background: #000000;
    border: 3px solid rgba(56, 189, 248, 0.4);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
    margin-bottom: 14px;
  }

  .sheet-media {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
  }

  .sheet-desc {
    margin: 0 0 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    text-align: center;
    max-width: 320px;
  }

  .sheet-meta {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
    margin-bottom: 20px;
  }

  .sheet-actions {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .apply-overlay {
    position: absolute;
    inset: 0;
    background: rgba(14, 14, 18, 0.92);
    backdrop-filter: blur(12px);
    z-index: 20;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }

  .apply-text {
    font-size: 14px;
    font-weight: 600;
    color: #38bdf8;
    margin: 0;
  }

  .spinner,
  .btn-spinner {
    width: 28px;
    height: 28px;
    border: 3px solid rgba(56, 189, 248, 0.2);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .btn-spinner {
    width: 18px;
    height: 18px;
    border-width: 2px;
    border-color: rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
