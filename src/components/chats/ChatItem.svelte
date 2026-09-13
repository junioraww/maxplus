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
  import {
    openChat,
    get as sessionGet
  } from "$lib/stores/session";
  import {
    getChat
  } from "$lib/stores/messages";

  import Avatar from "$components/main/Avatar.svelte";

  export let chat;
  export let replace;
  export let isSelected = false; // Выбран ли этот чат
  export let selectionMode = false; // Включен ли вообще режим выбора

  let unread = chat.newMessages || 0;

  const dispatch = createEventDispatcher();

  $: peerId =
    chat.type === "DIALOG" ? $currentUser ^ chat.id : null;

  $: contact = getContact(peerId);

  $: title =
    chat.id === 0
      ? "Избранное"
      : chat.title || $contact?.names?.[0]?.name || "Без названия";

  $: cachedChat = getChat(chat.id);
  $: receivedMessage = cachedChat.receivedMessage;
  $: shownMessage = replace?.message || $receivedMessage || chat.lastMessage;
  $: attaches = getAttachText(chat, shownMessage);

  currentSessionChats.subscribe(chats => {
    const entry = chats.find(x => x.id === chat.id);

    if (entry?.newMessages !== unread) {
      unread = entry.newMessages;
    }
  });

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

  $: isMe = shownMessage?.sender === $currentUser;
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
  <Avatar
    {chat}
    contactId={peerId}
    {selectionMode}
    {isSelected}
  />

  <div class="content">
    <div class="row top">
      <span class="name">{title}</span>
      <div class="meta">
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
        <div class="badge" style={unread >= 99 ? "width: 26px;" : ""}>
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
</style>
