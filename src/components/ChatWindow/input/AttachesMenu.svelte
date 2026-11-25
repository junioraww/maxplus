<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { getProxiedMediaUrl } from "$lib/utils/images";

  export let onClose = null;
  export let close = null;
  export let setBackHandler = null;
  export let onSelect = null;

  const dispatch = createEventDispatcher();

  let activeTab = "gallery";
  let recentMedia = [];
  let loadingRecent = false;

  // Check if we are in a mobile environment (Android / iOS)
  const isMobile =
    typeof navigator !== "undefined" &&
    /android|iphone|ipad|ipod/i.test(navigator.userAgent || "");

  function handleClose() {
    if (typeof close === "function") close();
    if (typeof onClose === "function") onClose();
    dispatch("close");
  }

  let unregisterBack = null;
  if (typeof setBackHandler === "function") {
    setBackHandler(() => {
      handleClose();
      return false;
    });
  } else {
    unregisterBack = registerBackHandler(() => {
      handleClose();
      return true;
    });
  }

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
  });

  // Local drag-to-dismiss controller for the handle
  let isDragging = false;
  let startY = 0;
  let currentDy = 0;
  let startTime = 0;
  let isClosing = false;

  function onHandlePointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    isDragging = true;
    startY = e.clientY;
    startTime = Date.now();
    currentDy = 0;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  }

  function onHandlePointerMove(e) {
    if (!isDragging) return;
    const dy = e.clientY - startY;
    currentDy = Math.max(0, dy);
  }

  function onHandlePointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    const dt = Date.now() - startTime;
    const velocity = currentDy / Math.max(dt, 1);
    if (currentDy > 85 || (velocity > 0.35 && currentDy > 25)) {
      triggerDismiss();
    } else {
      currentDy = 0;
    }
  }

  function triggerDismiss() {
    isClosing = true;
    currentDy = 450;
    setTimeout(() => {
      handleClose();
    }, 180);
  }

  function getMediaUrl(path) {
    if (!path) return "";
    try {
      const proxied = getProxiedMediaUrl(path);
      if (proxied) return proxied;
    } catch {}
    if (typeof convertFileSrc === "function") {
      return convertFileSrc(path);
    }
    if (
      typeof window !== "undefined" &&
      typeof window.__TAURI_INTERNALS__?.convertFileSrc === "function"
    ) {
      return window.__TAURI_INTERNALS__.convertFileSrc(path);
    }
    return path;
  }

  let failedImagePaths = new Set();
  function handleImageError(e, item) {
    if (!failedImagePaths.has(item.path)) {
      failedImagePaths.add(item.path);
      if (typeof convertFileSrc === "function") {
        e.currentTarget.src = convertFileSrc(item.path);
        return;
      }
    }
    e.currentTarget.style.display = "none";
    if (e.currentTarget.parentElement) {
      e.currentTarget.parentElement.classList.add("has-load-error");
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "";
    const k = 1024;
    const sizes = ["Б", "КБ", "МБ", "ГБ"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i] || ""}`;
  }

  async function loadRecentMedia() {
    if (isMobile) return;
    loadingRecent = true;
    try {
      const invokeFn =
        typeof invoke === "function"
          ? invoke
          : window?.__TAURI_INTERNALS__?.invoke || (async () => []);
      const res = await invokeFn("get_recent_media", { limit: 40 }).catch(
        () => []
      );
      recentMedia = Array.isArray(res) ? res : [];
    } catch (_) {
      recentMedia = [];
    } finally {
      loadingRecent = false;
    }
  }

  onMount(() => {
    loadRecentMedia();
  });

  function handleSelect(type) {
    if (typeof onSelect === "function") {
      onSelect({ type });
    }
    dispatch("select", { type });
  }

  function handleSelectRecent(item) {
    const detail = {
      type: item.is_video ? "VIDEO" : "PHOTO",
      path: item.path,
      name: item.name,
      size: item.size,
      mime: item.mime_type,
      is_video: item.is_video,
    };
    if (typeof onSelect === "function") {
      onSelect(detail);
    }
    dispatch("select", detail);
  }

  function handleTabClick(tab) {
    if (tab === "poll") {
      handleSelect("POLL");
      return;
    }
    if (tab === "location") {
      handleSelect("LOCATION");
      return;
    }
    if (tab === "contact") {
      handleSelect("CONTACT");
      return;
    }

    if (activeTab === tab) {
      if (tab === "gallery") handleSelect("PHOTO");
      if (tab === "file") handleSelect("FILE");
    } else {
      activeTab = tab;
    }
  }
</script>

<div
  class="attaches-sheet-backdrop portal-sheet-backdrop attaches-dropout"
  on:click|self={handleClose}
  transition:fade={{ duration: 150 }}
>
  <div
    class="attaches-bottom-sheet attaches-dropout"
    class:is-closing={isClosing}
    style={currentDy > 0 ? `transform: translate3d(0, ${currentDy}px, 0); transition: ${isDragging ? 'none' : 'transform 200ms cubic-bezier(0.1, 0.9, 0.2, 1)'};` : ''}
    on:click|stopPropagation
    on:pointerdown|stopPropagation
  >
    <div
      class="sheet-handle-area"
      on:pointerdown={onHandlePointerDown}
      on:pointermove={onHandlePointerMove}
      on:pointerup={onHandlePointerUp}
      on:pointercancel={onHandlePointerUp}
    >
      <div
        class="sheet-handle bottom-sheet-handle sheet-drag-handle drag-pill"
        title="Потяните вниз, чтобы закрыть"
      ></div>
    </div>

    {#if isMobile}
      <!-- Mobile Only: Android / iOS camera & runtime permissions -->
      <button type="button" class="camera-access-card" on:click={() => handleSelect("PHOTO")}>
        <span class="mask-icon camera-icon" style="-webkit-mask-image: url('/icons/camera-plus.svg'); mask-image: url('/icons/camera-plus.svg'); width: 34px; height: 34px;"></span>
        <span class="camera-access-text">Разрешить доступ к камере</span>
      </button>

      <div class="media-permission-section">
        <div class="permission-title">Нет доступа к файлам и медиа</div>
        <div class="permission-subtitle">
          Разрешите доступ, чтобы отправлять фотографии и видео с этого устройства
        </div>
        <button type="button" class="permission-action-btn" on:click={() => handleSelect("PHOTO")}>
          Разрешить доступ
        </button>
      </div>
    {:else}
      <!-- Desktop (Linux / macOS / Windows / Browser): Recent media & file actions -->
      {#if activeTab === "gallery"}
        <div class="desktop-gallery-wrap" transition:fade={{ duration: 120 }}>
          <div class="gallery-top-bar">
            <div class="gallery-top-info">
              <span class="gallery-top-title">Недавние медиа</span>
              {#if recentMedia.length > 0}
                <span class="gallery-count-badge">{recentMedia.length}</span>
              {/if}
            </div>

            <button
              type="button"
              class="pick-all-btn"
              on:click={() => handleSelect("PHOTO")}
              title="Открыть системный диалог выбора файлов"
            >
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/image-plus.svg'); mask-image: url('/icons/image-plus.svg'); width: 16px; height: 16px;"></span>
              <span>Все файлы</span>
            </button>
          </div>

          {#if loadingRecent}
            <div class="recent-skeleton-grid">
              {#each Array(10) as _}
                <div class="recent-skeleton-cell"></div>
              {/each}
            </div>
          {:else if recentMedia.length > 0}
            <div class="recent-media-grid">
              {#each recentMedia as item (item.path)}
                <button
                  type="button"
                  class="recent-media-cell"
                  on:click={() => handleSelectRecent(item)}
                  title="{item.name} ({formatBytes(item.size)})"
                >
                  {#if item.is_video}
                    <div class="video-thumb-container">
                      <video
                        src={getMediaUrl(item.path)}
                        class="recent-thumb-video"
                        preload="metadata"
                        muted
                        playsinline
                      ></video>
                      <div class="video-indicator">
                        <svg viewBox="0 0 24 24" class="video-indicator-svg">
                          <path fill="currentColor" d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    </div>
                  {:else}
                    <img
                      src={getMediaUrl(item.path)}
                      alt={item.name}
                      class="recent-thumb-img"
                      loading="lazy"
                      on:error={(e) => handleImageError(e, item)}
                    />
                  {/if}

                  <div class="media-hover-overlay">
                    <span class="media-cell-name">{item.name}</span>
                    {#if item.size}
                      <span class="media-cell-size">{formatBytes(item.size)}</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {:else}
            <!-- Empty state if no media in Pictures / Downloads -->
            <div class="desktop-empty-gallery">
              <div class="empty-gallery-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/gallery.svg'); mask-image: url('/icons/gallery.svg'); width: 34px; height: 34px; background-color: #8a8d9b;"></span>
              </div>
              <div class="empty-gallery-text">
                В папках «Изображения» и «Загрузки» не найдено недавних файлов
              </div>
              <button
                type="button"
                class="desktop-main-action-btn primary"
                on:click={() => handleSelect("PHOTO")}
              >
                <span class="mask-icon action-btn-icon" style="-webkit-mask-image: url('/icons/image-plus.svg'); mask-image: url('/icons/image-plus.svg'); width: 18px; height: 18px; background-color: #ffffff;"></span>
                <span>Выбрать фото или видео</span>
              </button>
            </div>
          {/if}

          <div class="desktop-sub-actions">
            <button
              type="button"
              class="desktop-secondary-btn"
              on:click={() => handleSelect("FILE")}
            >
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/file.svg'); mask-image: url('/icons/file.svg'); width: 15px; height: 15px; background-color: #8a8d9b;"></span>
              <span>Отправить без сжатия (как файл)</span>
            </button>
          </div>
        </div>
      {:else if activeTab === "file"}
        <div class="desktop-media-section" transition:fade={{ duration: 120 }}>
          <div class="desktop-media-header">
            <div class="desktop-media-icon-wrap">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/file.svg'); mask-image: url('/icons/file.svg'); width: 30px; height: 30px; background-color: #38bdf8;"></span>
            </div>
            <div class="desktop-media-texts">
              <div class="desktop-media-title">Отправка файлов</div>
              <div class="desktop-media-subtitle">
                Документы, архивы, аудио и другие файлы любого формата без сжатия
              </div>
            </div>
          </div>

          <div class="desktop-actions-grid">
            <button
              type="button"
              class="desktop-main-action-btn primary"
              on:click={() => handleSelect("FILE")}
            >
              <span class="mask-icon action-btn-icon" style="-webkit-mask-image: url('/icons/file.svg'); mask-image: url('/icons/file.svg'); width: 20px; height: 20px; background-color: #ffffff;"></span>
              <span>Выбрать файл на компьютере</span>
            </button>
          </div>
        </div>
      {/if}
    {/if}

    <div class="sheet-tabs-bar">
      <button
        type="button"
        class="sheet-tab-btn"
        class:active={activeTab === "gallery"}
        on:click={() => handleTabClick("gallery")}
      >
        <span class="mask-icon tab-icon" style="-webkit-mask-image: url('/icons/gallery.svg'); mask-image: url('/icons/gallery.svg'); width: 22px; height: 22px;"></span>
        <span class="tab-label">Галерея</span>
      </button>

      <button
        type="button"
        class="sheet-tab-btn"
        class:active={activeTab === "file"}
        on:click={() => handleTabClick("file")}
      >
        <span class="mask-icon tab-icon" style="-webkit-mask-image: url('/icons/file.svg'); mask-image: url('/icons/file.svg'); width: 22px; height: 22px;"></span>
        <span class="tab-label">Файл</span>
      </button>

      <button
        type="button"
        class="sheet-tab-btn"
        class:active={activeTab === "poll"}
        on:click={() => handleTabClick("poll")}
      >
        <span class="mask-icon tab-icon" style="-webkit-mask-image: url('/icons/poll.svg'); mask-image: url('/icons/poll.svg'); width: 22px; height: 22px;"></span>
        <span class="tab-label">Опрос</span>
      </button>

      <button
        type="button"
        class="sheet-tab-btn"
        class:active={activeTab === "location"}
        on:click={() => handleTabClick("location")}
      >
        <span class="mask-icon tab-icon" style="-webkit-mask-image: url('/icons/location.svg'); mask-image: url('/icons/location.svg'); width: 22px; height: 22px;"></span>
        <span class="tab-label">Место</span>
      </button>

      <button
        type="button"
        class="sheet-tab-btn"
        class:active={activeTab === "contact"}
        on:click={() => handleTabClick("contact")}
      >
        <span class="mask-icon tab-icon" style="-webkit-mask-image: url('/icons/user.svg'); mask-image: url('/icons/user.svg'); width: 22px; height: 22px;"></span>
        <span class="tab-label">Контакт</span>
      </button>
    </div>
  </div>
</div>

<style>
  .attaches-sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 45);
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .attaches-bottom-sheet {
    width: 100%;
    max-width: 540px;
    background: var(--bg-surface, #1e2029);
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.55);
    padding: 0 16px 12px;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    z-index: var(--z-modal, 46);
    user-select: none;
    animation: sheetSlideUp 220ms cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
    border: 1px solid var(--dropout-border, rgba(255, 255, 255, 0.08));
    border-bottom: none;
    touch-action: pan-y;
  }

  @keyframes sheetSlideUp {
    from {
      transform: translate3d(0, 100%, 0);
    }
    to {
      transform: translate3d(0, 0, 0);
    }
  }

  .sheet-handle-area {
    width: 100%;
    padding: 10px 0 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: grab;
    touch-action: none;
  }

  .sheet-handle-area:active {
    cursor: grabbing;
  }

  .sheet-handle {
    width: 40px;
    height: 4px;
    background: rgba(255, 255, 255, 0.28);
    border-radius: 2px;
    flex-shrink: 0;
    transition: background 0.15s ease, width 0.15s ease;
  }

  .sheet-handle-area:hover .sheet-handle {
    background: rgba(255, 255, 255, 0.45);
    width: 44px;
  }

  .camera-access-card {
    background: var(--bg-app, #121318);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    cursor: pointer;
    transition: background-color 0.15s ease;
    margin-bottom: 24px;
    width: 100%;
    box-sizing: border-box;
  }

  .camera-access-card:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .camera-icon {
    background-color: var(--primary, #38bdf8);
  }

  .camera-access-text {
    font-size: 15px;
    font-weight: 500;
    color: #ffffff;
  }

  .media-permission-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 0 12px 20px;
  }

  .permission-title {
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 6px;
  }

  .permission-subtitle {
    font-size: 13.5px;
    color: #8a8d9b;
    line-height: 1.4;
    margin-bottom: 16px;
    max-width: 320px;
  }

  .permission-action-btn {
    background: var(--primary, #38bdf8);
    color: #ffffff;
    border: none;
    border-radius: 12px;
    padding: 10px 24px;
    font-size: 14.5px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .permission-action-btn:hover {
    opacity: 0.9;
  }

  .desktop-gallery-wrap {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin-bottom: 8px;
  }

  .gallery-top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .gallery-top-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .gallery-top-title {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
    letter-spacing: 0.2px;
  }

  .gallery-count-badge {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
    font-size: 11px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 10px;
    line-height: 16px;
  }

  .pick-all-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(56, 189, 248, 0.12);
    color: var(--primary, #38bdf8);
    border: none;
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pick-all-btn:hover {
    background: rgba(56, 189, 248, 0.22);
  }

  .pick-all-btn .mask-icon {
    background-color: currentColor;
  }

  .recent-media-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
    max-height: 250px;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2px;
    box-sizing: border-box;
    width: 100%;
  }

  @media (max-width: 440px) {
    .recent-media-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  .recent-media-cell {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    min-width: 0;
    min-height: 0;
    border-radius: 10px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.04);
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    display: block;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  }

  .recent-media-cell:hover {
    transform: scale(1.03);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
    border-color: rgba(56, 189, 248, 0.5);
    z-index: 2;
  }

  .recent-media-cell:active {
    transform: scale(0.97);
  }

  .recent-thumb-img {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    object-fit: cover;
    display: block;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  .video-thumb-container {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .recent-thumb-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .video-indicator {
    position: absolute;
    bottom: 5px;
    right: 5px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    backdrop-filter: blur(2px);
  }

  .video-indicator-svg {
    width: 10px;
    height: 10px;
    color: #ffffff;
    margin-left: 1px;
  }

  .media-hover-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 3px 5px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent);
    display: flex;
    flex-direction: column;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }

  .recent-media-cell:hover .media-hover-overlay {
    opacity: 1;
  }

  .media-cell-name {
    font-size: 10px;
    color: #ffffff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.2;
  }

  .media-cell-size {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.7);
    line-height: 1.1;
  }

  .recent-skeleton-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
    height: 120px;
    width: 100%;
    box-sizing: border-box;
  }

  .recent-skeleton-cell {
    width: 100%;
    aspect-ratio: 1 / 1;
    min-width: 0;
    min-height: 0;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 10px;
    animation: skeleton-pulse 1.4s ease-in-out infinite;
  }

  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.8; }
  }

  .desktop-empty-gallery {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px 8px 16px;
    gap: 12px;
  }

  .empty-gallery-icon {
    width: 54px;
    height: 54px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-gallery-text {
    font-size: 13.5px;
    color: #8a8d9b;
    max-width: 280px;
    line-height: 1.4;
  }

  .desktop-sub-actions {
    margin-top: 10px;
    display: flex;
    align-items: center;
  }

  .desktop-secondary-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    color: #8a8d9b;
    font-size: 13px;
    cursor: pointer;
    padding: 6px 4px;
    border-radius: 8px;
    transition: color 0.15s ease;
  }

  .desktop-secondary-btn:hover {
    color: #ffffff;
  }

  .desktop-secondary-btn:hover .mask-icon {
    background-color: #ffffff !important;
  }

  .desktop-media-section {
    display: flex;
    flex-direction: column;
    padding: 8px 0 16px;
  }

  .desktop-media-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 20px;
  }

  .desktop-media-icon-wrap {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: rgba(56, 189, 248, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .desktop-media-title {
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 4px;
  }

  .desktop-media-subtitle {
    font-size: 13px;
    color: #8a8d9b;
    line-height: 1.35;
  }

  .desktop-actions-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .desktop-main-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 20px;
    border-radius: 12px;
    border: none;
    font-size: 14.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .desktop-main-action-btn.primary {
    background: var(--primary, #38bdf8);
    color: #ffffff;
  }

  .desktop-main-action-btn.primary:hover {
    opacity: 0.92;
    transform: translateY(-1px);
  }

  .sheet-tabs-bar {
    display: flex;
    align-items: center;
    justify-content: space-around;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 10px;
    margin-top: 4px;
  }

  .sheet-tab-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 6px 12px;
    border-radius: 12px;
    transition: all 0.15s ease;
    flex: 1;
  }

  .sheet-tab-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .sheet-tab-btn .tab-icon {
    background-color: #8a8d9b;
    transition: background-color 0.15s ease;
  }

  .sheet-tab-btn .tab-label {
    font-size: 12px;
    color: #8a8d9b;
    transition: color 0.15s ease;
  }

  .sheet-tab-btn.active .tab-icon {
    background-color: var(--primary, #38bdf8);
  }

  .sheet-tab-btn.active .tab-label {
    color: var(--primary, #38bdf8);
    font-weight: 500;
  }
</style>