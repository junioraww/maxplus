<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { writable } from "svelte/store";
  import { openPath } from "@tauri-apps/plugin-opener";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { getContact } from "$lib/utils/caching";
  import { openChat } from "$lib/stores/session";
  import {
    getAttachText, getSystemText
  } from "$lib/utils/attachs";
  import { scrollTo } from '$lib/utils/scroll';
  import MessagePreview from "$components/main/MessagePreview.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import Reactions from "$components/ChatWindow/Reactions.svelte";
  import Attachments from "$components/ChatWindow/Attachments.svelte";
  import InlineKeyboard from "$components/ChatWindow/InlineKeyboard.svelte";

  const dispatch = createEventDispatcher();

  export let msg;
  export let chat;
  export let dropoutActiveAt;
  export let scrollElement;
  export let decoded;
  export let makeVisible;

  const isMe = msg.sender === $currentUser;
  const isSystem = msg.attaches?.[0]?._type === "CONTROL";

  $: lines = (decoded?.text || msg.text)?.split("\n");

  let innerWidth = 0;

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
      return msg.attaches[0].pinnedMessage;
    }
    return undefined;
  })();

  $: linkedType = msg.link ? msg.link.type : "REPLY";
  $: forwardLines = linkedMsg?.text?.split("\n");

  const cachedLinkedContact = linkedMsg && getContact(linkedMsg.sender);
  $: linkedMsgContact = cachedLinkedContact && $cachedLinkedContact;

  $: column =
    msg.text?.length > 20 ||
    msg.attaches.length ||
    msg.reactionInfo?.totalCount ||
    msg.link?.messageId;

  $: showAvatar =
    chat.type !== "CHANNEL" &&
    (!isMe || innerWidth > 500) &&
    !isSystem;

  $: inlineKeyboardAttach = msg.attaches?.find(x => x._type === "INLINE_KEYBOARD");
</script>

<svelte:window bind:innerWidth={innerWidth} />

<div
  class="message-row"
  class:is-me={isMe}
  class:is-system={isSystem}
  class:is-deleted={msg.deleted}
  class:inactive={/* todo optimize */
  dropoutActiveAt && dropoutActiveAt?.msg?.id !== msg.id}
>
  <div class="indent">
    {#if showAvatar}
      <Avatar size={32} contactId={msg.sender} style="chat" />
    {/if}
  </div>

  <div class="message-bubble-container">
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
          {#each getSystemText(msg).split("\n") as line}
            <p class="line system">{@html line}</p>
          {/each}
        {:else}
          {#if lines}
            {#each lines as line}
              <p class="line">
              {#if decoded}
                {@html line}
              {:else}
                {line}
              {/if}
              </p>
            {/each}
          {/if}

          {#if msg.attaches?.length}
            <Attachments {getFile} attaches={msg.attaches} {handleMediaClick} />
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
            <span class="timestamp"
              >{new Date(msg.time).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}</span
            >
          </div>
          {#if isMe && !isSystem}
            <div class="status-ticks">
              {#if msg.status === 3}
                <svg class="status-icon is-read" viewBox="0 0 23 13"
                  ><path
                    d="M11 12.025L5 6L6.5 4.5L11 9.52502L20.05 0L21.45 1.425L11 12.025ZM4.9999 12.025L0 7L1.5 5.50002L4.9999 9.5L14.375 0.025L15.8 1.425L4.9999 12.025Z"
                  /></svg
                >
              {:else}
                <svg class="status-icon" viewBox="0 0 17 6"
                  ><path
                    d="M6 12.025L0 6L1.5 4.5L6 9.52502L15.05 0L16.45 1.425L6 12.025Z"
                  /></svg
                >
              {/if}
              {#if decoded}
                <a class="obf-type">{decoded.obf}</a>
                {#if false}
                <svg class="status-icon safe" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M11 7V5a3 3 0 0 0-6 0v2H4v7h8V7h-1zM6 5a2 2 0 1 1 4 0v2H6V5z"/>
                </svg>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

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

  .message-bubble-container {
    display: flex;
    flex-direction: column;
    max-width: 80%;
    min-width: 100px;
    margin-right: 10px;
    position: relative;
    width: fit-content;
  }

  .message-row.is-me {
    justify-content: flex-end;
  }

  .message-row.is-me .message-bubble-container {
    align-items: flex-end;
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
    align-items: center;
    flex-direction: column;
  }

  .message-row.is-system .message-bubble::before {
    left: inherit;
    right: -10px;
    clip-path: path("M0 0 Q5 10 10 10 Q10 10 0 10 Z");
  }

  .message-row.is-system .message-bubble {
    border-radius: 16px 16px 0px 16px;
  }

  @media screen and (max-width: 500px) {
    .message-row.is-me {
      flex-direction: column;
    }

    .message-row.is-me .message-bubble {
      border-radius: 16px 16px 0px 16px;
    }

    .message-row.is-me .message-bubble::before {
      left: inherit;
      right: -10px;
      clip-path: path("M0 0 Q5 10 10 10 Q10 10 0 10 Z");
    }
  }

  .message-row.is-me .message-bubble {
      background: #7b4cd6;
  }

  .message-row:not(.is-me, .is-system) .message-bubble {
      background: #3a3c55;
  }

  .message-row.is-system .message-bubble {
      background: #7773;
      backdrop-filter: blur(2px);
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

  .timestamp {
    font-size: 11px;
    opacity: 0.5;
  }

  .status-ticks {
    align-self: end;
  }

  .status-ticks * {
    position: relative;
  }

  .status-icon {
    width: 10px;
    height: 10px;
    top: 1px;
    fill: #7f7;
  }

  .status-icon.is-read {
    fill: #34b7f1;
    height: 14px;
  }

  .status-icon.safe {
    top: 1;
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

  /*.spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top: 2px solid white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }*/
</style>
