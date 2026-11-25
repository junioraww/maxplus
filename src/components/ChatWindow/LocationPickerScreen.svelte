<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { registerBackHandler } from "$lib/utils/backButton";

  const dispatch = createEventDispatcher();

  export let close = null;
  export let onSelect = null;

  // Initial coordinates (Moscow center default fallback)
  let latitude = 55.751244;
  let longitude = 37.618423;
  let zoom = 15;
  let addressText = "Москва, Россия";
  let isLoadingGeo = false;
  let noticeText = "";
  let noticeTimer = null;

  // Live Location Translation matching Telegram & OneMe protocol (livePeriod)
  let isLiveMode = false;
  let livePeriod = 900; // 15 min default (900s), 1 hour (3600s), 8 hours (28800s)

  // Map viewport dimensions
  let viewportEl;
  let viewportWidth = 600;
  let viewportHeight = 400;

  // Interaction state
  let isDragging = false;
  let isPinLifted = false;
  let startX = 0;
  let startY = 0;
  let startWorldX = 0;
  let startWorldY = 0;

  let unregisterBack = registerBackHandler(() => {
    handleClose();
    return true;
  });

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
    if (noticeTimer) clearTimeout(noticeTimer);
    if (reverseGeocodeTimer) clearTimeout(reverseGeocodeTimer);
  });

  function showNotice(msg) {
    noticeText = msg;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      noticeText = "";
    }, 4000);
  }

  function handleClose() {
    if (typeof close === "function") {
      close();
    } else {
      dispatch("close");
    }
  }

  // Web Mercator EPSG:3857 coordinate projection math
  function latLngToWorld(lat, lng, z) {
    const scale = 256 * Math.pow(2, z);
    const x = ((lng + 180) / 360) * scale;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const clampedSin = Math.min(Math.max(sinLat, -0.9999), 0.9999);
    const y = (0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI)) * scale;
    return { x, y };
  }

  function worldToLatLng(x, y, z) {
    const scale = 256 * Math.pow(2, z);
    const lng = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return {
      lat: Math.min(Math.max(lat, -85.0511), 85.0511),
      lng: ((((lng + 180) % 360) + 360) % 360) - 180,
    };
  }

  // Reactive visible tiles calculation
  let visibleTiles = [];
  $: {
    const maxTile = Math.pow(2, Math.floor(zoom));
    const centerWorld = latLngToWorld(latitude, longitude, zoom);
    const minX = centerWorld.x - viewportWidth / 2;
    const minY = centerWorld.y - viewportHeight / 2;
    const maxX = minX + viewportWidth;
    const maxY = minY + viewportHeight;

    const minTileX = Math.floor(minX / 256);
    const maxTileX = Math.floor(maxX / 256);
    const minTileY = Math.max(0, Math.floor(minY / 256));
    const maxTileY = Math.min(maxTile - 1, Math.floor(maxY / 256));

    const tiles = [];
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const normTx = ((tx % maxTile) + maxTile) % maxTile;
        const left = Math.round(tx * 256 - minX);
        const top = Math.round(ty * 256 - minY);
        tiles.push({
          key: `${zoom}-${normTx}-${ty}`,
          url: `https://basemaps.cartocdn.com/rastertiles/dark_all/${zoom}/${normTx}/${ty}.png`,
          fallbackUrl: `https://tile.openstreetmap.org/${zoom}/${normTx}/${ty}.png`,
          left,
          top,
        });
      }
    }
    visibleTiles = tiles;
  }

  // Pointer drag handling
  function onPointerDown(e) {
    if (e.button !== 0) return; // Left mouse button only
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging = true;
    isPinLifted = true;
    startX = e.clientX;
    startY = e.clientY;
    const centerWorld = latLngToWorld(latitude, longitude, zoom);
    startWorldX = centerWorld.x;
    startWorldY = centerWorld.y;
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newWorldX = startWorldX - dx;
    const newWorldY = startWorldY - dy;
    const coords = worldToLatLng(newWorldX, newWorldY, zoom);
    latitude = Number(coords.lat.toFixed(6));
    longitude = Number(coords.lng.toFixed(6));
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    isDragging = false;
    isPinLifted = false;
    scheduleReverseGeocode(latitude, longitude);
  }

  function onWheel(e) {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else if (e.deltaY > 0) {
      zoomOut();
    }
  }

  function zoomIn() {
    if (zoom < 18) {
      zoom = Math.min(18, zoom + 1);
      scheduleReverseGeocode(latitude, longitude);
    }
  }

  function zoomOut() {
    if (zoom > 3) {
      zoom = Math.max(3, zoom - 1);
      scheduleReverseGeocode(latitude, longitude);
    }
  }

  // Reverse geocoding via OpenStreetMap Nominatim with 350ms debounce
  let reverseGeocodeTimer = null;
  function scheduleReverseGeocode(lat, lng) {
    if (reverseGeocodeTimer) clearTimeout(reverseGeocodeTimer);
    reverseGeocodeTimer = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
        const res = await fetch(url, { headers: { "Accept-Language": "ru,en" } });
        if (res.ok) {
          const data = await res.json();
          if (data?.address) {
            const addr = data.address;
            const road = addr.road || addr.street || addr.pedestrian || addr.suburb || "";
            const num = addr.house_number || "";
            const city = addr.city || addr.town || addr.village || addr.municipality || addr.state || "";
            const parts = [road, num, city].filter(Boolean);
            if (parts.length > 0) {
              addressText = parts.join(", ");
              return;
            }
          }
          if (data?.display_name) {
            addressText = data.display_name.split(",").slice(0, 3).join(",");
            return;
          }
        }
      } catch (_) {}
      addressText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }, 350);
  }

  function handleLocateMe() {
    if (!navigator?.geolocation) {
      showNotice("Геолокация недоступна на этом устройстве");
      return;
    }
    isLoadingGeo = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        latitude = Number(pos.coords.latitude.toFixed(6));
        longitude = Number(pos.coords.longitude.toFixed(6));
        zoom = 16;
        isLoadingGeo = false;
        scheduleReverseGeocode(latitude, longitude);
      },
      (err) => {
        console.warn("Geolocation failed:", err);
        isLoadingGeo = false;
        showNotice("Не удалось определить координаты автоматически (укажите точку на карте)");
      },
      { timeout: 7000, enableHighAccuracy: true }
    );
  }

  onMount(() => {
    handleLocateMe();
  });

  function handleTileError(e, fallbackUrl) {
    if (e.target && e.target.src !== fallbackUrl) {
      e.target.src = fallbackUrl;
    }
  }

  function submitLocation() {
    const detail = {
      latitude,
      longitude,
      zoom,
      address: addressText,
      livePeriod: isLiveMode ? livePeriod : 0,
    };
    dispatch("select", detail);
    if (typeof onSelect === "function") {
      onSelect(detail);
    }
    handleClose();
  }
