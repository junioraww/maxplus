<script>
  import { createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import {
    currentUser,
    currentSessionChats,
  } from "$lib/stores/api";
  import {
    getContact
  } from "$lib/stores/contacts";
  import {
    getAttachText,
    getSystemText,
  } from "$lib/utils/attachs";
  import Session, {
    openChat,
    get as sessionGet
  } from "$lib/stores/session";
  import {
    getChat
  } from "$lib/stores/messages";
  import { isChatMuted } from "$lib/utils/notifications";

  import Avatar from "$components/main/Avatar.svelte";

  export let chat;
  export let replace;
  export let isSelected = false;
  export let selectionMode = false;

  const dispatch = createEventDispatcher();

  $: currentChat = $currentSessionChats?.find((x) => String(x.id) === String(chat?.id)) || chat;
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

  let pressTimer;
  let isLongPress = false;

  function handleStart() {
    isLongPress = false;
    pressTimer = setTimeout(() => {
      isLongPress = true;
      dispatch("longpress", chat);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 250);
  }

  function handleEnd() {
    clearTimeout(pressTimer);
  }

  function handleMove() {
    clearTimeout(pressTimer);
  }

  function handleClick() {
    if (isLongPress) return;

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
  on:mousedown={handleStart}
  on:touchstart|passive={handleStart}
  on:mouseup={handleEnd}
  on:touchend={handleEnd}
  on:touchmove|passive={handleMove}
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
        $Session.profile = { userId: $currentUser };
      } else if (chat.type === "DIALOG") {
        $Session.profile = { userId: peerId };
      } else {
        $Session.profile = { chatId: chat.id };
      }
    }}
  >
    <Avatar
      {chat}
      contactId={peerId}
      {selectionMode}
      {isSelected}
    />
  </div>

  <div class="content">
    <div class="row top">
      <span class="name">
        {#if isBot}
          <img src="icons/bot.svg" class="bot-badge-icon" alt="" />
        {/if}
        {title}
      </span>
      <div class="meta">
        {#if muted}
          <svg class="muted-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#8e8e93" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            <line x1="2" y1="2" x2="22" y2="22"></line>
          </svg>
        {/if}
        {#if isMe}
          <span class="status-icon" class:read={isRead}>
            {isRead ? "✓✓" : "✓"}
          </span>
        {/if}
        <span class="time">{timeDisplay}</span>
      </div>
    </div>

    <div class="row bottom">
      <p class="preview">
        {#if isMe}<span class="you-prefix">Вы:</span>{/if}
        {#if attaches}
          <b>{attaches}</b>{#if shownMessage?.text},
          {/if}
        {/if}
        {#if replace}
          {@html replace.text}
        {:else}
          {shownMessage?.text || getSystemText(shownMessage)}
        {/if}
      </p>
      {#if unread > 0}
        <div class="badge" class:muted style={unread >= 99 ? "width: 26px;" : ""}>
          {unread > 99 ? "99+" : unread}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .chat-item {
    display: flex;
    padding: 8px 10px;
    cursor: pointer;
    transition: background-color 0.2s;
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

  /*.online-badge {
        position: absolute; bottom: 2px; right: 2px;
        width: 12px; height: 12px;
        background-color: #4ade80;
        border: 2px solid #1e1e1e;
        border-radius: 50%;
        z-index: 1;
    }*/

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
  }

  .name {
    font-weight: 500;
    font-size: 16px;
    color: #eee;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
  }

  .time {
    font-size: 12px;
    color: #888;
  }

  .status-icon {
    font-size: 12px;
    color: #888;
  }

  .status-icon.read {
    color: #4ade80;
  }

  .preview {
    margin: 0;
    font-size: 14px;
    color: #aaa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .you-prefix {
    color: #fff;
  }

  .badge {
    background-color: #3b82f6;
    color: white;
    font-size: 11px;
    font-weight: bold;
    width: 20px;
    height: 20px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 8px;
    flex-shrink: 0;
  }

  .badge.muted {
    background-color: #4b4b56;
    color: #bbb;
  }

  .bot-badge-icon {
    width: 14px;
    height: 14px;
    margin-right: 4px;
    vertical-align: -2px;
    display: inline-block;
    opacity: 0.85;
  }

  .muted-icon {
    opacity: 0.85;
    margin-right: 2px;
    display: inline-block;
    vertical-align: -1px;
  }

  .avatar-click-area {
    cursor: pointer;
    flex-shrink: 0;
    border-radius: 50%;
    transition: opacity 0.15s ease;
  }

  .avatar-click-area:hover {
    opacity: 0.88;
  }
</style>
