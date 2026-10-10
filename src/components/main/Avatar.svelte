<script>
  import { getContact } from "$lib/utils/caching";
  import { getAvatarPlaceholder, getInitials } from "$lib/utils/images";

  import Image from "$components/main/Image.svelte";

  import { currentPresence, currentUser, currentUserDetails } from "$lib/stores/api";

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
  $: effectiveContactId = resolvedContactId || $contact?.id;
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
          style="color: var(--text-primary)"><polyline points="20 6 9 17 4 12"></polyline></svg
        >
      {/if}
    </div>
  {/if}

  <div class="avatar-container">
    {#if chat?.id === 0}
      <img src="/saved.webp" style={imageStyle} alt={effectiveTitle} />
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
    color: var(--text-primary);
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
</style>
