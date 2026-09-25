<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { openPath } from "@tauri-apps/plugin-opener";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { getContact } from "$lib/utils/caching";
  import Session, { openChat } from "$lib/stores/session";
  import {
    getAttachText, getSystemText
  } from "$lib/utils/attachs";
  import { scrollTo } from '$lib/utils/scroll';
  import MessagePreview from "$components/main/MessagePreview.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import Reactions from "$components/ChatWindow/Reactions.svelte";
  import Attachments from "$components/ChatWindow/Attachments.svelte";
  import InlineKeyboard from "$components/ChatWindow/InlineKeyboard.svelte";
  import StickerMedia from "$components/ChatWindow/Stickers/StickerMedia.svelte";
  import { transcriptions, toggleTranscriptionExpanded } from "$lib/stores/transcription";

  const dispatch = createEventDispatcher();

  export let msg;
  export let chat;
  export let dropoutActiveAt;
  export let scrollElement;
  export let decoded;
  export let makeVisible;
  export let otherReadTime = 0;

  $: isMe = Number(msg.sender) === Number($currentUser);
  $: isSending = msg.status === "sending" || msg.status === "pending" || msg.status === 0 || msg.sending === true;
  $: isRead = !isSending && (msg.read === true || msg.status === 3 || msg.status === "read" || (otherReadTime > 0 && otherReadTime >= (msg.time || 0)));
  $: isSystem = Boolean(msg.attaches?.some((x) => x._type === "CONTROL"));

  $: rawText = decoded ? (decoded.text ?? "") : (msg.text || "");
  $: lines = rawText ? rawText.split("\n") : [];
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

  function handleMediaClick(attach) {
    dispatch("openMedia", { attach });
  }

  function handleForwardHeaderClick() {
    return openChat(msg.link.chatId, msg.link.message.id);
  }

  function getFile(fileId) {
    return $API.getFileById(chat.id, msg.id, fileId);
  }

  async function openReply(e) {
    await makeVisible(linkedMsg.id);

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
      }
    });
  }

  $: linkedMsg = (() => {
    if (msg.link) return msg.link.message;
    if (isSystem) {
      return msg.attaches?.find((x) => x._type === "CONTROL")?.pinnedMessage;
    }
    return undefined;
  })();

  $: linkedType = msg.link ? msg.link.type : "REPLY";
  $: forwardLines = linkedMsg?.text?.split("\n");

  const cachedLinkedContact = linkedMsg && getContact(linkedMsg.sender);
  $: linkedMsgContact = cachedLinkedContact && $cachedLinkedContact;

  $: column =
    rawText?.length > 20 ||
    effectiveAttaches?.length ||
    msg.reactionInfo?.totalCount ||
    msg.link?.messageId;

  $: showAvatar =
    chat.type !== "CHANNEL" &&
    !isSystem;

  $: inlineKeyboardAttach = effectiveAttaches?.find(x => x._type === "INLINE_KEYBOARD");
  $: stickerAttach = effectiveAttaches?.find(x => x._type === "STICKER");
  $: isStickerOnly = stickerAttach && (!lines || lines.length === 0 || (lines.length === 1 && !lines[0]?.trim())) && (!effectiveAttaches || effectiveAttaches.length === 1) && !linkedMsg;
  $: isVideoNoteOnly = effectiveAttaches?.some(x => x._type === "VIDEO" && x.videoType === 1) && (!lines || lines.length === 0 || (lines.length === 1 && !lines[0]?.trim())) && (!effectiveAttaches || effectiveAttaches.length === 1) && !linkedMsg;
</script>

<div
  class="message-row"
  class:is-me={isMe}
  class:is-system={isSystem}
  class:is-deleted={msg.deleted}
  class:is-sticker={isStickerOnly}
  class:is-video-note={isVideoNoteOnly}
  class:is-channel={chat.type === "CHANNEL"}
  class:inactive={/* todo optimize */
  dropoutActiveAt && dropoutActiveAt?.msg?.id !== msg.id}
