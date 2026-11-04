<script>
  import { onMount, onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { fade, slide } from "svelte/transition";
  import {
    activeStoryViewer,
    closeStoriesViewer,
    fetchStoriesForOwner,
    markStoryAsRead,
    removeStoryLocally,
    sortedStoriesFeed
  } from "$lib/stores/stories";
  import API, { currentUser } from "$lib/stores/api";
  import { getContact, getContactDisplayName } from "$lib/stores/contacts";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import Avatar from "$components/main/Avatar.svelte";

  let stories = [];
  let currentIndex = 0;
  let isPaused = false;
  let progressRatio = 0;
  let animFrameId = null;
  let startTime = null;
  let elapsedBeforePause = 0;
  const PHOTO_DURATION = 5000;

  let videoEl = null;
  let isVideoStory = false;
  let videoFailed = false;
  let isVideoBuffering = false;
  let videoDurationMs = 0;

  let dragStartY = 0;
  let currentDragDy = 0;
  let isDragging = false;

  let statsModalOpen = false;
  let statsList = [];
  let statsLoading = false;
  let pointerDownTime = 0;
  let wasLongPress = false;
  let holdTimer = null;
  let isHoldPaused = false;
  let generatedPosterUrl = "";

  let videoCache = {};
  let isVideoLoading = false;
  let activeStoryId = null;
  let requestedVideoIds = new Set();
  let failedVideoIds = new Set();

  $: active = $activeStoryViewer;
  $: ownerId = active?.ownerId;
  $: isMe = Number(ownerId) === Number($currentUser);
  $: currentStory = stories[currentIndex] || null;
  $: contactStore = ownerId ? getContact(ownerId) : null;
  $: contact = $contactStore;
  $: ownerTitle = isMe
    ? "Ваша история"
    : (getContactDisplayName(contact) || contact?.name || `ID ${ownerId}`);
  function describeStoryMedia(story, cache) {
    const m = story?.media;
    if (!m) return null;

    const isVideo = m._type === "VIDEO" || m.mediaType === "VIDEO";
    if (isVideo) {
      const directVideoUrl = m.mp4Url || m.videoUrl || m.MP4_1080 || m.url || (m._type === "VIDEO" ? m.baseUrl : null);
      const posterUrl = m.thumbnailUrl || m.previewUrl || m.thumbnail || "";
      const src = m.path
        ? getProxiedMediaUrl(m.path)
        : (directVideoUrl
          ? getProxiedMediaUrl(directVideoUrl)
          : (m.videoId && cache[m.videoId] ? cache[m.videoId] : null));

      return {
        isVideo: true,
        videoId: m.videoId || null,
        token: m.token || null,
        src,
        poster: posterUrl ? getProxiedMediaUrl(posterUrl) : "",
        durationMs: Number(m.duration) || 0
      };
    }

    const photoPath = m.photoUrl || m.baseUrl || m.path || m.url || "";
    return {
      isVideo: false,
      src: photoPath ? getProxiedMediaUrl(photoPath) : "",
      poster: "",
      durationMs: PHOTO_DURATION
    };
  }

  $: currentMedia = describeStoryMedia(currentStory, videoCache);
  $: isVideoStory = Boolean(currentMedia?.isVideo);

  async function resolveStoryVideo(videoId, token = null) {
    if (!videoId || videoCache[videoId] || requestedVideoIds.has(videoId) || failedVideoIds.has(videoId)) return;
    requestedVideoIds.add(videoId);
    isVideoLoading = true;
    try {
      const res = await $API.getVideoById(0, 0, videoId, token);
      const qualityPriority = ["MP4_1080", "MP4_720", "MP4_480", "MP4_360"];
      let url = null;
      for (const q of qualityPriority) {
        if (res && res[q]) {
          url = res[q];
          break;
        }
      }
      if (!url && res?.HLS) {
        url = res.HLS;
      }
      if (url) {
        videoCache[videoId] = getProxiedMediaUrl(url);
        videoCache = { ...videoCache };
      } else {
        failedVideoIds.add(videoId);
        if (currentMedia?.videoId === videoId) {
          handleVideoError();
        }
      }
    } catch (_) {
      failedVideoIds.add(videoId);
      if (currentMedia?.videoId === videoId) {
        handleVideoError();
      }
    } finally {
      isVideoLoading = false;
    }
  }

  $: if (
    currentMedia?.isVideo &&
    currentMedia.videoId &&
    !currentMedia.src &&
    !isVideoLoading &&
    !requestedVideoIds.has(currentMedia.videoId) &&
    !failedVideoIds.has(currentMedia.videoId)
  ) {
    resolveStoryVideo(currentMedia.videoId, currentMedia.token);
  }

  $: if (currentStory && currentStory.id !== activeStoryId) {
    activeStoryId = currentStory.id;
    startCurrentStory();
  }

  $: if (ownerId) {
    loadOwnerStories(ownerId);
  }

  async function loadOwnerStories(oid) {
    stopPlayback();
    requestedVideoIds.clear();
    failedVideoIds.clear();
    stories = await fetchStoriesForOwner($API, oid);
    if (!stories || stories.length === 0) {
      handleClose();
      return;
    }
    const initialStoryId = active?.storyId;
    if (initialStoryId) {
      const idx = stories.findIndex((s) => Number(s.id) === Number(initialStoryId));
      currentIndex = idx !== -1 ? idx : 0;
    } else {
      currentIndex = 0;
    }
  }

  function startCurrentStory() {
    stopPlayback();
    generatedPosterUrl = "";
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (!currentStory) return;

    markStoryAsRead($API, ownerId, currentStory.id);

    progressRatio = 0;
    elapsedBeforePause = 0;
    startTime = performance.now();

    const media = describeStoryMedia(currentStory, videoCache);
    if (!media?.isVideo) {
      videoFailed = false;
      isVideoBuffering = false;
      animFrameId = requestAnimationFrame(runPhotoTimer);
    } else if (media.videoId && failedVideoIds.has(media.videoId)) {
      videoFailed = true;
      isVideoBuffering = false;
      animFrameId = requestAnimationFrame(runPhotoTimer);
    } else {
      videoFailed = false;
      isVideoBuffering = true;
    }
  }

  function handleVideoError() {
    videoFailed = true;
    isVideoBuffering = false;
    startTime = performance.now();
    animFrameId = requestAnimationFrame(runPhotoTimer);
  }

  function handleVideoWaiting() {
    isVideoBuffering = true;
  }

  function handleVideoPlaying() {
    isVideoBuffering = false;
  }

  function handleVideoCanPlay() {
    isVideoBuffering = false;
  }

  function runPhotoTimer() {
    if (isPaused) return;
    const now = performance.now();
    const totalElapsed = elapsedBeforePause + (now - startTime);
    progressRatio = Math.min(1, totalElapsed / PHOTO_DURATION);

    if (progressRatio >= 1) {
      nextStory();
    } else {
      animFrameId = requestAnimationFrame(runPhotoTimer);
    }
  }

  function handleVideoTimeUpdate() {
    if (!videoEl || !isVideoStory) return;
    isVideoBuffering = false;
    const dur = videoEl.duration || (currentMedia?.durationMs ? currentMedia.durationMs / 1000 : 0);
    if (dur > 0 && !isNaN(videoEl.currentTime)) {
      progressRatio = Math.min(1, videoEl.currentTime / dur);
    }
  }

  function handleVideoEnded() {
    isVideoBuffering = false;
    nextStory();
  }

  function stopPlayback() {
    isVideoBuffering = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.removeAttribute("src");
        videoEl.load();
      } catch (_) {}
    }
  }

  function pausePlayback() {
    if (isPaused) return;
    isPaused = true;
    if (!isVideoStory) {
      elapsedBeforePause += performance.now() - startTime;
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    } else if (videoEl) {
      videoEl.pause();
    }
  }

  function resumePlayback() {
    if (!isPaused) return;
    isPaused = false;
    if (!isVideoStory) {
      startTime = performance.now();
      animFrameId = requestAnimationFrame(runPhotoTimer);
    } else if (videoEl) {
      videoEl.play().catch(() => {});
    }
  }

  function prevStory() {
    if (currentIndex > 0) {
      currentIndex--;
    } else {
      moveToNeighborUser(-1);
    }
  }

  function nextStory() {
    if (currentIndex < stories.length - 1) {
      currentIndex++;
    } else {
      moveToNeighborUser(1);
    }
  }

  function moveToNeighborUser(dir) {
    const feed = $sortedStoriesFeed;
    const currentPos = feed.findIndex((p) => Number(p.owner?.ownerId) === Number(ownerId));
    if (currentPos === -1) {
      handleClose();
      return;
    }
    const nextPos = currentPos + dir;
    if (nextPos >= 0 && nextPos < feed.length) {
      const nextOwner = feed[nextPos].owner?.ownerId;
      if (nextOwner) {
        activeStoryViewer.set({ ownerId: nextOwner, storyId: null });
        return;
      }
    }
    handleClose();
  }

  function handleVideoLoadedMetadata() {
    if (videoEl && videoEl.videoWidth > 0 && !currentMedia?.poster) {
      try {
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = Math.round(160 * (videoEl.videoHeight / videoEl.videoWidth));
        const ctx = c.getContext("2d");
        ctx.drawImage(videoEl, 0, 0, c.width, c.height);
        generatedPosterUrl = c.toDataURL("image/jpeg", 0.7);
      } catch (_) {}
    }
  }

  function handlePointerDown(e) {
    if (statsModalOpen) return;
    if (e.target.closest(".interactive-ctrl")) return;
    isDragging = false;
    wasLongPress = false;
    isHoldPaused = false;
    dragStartY = e.clientY;
    pointerDownTime = performance.now();

    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      isHoldPaused = true;
      pausePlayback();
    }, 180);
  }

  function handlePointerMove(e) {
    if (statsModalOpen || !dragStartY) return;
    const dy = e.clientY - dragStartY;
    if (dy > 8) {
      isDragging = true;
      currentDragDy = dy;
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    }
  }

  function handlePointerUp(e) {
    if (statsModalOpen) return;
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    pointerDownTime = 0;

    if (isDragging) {
      if (currentDragDy > 100) {
        handleClose();
      } else {
        currentDragDy = 0;
        resumePlayback();
      }
      isDragging = false;
      dragStartY = 0;
      return;
    }

    if (isHoldPaused) {
      isHoldPaused = false;
      wasLongPress = true;
      resumePlayback();
    }
    dragStartY = 0;
    isDragging = false;
  }

  function handleScreenTap(e) {
    if (wasLongPress) {
      wasLongPress = false;
      return;
    }
    if (statsModalOpen) {
      closeStats();
      return;
    }
    if (isDragging || currentDragDy > 10) return;
    if (e.target.closest(".interactive-ctrl")) return;

    const w = window.innerWidth;
    const x = e.clientX;
    if (x < w * 0.35) {
      prevStory();
    } else {
      nextStory();
    }
  }

  async function handleSendReaction(emoji) {
    if (!currentStory?.id) return;
    try {
      await $API.reactStory({ ownerId, type: 0 }, currentStory.id, emoji);
    } catch (_) {}
  }

  async function handleDeleteCurrentStory() {
    if (!currentStory?.id || !isMe) return;
    try {
      const deletedId = currentStory.id;
      await $API.deleteStories([deletedId]);
      removeStoryLocally(ownerId, deletedId);
      stories = stories.filter((s) => s.id !== deletedId);
      if (stories.length === 0) {
        handleClose();
      } else {
        currentIndex = Math.min(currentIndex, stories.length - 1);
        startCurrentStory();
      }
    } catch (_) {}
  }

  async function openStats() {
    if (!currentStory?.id) return;
    pausePlayback();
    statsModalOpen = true;
    statsLoading = true;
    try {
      const resp = await $API.getStoryDetailedStats(currentStory.id, 0, 0);
      statsList = resp?.storyDetailedStats || [];
    } catch (_) {
      statsList = [];
    } finally {
      statsLoading = false;
    }
  }

  function closeStats() {
    statsModalOpen = false;
    resumePlayback();
  }

  function handleClose() {
    stopPlayback();
    activeStoryId = null;
    closeStoriesViewer();
  }

  onDestroy(() => {
    stopPlayback();
    activeStoryId = null;
  });
