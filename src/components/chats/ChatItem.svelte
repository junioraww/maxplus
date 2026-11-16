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
          <img src="icons/bot.svg" class="bot-badge-icon" alt="" />
        {/if}
        <span class="name">{title}</span>
        {#if muted}
          <svg class="muted-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            <line x1="2" y1="2" x2="22" y2="22"></line>
          </svg>
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
            <svg class="status-icon read" viewBox="0 0 18 16" width="16" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1.5 8 5.5 12 12.5 4"></polyline>
              <polyline points="6.5 8 10.5 12 17.5 4"></polyline>
            </svg>
          {:else}
            <svg class="status-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="2.5 8 6.5 12 14.5 4"></polyline>
            </svg>
          {/if}
        {/if}
        <span class="time">{timeDisplay}</span>
        {#if isPinned}
          <svg class="pin-icon" viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
            <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.923-1.414.728-.195-.195.533-1.22.728-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
          </svg>
        {/if}
        {#each $pluginChatTrailings as item (item.id)}
          <span class="plugin-mount-inline plugin-chat-trailing" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </span>
        {/each}
      </div>
    </div>

    <div class="row bottom">
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
    min-height: 80px;
    padding: 9px 6px;
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
    color: var(--text-muted, #8b929e);
    flex-shrink: 0;
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
    color: var(--text-muted, #8b929e);
    flex-shrink: 0;
  }

  .status-icon.read {
    color: var(--read-tick, #34b7f1);
  }

  .pin-icon {
    color: var(--text-muted, #8b929e);
    flex-shrink: 0;
  }

  .preview {
    margin: 0;
    font-size: 15px;
    line-height: 20px;
    color: var(--text-secondary, #8b929e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
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