</script>

<div class="location-screen-root">
  <header class="location-header">
    <button type="button" class="header-back-btn" on:click={handleClose} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <div class="header-titles">
      <h1 class="header-title">Геопозиция</h1>
      <span class="header-subtitle">{addressText}</span>
    </div>
    <div class="header-spacer"></div>
  </header>

  <div
    class="map-viewport"
    bind:this={viewportEl}
    bind:clientWidth={viewportWidth}
    bind:clientHeight={viewportHeight}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:wheel={onWheel}
  >
    <!-- Map Tiles Layer -->
    <div class="map-tiles-container">
      {#each visibleTiles as tile (tile.key)}
        <img
          class="map-tile"
          src={tile.url}
          alt=""
          loading="eager"
          draggable="false"
          style="left: {tile.left}px; top: {tile.top}px;"
          on:error={(e) => handleTileError(e, tile.fallbackUrl)}
        />
      {/each}
    </div>

    <!-- Center pin marker matching OneMe center marker with lift bounce -->
    <div class="center-pin-wrap" class:pin-lifted={isPinLifted}>
      <div class="pin-shadow"></div>
      <div class="pin-icon-box">
        <span class="mask-icon pin-icon" style="-webkit-mask-image: url('/icons/location.svg'); mask-image: url('/icons/location.svg'); width: 24px; height: 24px;"></span>
      </div>
    </div>

    <!-- Zoom Controls -->
    <div class="zoom-controls">
      <button type="button" class="zoom-btn" on:click={zoomIn} title="Приблизить" aria-label="Приблизить">
        +
      </button>
      <button type="button" class="zoom-btn" on:click={zoomOut} title="Отдалить" aria-label="Отдалить">
        −
      </button>
    </div>

    <!-- Locate me floating button -->
    <button
      type="button"
      class="locate-me-btn"
      on:click={handleLocateMe}
      title="Моя геопозиция"
      aria-label="Моя геопозиция"
    >
      {#if isLoadingGeo}
        <div class="geo-spinner"></div>
      {:else}
        <span class="mask-icon locate-icon" style="-webkit-mask-image: url('/icons/location.svg'); mask-image: url('/icons/location.svg'); width: 22px; height: 22px;"></span>
      {/if}
    </button>

    <!-- Notice Toast if location unavailable -->
    {#if noticeText}
      <div class="map-notice" transition:fade={{ duration: 150 }}>
        {noticeText}
      </div>
    {/if}
  </div>

  <div class="location-bottom-bar">
    <!-- Sharing Mode: Static Point vs Live Location -->
    <div class="mode-tabs-bar">
      <button
        type="button"
        class="mode-tab-btn"
        class:active={!isLiveMode}
        on:click={() => (isLiveMode = false)}
      >
        <span>Отправить точку</span>
      </button>
      <button
        type="button"
        class="mode-tab-btn"
        class:active={isLiveMode}
        on:click={() => (isLiveMode = true)}
      >
        <span>Трансляция геопозиции</span>
      </button>
    </div>

    {#if isLiveMode}
      <div class="live-period-picker">
        <span class="live-period-label">Длительность трансляции:</span>
        <div class="period-chips">
          <button
            type="button"
            class="period-chip"
            class:selected={livePeriod === 900}
            on:click={() => (livePeriod = 900)}
          >
            15 минут
          </button>
          <button
            type="button"
            class="period-chip"
            class:selected={livePeriod === 3600}
            on:click={() => (livePeriod = 3600)}
          >
            1 час
          </button>
          <button
            type="button"
            class="period-chip"
            class:selected={livePeriod === 28800}
            on:click={() => (livePeriod = 28800)}
          >
            8 часов
          </button>
        </div>
      </div>
    {/if}

    <div class="coords-box">
      <span class="coords-label">Координаты:</span>
      <span class="coords-val">{latitude.toFixed(6)}, {longitude.toFixed(6)}</span>
    </div>

    <button type="button" class="send-location-btn" on:click={submitLocation}>
      <span class="mask-icon send-icon" style="-webkit-mask-image: url('/icons/send.svg'); mask-image: url('/icons/send.svg'); width: 18px; height: 18px;"></span>
      <span>
        {#if isLiveMode}
          Начать трансляцию ({livePeriod === 900 ? "15 мин" : livePeriod === 3600 ? "1 час" : "8 часов"})
        {:else}
          Отправить эту геопозицию
        {/if}
      </span>
    </button>
  </div>
</div>

<style>
  .location-screen-root {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    background: #111216;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    user-select: none;
    box-sizing: border-box;
    z-index: var(--z-modal, 45);
  }

  .location-header {
    height: 56px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    background: #18191e;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    gap: 8px;
    z-index: 2;
  }

  .header-back-btn {
    background: transparent;
    border: none;
    color: #ffffff;
    cursor: pointer;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
    transition: background 0.15s ease;
  }

  .header-back-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .header-titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .header-title {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: #ffffff;
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-subtitle {
    font-size: 12px;
    color: #8a8d9b;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-spacer {
    width: 40px;
    flex-shrink: 0;
  }

  .map-viewport {
    flex: 1;
    position: relative;
    background: #13151b;
    overflow: hidden;
    cursor: grab;
    touch-action: none;
  }

  .map-viewport:active {
    cursor: grabbing;
  }

  .map-tiles-container {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .map-tile {
    position: absolute;
    width: 256px;
    height: 256px;
    user-select: none;
    pointer-events: none;
    image-rendering: auto;
  }

  .center-pin-wrap {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    z-index: 3;
    transition: transform 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  }

  .center-pin-wrap.pin-lifted {
    transform: translate(-50%, -115%) scale(1.08);
  }

  .pin-icon-box {
    width: 44px;
    height: 44px;
    background: #e05353;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(224, 83, 83, 0.55);
  }

  .pin-icon {
    transform: rotate(45deg);
    background-color: #ffffff;
    width: 24px;
    height: 24px;
  }

  .pin-shadow {
    position: absolute;
    bottom: -6px;
    width: 16px;
    height: 6px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;
    transition: transform 0.2s ease, opacity 0.2s ease;
  }

  .center-pin-wrap.pin-lifted .pin-shadow {
    transform: scale(0.6);
    opacity: 0.3;
  }

  .zoom-controls {
    position: absolute;
    right: 18px;
    bottom: 84px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 4;
  }

  .zoom-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #1e2027;
    color: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    font-size: 20px;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .zoom-btn:hover {
    background: #2a2d36;
    transform: scale(1.05);
  }

  .zoom-btn:active {
    transform: scale(0.95);
  }

  .locate-me-btn {
    position: absolute;
    right: 18px;
    bottom: 24px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #248bfe;
    color: #ffffff;
    border: none;
    box-shadow: 0 4px 14px rgba(36, 139, 254, 0.45);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 4;
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .locate-me-btn:hover {
    transform: scale(1.05);
    background: #1f7fe8;
  }

  .locate-me-btn:active {
    transform: scale(0.95);
  }

  .locate-icon {
    background-color: #ffffff;
    width: 22px;
    height: 22px;
  }

  .geo-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: geo-spin 0.7s linear infinite;
  }

  @keyframes geo-spin {
    to { transform: rotate(360deg); }
  }

  .map-notice {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(24, 25, 30, 0.94);
    color: #e0a353;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid rgba(224, 163, 83, 0.3);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    z-index: 5;
    pointer-events: none;
    text-align: center;
    max-width: 90%;
  }

  .location-bottom-bar {
    background: #18191e;
    padding: 14px 20px calc(18px + var(--safe-bottom, 0px));
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-shrink: 0;
    z-index: 2;
  }

  .mode-tabs-bar {
    display: flex;
    gap: 8px;
    background: rgba(255, 255, 255, 0.05);
    padding: 4px;
    border-radius: 10px;
  }

  .mode-tab-btn {
    flex: 1;
    height: 34px;
    background: transparent;
    border: none;
    color: #8a8d9b;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mode-tab-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .live-period-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .live-period-label {
    font-size: 12.5px;
    color: #8a8d9b;
  }

  .period-chips {
    display: flex;
    gap: 8px;
  }

  .period-chip {
    flex: 1;
    height: 32px;
    background: #20222a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #ffffff;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .period-chip.selected {
    background: #248bfe;
    border-color: #248bfe;
  }

  .coords-box {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: #8a8d9b;
  }

  .coords-val {
    color: #ffffff;
    font-family: monospace;
    font-size: 13px;
  }

  .send-location-btn {
    width: 100%;
    height: 48px;
    border-radius: 12px;
    background: #248bfe;
    color: #ffffff;
    border: none;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .send-location-btn:hover {
    background: #1f7fe8;
  }

  .send-location-btn:active {
    transform: scale(0.99);
  }

  .send-icon {
    background-color: #ffffff;
  }
</style>
