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
    const msgDate = new Date(Number(shownMessage.time) + (Number(sessionGet("drift")) || 0));
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
    if (
      msgDate.getDate() === yesterday.getDate() &&
      msgDate.getMonth() === yesterday.getMonth() &&
      msgDate.getFullYear() === yesterday.getFullYear()
    ) return "Вчера";
    if (msgDate.getFullYear() !== now.getFullYear())
      return msgDate.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    return msgDate.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
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

<div class="item">
  <div
    role="presentation"
    class="wrapper"
    class:wrapper--withActions={!selectionMode}
    class:selected={isSelected}
    on:mousedown={handleStart}
    on:touchstart|passive={handleStart}
    on:mouseup={handleEnd}
    on:touchend={handleEnd}
    on:touchmove|passive={handleMove}
    on:contextmenu|preventDefault={() => dispatch("longpress", chat)}
  >
    <button class="cell" on:click={handleClick}>
      <div
        class="avatar"
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
        <Avatar
          {chat}
          contactId={peerId}
          size={64}
          {selectionMode}
          {isSelected}
        />
      </div>

      <h3 class="title">
        <span class="name">
          {#if isBot}
            <svg class="bot-badge-icon" aria-hidden="true" width="16" height="16"><use href="#icon_bot_mini"></use></svg>
          {/if}
          <span class="name-text">{title}</span>
        </span>
      </h3>

      <div class="icons">
        {#if muted}
          <svg class="muted-icon" aria-label="Без звука" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            <line x1="2" y1="2" x2="22" y2="22"></line>
          </svg>
        {/if}
      </div>

      <div class="meta">
        {#if isMe}
          <span class="readMarker" class:unread={!isRead} aria-label={isRead ? "Прочитано" : "Отправлено"}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              {#if isRead}
                <path d="M1.5 8.5l3 3 6-7"></path>
                <path d="M7.5 11.5l6-7"></path>
              {:else}
                <path d="M3.5 8.5l3 3 6-7"></path>
              {/if}
            </svg>
          </span>
        {/if}
        <span class="time">{timeDisplay}</span>
      </div>

      <span class="text">
        {#if attaches}
          <span class="attach">{attaches}</span>{#if shownMessage?.text}, {/if}
        {/if}
        {#if replace}
          {@html replace.text}
        {:else}
          {(shownMessage?.text || getSystemText(shownMessage, false) || "").replace(/<[^>]*>/g, "")}
        {/if}
      </span>

      <div class="indicators">
        {#if unread > 0}
          <div class="badge" class:muted>
            {unread > 99 ? "99+" : unread}
          </div>
        {/if}
      </div>
    </button>

    {#if !selectionMode}
      <div class="actions">
        <button
          class="menuButton"
          aria-label="Действия с чатом"
          aria-haspopup="dialog"
          on:click|stopPropagation={() => dispatch("longpress", chat)}
          on:mousedown|stopPropagation
          on:touchstart|stopPropagation|passive
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="3" cy="8" r="1.5"></circle>
            <circle cx="8" cy="8" r="1.5"></circle>
            <circle cx="13" cy="8" r="1.5"></circle>
          </svg>
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* === Chat cell — ported from Max (svelte-q2jdqb) === */
  .item {
    position: relative;
    width: 100%;
  }

  .wrapper {
    position: relative;
    display: flex;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }

  .cell {
    --cell-bg: var(--background-primary, transparent);
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    display: grid;
    grid-template-columns: auto auto 1fr auto auto;
    grid-template-areas:
      "avatar title icons meta meta"
      "avatar text text text indicators";
    padding: 9px 16px;
    border: 0;
    margin: 0;
    text-align: left;
    color: var(--text-primary);
    font: inherit;
    background: var(--cell-bg);
    cursor: pointer;
    outline-offset: calc(-1px - var(--outline-width, 2px));
    transition: background-color 0.15s;
  }

  @media (hover: hover) {
    .wrapper:hover .cell {
      background: var(--states-background-card-hover, #0d0d0d0a);
    }
  }

  .cell:focus-visible {
    background: var(--states-background-card-hover, #0d0d0d0a);
  }

  .cell:active {
    background: var(--states-background-card-pressed, #0d0d0d14);
  }

  .wrapper.selected .cell {
    background: var(--background-themed-fade, #007aff29);
  }

  .avatar {
    grid-area: avatar;
    display: flex;
    align-items: center;
    height: 100%;
    margin-right: var(--spacing-m, 12px);
    cursor: pointer;
  }

  .title {
    grid-area: title;
    align-self: center;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font: 500 var(--font-detail-size, 15px) / var(--font-detail-line-height, 20px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-detail-letter-spacing, 0.15px);
    color: var(--text-primary);
  }

  .name {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-xs, 4px);
    max-width: 100%;
  }

  .name-text {
    flex: 1 1 0%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .bot-badge-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--icon-tertiary, #0607087a);
  }

  .icons {
    grid-area: icons;
    display: flex;
    align-items: center;
    height: 100%;
    margin-left: var(--spacing-2xs, 2px);
    color: var(--icon-mute, #06070847);
  }

  .meta {
    grid-area: meta;
    justify-self: flex-end;
    display: flex;
    align-items: center;
    gap: var(--spacing-xs, 4px);
    height: 100%;
    margin-left: var(--spacing-m, 12px);
  }

  .time {
    white-space: nowrap;
    font: 400 var(--font-description-size, 13px) / var(--font-description-line-height, 16px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-description-letter-spacing, 0.2px);
    color: var(--text-tertiary, #06070885);
  }

  .readMarker {
    display: flex;
    color: var(--icon-themed, var(--accent-primary));
  }

  .readMarker.unread {
    color: var(--icon-tertiary, #0607087a);
  }

  .text {
    grid-area: text;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-word;
    min-height: calc(2 * var(--font-detail-line-height, 20px) + var(--spacing-2xs, 2px));
    max-height: calc(2 * var(--font-detail-line-height, 20px) + var(--spacing-2xs, 2px));
    padding-top: var(--spacing-2xs, 2px);
    font: 400 var(--font-detail-size, 15px) / var(--font-detail-line-height, 20px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-detail-letter-spacing, 0.15px);
    color: var(--text-tertiary, #06070885);
  }

  .attach {
    color: var(--text-secondary, #060708ad);
  }

  .indicators {
    grid-area: indicators;
    position: relative;
    display: flex;
    justify-content: flex-end;
    height: 32px;
    margin-top: 2px;
    margin-left: var(--spacing-m, 12px);
  }

  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--counter-themed, var(--accent-primary));
    color: var(--counter-contrast, #fff);
    font: 500 var(--font-label-size, 12px) / 16px var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-label-letter-spacing, 0.3px);
    font-variant-numeric: tabular-nums;
    box-sizing: border-box;
  }

  .badge.muted {
    background: var(--counter-mute, #0607081f);
    color: var(--text-secondary, #060708ad);
  }

  .muted-icon {
    display: block;
  }

  /* "⋯" button on hover — Max .actions/.menuButton */
  .actions {
    position: absolute;
    top: 7px;
    right: 16px;
    display: flex;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }

  .menuButton {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    background: none;
    color: var(--icon-tertiary, #0607087a);
    cursor: pointer;
  }

  .menuButton:hover {
    color: var(--icon-secondary, #060708ad);
  }

  .meta {
    transition: opacity 0.12s;
  }

  @media (hover: hover) {
    .wrapper--withActions:hover .actions {
      opacity: 1;
      pointer-events: auto;
    }

    .wrapper--withActions:hover .meta {
      opacity: 0;
    }
  }

  .wrapper--withActions:focus-within .actions {
    opacity: 1;
    pointer-events: auto;
  }

  .wrapper--withActions:focus-within .meta {
    opacity: 0;
  }

</style>
