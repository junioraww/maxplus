<script>
  import { createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import { currentUser } from "$lib/stores/api";
  import { getContact } from "$lib/stores/contacts";
  import { getAttachText, getSystemText } from "$lib/utils/attachs";
  import Session, { openChat, openProfile, get as sessionGet } from "$lib/stores/session";
  import { getChat } from "$lib/stores/messages";
  import { isChatMuted } from "$lib/utils/notifications";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import { openMiniApp } from "$lib/stores/webapp";
  import { chatDrafts } from "$lib/stores/drafts";
  import { chatTypingStore } from "$lib/stores/typing";
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

  $: muted = Boolean(isChatMuted(currentChat) || isChatMuted(chat) || currentChat?.muted || currentChat?.isMuted || chat?.muted || chat?.isMuted);
  $: isBot = $contact?.options?.includes("BOT") || chat?.options?.BOT === true || chat?.options?.IS_BOT === true;
  export let isPinned = undefined;
  $: resolvedPinned = isPinned !== undefined
    ? Boolean(isPinned)
    : (chat?.isPinned !== undefined
      ? Boolean(chat.isPinned)
      : Boolean(currentChat?.favIndex || currentChat?.pinned || chat?.favIndex || chat?.pinned));

  $: title =
    (currentChat?.id === 0 || chat?.id === 0)
      ? "Избранное"
      : currentChat?.title || chat?.title || $contact?.names?.[0]?.name || "Без названия";

  $: isOfficial = Boolean(
    currentChat?.official ||
    currentChat?.isOfficial ||
    currentChat?.options?.OFFICIAL === true ||
    currentChat?.options?.official === true ||
    $contact?.official ||
    $contact?.isOfficial ||
    $contact?.options?.includes?.("OFFICIAL") ||
    $contact?.options?.includes?.("VERIFIED") ||
    chat?.official ||
    chat?.isOfficial ||
    chat?.options?.OFFICIAL === true ||
    chat?.options?.official === true ||
    title === "Безопасность"
  );

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

  $: rawMessageText = replace ? replace.text : (shownMessage?.text || getSystemText(shownMessage, false) || "");
  $: messageText = typeof rawMessageText === "string" ? rawMessageText.replace(/<[^>]*>/g, "").trim() : "";
  $: hasText = Boolean(messageText && messageText.length > 0);
  $: isVideoMsg = Boolean(shownMessage?.attaches?.some(x => {
    const t = x._type || x.type;
    return t === "VIDEO";
  }));

  $: previewThumbs = (() => {
    if (!shownMessage?.attaches || !shownMessage.attaches.length) return [];
    const photos = shownMessage.attaches.filter(x => (x._type || x.type) === "PHOTO");
    if (photos.length > 0) {
      return photos.slice(0, 3).map(a => a.previewUrl || a.thumbnailUrl || a.baseUrl || a.url).filter(Boolean);
    }
    const a = shownMessage.attaches.find(x => {
      const t = x._type || x.type;
      return t === "VIDEO" || t === "STICKER";
    });
    if (a) {
      const u = a.thumbnailUrl || a.previewUrl || a.baseUrl || a.url;
      return u ? [u] : [];
    }
    return [];
  })();

  $: isGroupChat = currentChat?.type === "CHAT" || chat?.type === "CHAT" || currentChat?.type === "group" || chat?.type === "group";
  $: senderId = shownMessage?.sender ?? shownMessage?.from;
  $: senderContact = (isGroupChat && senderId && String(senderId) !== String($currentUser)) ? getContact(senderId) : null;
  $: senderName = $senderContact?.names?.[0]?.name || $senderContact?.firstName || $senderContact?.name || shownMessage?.authorName || "";
  $: senderAvatar = $senderContact?.avatar || shownMessage?.authorAvatar || "";

  $: callAttach = shownMessage?.attaches?.find(a => ((a._type || a.type) === 'CALL' && a.hangupType != null) || a.hangupType != null) || (shownMessage?.type === 'CALL' ? shownMessage : null);
  $: isCallMsg = Boolean(callAttach);
  $: callInfo = (() => {
    if (!callAttach) return null;
    const hang = (callAttach.hangupType || "").toUpperCase();
    const isMissed = hang === "MISSED" || hang === "CANCELED" || hang === "REJECTED";
    const isVideo = Boolean(callAttach.video || callAttach.isVideo);
    const rawDur = Number(callAttach.duration || 0);
    const durationSec = rawDur > 0 ? Math.max(1, Math.round(rawDur / 1000)) : 0;
    let label = isMissed 
      ? (isVideo ? "Пропущенный видеозвонок" : "Пропущенный") 
      : (hang === "CANCELED" ? "Отменённый" : "Звонок");
    if (!isMissed && durationSec > 0) {
      const h = Math.floor(durationSec / 3600);
      const mins = Math.floor((durationSec % 3600) / 60);
      const secs = durationSec % 60;
      if (h > 0) {
        label += ` · ${h} ч ${mins} мин`;
      } else {
        label += ` · ${mins > 0 ? `${mins} мин ` : ""}${secs} сек`;
      }
    }
    return {
      isMissed,
      icon: isMissed ? "/icons/call-missed.svg" : (hang === "CANCELED" ? "/icons/call-canceled.svg" : "/icons/call-incoming.svg"),
      label,
    };
  })();

  $: hasBotWebApp = Boolean(
    isBot && (
      $contact?.options?.includes?.("WEB_APP") ||
      $contact?.options?.includes?.("APP") ||
      $contact?.app ||
      currentChat?.options?.WEB_APP ||
      currentChat?.options?.hasWebApp ||
      currentChat?.bot?.app
    )
  );

  function handleOpenBotApp(e) {
    e?.stopPropagation?.();
    openMiniApp({
      botId: peerId,
      chatId: chat.id,
      title: title || "Мини-приложение",
    });
  }

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
    if (
      msgDate.getDate() === yesterday.getDate() &&
      msgDate.getMonth() === yesterday.getMonth() &&
      msgDate.getFullYear() === yesterday.getFullYear()
    ) {
      return "Вчера";
    }
    if (msgDate.getFullYear() === now.getFullYear()) {
      return msgDate.toLocaleDateString("ru", { day: "numeric", month: "short" });
    }
    return msgDate.toLocaleDateString("ru", { day: "numeric", month: "short", year: "numeric" });
  })();

  $: isMe = String(shownMessage?.sender) === String($currentUser) || String(shownMessage?.from) === String($currentUser);
  $: isRead = shownMessage?.read;
  $: isPending = Boolean(shownMessage?.sending || shownMessage?.status === "PENDING" || (isMe && !shownMessage?.time));

  $: unreadMentions = Number(currentChat?.unreadMentions || currentChat?.newMentions || chat?.unreadMentions || chat?.newMentions || 0);
  $: unreadReactions = (() => {
    const target = currentChat || chat;
    if (target?.unreadReactions != null) {
      const count = Number(target.unreadReactions) || 0;
      if (count <= 0) return 0;
      if (target?.hasReaction === false || !target?.lastReaction) return 0;
      return count;
    }
    if (target?.hasReaction === false || !target?.lastReaction) {
      return 0;
    }
    return 1;
  })();
  $: hasNotificationStack = unread > 0 || unreadMentions > 0 || unreadReactions > 0;

  $: draftText = $chatDrafts.get(chat?.id)?.text || $chatDrafts.get(String(chat?.id))?.text || null;
  $: hasDraft = Boolean(draftText && draftText.trim().length > 0);

  $: activeTyping = $chatTypingStore.get(chat?.id) || $chatTypingStore.get(String(chat?.id)) || null;

  $: isSavedMessages = (currentChat?.id === 0 || chat?.id === 0);
  $: isEmptySavedMessages = isSavedMessages && !hasText && !attaches && !shownMessage?.time && !hasDraft && !activeTyping;

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
    }, 400);
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
    }, 400);
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
      dispatch("open", chat.id);
      openChat(chat.id);
    }
  }