>
  <div class="indent">
    {#if showAvatar}
      <button
        type="button"
        class="avatar-msg-btn"
        on:mousedown|stopPropagation
        on:mouseup|stopPropagation
        on:touchend|stopPropagation
        on:click|stopPropagation={() => {
          if (msg.sender) {
            $Session.profile = { userId: Number(msg.sender) };
          }
        }}
      >
        <Avatar size={32} contactId={msg.sender} style="chat" />
      </button>
    {/if}
  </div>

  <div class="message-bubble-container">
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
              >{new Date(msg.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}</span
            >
            {#if isMe && !isSystem}
              <div class="status-ticks">
                {#if isSending}
                  <svg class="status-icon is-sending" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
                    <polyline points="8,4.5 8,8 10.5,9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                {:else if isRead}
                  <svg class="status-icon is-read" viewBox="0 0 20 12">
                    <path fill="currentColor" d="M9.5 10.5L5 6l1.4-1.4L9.5 7.7 17.6 0l1.4 1.4z" />
                    <path fill="currentColor" d="M4.5 10.5L0 6l1.4-1.4L4.5 7.7 7.5 4.7 8.9 6.1z" />
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
            <Reactions info={msg.reactionInfo} {isMe} />
          </div>
        {/if}
      </div>
    {:else}
      <div class={"message-bubble " + (column ? "column" : "row")}>
      <div class="direction">
        <div class="text">
        {#if linkedMsg}
          {#if linkedType === "FORWARD"}
            <div class="forward-block">
              <div
                class="forward-header"
                on:click|stopPropagation={handleForwardHeaderClick}
              >
                {#if msg.link.chatIconUrl}
                  <img
                    src={msg.link.chatIconUrl}
                    alt=""
                    class="forward-avatar"
                  />
                {/if}
                <div class="forward-info">
                  <span class="forward-name">{msg.link.chatName}</span>
                  <span class="forward-label">Пересланное сообщение</span>
                </div>
                <svg class="forward-arrow" viewBox="0 0 24 24"
                  ><path
                    d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"
                  /></svg
                >
              </div>

              {#if forwardLines}
                <div class="forward-content">
                  {#each forwardLines as fLine}
                    <p class="line allow-selection">{fLine}</p>
                  {/each}
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
                  <b>{linkedMsgContact?.names?.[0]?.firstName || "?"}</b>
                  <MessagePreview {chat} msg={linkedMsg} cut={true} />
                </p>
              </div>
            </div>
          {/if}
        {/if}

        {#if isSystem}
          {@const sysText = getSystemText(msg) || ""}
          {#if sysText}
            {#each sysText.split("\n") as line}
              <p class="line system">{@html line}</p>
            {/each}
          {/if}
        {:else}
          {#if msg.deleted}
            <div class="deleted-notice">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
              <span>Сообщение удалено</span>
              {#if msg.deleted_at || msg.deletedAt}
                <span class="deleted-notice-time">({new Date(msg.deleted_at || msg.deletedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})</span>
              {/if}
            </div>
          {/if}

          {#if lines}
            {#each lines as line}
              <p class="line" class:deleted-text={msg.deleted}>
              {#if decoded}
                {@html line}
              {:else}
                {line}
              {/if}
              </p>
            {/each}
          {/if}

          {#if effectiveAttaches?.length}
            <Attachments
              {getFile}
              attaches={effectiveAttaches}
              {handleMediaClick}
              chatId={msg?.chatId ?? chat?.id}
              messageId={msg?.id}
              {isMe}
            />
          {/if}
        {/if}
      </div>
      <div class={column ? "bottom cmn" : "bottom"}>
        <Reactions info={msg.reactionInfo} {isMe} />

        <div class="message-status">
          <div class="status-meta">
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
            <span class="timestamp"
              >{new Date(msg.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}</span
            >
          </div>
          {#if isMe && !isSystem}
            <div class="status-ticks">
              {#if isSending}
                <svg class="status-icon is-sending" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
                  <polyline points="8,4.5 8,8 10.5,9.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              {:else if isRead}
                <svg class="status-icon is-read" viewBox="0 0 20 12">
                  <path fill="currentColor" d="M9.5 10.5L5 6l1.4-1.4L9.5 7.7 17.6 0l1.4 1.4z" />
                  <path fill="currentColor" d="M4.5 10.5L0 6l1.4-1.4L4.5 7.7 7.5 4.7 8.9 6.1z" />
                </svg>
              {:else}
                <svg class="status-icon is-sent" viewBox="0 0 16 12">
                  <path fill="currentColor" d="M5.5 10.5L1 6l1.4-1.4L5.5 7.7 13.6 0l1.4 1.4z" />
                </svg>
              {/if}
              {#if decoded}
                <a class="obf-type">{decoded.obf}</a>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
  {/if}

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
    <InlineKeyboard {chat} {msg} attach={inlineKeyboardAttach} />
  {/if}
</div>
</div>

<style>
  .message-row {
    display: flex;
    align-items: flex-end;
    width: 100%;
    transition:
      opacity 0.2s,
      background 0.5s;
  }

  .placeholder {
    height: 80px;
    width: 100%;
    opacity: 0;
  }

  .message-row.inactive {
    opacity: 0.5;
  }

  .indent {
    margin: 0 12px 0 9px;
  }

  @media screen and (max-width: 500px) {
    .message-row.is-me .indent {
      display: none;
    }
  }

  .indent:empty {
    display: none;
  }

  .message-bubble-container {
    display: flex;
    flex-direction: column;
    max-width: 80%;
    min-width: 100px;
    margin-right: 10px;
    position: relative;
    width: fit-content;
  }

  .message-bubble {
    color: #fff;
    padding: 8px 4px 8px 12px;
    border-radius: 16px 16px 16px 0;
    min-width: 100px;
    width: 100%;
    box-sizing: border-box;
    font-size: 13px;
    position: relative;
  }

  .text {
    min-width: 0;
  }

  .message-bubble.column .text {
    padding-right: 10px;
  }

  .message-row .message-bubble::before {
    content: "";
    left: -10px;
    clip-path: path("M10 0 Q5 10 0 10 Q0 10 10 10 Z");
    width: 10px;
    height: 10px;
    position: absolute;
    bottom: 0;
    background: inherit;
  }

  .message-row.is-system {
    display: flex;
    justify-content: center !important;
    align-items: center !important;
    width: 100%;
    margin: 6px 0;
  }

  .message-row.is-system .indent {
    display: none !important;
  }

  .message-row.is-system .message-bubble-container {
    margin: 0 auto;
    align-items: center;
    justify-content: center;
    max-width: 90%;
    width: auto;
  }

  .message-row.is-system .message-bubble::before {
    display: none !important;
  }

  .message-row.is-system .message-bubble {
    border-radius: 12px;
    padding: 6px 14px;
    background: rgba(45, 48, 60, 0.85);
    width: auto;
    min-width: 0;
    text-align: center;
  }

  .message-row.is-system .direction {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-align: center;
  }

  .message-row.is-system .text {
    text-align: center;
    width: 100%;
  }

  .message-row.is-me:not(.is-system) {
    justify-content: flex-end;
  }

  .message-row.is-me:not(.is-system) .message-bubble-container {
    align-items: flex-end;
  }

  .message-row.is-me:not(.is-system) .message-bubble {
    border-radius: 16px 16px 0px 16px;
    background: #7b4cd6;
  }

  .message-row.is-me:not(.is-system) .message-bubble::before {
    left: inherit;
    right: -10px;
    clip-path: path("M0 0 Q5 10 10 10 Q10 10 0 10 Z");
  }

  .message-row.is-me:not(.is-system) .indent {
    display: none;
  }

  @media screen and (min-width: 501px) {
    .message-row.is-me:not(.is-system) {
      justify-content: flex-start;
      flex-direction: row;
    }

    .message-row.is-me:not(.is-system) .message-bubble-container {
      align-items: flex-start;
    }

    .message-row.is-me:not(.is-system) .message-bubble {
      border-radius: 16px 16px 16px 0;
    }

    .message-row.is-me:not(.is-system) .message-bubble::before {
      left: -10px;
      right: inherit;
      clip-path: path("M10 0 Q5 10 0 10 Q0 10 10 10 Z");
    }

    .message-row.is-me:not(.is-system) .indent {
      display: block;
    }
  }

  .message-row.is-channel:not(.is-system) {
    justify-content: flex-start;
  }

  .message-row.is-channel:not(.is-system) .indent {
    display: none;
  }

  .message-row.is-channel:not(.is-system) .message-bubble-container {
    align-items: flex-start;
    margin-left: 14px;
  }

  .message-row.is-channel:not(.is-system) .message-bubble {
    border-radius: 16px 16px 16px 0;
  }

  .message-row.is-channel:not(.is-system) .message-bubble::before {
    left: -10px;
    right: inherit;
    clip-path: path("M10 0 Q5 10 0 10 Q0 10 10 10 Z");
  }

  .message-row:not(.is-me, .is-system) .message-bubble {
      background: #3a3c55;
  }

  .message-row.is-deleted .message-bubble {
    background-color: #c99;
  }

  /* динамичная сетка */

  .message-bubble.row .direction {
    display: flex;
    gap: 10px;
  }

  .message-bubble.column .direction {
    display: flex;
    flex-direction: column;
  }

  /* связанные сообщения */

  .forward-block {
    border-left: 2px solid #34b7f1;
    padding-left: 8px;
    margin-bottom: 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px 12px 12px 4px;
    padding-top: 4px;
    padding-bottom: 4px;
    overflow: hidden;
  }

  .forward-header {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    margin-bottom: 4px;
  }

  .forward-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
  }

  .forward-name {
    font-weight: 600;
    color: #34b7f1;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .forward-arrow {
    width: 14px;
    height: 14px;
    fill: #34b7f1;
  }

  .reply-block {
    border-left: 3px solid #4a90e2;
    padding: 10px 4px 10px 8px;
    margin-bottom: 6px;
    margin-left: -4px;
    border-radius: 4px 0 0 0;
    opacity: 0.85;
    font-size: 12px;
    background-color: #0001;
    cursor: pointer;
  }

  .reply-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .message-row.is-system .reply-block {
    border-left: 3px solid #fff7;
  }

  /* значки */

  .bottom {
    display: flex;
    justify-content: space-between;
    gap: 15px;
    margin-right: 4px;
    flex: 1;
  }

  .bottom.cmn {
    flex-direction: row;
  }

  .message-status {
    display: flex;
    gap: 6px;
    align-items: end;
    white-space: nowrap;
    margin-left: auto;
    margin-right: 0;
    margin-bottom: -3px;
  }

  .status-meta {
    display: flex;
    gap: 10px;
  }

  .views {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    margin-bottom: -1px;
    opacity: 0.6;
  }

  .views-icon {
    width: 12px;
    fill: currentColor;
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

  .line.deleted-text {
    opacity: 0.6;
    text-decoration: line-through;
  }

  .deleted-badge {
    font-size: 10px;
    color: #ef4444;
    font-weight: 600;
    margin-right: 2px;
  }

  .edited-badge {
    background: transparent;
    border: none;
    font-size: 10px;
    color: #8b929e;
    cursor: pointer;
    padding: 0 2px;
    border-radius: 3px;
    transition: color 0.15s ease;
  }

  .edited-badge:hover {
    color: #38bdf8;
    text-decoration: underline;
  }

  .timestamp {
    font-size: 11px;
    opacity: 0.5;
  }

  .status-ticks {
    display: inline-flex;
    align-items: center;
    align-self: end;
  }

  .status-ticks * {
    position: relative;
  }

  .status-icon {
    width: 14px;
    height: 10px;
    top: 1px;
    fill: currentColor;
    color: #8e8e93;
  }

  .status-icon.is-sending {
    width: 12px;
    height: 12px;
    color: #8e8e93;
    stroke: currentColor;
    fill: none;
    top: 0;
  }

  .status-icon.is-sent {
    width: 13px;
    height: 10px;
    color: #8e8e93;
    fill: currentColor;
  }

  .status-icon.is-read {
    width: 16px;
    height: 10px;
    color: #34b7f1;
    fill: currentColor;
  }

  .obf-type {
    font-size: 8px;
    color: #7f7;
    font-weight: 1000;
    position: relative;
    top: 1px;
  }

  .line {
    margin: 0;
    line-height: 1.4;
    word-break: break-word;
    pointer-events: auto;
  }

  .line.system {
    text-align: center;
  }

  @keyframes pulseHighlight {
    0% {
      background: rgba(255,255,255,0);
    }
    30% {
      background: rgba(255,255,255,0.12);
    }
    100% {
      background: rgba(255,255,255,0);
    }
  }

  .msg-highlight {
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

  .message-row.is-video-note .message-bubble {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    padding: 0 !important;
  }

  .message-row.is-video-note .message-bubble::before {
    display: none !important;
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
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
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
    color: #34b7f1;
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
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 12px;
    padding: 8px 12px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(8px);
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
</style>
