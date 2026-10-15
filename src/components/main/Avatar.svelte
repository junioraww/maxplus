<script>
  import { getContact } from "$lib/utils/caching";
  import { getAvatarPlaceholder, getInitials } from "$lib/utils/images";
  import Image from "$components/main/Image.svelte";
  import { currentPresence, currentUser, currentUserDetails } from "$lib/stores/api";
  import { safeAvatarMapStore, safeAvatarDebugStore, AvatarSyncManager, avatarAssetStore, loadAvatarAsset, inspectAvatarStego } from "$lib/services/AvatarSyncManager";
  import { getSafeAvatarMediaUrl } from "$lib/services/uplink";
  import { disableMaxPlusAvatars } from "$lib/stores/avatarSettings";

  export let size = 50;
  export let selectionMode = false;
  export let isSelected = false;
  export let chat = {};
  export let contactId = null;
  export let userId = null;
  export let src = null;
  export let title = null;
  export let style = "";
  export let seed = null;
  export let isSelf = false;

  $: resolvedContactId = contactId ?? userId;
  $: contact = getContact(resolvedContactId);
  $: effectiveContactId = resolvedContactId || $contact?.id || (chat?.id ? Number(chat.id) : null);
  $: isMe = isSelf || Boolean(effectiveContactId && Number(effectiveContactId) === Number($currentUser));
  $: selfDetails = isMe ? $currentUserDetails : null;

  $: isOnline = Boolean(
    $contact?.online ||
    (effectiveContactId && $currentPresence && $currentPresence[effectiveContactId]?.status === 1)
  );

  $: effectiveTitle =
    title ||
    (chat?.id === 0
      ? "Избранное"
      : (chat?.title ||
         (isMe
           ? (selfDetails?.names?.[0]?.firstName ? `${selfDetails.names[0].firstName} ${selfDetails.names[0].lastName || ""}`.trim() : (selfDetails?.name || "Вы"))
           : ($contact?.names?.[0]?.firstName ? `${$contact.names[0].firstName} ${$contact.names[0].lastName || ""}`.trim() : ($contact?.name || "Без названия")))));

  $: avatarUrl =
    src ||
    chat?.avatar ||
    chat?.baseRawIconUrl ||
    chat?.baseIconUrl ||
    chat?.iconUrl ||
    chat?.baseUrl ||
    selfDetails?.baseRawUrl ||
    selfDetails?.avatar ||
    selfDetails?.baseUrl ||
    $contact?.baseRawUrl ||
    $contact?.avatar ||
    $contact?.baseUrl;

  $: targetEntityId = Number(effectiveContactId || chat?.id || $currentUser || 0);
  $: safeAvatarUid = !$disableMaxPlusAvatars && targetEntityId && $safeAvatarMapStore.has(targetEntityId) ? $safeAvatarMapStore.get(targetEntityId) : null;
  $: safeMediaUrl = safeAvatarUid ? getSafeAvatarMediaUrl(safeAvatarUid) : null;

  let activeSrc = null;
  $: if (safeMediaUrl) {
    if ($avatarAssetStore.has(safeMediaUrl)) {
      activeSrc = $avatarAssetStore.get(safeMediaUrl);
    } else {
      loadAvatarAsset(safeMediaUrl).then((url) => {
        activeSrc = url;
      });
    }
  } else {
    activeSrc = null;
  }

  let mediaError = false;
  let isVideoAvatar = true;
  let mediaLoaded = false;
  $: if (safeAvatarUid) {
    mediaError = false;
    isVideoAvatar = true;
    mediaLoaded = false;
  }

  function handleVideoReady(e) {
    const video = e?.currentTarget;
    if (!video || mediaLoaded) return;

    if (video.seeking) {
      video.addEventListener("seeked", () => handleVideoReady({ currentTarget: video }), { once: true });
      return;
    }

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mediaLoaded = true;
        });
      });
    }
  }

  function handleVideoError() {
    isVideoAvatar = false;
  }

  function handleMediaError() {
    mediaError = true;
    if (targetEntityId) {
      safeAvatarMapStore.update((map) => {
        map.delete(targetEntityId);
        return map;
      });
    }
  }

  $: if (!$disableMaxPlusAvatars && avatarUrl && targetEntityId && !safeAvatarUid) {
    inspectAvatarStego(avatarUrl, targetEntityId, $disableMaxPlusAvatars);
  }

  function syncVideo(node, uid) {
    if (!uid) return;
    return {
      destroy: AvatarSyncManager.registerVideo(uid, node)
    };
  }
