<script>
  import { getContact } from "$lib/utils/caching";
  import { getAvatarPlaceholder, getInitials } from "$lib/utils/images";

  import Image from "$components/main/Image.svelte";

  import API, { currentSessionChats } from "$lib/stores/api";

  export let size;
  export let selectionMode;
  export let isSelected;
  export let chat = {};
  export let contactId;
  export let title;
  export let style;
  export let seed;

  $: contact = getContact(contactId);

  if (!size) size = 50;
  if (!title)
    title =
      chat.id === 0
        ? "Избранное"
        : chat.title || contact?.names?.[0]?.name || "Без названия";

  $: avatarUrl =
    chat?.avatar ||
    chat?.baseIconUrl ||
    chat?.iconUrl ||
    chat?.baseRawIconUrl ||
    chat?.baseUrl ||
    $contact?.avatar ||
    $contact?.baseUrl;

  const fetchedChatIcons = new Set();

  $: if (chat?.id && chat?.type !== "DIALOG" && !avatarUrl && !fetchedChatIcons.has(chat.id)) {
    fetchedChatIcons.add(chat.id);
    $API?.getChat?.(chat.id).then((res) => {
      const serverChat = res?.chats?.[0];
      if (serverChat) {
        currentSessionChats.update((chats) => {
          if (!chats) return chats;
          const idx = chats.findIndex((c) => c.id === chat.id);
          if (idx !== -1) {
            chats[idx] = { ...chats[idx], ...serverChat };
          }
          return [...chats];
        });
      }
    }).catch(() => {});
  }

  const imageStyle = `width: 100%; height: 100%; border-radius: 50%; object-fit: cover;`;
</script>

<div class="avatar-wrapper" style="width: {size}px; height: {size}px; {style}">
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
    {#if chat.id === 0}
      <img src="saved.webp" style={imageStyle} />
    {:else if avatarUrl}
      <Image src={avatarUrl} alt={title} style={imageStyle} />
    {:else}
      <div
        class="avatar-placeholder"
        style="background: {getAvatarPlaceholder($contact?.id || chat?.id || seed)}; font-size: {size / 2.5}px;"
      >
        {getInitials(title)}
      </div>
    {/if}

    {#if $contact?.online && !selectionMode}
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
</style>
