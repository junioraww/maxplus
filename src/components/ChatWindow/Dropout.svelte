<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade, scale, fly } from "svelte/transition";
  import { tick } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import { handleReaction } from "$components/ChatWindow/actions";
  import API, { currentSessionChats, currentUser, serverConfig } from "$lib/stores/api";
  import { saveChats } from "$lib/stores/messages";
  import { reactionEmojis, ensureReactionsLoaded } from "$lib/stores/reactions.js";

  export let activeAt;
  export let chat;

  const dispatch = createEventDispatcher();

  let menuPosition = { top: 0, left: 0 };
  let menuNode;
  let reactionsExpanded = false;
  let reactionsBelow = false;

  let unregisterBack = null;

  function cleanupBack() {
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
  }

  async function updatePosition(clientX, clientY) {
    await tick();
    if (!menuNode) return;
    const cardNode = menuNode.querySelector(".telegram-dropout-card");
    const cardWidth = cardNode?.offsetWidth || 196;
    const cardHeight = cardNode?.offsetHeight || 260;
    const { innerWidth, innerHeight } = window;
    let x = clientX;
    let y = clientY;

    if (x + cardWidth > innerWidth - 12) {
      x = innerWidth - cardWidth - 12;
    }
    if (x < 12) x = 12;

    if (y + cardHeight > innerHeight - 16) {
      y = innerHeight - cardHeight - 16;
    }
    if (y < 60) {
      reactionsBelow = true;
      if (y < 12) y = 12;
    } else {
      reactionsBelow = false;
    }

    menuPosition = { top: y, left: x };
    cleanupBack();
    unregisterBack = registerBackHandler(() => {
      dispatch("close", { update: false });
    });
  }

  $: if (activeAt) {
    reactionsExpanded = false;
    ensureReactionsLoaded().catch(() => {});
    updatePosition(activeAt.e.clientX, activeAt.e.clientY);
  } else {
    cleanupBack();
  }

  $: if (reactionsExpanded && menuNode) {
    tick().then(() => {
      const card = menuNode?.querySelector(".telegram-dropout-card");
      if (card) {
        const rect = card.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 16) {
          const shift = rect.bottom - (window.innerHeight - 16);
          menuPosition.top = Math.max(16, menuPosition.top - shift);
        }
        if (rect.top < 16) {
          menuPosition.top = 16;
        }
        if (rect.right > window.innerWidth - 12) {
          const shiftX = rect.right - (window.innerWidth - 12);
          menuPosition.left = Math.max(12, menuPosition.left - shiftX);
        }
        if (rect.left < 12) {
          menuPosition.left = 12;
        }
      }
    });
  }

  const clickReaction = async (emoji) => {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      handleReaction(chat, targetMsg, emoji);
    }
    dispatch("close", { action: "reaction" });
    cleanupBack();
  };

  onDestroy(() => {
    cleanupBack();
  });

  function handleSetReply() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("reply", { id: targetMsg.id });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleCopy() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("copyText", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleForward() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("forward", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleSelect() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("select", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  async function handlePinMessage() {
    const targetMsg = activeAt?.msg;
    if (!targetMsg) return;
    await $API.pinMessage(chat.id, targetMsg.id);
    const updatedChat = {
      ...chat,
      pinnedMessage: targetMsg,
    };

    currentSessionChats.update(chats => {
      const idx = chats.findIndex(x => x.id === chat.id);
      if (idx !== -1) chats[idx] = updatedChat;
      return [...chats];
    });

    await saveChats([ updatedChat ]);
    dispatch("close", {});
    cleanupBack();
  }

  function handleEditMessage() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("edit", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleHistoryMessage() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("history", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleDeleteMessage() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("delete", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleReportMessage() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("report", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleBackdropClick() {
    dispatch("close", {});
    cleanupBack();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      dispatch("close", {});
      cleanupBack();
    }
  }

  $: editTimeoutSec = Number($serverConfig?.["edit-timeout"]) || 86400;
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if activeAt && activeAt.msg}
  {@const msg = activeAt.msg}
  {@const isMe = Number(msg.sender) === Number($currentUser)}
  {@const isDeleted = msg.deleted === true}
  {@const msgTime = Number(msg.time) || 0}
  {@const canEdit = isMe && !isDeleted && (msgTime > 0 ? (Date.now() - msgTime <= editTimeoutSec * 1000) : true)}
  {@const hasHistory = !!(msg.edited || msg.status === 'EDITED' || (Array.isArray(msg.history) && msg.history.length > 0))}
  {@const reactionsAllowed = !isDeleted && (chat.reactions == null || chat.reactions.isActive !== false)}
  {@const canPin = !isDeleted && (chat?.type === "CHAT" || chat?.type === "GROUP" || chat?.type === "CHANNEL")}
  {@const hasText = !!(msg.text?.trim())}
  {@const isChannel = chat?.type === "CHANNEL"}

  <div
    class="dropout-backdrop"
    on:click={handleBackdropClick}
    transition:fade={{ duration: 160 }}
  />

  <div
    class="dropout-container message-actions-dropout"
    bind:this={menuNode}
    style="top:{menuPosition.top}px; left:{menuPosition.left}px;"
    on:click|stopPropagation
  >
    {#if reactionsAllowed && !reactionsExpanded}
      <div
        class="reaction-capsule"
        class:is-below={reactionsBelow}
        transition:fade={{ duration: 160 }}
      >
        <div class="reaction-grid-collapsed">
          {#each $reactionEmojis.slice(0, 5) as emoji, i (emoji + '_' + i)}
            {@const isSelectedReaction = msg.reactionInfo?.yourReaction === emoji}
            <button
              type="button"
              class="reaction-pill"
              class:is-active={isSelectedReaction}
              in:fly={{ y: 12, duration: 180, delay: i * 25 }}
              on:click|stopPropagation={() => clickReaction(emoji)}
              aria-label="Reaction {emoji}"
            >
              {emoji}
            </button>
          {/each}

          {#if $reactionEmojis.length > 5}
            <button
              type="button"
              class="reaction-pill expand-btn"
              in:fly={{ y: 12, duration: 180, delay: 5 * 25 }}
              on:click|stopPropagation={() => { reactionsExpanded = true; }}
              title="Все реакции"
            >
              <svg viewBox="0 0 24 24" class="expand-icon">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <div
      class="telegram-dropout-card"
      class:is-reactions-picker={reactionsExpanded}
      transition:scale={{ duration: 200, start: 0.9, opacity: 0 }}
    >
      {#if reactionsExpanded}
        <div class="reactions-picker-view">
          <div class="reactions-picker-header">
            <button
              type="button"
              class="picker-back-btn"
              on:click|stopPropagation={() => { reactionsExpanded = false; }}
              title="Назад"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
            </button>
            <span class="picker-title">Реакции</span>
            <button
              type="button"
              class="picker-close-btn"
              on:click|stopPropagation={() => dispatch("close", {})}
              title="Закрыть"
            >
              ✕
            </button>
          </div>
          <div class="reactions-picker-grid">
            {#each $reactionEmojis as emoji, i (emoji + '_' + i)}
              {@const isSelectedReaction = msg.reactionInfo?.yourReaction === emoji}
              <button
                type="button"
                class="reaction-pill picker-pill"
                class:is-active={isSelectedReaction}
                on:click|stopPropagation={() => clickReaction(emoji)}
                aria-label="Reaction {emoji}"
              >
                {emoji}
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="actions-group">
          {#if !isChannel}
            <button type="button" class="action-row" on:click={() => handleSetReply()}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" fill="currentColor"/></svg>
              <span class="action-label">Ответить</span>
            </button>
          {/if}

          {#if hasText}
            <button type="button" class="action-row" on:click={handleCopy}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/></svg>
              <span class="action-label">Скопировать текст</span>
            </button>
          {/if}

          <button type="button" class="action-row" on:click={handleForward}>
            <svg viewBox="0 0 24 24" class="action-icon"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" fill="currentColor"/></svg>
            <span class="action-label">Переслать</span>
          </button>

          {#if canEdit}
            <button type="button" class="action-row" on:click={handleEditMessage}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/></svg>
              <span class="action-label">Изменить</span>
            </button>
          {/if}

          {#if canPin}
            <button type="button" class="action-row" on:click={() => handlePinMessage()}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" fill="currentColor"/></svg>
              <span class="action-label">Закрепить</span>
            </button>
          {/if}

          <button type="button" class="action-row" on:click={handleSelect}>
            <svg viewBox="0 0 24 24" class="action-icon"><path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.41 11.93l-1.41 1.41 5.66 5.66 12-12-1.42-1.41zM.41 13.34l5.66 5.66 1.41-1.41-5.66-5.66L.41 13.34z" fill="currentColor"/></svg>
            <span class="action-label">Выбрать</span>
          </button>

          {#if hasHistory}
            <button type="button" class="action-row" on:click={handleHistoryMessage}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" fill="currentColor"/></svg>
              <span class="action-label">История изменений</span>
            </button>
          {/if}

          {#if !isMe}
            <button type="button" class="action-row report-row" on:click={handleReportMessage}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z" fill="currentColor"/></svg>
              <span class="action-label">Пожаловаться</span>
            </button>
          {/if}

          {#if isMe || !isChannel}
            <div class="divider" />
            <button type="button" class="action-row delete-row" on:click={handleDeleteMessage}>
              <svg viewBox="0 0 24 24" class="action-icon"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor"/></svg>
              <span class="action-label">Удалить</span>
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dropout-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 45;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  .dropout-container {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    user-select: none;
    width: 196px;
  }

  .reaction-capsule {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: 196px;
    background: rgba(28, 30, 42, 0.96);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 20px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 5px 6px;
    box-sizing: border-box;
    transition: max-height 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), border-radius 0.2s ease;
  }

  .reaction-capsule.is-below {
    bottom: auto;
    top: calc(100% + 8px);
  }

  .reaction-grid-collapsed {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 2px;
  }

  .reaction-pill {
    font-size: 19px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    white-space: nowrap;
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.12s ease;
  }

  .reaction-pill:hover {
    transform: scale(1.22);
    background: rgba(255, 255, 255, 0.12);
  }

  .reaction-pill:active {
    transform: scale(0.92);
  }

  .reaction-pill.is-active {
    background: rgba(123, 76, 214, 0.45);
    border-color: rgba(167, 139, 250, 0.6);
  }

  .expand-btn {
    width: 26px;
    height: 26px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.8);
    flex-shrink: 0;
    white-space: nowrap;
  }

  .expand-btn:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
  }

  .expand-icon {
    width: 16px;
    height: 16px;
  }

  .telegram-dropout-card {
    display: flex;
    flex-direction: column;
    width: 196px;
    background: rgba(28, 30, 42, 0.94);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55), 0 2px 10px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .telegram-dropout-card.is-reactions-picker {
    width: 230px;
    max-height: min(320px, calc(100vh - 32px));
  }

  .reactions-picker-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .reactions-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .picker-back-btn,
  .picker-close-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    padding: 0;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .picker-back-btn:hover,
  .picker-close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .picker-title {
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
  }

  .reactions-picker-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
    padding: 10px;
    overflow-y: auto;
    max-height: 260px;
    justify-items: center;
    align-items: center;
  }

  .picker-pill {
    width: 32px;
    height: 32px;
    font-size: 20px;
  }

  .actions-group {
    display: flex;
    flex-direction: column;
    padding: 6px 0;
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 450;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .action-row:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .action-row:active {
    background: rgba(255, 255, 255, 0.14);
  }

  .action-icon {
    width: 18px;
    height: 18px;
    color: rgba(255, 255, 255, 0.75);
    flex-shrink: 0;
  }

  .action-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 4px 0;
  }

  .report-row:hover {
    background: rgba(251, 146, 60, 0.12);
  }

  .delete-row {
    color: #f87171;
  }

  .delete-row .action-icon {
    color: #f87171;
  }

  .delete-row:hover {
    background: rgba(239, 68, 68, 0.12);
  }
</style>
