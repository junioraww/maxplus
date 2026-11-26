<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { openPath } from "@tauri-apps/plugin-opener";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { getContact } from "$lib/utils/caching";
  import Session, { openChat, openProfile } from "$lib/stores/session";
  import { getAttachText, getSystemText } from "$lib/utils/attachs";
  import { scrollTo } from "$lib/utils/scroll";
  import MessagePreview from "$components/main/MessagePreview.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import Reactions from "$components/ChatWindow/Reactions.svelte";
  import Attachments from "$components/ChatWindow/Attachments.svelte";
  import InlineKeyboard from "$components/ChatWindow/InlineKeyboard.svelte";
  import StickerMedia from "$components/ChatWindow/Stickers/StickerMedia.svelte";
  import FormattedText from "$components/ChatWindow/FormattedText.svelte";
  import { transcriptions, toggleTranscriptionExpanded } from "$lib/stores/transcription";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import { CryptoPluginRegistry } from "$lib/crypto/plugins";
  import PluginMessageCard from "$components/plugins/PluginMessageCard.svelte";

  const pluginMessageHeaders = getMountStore("message:header");
  const pluginMessageFooters = getMountStore("message:footer");
  const pluginMessageDecorations = getMountStore("message:decoration");

  const dispatch = createEventDispatcher();

  export let msg;
  export let chat;
  export let dropoutActiveAt;
  export let scrollElement;
  export let decoded;
  export let makeVisible = undefined;
  export let isBot = false;
  export let otherReadTime = 0;
  export let selected = false;
  export let selectionMode = false;
  export let isFirstInGroup = true;
  export let isLastInGroup = true;
  export let isConsecutive = false;

  $: isMe = Number(msg.sender) === Number($currentUser);
  $: isFailed = msg.status === "failed" || msg.status === 40;
  $: isSending = !isFailed && (msg.status === "sending" || msg.status === "pending" || msg.status === 0 || msg.sending === true);
  $: isRead = !isSending && !isFailed && (isBot || msg.read === true || msg.status === 3 || msg.status === "read" || (otherReadTime > 0 && otherReadTime >= (msg.time || 0)));
  $: isSystem = Boolean(msg.attaches?.some((x) => x._type === "CONTROL") || msg.type === "SYSTEM");

  $: rawText = decoded ? (decoded.text ?? "") : (msg.text || "");
  $: isE2eDisable = Boolean(rawText && (rawText === "__E2E_DISABLE__" || rawText.includes('"e2e_control":"disable"')));
  $: effectiveText = isE2eDisable ? (isMe ? "<b>Вы отключили сквозное шифрование</b>" : "<b>Собеседник отключил сквозное шифрование</b>") : rawText;
  $: matchedMessageCard = !isE2eDisable ? CryptoPluginRegistry.findMessageCard(effectiveText, msg) : null;
  $: lines = effectiveText ? effectiveText.split("\n") : [];
  $: effectiveAttaches = (() => {
    if (!msg.attaches || !msg.attaches.length) return [];
    if (!decoded?.media) return msg.attaches;
    const media = decoded.media;
    const targetIdx = media.attach_index ?? 0;
    return msg.attaches.map((att, idx) => {
      if (idx === targetIdx) {
        const resolvedType = media.media_type || att._type || "FILE";
        return {
          ...att,
          _type: resolvedType,
          type: resolvedType,
          originalType: media.media_type,
          name: media.name || att.name,
          size: media.size || att.size,
          mime: media.mime || att.mime,
          width: media.width ?? att.width,
          height: media.height ?? att.height,
          duration: media.duration ?? att.duration,
          wave: media.wave ?? att.wave,
          videoType: media.video_type ?? att.videoType,
          color: media.color || null,
          isEncryptedMedia: true,
          encryptedAttach: att,
          localPath: att.localPath || (isMe ? att.path : null),
        };
      }
      return att;
    });
  })();
  $: transcription = $transcriptions[String(msg?.id)];

  // Sender details for group header
  $: cachedSenderContact = msg.sender ? getContact(msg.sender) : null;
  $: senderContact = cachedSenderContact ? $cachedSenderContact : null;
  $: senderAuthorName = (() => {
    if (isMe) return "Вы";
    if (senderContact?.names?.[0]?.firstName) {
      return `${senderContact.names[0].firstName} ${senderContact.names[0].lastName || ""}`.trim();
    }
    if (senderContact?.name) return senderContact.name;
    if (msg.senderName) return msg.senderName;
    if (msg.sender) return String(msg.sender);
    return "Пользователь";
  })();
  $: authorColorIdx = (() => {
    if (senderAuthorName === "лис" || senderAuthorName?.toLowerCase() === "лис") return 3; // #78b1f5 (Max sky blue)
    const num = Number(msg.sender);
    if (!isNaN(num) && num > 0) return Math.abs(num) % 5;
    let h = 0;
    const str = String(senderAuthorName || msg.sender || "");
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 5;
  })();

  // Group roles
  $: isGroupChat = chat?.type === "CHAT" || chat?.type === "GROUP";
  $: isOwner = isGroupChat && (Number(msg.sender) === Number(chat?.owner || chat?.ownerId));
  $: isAdmin = isGroupChat && !isOwner && Boolean(chat?.admins?.some((a) => Number(a) === Number(msg.sender)));
  $: roleLabel = isOwner ? "владелец" : (isAdmin ? "админ" : (chat?.participantRoles?.[msg.sender] || null));
  $: showGroupHeader = isGroupChat && !isMe && !isSystem && isFirstInGroup;

  // Channel details
  $: isChannel = chat?.type === "CHANNEL";
  $: channelCommentsCount = msg.commentsCounter ?? msg.stats?.commentsCount ?? (Array.isArray(msg.comments) ? msg.comments.length : 0);
  $: hasChannelComments = isChannel && (
    msg.commentsCounter != null ||
    msg.stats?.commentsCount != null ||
    (Array.isArray(msg.comments) && msg.comments.length > 0) ||
    chat?.linkedChatId != null ||
    chat?.options?.COMMENTS_ENABLED === true ||
    chat?.options?.commentsEnabled === true
  );

  function handleMediaClick(attach, originEl = null) {
    dispatch("openMedia", { attach, originEl });
  }

  function handleForwardHeaderClick() {
    if (msg.link?.chatId != null) {
      return openChat(msg.link.chatId, msg.link.message?.id || msg.link.messageId);
    }
  }

  function getFile(fileId) {
    return $API.getFileById(chat.id, msg.id, fileId);
  }

  async function openReply(e) {
    if (!linkedMsg?.id) return;
    if (makeVisible) {
      await makeVisible(linkedMsg.id);
    }

    const target = document.getElementById("m-" + linkedMsg.id);
    if (!target || !scrollElement) return;

    const highlight = document.createElement("div");
    highlight.className = "msg-highlight";

    target.style.position = "relative";
    target.appendChild(highlight);

    scrollTo(scrollElement, target, {
      smooth: true,
      onComplete: () => {
        setTimeout(() => {
          highlight.remove();
        }, 1000);
      },
    });
  }

  $: linkedMsg = (() => {
    if (msg.link) {
      if (msg.link.message) return msg.link.message;
      if (msg.link.messageId) {
        return {
          id: msg.link.messageId,
          text: msg.link.text || "",
          sender: msg.link.senderId || msg.link.sender,
          time: msg.link.time,
          attaches: msg.link.attaches || [],
        };
      }
    }
    if (isSystem) {
      return msg.attaches?.find((x) => x._type === "CONTROL")?.pinnedMessage;
    }
    return undefined;
  })();

  $: linkedType = msg.link ? msg.link.type : "REPLY";
  $: forwardLines = linkedMsg?.text?.split("\n");

  $: isReplyToMe = Number(linkedMsg?.sender) === Number($currentUser);
  $: cachedLinkedContact = linkedMsg?.sender ? getContact(linkedMsg.sender) : null;
  $: linkedMsgContact = cachedLinkedContact ? $cachedLinkedContact : null;
  $: replyAuthorName = isReplyToMe
    ? "Вы"
    : (linkedMsgContact?.names?.[0]?.firstName || linkedMsgContact?.names?.[0]?.first_name || (linkedMsg?.sender ? String(linkedMsg.sender) : "?"));

  $: isForwardFromMe = Number(linkedMsg?.sender) === Number($currentUser);
  $: cachedForwardContact = linkedMsg?.sender ? getContact(linkedMsg.sender) : null;
  $: forwardContact = cachedForwardContact ? $cachedForwardContact : null;
  $: forwardChatStore = msg.link?.chatId != null ? getChat(msg.link.chatId).chatInfo : null;
  $: forwardChat = forwardChatStore ? $forwardChatStore : null;
  $: isForwardChannel = linkedMsg?.type === "CHANNEL" || forwardChat?.type === "CHANNEL" || (Boolean(msg.link?.chatName) && !linkedMsg?.sender);

  $: forwardAuthorName = (() => {
    if (isForwardChannel) {
      return msg.link?.chatName || forwardChat?.title || "Канал";
    }
    if (isForwardFromMe) {
      if ($currentUserDetails?.names?.[0]?.firstName) {
        return `${$currentUserDetails.names[0].firstName} ${$currentUserDetails.names[0].lastName || ""}`.trim();
      }
      return $currentUserDetails?.name || "Вы";
    }
    if (forwardContact?.names?.[0]?.firstName) {
      return `${forwardContact.names[0].firstName} ${forwardContact.names[0].lastName || ""}`.trim();
    }
    if (forwardContact?.name) return forwardContact.name;
    if (msg.link?.chatName) return msg.link.chatName;
    if (forwardChat?.title) return forwardChat.title;
    if (linkedMsg?.sender) return String(linkedMsg.sender);
    return "Пользователь";
  })();

  $: forwardAvatarUrl = (() => {
    if (msg.link?.chatIconUrl) return msg.link.chatIconUrl;
    if (isForwardChannel && forwardChat) {
      return forwardChat.avatar || forwardChat.baseIconUrl || forwardChat.iconUrl || forwardChat.baseUrl;
    }
    if (isForwardFromMe && $currentUserDetails) {
      return $currentUserDetails.avatar || $currentUserDetails.baseUrl;
    }
    if (forwardContact) {
      return forwardContact.baseUrl || forwardContact.baseRawUrl;
    }
    if (forwardChat) {
      return forwardChat.baseIconUrl || forwardChat.baseUrl || forwardChat.iconUrl;
    }
    return null;
  })();

  $: hasBlocks = Boolean(
    linkedMsg ||
    effectiveAttaches?.length ||
    msg.reactionInfo?.totalCount ||
    msg.deleted ||
    lines.length > 1 ||
    (effectiveText && effectiveText.length > 30) ||
    isChannel
  );
  $: isInlineRow = !hasBlocks && Boolean(effectiveText);

  $: showAvatar =
    isGroupChat &&
    !isMe &&
    !isSystem &&
    isFirstInGroup;

  $: inlineKeyboardAttach = effectiveAttaches?.find((x) => x._type === "INLINE_KEYBOARD");
  $: stickerAttach = effectiveAttaches?.find((x) => x._type === "STICKER");
  $: isStickerOnly = stickerAttach && (!lines || lines.length === 0 || (lines.length === 1 && !lines[0]?.trim())) && (!effectiveAttaches || effectiveAttaches.length === 1) && !linkedMsg;
  $: isVideoNoteOnly = effectiveAttaches?.some((x) => x._type === "VIDEO" && x.videoType === 1) && (!lines || lines.length === 0 || (lines.length === 1 && !lines[0]?.trim())) && (!effectiveAttaches || effectiveAttaches.length === 1) && !linkedMsg;
  $: isPollOnly = effectiveAttaches?.some((x) => (x._type || x.type) === "POLL") && (!lines || lines.length === 0 || (lines.length === 1 && !lines[0]?.trim())) && effectiveAttaches.length === 1 && !linkedMsg;
  $: isMediaOnly = !isSystem && !isStickerOnly && !isVideoNoteOnly && !isPollOnly && !effectiveText?.trim() && !linkedMsg && !msg.deleted && !msg.reactionInfo?.totalCount && !inlineKeyboardAttach && effectiveAttaches?.length > 0 && effectiveAttaches.every((x) => {
    const t = x._type || x.type;
    return t === "PHOTO" || (t === "VIDEO" && x.videoType !== 1 && !x.isNote);
  });

  let pressTimer = null;
  let isLongPress = false;
  let startX = 0;
  let startY = 0;

  function handleTouchStart(e) {
    if (e.target.closest("button, a, .rich-link, .link-dropout-card, .dropout-backdrop, input, textarea, .avatar-msg-btn, .poll-container")) return;
    const touch = e.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
    isLongPress = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      isLongPress = true;
      dispatch("longpress", { msg, clientX: startX, clientY: startY, target: e.target });
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 450);
  }

  function handleTouchMove(e) {
    if (!pressTimer) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
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

  function handleContextMenu(e) {
    if (e.target.closest("input, textarea, a, .rich-link, .link-dropout-card, .dropout-backdrop, .poll-container")) return;
    e.preventDefault();
    dispatch("contextmenu", { msg, e });
  }

  function handleClick(e) {
    if (isLongPress) {
      e.stopPropagation();
      e.preventDefault();
      setTimeout(() => {
        isLongPress = false;
      }, 400);
      return;
    }
    if (selectionMode) {
      e.stopPropagation();
      dispatch("toggleSelect", { id: msg.id });
      return;
    }
    if (e.target.closest("button, a, .rich-link, .link-dropout-card, .dropout-backdrop, input, textarea, .avatar-msg-btn, .author-header-btn, .media-download-badge, .voice-play-btn, .edited-badge, .sticker-wrapper, .poll-container, .poll-result-bar, .poll-option-btn, .poll-cancel-btn")) return;
    const windowSel = typeof window !== "undefined" ? window.getSelection() : null;
    if (windowSel && !windowSel.isCollapsed && windowSel.toString().trim()) return;
    dispatch("messageClick", { msg, e });
  }

  function handleSystemClick(e) {
    const userLink = e.target.closest(".user-link");
    if (userLink && userLink.dataset.userId) {
      e.stopPropagation();
      openProfile({ userId: Number(userLink.dataset.userId) });
      return;
    }
    const control = msg.attaches?.find((x) => x._type === "CONTROL");
    const pinId = control?.pinnedMessage?.id || control?.messageId || control?.pinnedMessageId;
    if (pinId && makeVisible) {
      e.stopPropagation();
      makeVisible(pinId);
    }
  }

  function formatCommentsLabel(count) {
    if (!count || count <= 0) return "Обсудить";
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${count} комментариев`;
    if (mod10 === 1) return `${count} комментарий`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} комментария`;
    return `${count} комментариев`;
  }
</script>

{#if isSystem}
  <div
    class="message-system-row"
    class:inactive={dropoutActiveAt && dropoutActiveAt?.msg?.id !== msg.id}
    on:click={handleSystemClick}
    on:contextmenu={handleContextMenu}
  >
    <div class="message-system-pill">
      {@html getSystemText(msg) || (msg.text ? msg.text : "")}
    </div>
  </div>
{:else}
  <div
    class="message-row"
    class:is-me={isMe}
    class:is-consecutive={isConsecutive}
    class:is-deleted={msg.deleted}
    class:is-sticker={isStickerOnly}
    class:is-video-note={isVideoNoteOnly}
    class:is-poll={isPollOnly}
    class:is-channel={isChannel}
    class:is-selected={selected}
    class:selection-active={selectionMode}
    class:inactive={dropoutActiveAt && dropoutActiveAt?.msg?.id !== msg.id}
    on:dragstart|preventDefault
    on:touchstart|passive={handleTouchStart}
    on:touchmove|passive={handleTouchMove}
    on:touchend={handleTouchEnd}
    on:contextmenu={handleContextMenu}
    on:click={handleClick}
  >
    {#if selectionMode}
      <div class="selection-checkbox" class:is-checked={selected}>
        {#if selected}
          <svg viewBox="0 0 16 16" class="selection-check-icon">
            <path d="M13.5 4.5L6.5 11.5L2.5 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        {/if}
      </div>
    {/if}

    <div class="indent" class:is-grouped-indent={isGroupChat && !isMe && !isSystem}>
      {#if showAvatar}
        <button
          type="button"
          class="avatar-msg-btn"
          on:mousedown|stopPropagation
          on:mouseup|stopPropagation
          on:touchend|stopPropagation
          on:click|stopPropagation={() => {
            if (msg.sender) {
              openProfile({ userId: Number(msg.sender) });
            }
          }}
        >
          <Avatar size={32} contactId={msg.sender} style="chat" showOnline={false} allowStories={false} />
        </button>
      {/if}
    </div>

    <div class="message-bubble-container">
      {#each $pluginMessageHeaders as item (item.id)}
        <div class="plugin-mount-block plugin-message-header" data-plugin-mount={item.pluginId || item.id}>
          {@html item.html}
        </div>
      {/each}
      {#each $pluginMessageDecorations as item (item.id)}
        <div class="plugin-mount-inline plugin-message-decoration" data-plugin-mount={item.pluginId || item.id}>
          {@html item.html}
        </div>
      {/each}

      {#if isStickerOnly}
        <div class="message-bubble sticker-bubble">
          <div class="sticker-wrapper" on:click|stopPropagation={() => dispatch("openStickerPack", { sticker: stickerAttach })}>
            <StickerMedia
              url={stickerAttach.baseUrl || stickerAttach.url}
              lottieUrl={stickerAttach.lottieUrl}
              size={160}
              autoplay={true}
              loop={true}
            />
            <div class="sticker-floating-meta">
              <span class="timestamp"
                >{new Date(msg.time).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}</span
              >
              {#if isMe}
                <div class="status-ticks">
                  {#if isFailed}
                    <button
                      type="button"
                      class="failed-status-btn"
                      title={msg.error || "Ошибка отправки"}
                      on:click|stopPropagation={() => dispatch("failedClick", msg)}
                    >
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/warning.svg'); mask-image: url('/icons/warning.svg'); width: 14px; height: 14px;"></span>
                    </button>
                  {:else if isSending}
                    <svg class="status-icon is-sending" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
                      <polyline points="8,4.5 8,8 10.5,9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {:else if isRead}
                    <svg class="status-icon is-read" viewBox="0 0 20 12">
                      <path fill="currentColor" d="M4.5 10.5L0 6l1.4-1.4L4.5 7.7 12.6 0l1.4 1.4z" />
                      <path fill="currentColor" d="M9.5 10.5L5 6l1.4-1.4L9.5 7.7 17.6 0l1.4 1.4z" />
                    </svg>
                  {:else}
                    <svg class="status-icon is-sent" viewBox="0 0 16 12">
                      <path fill="currentColor" d="M5.5 10.5L1 6l1.4-1.4L5.5 7.7 13.6 0l1.4 1.4z" />
                    </svg>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
          {#if msg.reactionInfo?.totalCount}
            <div class="sticker-reactions">
              <Reactions info={msg.reactionInfo} {isMe} msgId={msg.id} on:react={(e) => dispatch("react", e.detail)} />
            </div>
          {/if}
        </div>
      {:else}
        <div class="bubble-and-share" class:is-channel={isChannel}>
        <div class="message-bubble" class:is-row={isInlineRow} class:is-poll={isPollOnly} class:is-media-only={isMediaOnly} class:is-first-group={isFirstInGroup} class:is-last-group={isLastInGroup}>
          <div class="bubble-content">
            {#if showGroupHeader}
              <div class="author-header">
                <button
                  type="button"
                  class="author-header-btn"
                  style="color: var(--msg-author-color-{authorColorIdx}, #5daaff);"
                  on:click|stopPropagation={() => {
                    if (msg.sender) openProfile({ userId: Number(msg.sender) });
                  }}
                >
                  <span class="author-name">{senderAuthorName}</span>
                </button>
                {#if roleLabel}
                  <span class="role-badge">{roleLabel}</span>
                {/if}
              </div>
            {/if}

            {#if linkedMsg}
              {#if linkedType === "FORWARD"}
                <div class="forward-block">
                  <div
                    class="forward-header"
                    on:click|stopPropagation={handleForwardHeaderClick}
                  >
                    <span class="forward-label">{isForwardChannel ? "Переслано из канала:" : "Переслано:"}</span>
                    <div class="forward-author-row">
                      <div class="forward-avatar-placeholder">
                        <Avatar
                          contactId={isForwardChannel ? null : (isForwardFromMe ? Number($currentUser) : (linkedMsg?.sender ? Number(linkedMsg.sender) : null))}
                          chat={isForwardChannel ? (forwardChat || { title: forwardAuthorName }) : forwardChat}
                          src={forwardAvatarUrl}
                          title={forwardAuthorName}
                          size={18}
                        />
                      </div>
                      <span class="forward-name">{forwardAuthorName}</span>
                    </div>
                  </div>

                  {#if linkedMsg.text}
                    <div class="forward-content">
                      <FormattedText text={linkedMsg.text} elements={linkedMsg.elements || []} />
                    </div>
                  {/if}

                  {#if linkedMsg.attaches}
                    <Attachments
                      {getFile}
                      attaches={linkedMsg.attaches}
                      {handleMediaClick}
                      chatId={linkedMsg.chatId || chat?.id}
                      messageId={linkedMsg.id}
                    />
                  {/if}
                </div>
              {:else if linkedType === "REPLY"}
                <div on:click|stopPropagation={openReply} class="reply-block">
                  <div class="reply-content">
                    <p class="line allow-selection">
                      <b class="reply-author-name">{replyAuthorName}</b>
                      <MessagePreview {chat} msg={linkedMsg} cut={true} />
                    </p>
                  </div>
                </div>
              {/if}
            {/if}

            {#if msg.deleted}
              <div class="deleted-notice">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
                <span>Сообщение удалено</span>
                {#if msg.deleted_at || msg.deletedAt}
                  <span class="deleted-notice-time">({new Date(msg.deleted_at || msg.deletedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false })})</span>
                {/if}
              </div>
            {/if}

            {#if matchedMessageCard}
              <PluginMessageCard
                handler={matchedMessageCard.handler}
                text={effectiveText}
                {msg}
                {chat}
                {isMe}
              />
            {:else if decoded?.error || effectiveText.includes('<b style="color:#f66">')}
              {#each lines as line}
                <p class="line crypto-error">{@html line}</p>
              {/each}
            {:else if isE2eDisable || decoded?.is_handshake_request || decoded?.is_handshake_accept || (typeof effectiveText === "string" && /<\/?(b|i|u|s|span|div|p|a|code|strong|em)(\s+[^>]*)?>/i.test(effectiveText))}
              {#each lines as line}
                <p class="line">{@html line}</p>
              {/each}
            {:else if effectiveText}
              <FormattedText
                text={effectiveText}
                elements={msg.elements || []}
                deleted={msg.deleted}
                {isSystem}
              />
            {/if}

            {#if effectiveAttaches?.length}
              <Attachments
                {getFile}
                attaches={effectiveAttaches}
                {handleMediaClick}
                chatId={msg?.chatId ?? chat?.id}
                messageId={msg?.id}
                {isMe}
                mediaOnly={isMediaOnly}
              />
            {/if}
          </div>

          <div class="message-footer" class:is-floating-pill={isMediaOnly}>
            {#if msg.reactionInfo?.totalCount}
              <Reactions info={msg.reactionInfo} {isMe} msgId={msg.id} on:react={(e) => dispatch("react", e.detail)} />
            {/if}

            <div class="message-status">
              {#if msg.stats?.views}
                <span class="views">
                  <svg viewBox="0 0 24 24" class="views-icon"
                    ><path
                      d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"
                    /></svg
                  >
                  {msg.stats.views}
                </span>
              {/if}
              {#if msg.deleted}
                <span class="deleted-badge" title="Удалено">удалено</span>
              {:else if msg.edited || msg.status === 'EDITED' || (Array.isArray(msg.history) && msg.history.length > 0)}
                <button
                  type="button"
                  class="edited-badge"
                  title="История изменений"
                  on:click|stopPropagation={() => dispatch('openHistory', { msg })}
                >
                  изм.
                </button>
              {/if}
              {#if decoded?.obf && !isE2eDisable}
                <span class="obf-type" title="Шифрование: {decoded.obf}">{decoded.obf}</span>
              {/if}
              <span class="timestamp"
                >{new Date(msg.time).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}</span
              >
              {#if isMe}
                <span class="status-ticks">
                  {#if isFailed}
                    <button
                      type="button"
                      class="failed-status-btn"
                      title={msg.error || "Ошибка отправки"}
                      on:click|stopPropagation={() => dispatch("failedClick", msg)}
                    >
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/warning.svg'); mask-image: url('/icons/warning.svg'); width: 14px; height: 14px;"></span>
                    </button>
                  {:else if isSending}
                    <svg class="status-icon is-sending" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
                      <polyline points="8,4.5 8,8 10.5,9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  {:else if isRead}
                    <svg class="status-icon is-read" viewBox="0 0 20 12">
                      <path fill="currentColor" d="M4.5 10.5L0 6l1.4-1.4L4.5 7.7 12.6 0l1.4 1.4z" />
                      <path fill="currentColor" d="M9.5 10.5L5 6l1.4-1.4L9.5 7.7 17.6 0l1.4 1.4z" />
                    </svg>
                  {:else}
                    <svg class="status-icon is-sent" viewBox="0 0 16 12">
                      <path fill="currentColor" d="M5.5 10.5L1 6l1.4-1.4L5.5 7.7 13.6 0l1.4 1.4z" />
                    </svg>
                  {/if}
                </span>
              {/if}
            </div>
          </div>
        </div>

        {#if isChannel}
          <button
            type="button"
            class="channel-share-btn"
            title="Поделиться"
            aria-label="Поделиться"
            on:click|stopPropagation={() => dispatch("forward", { msg })}
          >
            <svg viewBox="0 0 24 24" class="channel-btn-icon" width="16" height="16">
              <path fill="currentColor" d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/>
            </svg>
          </button>
        {/if}
        </div>

        {#if hasChannelComments}
          <div class="channel-action-bar">
            <button
              type="button"
              class="channel-comments-btn"
              on:click|stopPropagation={() => dispatch("openComments", { msg })}
            >
              <svg viewBox="0 0 24 24" class="channel-btn-icon" width="16" height="16">
                <path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
              </svg>
              <span>{formatCommentsLabel(channelCommentsCount)}</span>
              <svg viewBox="0 0 24 24" class="channel-comments-arrow" width="14" height="14">
                <path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
              </svg>
            </button>
          </div>
        {/if}
      {/if}

      {#each $pluginMessageFooters as item (item.id)}
        <div class="plugin-mount-block plugin-message-footer" data-plugin-mount={item.pluginId || item.id}>
          {@html item.html}
        </div>
      {/each}

      {#if transcription && transcription.expanded}
        <div class="transcription-card" class:is-me={isMe}>
          <div class="transcription-header">
            <div class="transcription-title">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
              </svg>
              <span>Транскрипция</span>
            </div>
            <button
              type="button"
              class="transcription-close-btn"
              on:click|stopPropagation={() => toggleTranscriptionExpanded(msg.id)}
              title="Скрыть"
            >✕</button>
          </div>
          {#if transcription.status === 'loading'}
            <div class="transcription-loading">
              <div class="transcription-spinner"></div>
              <span>Распознавание речи...</span>
            </div>
          {:else}
            <div class="transcription-text">{transcription.text}</div>
          {/if}
        </div>
      {/if}

      {#if inlineKeyboardAttach}
        <div class="inline-keyboard-wrap" class:has-side-share={isChannel && !isSystem && !isStickerOnly}>
          <InlineKeyboard {chat} {msg} attach={inlineKeyboardAttach} />
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* System message pill */
  .message-system-row {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    margin: 4px 0;
    user-select: text;
    -webkit-user-select: text;
    transition: opacity 0.2s;
  }

  .message-system-row.inactive {
    opacity: 0.5;
  }

  .message-system-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 22px;
    padding: var(--msg-system-padding, 2px 10px);
    border-radius: var(--msg-system-radius, 11px);
    background: var(--msg-system-bg, rgba(40, 44, 66, 0.70));
    color: var(--msg-system-text, #ffffff);
    font-size: var(--msg-system-font-size, 12px);
    font-weight: 400;
    line-height: 1.2;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    max-width: min(280px, 90%);
    word-break: break-word;
    cursor: default;
    box-sizing: border-box;
    white-space: pre-wrap;
  }

  .message-system-pill :global(.user-link) {
    display: inline;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    font-weight: 500;
    margin-right: 0.28em;
    transition: opacity 0.15s ease;
  }

  .message-system-pill :global(.user-link:hover) {
    opacity: 0.85;
  }

  /* Standard message row */
  .message-row {
    display: flex;
    align-items: flex-end;
    width: 100%;
    transition: opacity 0.2s, background-color 0.15s ease;
    border-radius: 4px;
    padding: 3px 6px;
    box-sizing: border-box;
  }

  .message-row.is-consecutive {
    padding: 1px 6px;
  }

  .message-row.selection-active,
  .message-row.selection-active * {
    cursor: pointer;
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-user-drag: none !important;
  }

  .message-row.is-selected {
    background: var(--msg-selection-bg, rgba(56, 189, 248, 0.14));
  }

  .message-row.inactive {
    opacity: 0.5;
  }

  /* Selection checkbox */
  .selection-checkbox {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--msg-selection-checkbox-border, rgba(255, 255, 255, 0.4));
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 8px;
    margin-right: 4px;
    flex-shrink: 0;
    align-self: center;
    box-sizing: border-box;
    transition: all 0.15s ease;
  }

  .selection-checkbox.is-checked {
    background: var(--msg-selection-checkbox-active, #38bdf8);
    border-color: var(--msg-selection-checkbox-active, #38bdf8);
  }

  .selection-check-icon {
    width: 12px;
    height: 12px;
    color: #ffffff;
  }

  .indent {
    margin: 0 6px 0 0;
    flex-shrink: 0;
    width: 32px;
  }

  .indent.is-grouped-indent {
    width: 32px;
    min-height: 1px;
    display: block !important;
  }

  .indent:empty:not(.is-grouped-indent) {
    display: none;
  }

  .message-row:not(.is-me) .indent:empty:not(.is-grouped-indent) + .message-bubble-container {
    margin-left: 6px;
  }

  .message-row.is-me .indent {
    display: none;
  }

  .message-bubble-container {
    display: flex;
    flex-direction: column;
    max-width: min(520px, 78%);
    min-width: 60px;
    margin-right: 0;
    position: relative;
    width: fit-content;
  }

  /* Incoming alignment */
  .message-row:not(.is-me) {
    justify-content: flex-start;
  }

  .message-row:not(.is-me) .message-bubble-container {
    align-items: flex-start;
  }

  /* Outgoing alignment: ALWAYS on the right, mobile and desktop */
  .message-row.is-me {
    justify-content: flex-end;
  }

  .message-row.is-me .message-bubble-container {
    align-items: flex-end;
    margin-right: 0;
    margin-left: auto;
  }

  /* Channel alignment */
  .message-row.is-channel {
    justify-content: flex-start;
  }

  .message-row.is-channel .indent {
    display: none;
  }

  .message-row.is-channel .message-bubble-container {
    align-items: flex-start;
    margin-left: 14px;
    max-width: min(640px, 90%);
  }

  /* Message bubble styling: pure rounded corners, no broken SVG pseudo-tails */
  .message-bubble {
    color: var(--msg-bubble-in-text, #ffffff);
    background: var(--msg-bubble-in-bg, #373a4e);
    padding: 8px 10px;
    border-radius: var(--msg-bubble-radius, 16px);
    border-bottom-left-radius: 4px;
    min-width: 60px;
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
    font-size: 15px;
    position: relative;
    user-select: text;
    -webkit-user-select: text;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .message-bubble:not(.is-first-group) {
    border-top-left-radius: 6px;
  }

  .message-bubble:not(.is-last-group) {
    border-bottom-left-radius: 6px;
  }

  .message-row.is-me .message-bubble {
    color: var(--msg-bubble-out-text, #ffffff);
    background: var(--msg-bubble-out-bg, linear-gradient(135deg, #4f6cf7 0%, #894df8 52%, #b57dfa 100%));
    border-radius: var(--msg-bubble-radius, 16px);
    border-bottom-right-radius: 4px;
    border-bottom-left-radius: var(--msg-bubble-radius, 16px);
  }

  .message-row.is-me .message-bubble:not(.is-first-group) {
    border-top-right-radius: 6px;
    border-top-left-radius: var(--msg-bubble-radius, 16px);
  }

  .message-row.is-me .message-bubble:not(.is-last-group) {
    border-bottom-right-radius: 6px;
    border-bottom-left-radius: var(--msg-bubble-radius, 16px);
  }

  .message-row.is-channel .message-bubble {
    border-radius: var(--msg-bubble-radius, 16px);
  }

  .message-bubble.is-row {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    width: fit-content;
  }

  .bubble-content {
    min-width: 0;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
    width: 100%;
  }

  .message-bubble.is-row .bubble-content {
    width: auto;
  }

  /* Group author header */
  .author-header {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    width: fit-content;
    max-width: 100%;
    margin-bottom: 2px;
  }

  .author-header-btn {
    display: inline-flex;
    align-items: baseline;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.25;
    text-align: left;
    min-width: 0;
    transition: opacity 0.15s ease;
  }

  .author-header-btn:hover {
    opacity: 0.85;
    text-decoration: underline;
  }

  .author-name {
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }

  .role-badge {
    font-size: 13px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.52);
    text-transform: lowercase;
    line-height: 1.25;
    background: transparent;
    border: none;
    padding: 0;
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* Forward block (matches MAX-decompiled clean forwarded header) */
  .forward-block {
    padding: 0;
    margin-bottom: 2px;
    width: 100%;
    box-sizing: border-box;
  }

  .forward-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    cursor: pointer;
    margin-bottom: 4px;
  }

  .forward-author-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
  }

  .forward-avatar-placeholder {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
  }

  .forward-label {
    font-size: 12px;
    opacity: 0.78;
    color: inherit;
    line-height: 1.2;
  }

  .forward-name {
    font-weight: 600;
    color: inherit;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Reply block */
  .reply-block {
    border-left: 3px solid var(--msg-quote-border, #38bdf8);
    padding: 4px 8px;
    margin-bottom: 6px;
    border-radius: 4px 8px 8px 4px;
    font-size: 12px;
    background: var(--msg-quote-bg, rgba(255, 255, 255, 0.06));
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
  }

  .reply-author-name {
    color: var(--msg-quote-border, #38bdf8);
  }

  .message-row.is-me .forward-block,
  .message-row.is-me .reply-block {
    border-left-color: rgba(255, 255, 255, 0.85);
    background: rgba(255, 255, 255, 0.14);
  }

  .message-row.is-me .forward-name,
  .message-row.is-me .reply-author-name {
    color: #ffffff;
  }

  .reply-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Channel Action Bar (Comments + Side Share Button) */
  .bubble-and-share {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    max-width: 100%;
  }

  .inline-keyboard-wrap {
    width: 100%;
    box-sizing: border-box;
  }

  .inline-keyboard-wrap.has-side-share {
    padding-right: 36px;
  }

  .channel-action-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    width: 100%;
  }

  .channel-comments-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--msg-bubble-in-bg, #2b2e3e);
    border: none;
    border-radius: 12px;
    padding: 6px 12px;
    color: var(--msg-views-color, rgba(255, 255, 255, 0.75));
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .channel-comments-btn:hover {
    opacity: 0.9;
    background: rgba(255, 255, 255, 0.12);
  }

  .channel-comments-arrow {
    opacity: 0.7;
    margin-left: 2px;
  }

  .channel-share-btn {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--msg-bubble-in-bg, rgba(43, 46, 62, 0.85));
    border: none;
    border-radius: 50%;
    padding: 0;
    color: var(--msg-views-color, rgba(255, 255, 255, 0.85));
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .channel-share-btn:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .channel-share-btn:active {
    transform: scale(0.94);
  }

  .channel-btn-icon {
    flex-shrink: 0;
  }

  /* Message Footer */
  .message-footer {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    margin-top: 3px;
    width: 100%;
    line-height: 1;
  }

  .message-bubble.is-media-only {
    padding: 2px;
    overflow: hidden;
  }

  .message-footer.is-floating-pill {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: auto;
    margin-top: 0;
    padding: 2px 7px;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(4px);
    color: #ffffff;
    z-index: var(--z-base, 1);
    pointer-events: auto;
  }

  .message-footer.is-floating-pill .timestamp,
  .message-footer.is-floating-pill .edited-badge,
  .message-footer.is-floating-pill .views {
    color: rgba(255, 255, 255, 0.92);
  }

  .message-bubble.is-row .message-footer {
    width: auto;
    margin-top: 0;
    margin-left: auto;
    flex-shrink: 0;
    align-self: flex-end;
  }

  .message-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    line-height: 1;
    white-space: nowrap;
    margin-left: auto;
    flex-shrink: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .views {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--msg-views-color, rgba(255, 255, 255, 0.65));
    line-height: 1;
  }

  .views-icon {
    width: 13px;
    height: 13px;
    fill: currentColor;
    display: block;
  }

  .deleted-notice {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #ef4444;
    margin-bottom: 4px;
    font-weight: 500;
  }

  .deleted-notice-time {
    color: rgba(239, 68, 68, 0.7);
    font-size: 10px;
  }

  .deleted-badge {
    font-size: 10px;
    color: #ef4444;
    font-weight: 600;
    line-height: 1;
  }

  .edited-badge {
    background: transparent;
    border: none;
    font-size: 10px;
    line-height: 1;
    color: var(--msg-time-color, rgba(255, 255, 255, 0.6));
    cursor: pointer;
    padding: 0;
    border-radius: 3px;
    transition: color 0.15s ease;
    display: inline-flex;
    align-items: center;
  }

  .edited-badge:hover {
    color: var(--msg-tick-read-color, #38bdf8);
    text-decoration: underline;
  }

  .obf-type {
    font-size: 9px;
    font-weight: 700;
    color: #4ade80;
    line-height: 1;
    display: inline-flex;
    align-items: center;
  }

  .timestamp {
    font-size: 11px;
    line-height: 1;
    color: var(--msg-time-color, rgba(255, 255, 255, 0.65));
    display: inline-block;
  }

  .message-row:not(.is-me) .timestamp {
    color: var(--msg-time-color, #8e93a6);
  }

  .message-row.is-me .timestamp {
    color: rgba(255, 255, 255, 0.7);
  }

  .status-ticks {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    height: 11px;
  }

  .status-icon {
    width: 14px;
    height: 10px;
    display: block;
    fill: currentColor;
    color: rgba(255, 255, 255, 0.8) !important;
  }

  .status-icon.is-sending {
    width: 11px;
    height: 11px;
    color: rgba(255, 255, 255, 0.65) !important;
    stroke: currentColor;
    fill: none;
    display: block;
  }

  .failed-status-btn {
    border: none;
    background: transparent;
    color: #ef4444;
    padding: 0;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    line-height: 1;
  }

  .failed-status-btn .mask-icon {
    display: inline-block;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
  }

  .status-icon.is-sent {
    width: 13px;
    height: 10px;
    color: rgba(255, 255, 255, 0.8) !important;
    fill: currentColor;
    display: block;
  }

  .status-icon.is-read {
    width: 16px;
    height: 10px;
    color: rgba(255, 255, 255, 0.8) !important;
    fill: currentColor;
    display: block;
  }

  .line {
    margin: 0;
    line-height: 1.4;
    word-break: break-word;
    pointer-events: auto;
    user-select: text;
    -webkit-user-select: text;
    cursor: text;
  }

  @keyframes pulseHighlight {
    0% {
      background: rgba(255, 255, 255, 0);
    }
    30% {
      background: rgba(255, 255, 255, 0.12);
    }
    100% {
      background: rgba(255, 255, 255, 0);
    }
  }

  :global(.msg-highlight) {
    position: absolute;
    top: -3px;
    left: 0;
    width: 100%;
    height: calc(100% + 6px);
    pointer-events: none;
    animation: pulseHighlight 1.2s ease-out forwards;
  }

  .message-row.is-sticker .message-bubble-container,
  .message-row.is-video-note .message-bubble-container {
    background: transparent !important;
  }

  .message-row.is-poll .message-bubble-container {
    max-width: min(380px, 92%);
    width: 100%;
  }

  .message-row.is-poll .message-bubble {
    padding: 4px 12px 6px 12px;
    width: 100%;
  }

  .message-row.is-poll :global(.attachments-container) {
    margin-top: 0 !important;
  }

  .message-row.is-poll .bubble-content {
    width: 100%;
  }

  .message-row.is-video-note .message-bubble {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    padding: 0 !important;
  }

  .sticker-bubble {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    padding: 0 !important;
    position: relative;
    cursor: pointer;
    overflow: visible !important;
  }

  .sticker-wrapper {
    position: relative;
    display: inline-flex;
    border-radius: 16px;
    overflow: hidden;
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .sticker-wrapper:hover {
    transform: scale(1.03);
  }

  .sticker-wrapper:active {
    transform: scale(0.97);
  }

  .sticker-floating-meta {
    position: absolute;
    bottom: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.7);
    border-radius: 12px;
    padding: 2px 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    pointer-events: none;
  }

  .sticker-floating-meta .timestamp {
    color: rgba(255, 255, 255, 0.85);
    font-size: 11px;
    font-weight: 500;
  }

  .sticker-floating-meta .status-ticks svg {
    width: 13px;
    height: 10px;
    fill: currentColor;
    color: rgba(255, 255, 255, 0.85);
  }

  .sticker-floating-meta .status-ticks svg.is-sending {
    width: 12px;
    height: 12px;
    stroke: currentColor;
    fill: none;
  }

  .sticker-floating-meta .status-ticks svg.is-read {
    width: 16px;
    color: var(--msg-tick-read-color, #38bdf8);
    fill: currentColor;
  }

  .sticker-reactions {
    margin-top: 4px;
  }

  .avatar-msg-btn {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }

  .avatar-msg-btn:hover {
    opacity: 0.85;
    transform: scale(1.06);
  }

  .avatar-msg-btn:active {
    transform: scale(0.95);
  }

  .transcription-card {
    margin-top: 4px;
    max-width: 380px;
    background: rgba(30, 41, 59, 0.98);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 12px;
    padding: 8px 12px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    user-select: text;
  }

  .transcription-card.is-me {
    border-color: rgba(56, 189, 248, 0.4);
  }

  .transcription-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #38bdf8;
  }

  .transcription-title {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .transcription-close-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .transcription-close-btn:hover {
    color: white;
    background: rgba(255, 255, 255, 0.1);
  }

  .transcription-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.65);
    font-style: italic;
    padding: 4px 0;
  }

  .transcription-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(56, 189, 248, 0.25);
    border-top-color: #38bdf8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .transcription-text {
    font-size: 13px;
    line-height: 1.45;
    color: rgba(255, 255, 255, 0.92);
    word-break: break-word;
    white-space: pre-wrap;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media screen and (max-width: 500px) {
    .message-bubble-container {
      max-width: 86%;
    }
  }
</style>