</script>

<div class="avatar-wrapper" style="width: {size}px; height: {size}px; {style}" on:click>
  {#if selectionMode}
    <div class="selection-overlay" class:checked={isSelected}>
      {#if isSelected}
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          stroke="currentColor"
          stroke-width="3"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
          color="white"><polyline points="20 6 9 17 4 12"></polyline></svg
        >
      {/if}
    </div>
  {/if}

  <div class="avatar-container">
    {#if chat?.id === 0}
      <img src="/saved.webp" class="avatar-static-img" alt={effectiveTitle} />
    {:else if safeAvatarUid && !mediaError}
      <div class="avatar-media-container">
        {#if !mediaLoaded}
          <div class="avatar-shimmer-placeholder"></div>
        {/if}

        {#if isVideoAvatar && activeSrc}
          <video
            src={activeSrc}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            class="avatar-media"
            class:loaded={mediaLoaded}
            use:syncVideo={safeAvatarUid}
            on:loadedmetadata={handleVideoReady}
            on:loadeddata={handleVideoReady}
            on:canplay={handleVideoReady}
            on:playing={handleVideoReady}
            on:resize={handleVideoReady}
            on:seeked={handleVideoReady}
            on:error={handleVideoError}
            on:ended={(e) => {
              e.currentTarget.currentTime = 0;
              e.currentTarget.play().catch(() => {});
            }}
          />
        {:else if activeSrc}
          <img
            src={activeSrc}
            class="avatar-media"
            class:loaded={mediaLoaded}
            alt={effectiveTitle}
            on:load={() => (mediaLoaded = true)}
            on:error={handleMediaError}
          />
        {/if}
      </div>
    {:else if avatarUrl}
      <Image src={avatarUrl} alt={effectiveTitle} class="avatar-static-img" />
    {:else}
      <div
        class="avatar-placeholder"
        style="background: {getAvatarPlaceholder($contact?.id || selfDetails?.id || chat?.id || seed || effectiveTitle)}; font-size: {size / 2.5}px;"
      >
        {getInitials(effectiveTitle)}
      </div>
    {/if}

    {#if isOnline && !selectionMode}
      <span class="online-badge"></span>
    {/if}

    {#if $safeAvatarDebugStore}
      <span
        class="stego-debug-dot"
        class:stego-active={Boolean(safeAvatarUid && !mediaError)}
        class:stego-missing={Boolean(safeAvatarUid && mediaError)}
        title={safeAvatarUid ? `Max+ Avatar: ID=${safeAvatarUid}, Target=${targetEntityId}` : `Static Avatar: Target=${targetEntityId}`}
      >
        {#if safeAvatarUid}
          <span class="stego-debug-text">{safeAvatarUid.slice(0, 4)}</span>
        {/if}
      </span>
    {/if}
  </div>
</div>

<style>
  .avatar-wrapper {
    position: relative;
    flex-shrink: 0;
  }

  .avatar-container {
    width: 100%;
    height: 100%;
    border-radius: 50%;
  }

  .avatar-media-container {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    position: relative;
    border-radius: 50%;
    overflow: hidden;
  }

  .avatar-shimmer-placeholder {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 35%,
      rgba(79, 195, 247, 0.16) 50%,
      rgba(255, 255, 255, 0.12) 65%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: avatarShimmer 1.6s infinite linear;
    pointer-events: none;
    z-index: 3;
  }

  @keyframes avatarShimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .avatar-media {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    display: block;
    border-radius: 50%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.15s ease-out;
    z-index: 2;
  }

  .avatar-media.loaded {
    opacity: 1;
  }

  .avatar-static-img,
  .avatar-container :global(img) {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    display: block;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .avatar-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 600;
  }

  .selection-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .selection-overlay.checked {
    background: #3b82f6aa;
  }

  .stego-debug-dot {
    position: absolute;
    bottom: 0px;
    left: 0px;
    padding: 1px 4px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.75);
    border: 1px solid #52525b;
    z-index: 5;
    font-size: 8px;
    font-weight: 700;
    color: #a1a1aa;
    line-height: 1;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .stego-debug-dot.stego-active {
    border-color: #22c55e;
    color: #4ade80;
    background: rgba(20, 83, 45, 0.85);
  }

  .stego-debug-dot.stego-missing {
    border-color: #ef4444;
    color: #fca5a5;
    background: rgba(127, 29, 29, 0.85);
  }

  .stego-debug-text {
    font-family: monospace;
    letter-spacing: -0.2px;
  }
</style>
