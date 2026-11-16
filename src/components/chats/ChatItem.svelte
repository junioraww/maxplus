<script>
  import { createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import { currentUser } from "$lib/stores/api";
  import { getContact } from "$lib/stores/contacts";
  import { getAttachText, getSystemText } from "$lib/utils/attachs";
  import Session, { openChat, get as sessionGet } from "$lib/stores/session";
  import { getChat } from "$lib/stores/messages";
  import { isChatMuted } from "$lib/utils/notifications";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import Avatar from "$components/main/Avatar.svelte";

  const pluginChatLeadings = getMountStore("chat-item:leading");
  const pluginChatBadges = getMountStore("chat-item:badge");
  const pluginChatTrailings = getMountStore("chat-item:trailing");

  export let chat;
  export let replace;
  export let isSelected = false;
  export let selectionMode = false;

  const dispatch = createEventDispatcher();

  $: chatStore = chat?.id != null ? getChat(chat.id).chatInfo : null;
  $: currentChat = (chatStore && $chatStore) || chat;
  $: unread = currentChat?.newMessages ?? 0;

  $: peerId = (() => {
    if (chat.type !== "DIALOG") return null;
    if (chat.participants && Object.keys(chat.participants).length > 0) {
      const other = Object.keys(chat.participants).find(id => String(id) !== String($currentUser));
      if (other) return Number(other);
    }
    if ($currentUser != null && chat.id != null) {
      try {
        return Number(BigInt(chat.id) ^ BigInt($currentUser));
      } catch (e) {
        return null;
      }
    }
    return null;
  })();

  $: contact = getContact(peerId);

  $: muted = isChatMuted(currentChat);
  $: isBot = $contact?.options?.includes("BOT") || chat?.options?.BOT === true || chat?.options?.IS_BOT === true;
  $: isPinned = Boolean(currentChat?.favIndex || currentChat?.pinned || chat?.favIndex || chat?.pinned);

  $: title =
    chat.id === 0
      ? "Избранное"
      : chat.title || $contact?.names?.[0]?.name || "Без названия";

  $: cachedChat = getChat(chat.id);
  $: receivedMessage = cachedChat.receivedMessage;
  $: shownMessage = (() => {
    if (replace?.message) return replace.message;
    const fromChat = currentChat?.lastMessage || chat?.lastMessage;
    const fromReceived = $receivedMessage;
    if (!fromReceived) return fromChat;
    if (!fromChat) return fromReceived;
    return (fromReceived.time || 0) >= (fromChat.time || 0) ? fromReceived : fromChat;
  })();
  $: attaches = getAttachText(currentChat || chat, shownMessage);

  $: previewThumbUrl = (() => {
    if (!shownMessage?.attaches || !shownMessage.attaches.length) return null;
    const a = shownMessage.attaches.find(x => {
      const t = x._type || x.type;
      return t === "PHOTO" || t === "VIDEO" || t === "STICKER";
    });
    if (!a) return null;
    const t = a._type || a.type;
    if (t === "PHOTO") {
      return a.previewUrl || a.thumbnailUrl || a.baseUrl || a.url || null;
    }
    if (t === "VIDEO") {
      return a.thumbnailUrl || a.previewUrl || a.url || null;
    }
    if (t === "STICKER") {
      return a.url || a.baseUrl || null;
    }
    return null;
  })();

  $: timeDisplay = (() => {
    if (!shownMessage?.time) return "";
    const msgDate = new Date(shownMessage.time + sessionGet("drift"));
    const now = new Date();
    const isToday =
      msgDate.getDate() === now.getDate() &&
      msgDate.getMonth() === now.getMonth() &&
      msgDate.getFullYear() === now.getFullYear();
    if (isToday)
      return msgDate.toLocaleTimeString("ru", {
        hour: "2-digit",
        minute: "2-digit",
      });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (msgDate.getDate() === yesterday.getDate()) return "Вчера";
    return msgDate.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  })();

  $: isMe = String(shownMessage?.sender) === String($currentUser) || String(shownMessage?.from) === String($currentUser);
  $: isRead = shownMessage?.read;

  let pressTimer = null;
  let isLongPress = false;
  let startX = 0;
  let startY = 0;
  let hasMoved = false;

  function handleTouchStart(e) {
    const touch = e.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    hasMoved = false;
    isLongPress = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      isLongPress = true;
      dispatch("longpress", chat);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500);
  }

  function handleTouchMove(e) {
    if (!pressTimer && !isLongPress) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (Math.abs(touch.clientX - startX) > 8 || Math.abs(touch.clientY - startY) > 8) {
      hasMoved = true;
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function handleTouchEnd(e) {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (isLongPress) {
      e?.stopPropagation?.();
      setTimeout(() => {
        isLongPress = false;
      }, 400);
    }
  }

  function handleMouseDown(e) {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    hasMoved = false;
    isLongPress = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      isLongPress = true;
      dispatch("longpress", chat);
    }, 500);
  }

  function handleMouseMove(e) {
    if (!pressTimer && !isLongPress) return;
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
      hasMoved = true;
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function handleMouseUp(e) {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (isLongPress) {
      e?.stopPropagation?.();
      setTimeout(() => {
        isLongPress = false;
      }, 400);
    }
  }

  function handleClick(e) {
    if (isLongPress || hasMoved) {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      return;
    }

    if (selectionMode) {
      dispatch("toggle", chat);
    } else {
      openChat(chat.id);
    }
  }
</script>

<div
  class="chat-item"
  class:selected={isSelected}
  on:mousedown={handleMouseDown}
  on:mousemove={handleMouseMove}
  on:mouseup={handleMouseUp}
  on:touchstart|passive={handleTouchStart}
  on:touchmove|passive={handleTouchMove}
  on:touchend={handleTouchEnd}
  on:click={handleClick}
  on:contextmenu|preventDefault={() => dispatch("longpress", chat)}
>
  <div
    class="avatar-click-area"
    on:click|stopPropagation={() => {
      if (selectionMode) {
        handleClick();
        return;
      }
      if (chat.id === 0) {
        $Session.profile = { userId: $currentUser, chatId: 0 };
      } else if (chat.type === "DIALOG") {
        $Session.profile = { userId: peerId, chatId: chat.id };
      } else {
        $Session.profile = { chatId: chat.id };
      }
    }}
  >
    {#each $pluginChatLeadings as item (item.id)}
      <div class="plugin-mount-inline plugin-chat-leading" data-plugin-mount={item.pluginId || item.id}>
        {@html item.html}
      </div>
    {/each}
    <Avatar
      {chat}
      contactId={peerId}
      size={56}
      {selectionMode}
      {isSelected}
      allowStories={!selectionMode}
    />
  </div>

  <div class="content">
    <div class="row top">
      <div class="title-wrap">
        {#if isBot}
          <img src="/icons/bot.svg" class="bot-badge-icon" alt="" />
        {/if}
        <span class="name">{title}</span>
        {#if muted}
          <img src="/icons/mute.svg" class="muted-icon" alt="" />
        {/if}
        {#each $pluginChatBadges as item (item.id)}
          <span class="plugin-mount-inline plugin-chat-badge" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </span>
        {/each}
      </div>

      <div class="meta">
        {#if isMe}
          {#if isRead}
            <img src="/icons/status-read.svg" class="status-icon read" alt="" />
          {:else}
            <img src="/icons/status-delivered.svg" class="status-icon" alt="" />
          {/if}
        {/if}
        <span class="time">{timeDisplay}</span>
        {#if isPinned}
          <img src="/icons/pin.svg" class="pin-icon" alt="" />
        {/if}
        {#each $pluginChatTrailings as item (item.id)}
          <span class="plugin-mount-inline plugin-chat-trailing" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </span>
        {/each}
      </div>
    </div>

    <div class="row bottom">
      <div class="preview-wrap">
        {#if previewThumbUrl}
          <img src={previewThumbUrl} class="preview-thumb" alt="" />
        {/if}
        <p class="preview">
          {#if isMe}<span class="you-prefix">Вы: </span>{/if}
          {#if attaches}
            <b>{attaches}</b>{#if shownMessage?.text}, {/if}
          {/if}
          {#if replace}
            {@html replace.text}
          {:else}
            {(shownMessage?.text || getSystemText(shownMessage, false) || "").replace(/<[^>]*>/g, "")}
          {/if}
        </p>
      </div>
      {#if unread > 0}
        <div class="badge" class:muted>
          {unread > 99 ? "99+" : unread}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-item {
    display: flex;
    align-items: center;
    min-height: 72px;
    padding: 9px 12px;
    box-sizing: border-box;
    cursor: pointer;
    transition: background-color 0.15s ease;
    gap: 12px;
    user-select: none;
    position: relative;
  }

  .chat-item:hover {
    background-color: rgba(255, 255, 255, 0.03);
  }

  .chat-item.selected {
    background-color: rgba(59, 130, 246, 0.15);
  }

  .avatar-click-area {
    cursor: pointer;
    flex-shrink: 0;
    border-radius: 50%;
    transition: opacity 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .avatar-click-area:hover {
    opacity: 0.92;
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    gap: 4px;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-width: 0;
  }

  .row.bottom {
    align-items: flex-start;
  }

  .title-wrap {
    display: flex;
    align-items: center;
    min-width: 0;
    gap: 4px;
    flex: 1;
  }

  .name {
    font-weight: 600;
    font-size: 16px;
    line-height: 20px;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .muted-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.65;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .time {
    font-size: 13px;
    line-height: 16px;
    color: var(--text-muted, #8b929e);
    white-space: nowrap;
  }

  .status-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.65;
  }

  .status-icon.read {
    opacity: 1;
  }

  .pin-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    opacity: 0.65;
  }

  .preview-wrap {
    display: flex;
    align-items: flex-start;
    flex: 1;
    min-width: 0;
  }

  .preview-thumb {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
    margin-right: 6px;
    margin-top: 1px;
  }

  .preview {
    margin: 0;
    font-size: 15px;
    line-height: 20px;
    color: var(--text-secondary, #8b929e);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .you-prefix {
    color: var(--text-primary, #ffffff);
  }

  .badge {
    background-color: var(--badge-unread, #3b82f6);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    font-feature-settings: "tnum";
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 8px;
    flex-shrink: 0;
    box-sizing: border-box;
    line-height: 1;
    margin-top: 1px;
  }

  .badge.muted {
    background-color: #4b4b56;
    color: #dddddd;
  }

  .bot-badge-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.9;
  }
</style>
