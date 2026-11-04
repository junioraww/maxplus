<script>
  import { getContact } from "$lib/utils/caching";
  import { getAvatarPlaceholder, getInitials } from "$lib/utils/images";
  import { currentPresence, currentUser, currentUserDetails } from "$lib/stores/api";
  import { safeAvatarMapStore, safeAvatarDebugStore } from "$lib/services/AvatarSyncManager";
  import { getSafeAvatarMediaUrl } from "$lib/services/uplink";
  import { disableMaxPlusAvatars } from "$lib/stores/avatarSettings";
  import MediaCanvas from "$components/main/MediaCanvas.svelte";
  import { getStoryPreviewForUser, openStoriesViewer } from "$lib/stores/stories";

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
  export let allowStories = false;
  export let enableStoryRing = false;

  $: canShowStory = allowStories || enableStoryRing;

  $: resolvedContactId = contactId ?? userId;
  $: contact = isSelf ? null : getContact(resolvedContactId);
  $: effectiveContactId = resolvedContactId || $contact?.id || (isSelf ? Number($currentUser) : (chat?.id ? Number(chat.id) : null));
  $: isMe = isSelf || Boolean(effectiveContactId && Number(effectiveContactId) === Number($currentUser));
  $: selfDetails = isMe ? $currentUserDetails : null;

  $: storyPreview = canShowStory && effectiveContactId ? getStoryPreviewForUser(effectiveContactId) : null;
  $: hasStory = Boolean(storyPreview && (storyPreview.totalCount || 0) > 0);
  $: storyTotal = Math.max(1, storyPreview?.totalCount || 1);
  $: storyRead = Math.min(storyTotal, storyPreview?.readCount || 0);
  $: storyUnread = storyTotal - storyRead;
  $: storyRadius = (size - 2.5) / 2;
  $: storyCircumference = 2 * Math.PI * storyRadius;
  $: storySegmentGap = storyTotal > 1 ? 4 : 0;
  $: storySegmentLength = Math.max(2, (storyCircumference - storyTotal * storySegmentGap) / storyTotal);

  function handleStoryClick(e) {
    if (!hasStory || !effectiveContactId) return;
    e.stopPropagation();
    openStoriesViewer(effectiveContactId);
  }

  $: isOnline = !isSelf && Boolean(
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

  let safeVideoFailed = false;
  let staticMediaFailed = false;

  let prevTargetEntityId = null;
  $: if (targetEntityId !== prevTargetEntityId) {
    prevTargetEntityId = targetEntityId;
    safeVideoFailed = false;
    staticMediaFailed = false;
  }

  let prevSafeAvatarUid = null;
  $: if (safeAvatarUid !== prevSafeAvatarUid) {
    prevSafeAvatarUid = safeAvatarUid;
    safeVideoFailed = false;
    staticMediaFailed = false;
  }

  $: activeSrc = !safeVideoFailed && safeMediaUrl ? safeMediaUrl : (!staticMediaFailed && avatarUrl ? avatarUrl : null);
  $: activeType = !safeVideoFailed && safeMediaUrl ? "video" : "image";

  function handleMediaError() {
    if (activeSrc === safeMediaUrl) {
      safeVideoFailed = true;
    } else {
      staticMediaFailed = true;
    }
  }
</script>

<div
  class="avatar-wrapper"
  class:has-story={hasStory}
  style="width: {size}px; height: {size}px; {style}"
  on:click={hasStory ? handleStoryClick : undefined}
>
  {#if hasStory}
    <svg
      class="story-avatar-ring-svg"
      viewBox="0 0 {size} {size}"
      width={size}
      height={size}
    >
      <defs>
        <linearGradient id="avatarStoryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3b82f6" />
          <stop offset="50%" stop-color="#8b5cf6" />
          <stop offset="100%" stop-color="#ec4899" />
        </linearGradient>
      </defs>
      {#each Array(storyTotal) as _, i}
        {@const isSegUnread = i >= storyRead}
        {@const offset = -i * (storySegmentLength + storySegmentGap)}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={storyRadius}
          fill="none"
          stroke={isSegUnread ? "url(#avatarStoryGrad)" : "rgba(142, 142, 147, 0.4)"}
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-dasharray="{storySegmentLength} {storyCircumference - storySegmentLength}"
          stroke-dashoffset={offset}
        />
      {/each}
    </svg>
  {/if}

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
    {:else if activeSrc}
      <MediaCanvas
        src={activeSrc}
        type={activeType}
        {size}
        targetEntityId={!safeAvatarUid && !$disableMaxPlusAvatars ? targetEntityId : null}
        alt={effectiveTitle}
        class="avatar-media"
        on:error={handleMediaError}
      />
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
        class:stego-active={Boolean(safeAvatarUid && !safeVideoFailed)}
        class:stego-missing={Boolean(safeAvatarUid && safeVideoFailed)}
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
    aspect-ratio: 1 / 1;
    flex-shrink: 0;
  }

  .avatar-wrapper.has-story {
    cursor: pointer;
  }

  .story-avatar-ring-svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
    pointer-events: none;
    z-index: var(--z-panel, 2);
  }

  .avatar-wrapper.has-story .avatar-container {
    inset: 4px;
    width: calc(100% - 8px);
    height: calc(100% - 8px);
    position: absolute;
  }

  .avatar-container {
    width: 100%;
    height: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    position: relative;
    overflow: hidden;
  }

  :global(.avatar-media) {
    width: 100% !important;
    height: 100% !important;
    aspect-ratio: 1 / 1 !important;
    border-radius: 50% !important;
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

  .online-badge {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 25%;
    height: 25%;
    min-width: 8px;
    min-height: 8px;
    border-radius: 50%;
    background: #22c55e;
    border: 2px solid var(--bg-color, #18181b);
    z-index: 4;
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
