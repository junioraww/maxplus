<script>
  import { getContact } from "$lib/utils/caching";
  import { getAvatarPlaceholder, getInitials, getAssetUrl } from "$lib/utils/images";
  import Image from "$components/main/Image.svelte";
  import { currentPresence, currentUser, currentUserDetails } from "$lib/stores/api";
  import { decodeStegoPayload } from "$lib/utils/stego";
  import { safeAvatarMapStore, safeAvatarDebugStore, AvatarSyncManager } from "$lib/services/AvatarSyncManager";
  import { getSafeAvatarMediaUrl, getSafeAvatarPreviewUrl } from "$lib/services/uplink";
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

  const imageStyle = `width: 100%; height: 100%; border-radius: 50%; object-fit: cover;`;

  $: targetEntityId = Number(effectiveContactId || chat?.id || $currentUser || 0);
  $: safeAvatarUid = !$disableMaxPlusAvatars && targetEntityId && $safeAvatarMapStore.has(targetEntityId) ? $safeAvatarMapStore.get(targetEntityId) : null;
  $: safeMediaUrl = safeAvatarUid ? getSafeAvatarMediaUrl(safeAvatarUid) : null;
  $: safeAvatarPreviewUrl = safeAvatarUid ? getSafeAvatarPreviewUrl(safeAvatarUid) : null;

  let mediaError = false;
  let isVideoAvatar = true;
  let mediaLoaded = false;
  $: if (safeAvatarUid) {
    mediaError = false;
    isVideoAvatar = true;
    mediaLoaded = false;
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

  const inspectedUrls = new Set();

  $: if (!$disableMaxPlusAvatars && avatarUrl && targetEntityId && !safeAvatarUid && !inspectedUrls.has(avatarUrl)) {
    inspectedUrls.add(avatarUrl);
    inspectStego(avatarUrl, targetEntityId);
  }

  async function inspectStego(url, targetId) {
    if (typeof window === "undefined" || !url || !targetId || $disableMaxPlusAvatars) return;
    try {
      const localUrl = await getAssetUrl(url);
      if (!localUrl) return;

      let imgData = null;

      try {
        const resp = await fetch(localUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          if (typeof createImageBitmap !== "undefined") {
            const bmp = await createImageBitmap(blob);
            if (bmp.width >= 64) {
              const canvas = document.createElement("canvas");
              canvas.width = bmp.width;
              canvas.height = bmp.height;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(bmp, 0, 0);
                imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
              }
            }
          }
        }
      } catch {}

      if (!imgData) {
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
          img.src = localUrl;
        });
        if (!img.width || img.width < 64) return;

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        imgData = ctx.getImageData(0, 0, img.width, img.height);
      }

      if (!imgData) return;
      const foundUid = decodeStegoPayload(imgData, targetId);

      if (foundUid) {
        if ($safeAvatarDebugStore) {
          console.log(`[SafeAvatar] Stego MATCH: targetId=${targetId}, uid=${foundUid}`);
        }
        safeAvatarMapStore.update((map) => {
          map.set(targetId, foundUid);
          return map;
        });
      } else if ($safeAvatarDebugStore) {
        console.log(`[SafeAvatar] Stego negative: targetId=${targetId}`);
      }
    } catch (e) {
      if ($safeAvatarDebugStore) {
        console.error(`[SafeAvatar] Inspect error:`, e);
      }
    }
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
      <img src="/saved.webp" style={imageStyle} alt={effectiveTitle} />
    {:else if safeAvatarUid && !mediaError}
      <div class="avatar-media-container" style="width: 100%; height: 100%; position: relative; border-radius: 50%; overflow: hidden;">
        {#if !mediaLoaded}
          <div class="avatar-shimmer-placeholder"></div>
        {/if}

        {#if isVideoAvatar}
          <video
            src={safeMediaUrl}
            poster={safeAvatarPreviewUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            class="avatar-media"
            class:loaded={mediaLoaded}
            style={imageStyle}
            use:syncVideo={safeAvatarUid}
            on:canplay={() => (mediaLoaded = true)}
            on:playing={() => (mediaLoaded = true)}
            on:error={handleVideoError}
            on:ended={(e) => {
              e.currentTarget.currentTime = 0;
              e.currentTarget.play().catch(() => {});
            }}
          />
        {:else}
          <img
            src={safeMediaUrl}
            class="avatar-media"
            class:loaded={mediaLoaded}
            style={imageStyle}
            alt={effectiveTitle}
            on:load={() => (mediaLoaded = true)}
            on:error={handleMediaError}
          />
        {/if}
      </div>
    {:else if avatarUrl}
      <Image src={avatarUrl} alt={effectiveTitle} style={imageStyle} />
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
    z-index: 1;
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
    opacity: 0;
    transition: opacity 0.2s ease-out;
  }

  .avatar-media.loaded {
    opacity: 1;
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