</script>

{#if active}
  <div
    class="viewer-backdrop"
    transition:fade={{ duration: 180 }}
    style="transform: translateY({currentDragDy}px); opacity: {1 - currentDragDy / 400};"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:click={handleScreenTap}
    role="presentation"
  >
    {#if !currentStory}
      <div class="viewer-loader-center">
        <div class="loader-circle-spinner"></div>
      </div>
    {:else}
      <div class="story-viewer-stage">
        <div class="progress-bar-row interactive-ctrl">
          {#each stories as s, i}
            <div class="progress-track">
              <div
                class="progress-fill"
                style="width: {i < currentIndex ? 100 : i === currentIndex ? progressRatio * 100 : 0}%;"
              ></div>
            </div>
          {/each}
        </div>

        <div
          class="viewer-header interactive-ctrl"
          on:pointerdown|stopPropagation
          on:pointerup|stopPropagation
          on:click|stopPropagation
          role="presentation"
        >
          <div class="owner-pill">
            <Avatar size={34} contactId={ownerId} userId={ownerId} isSelf={isMe} />
            <span class="owner-title">{ownerTitle}</span>
          </div>

          <div class="header-actions">
            {#if isMe}
              <button type="button" class="action-circle-btn" on:click|stopPropagation={openStats} title="Статистика">
                <img src="/icons/stories/eye.svg" alt="" width="18" height="18" />
              </button>
              <button type="button" class="action-circle-btn" on:click|stopPropagation={handleDeleteCurrentStory} title="Удалить">
                <img src="/icons/trash.svg" alt="" width="18" height="18" />
              </button>
            {/if}

            <button type="button" class="action-circle-btn" on:click|stopPropagation={handleClose} title="Закрыть">
              <img src="/icons/close.svg" alt="" width="20" height="20" />
            </button>
          </div>
        </div>

        <div class="media-viewport">
          {#if currentMedia?.poster || generatedPosterUrl || (!currentMedia?.isVideo && currentMedia?.src)}
            <div class="story-viewer-blurred-bg" aria-hidden="true">
              <img
                src={currentMedia?.poster || generatedPosterUrl || currentMedia?.src}
                alt=""
                class="viewer-blurred-img"
              />
            </div>
          {/if}

          {#if currentMedia?.isVideo}
            {#if currentMedia.src && !videoFailed}
              <video
                bind:this={videoEl}
                src={currentMedia.src}
                autoplay
                playsinline
                on:loadeddata={handleVideoLoadedMetadata}
                on:waiting={handleVideoWaiting}
                on:stalled={handleVideoWaiting}
                on:playing={handleVideoPlaying}
                on:canplay={handleVideoCanPlay}
                on:timeupdate={handleVideoTimeUpdate}
                on:ended={handleVideoEnded}
                on:error={handleVideoError}
                class="story-media-player"
              ></video>
              {#if isVideoBuffering}
                <div class="story-spinner-center">
                  <div class="spinner"></div>
                </div>
              {/if}
            {:else if videoFailed}
              {#if currentMedia.poster}
                <img
                  src={currentMedia.poster}
                  alt=""
                  class="story-media-player"
                />
              {/if}
            {:else}
              <div class="video-loading-placeholder">
                {#if currentMedia.poster}
                  <img
                    src={currentMedia.poster}
                    alt=""
                    class="story-media-player"
                  />
                {/if}
                <div class="story-spinner-center">
                  <div class="spinner"></div>
                </div>
              </div>
            {/if}
          {:else if currentMedia?.src}
            <img
              src={currentMedia.src}
              alt=""
              class="story-media-player"
            />
          {/if}

          {#if currentStory.layers && currentStory.layers.length > 0}
            {#each currentStory.layers as layer}
              {#if layer.clickableLink?.url}
                <a
                  href={layer.clickableLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="interactive-ctrl story-link-layer"
                  style="left: {(layer.coordinates?.x || 0.5) * 100}%; top: {(layer.coordinates?.y || 0.85) * 100}%; transform: translate(-50%, -50%) rotate({layer.coordinates?.rotation || 0}deg);"
                  on:click|stopPropagation
                >
                  <img src="/icons/link.svg" alt="" width="16" height="16" />
                  <span>{layer.clickableLink.url.replace(/^https?:\/\//, "")}</span>
                </a>
              {/if}
            {/each}
          {/if}
        </div>

        {#if !isMe}
          <div class="reaction-tray interactive-ctrl" on:pointerdown|stopPropagation>
            {#each ["❤️", "🔥", "👍", "😂", "😮", "😢"] as emo}
              <button
                type="button"
                class="reaction-emo-btn"
                on:click={() => handleSendReaction(emo)}
              >
                {emo}
              </button>
            {/each}
          </div>
        {/if}
      </div>

    {#if statsModalOpen}
      <div
        class="stats-dimmer interactive-ctrl"
        transition:fade={{ duration: 160 }}
        on:pointerdown|stopPropagation
        on:click|stopPropagation={closeStats}
        role="presentation"
      ></div>
      <div class="stats-sheet interactive-ctrl" on:pointerdown|stopPropagation>
        <div class="stats-header">
          <h3>Просмотры истории</h3>
          <button type="button" class="close-btn" on:click={closeStats}>✕</button>
        </div>
        {#if statsLoading}
          <div class="stats-empty">Загрузка...</div>
        {:else if statsList.length === 0}
          <div class="stats-empty">Пока никто не посмотрел</div>
        {:else}
          <div class="stats-list-scroll">
            {#each statsList as item}
              <div class="stats-user-row">
                <Avatar size={36} contactId={item.userId} userId={item.userId} />
                <span class="stats-user-name">
                  {getContactDisplayName(get(getContact(item.userId))) || get(getContact(item.userId))?.name || `Пользователь ${item.userId}`}
                </span>
                {#if item.reaction}
                  <span class="stats-reaction-icon">
                    {item.reaction.id || "❤️"}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {/if}
  </div>
{/if}

<style>
  .viewer-loader-center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loader-circle-spinner {
    width: 44px;
    height: 44px;
    border: 3px solid rgba(255, 255, 255, 0.2);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .viewer-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-viewer, 100);
    background: #000000;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    touch-action: none;
  }

  .story-viewer-stage {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: min(calc(100vh * 9 / 16), 100vw);
    max-height: 100vh;
    aspect-ratio: 9 / 16;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    background: #000000;
  }

  .story-viewer-blurred-bg {
    position: absolute;
    inset: -32px;
    z-index: var(--z-base, 1);
    overflow: hidden;
    pointer-events: none;
    background: #000000;
  }

  .viewer-blurred-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scale(1.25);
    -webkit-filter: blur(28px) brightness(0.65);
    filter: blur(28px) brightness(0.65);
    opacity: 0.85;
  }

  .progress-bar-row {
    position: absolute;
    top: 10px;
    left: 12px;
    right: 12px;
    display: flex;
    gap: 4px;
    z-index: var(--z-header, 4);
  }

  .progress-track {
    flex: 1;
    height: 3px;
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #ffffff;
    transition: width 0.08s linear;
  }

  .viewer-header {
    position: absolute;
    top: 22px;
    left: 14px;
    right: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    z-index: var(--z-header, 4);
  }

  .owner-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(18, 19, 24, 0.88);
    padding: 4px 12px 4px 4px;
    border-radius: 24px;
  }

  .owner-title {
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-circle-btn {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(18, 19, 24, 0.88);
    color: #ffffff;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, background 0.15s;
  }

  .action-circle-btn:active {
    transform: scale(0.9);
  }

  .media-viewport {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .video-loading-placeholder {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .story-spinner-center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: var(--z-header, 4);
  }

  .story-media-player {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    z-index: var(--z-panel, 2);
  }

  .story-link-layer {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.9);
    color: #0f172a;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    z-index: var(--z-floating, 5);
    transition: transform 0.15s;
  }

  .story-link-layer:hover {
    transform: translate(-50%, -50%) scale(1.05);
  }

  .reaction-tray {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(0, 0, 0, 0.55);
    padding: 6px 14px;
    border-radius: 32px;
    backdrop-filter: blur(12px);
    z-index: var(--z-floating, 5);
  }

  .reaction-emo-btn {
    background: transparent;
    border: none;
    font-size: 24px;
    cursor: pointer;
    transition: transform 0.15s;
    padding: 4px;
  }

  .reaction-emo-btn:active {
    transform: scale(1.3);
  }

  .stats-dimmer {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: var(--z-modal-backdrop, 6);
  }

  .stats-sheet {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 55vh;
    background: #181920;
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    padding: 16px;
    z-index: var(--z-sheet, 7);
    display: flex;
    flex-direction: column;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.6);
  }

  .stats-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .stats-header h3 {
    margin: 0;
    color: #fff;
    font-size: 16px;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 18px;
    cursor: pointer;
  }

  .stats-list-scroll {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .stats-user-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
  }

  .stats-user-name {
    color: #fff;
    font-size: 14px;
    flex: 1;
  }

  .stats-reaction-icon {
    font-size: 18px;
  }

  .stats-empty {
    text-align: center;
    padding: 24px 0;
    color: #888;
    font-size: 14px;
  }
</style>