</script>

<div
  class="chat-item"
  class:selected={isSelected}
  class:pinned={resolvedPinned}
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
        openProfile({ userId: $currentUser, chatId: 0 });
      } else if (chat.type === "DIALOG") {
        openProfile({ userId: peerId, chatId: chat.id });
      } else {
        openProfile({ chatId: chat.id });
      }
    }}
  >
    {#each $pluginChatLeadings as item (item.id)}
      <div class="plugin-mount-inline plugin-chat-leading" data-plugin-mount={item.pluginId || item.id}>
        {@html item.html}
      </div>
    {/each}
    <Avatar
      chat={currentChat}
      title={title}
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
        <span class="name font-title">{title}</span>
        {#if isOfficial}
          <img src="/icons/verified.svg" class="verified-icon" alt="Официальный" />
        {:else if isBot}
          <img src="/icons/bot.svg" class="bot-badge-icon" alt="" />
        {/if}
        {#if muted}
          <img src="/icons/mute.svg" class="muted-icon" alt="Без звука" />
        {/if}
        {#each $pluginChatBadges as item (item.id)}
          <span class="plugin-mount-inline plugin-chat-badge" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </span>
        {/each}
      </div>

      <div class="meta">
        {#if isMe}
          {#if isPending}
            <img src="/icons/pending.svg" class="status-icon pending" alt="" />
          {:else if isRead}
            <img src="/icons/status-read.svg" class="status-icon read" alt="" />
          {:else}
            <img src="/icons/status-delivered.svg" class="status-icon" alt="" />
          {/if}
        {/if}
        <span class="time">{timeDisplay}</span>
        {#if resolvedPinned}
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
        {#if activeTyping}
          <div class="typing-preview font-medium">
            <span class="typing-dots">
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
              <span class="typing-dot"></span>
            </span>
            <span class="typing-text">{activeTyping.text}</span>
          </div>
        {:else if hasDraft}
          <p class="preview">
            <span class="draft-prefix font-medium">Черновик:</span><span class="draft-text">{draftText}</span>
          </p>
        {:else if isEmptySavedMessages}
          <p class="preview">
            <span class="empty-saved-desc">Сохраненные сообщения</span>
          </p>
        {:else}
          {#if previewThumbs.length > 0}
            <div class="preview-thumbs-row">
              {#each previewThumbs as thumbUrl}
                <img src={thumbUrl} class="preview-thumb" alt="" />
              {/each}
            </div>
          {/if}
          <p class="preview">
            {#if isMe}
              <span class="you-prefix">Вы: </span>
            {:else if isGroupChat && senderName}
              <span class="sender-mini-avatar-wrap">
                <Avatar userId={senderId} contactId={senderId} size={15} enableStoryRing={false} />
              </span>
              <span class="sender-prefix font-medium">{senderName}: </span>
            {/if}
            {#if isCallMsg && callInfo}
              <span class="call-preview-row" class:missed={callInfo.isMissed}>
                {#if callInfo.isMissed}
                  <svg class="call-preview-icon missed" viewBox="0 0 16 16" fill="none">
                    <path d="M3.6 7.8c1.1 2.2 2.8 4 5 5l1.7-1.7c.2-.2.5-.3.8-.2.9.3 1.8.4 2.8.4.4 0 .8.4.8.8v2.7c0 .4-.4.8-.8.8-7.3 0-13.1-5.9-13.1-13.1 0-.4.4-.8.8-.8h2.7c.4 0 .8.4.8.8 0 1 .2 1.9.4 2.8.1.3 0 .6-.2.8L3.6 7.8z" fill="currentColor"/>
                    <path d="M15 1.5L9.5 7M9.5 7H13.5M9.5 7V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {:else}
                  <img src={callInfo.icon} class="call-preview-icon" alt="" />
                {/if}
                <span class="call-preview-text">{callInfo.label}</span>
              </span>
            {:else}
              {#if isVideoMsg}
                <svg class="preview-play-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5 3.5v9l7-4.5-7-4.5z" />
                </svg>
              {/if}
              {#if hasText}
                {#if replace}
                  {@html replace.text}
                {:else}
                  {messageText}
                {/if}
              {:else if attaches}
                <b>{attaches}</b>
              {/if}
            {/if}
          </p>
        {/if}
      </div>
      {#if hasBotWebApp}
        <button class="bot-open-btn font-title" on:click={handleOpenBotApp}>
          Открыть
        </button>
      {/if}
      {#if hasNotificationStack}
        <div class="notification-stack">
          {#if unreadReactions > 0}
            <div class="stack-badge reaction-badge font-title" class:muted title="Реакции">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                <path d="M8 13.7s-5.2-3.3-5.2-7.2A3.3 3.3 0 0 1 8 3.5a3.3 3.3 0 0 1 5.2 3c0 3.9-5.2 7.2-5.2 7.2z" />
              </svg>
            </div>
          {/if}
          {#if unreadMentions > 0}
            <div class="stack-badge mention-badge font-title" class:muted title="Упоминания">
              @
            </div>
          {/if}
          {#if unread > 0}
            <div class="badge font-title" class:muted class:stacked={unreadMentions > 0 || unreadReactions > 0}>
              {unread > 999 ? "999+" : unread}
            </div>
          {/if}
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
    padding: 10px 12px;
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

  .chat-item.pinned {
    background-color: var(--bg-pinned-chat, #202225);
  }

  .chat-item.pinned:hover {
    background-color: var(--bg-pinned-chat-hover, #26282e);
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
    font-size: 16px;
    line-height: 20px;
    color: var(--text-primary, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .verified-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    margin-left: 2px;
  }

  .muted-icon {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    opacity: 0.65;
    margin-left: 2px;
    filter: brightness(0) invert(var(--icon-invert, 1));
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
    font-weight: 400;
    line-height: 16px;
    color: var(--text-muted, #8b929e);
    white-space: nowrap;
  }

  .status-icon {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .status-icon.read {
    opacity: 1;
  }

  .status-icon.pending {
    width: 14px;
    height: 14px;
    opacity: 0.75;
    filter: brightness(0) invert(var(--icon-invert, 1));
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

  .preview-thumbs-row {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-right: 6px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .preview-thumb {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .preview-play-icon {
    width: 12px;
    height: 12px;
    display: inline-block;
    vertical-align: -1px;
    margin-right: 4px;
    flex-shrink: 0;
    fill: currentColor;
    opacity: 0.85;
  }

  .preview {
    margin: 0;
    font-size: 15px;
    font-weight: 400;
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

  .sender-mini-avatar-wrap {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: -2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
  }

  .sender-prefix {
    color: var(--text-primary, #ffffff);
    margin-right: 2px;
  }

  .call-preview-row {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    vertical-align: middle;
  }

  .call-preview-icon {
    width: 14px;
    height: 14px;
    display: block;
    flex-shrink: 0;
  }

  .call-preview-icon.missed,
  .call-preview-row.missed .call-preview-text {
    color: var(--negative-primary, #ce4257);
  }

  :global([data-theme="light"]) .call-preview-icon.missed,
  :global([data-theme="light"]) .call-preview-row.missed .call-preview-text {
    color: #ff303c;
  }

  .bot-open-btn {
    background-color: var(--accent-subtle, rgba(36, 139, 254, 0.12));
    color: var(--accent-primary, #248bfe);
    border: none;
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 13px;
    line-height: 18px;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 8px;
    transition: background-color 0.15s ease;
  }

  .bot-open-btn:hover {
    background-color: var(--accent-subtle-hover, rgba(36, 139, 254, 0.22));
  }

  .badge {
    background-color: var(--badge-unread, #3b82f6);
    color: #ffffff;
    font-size: 12px;
    font-feature-settings: "tnum";
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
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
    background-color: #4b4b56 !important;
    color: #e5e7eb !important;
  }

  .bot-badge-icon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .draft-prefix {
    color: var(--negative-primary, #ce4257);
    margin-right: 6px;
    font-size: 14px;
    font-weight: var(--font-weight-medium, 500);
  }

  :global([data-theme="light"]) .draft-prefix {
    color: #ff303c;
  }

  .draft-text {
    color: var(--text-primary, #ffffff);
    opacity: 0.85;
  }

  .empty-saved-desc {
    color: var(--text-muted, #8b929e);
    font-size: 14px;
  }

  .typing-preview {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent-primary, #248bfe);
    font-size: 14px;
    line-height: 18px;
    min-width: 0;
  }

  .typing-dots {
    display: inline-flex;
    align-items: center;
    gap: 2.5px;
    height: 14px;
    margin-top: 2px;
  }

  .typing-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: var(--accent-primary, #248bfe);
    animation: typing-bounce 1.2s infinite ease-in-out both;
  }

  .typing-dot:nth-child(1) {
    animation-delay: -0.32s;
  }
  .typing-dot:nth-child(2) {
    animation-delay: -0.16s;
  }
  .typing-dot:nth-child(3) {
    animation-delay: 0s;
  }

  @keyframes typing-bounce {
    0%, 80%, 100% {
      transform: scale(0.6);
      opacity: 0.4;
    }
    40% {
      transform: scale(1.15);
      opacity: 1;
    }
  }

  .typing-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notification-stack {
    display: inline-flex;
    align-items: center;
    margin-left: 8px;
    flex-shrink: 0;
  }

  .stack-badge {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    margin-right: -4px;
    z-index: 2;
    flex-shrink: 0;
  }

  .mention-badge {
    background-color: var(--accent-primary, #248bfe);
    font-size: 11px;
    font-weight: var(--font-weight-bold, 700);
    line-height: 1;
  }

  .reaction-badge {
    background-color: var(--negative-primary, #ce4257);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  :global([data-theme="light"]) .reaction-badge {
    background-color: #ff303c;
  }

  .stack-badge.muted {
    background-color: #3d4649 !important;
    color: #8b929e !important;
  }

  .badge.stacked {
    margin-left: 0;
    z-index: 1;
  }
</style>
