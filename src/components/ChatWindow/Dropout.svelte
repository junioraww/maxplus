<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { fade, scale, fly } from "svelte/transition";
  import { tick } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { getSafeAreaInsets } from "$lib/utils/safeArea";

  import { handleReaction } from "$components/ChatWindow/actions";
  import API, { currentUser, serverConfig } from "$lib/stores/api";
  import { saveChats, getChat } from "$lib/stores/messages";
  import { reactionEmojis, ensureReactionsLoaded } from "$lib/stores/reactions";
  import { openProfile } from "$lib/stores/session";
  import { canPinInChat } from "$lib/utils/chatPermissions";
  import { showAlert } from "$lib/utils/alert";
  import SeenByItem from "./SeenByItem.svelte";

  export let activeAt;
  export let chat;

  const dispatch = createEventDispatcher();

  let menuPosition = { top: 0, left: 0 };
  let menuNode;
  let reactionsExpanded = false;
  let viewMode = "menu";
  let detailedReactions = {};
  let reactionsBelow = false;
  let alignRight = false;

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

    const cardNode = menuNode.querySelector(".telegram-dropout-card") || menuNode.querySelector(".reactions-picker-card");
    const capsuleNode = menuNode.querySelector(".reaction-capsule");

    const cardWidth = cardNode?.offsetWidth || 240;
    const capsuleWidth = capsuleNode?.offsetWidth || 290;
    const menuWidth = Math.max(cardWidth, reactionsExpanded ? 320 : (reactionsAllowed ? capsuleWidth : cardWidth));
    const cardHeight = cardNode?.offsetHeight || 280;
    const capsuleHeight = capsuleNode?.offsetHeight || (reactionsAllowed ? 42 : 0);
    const totalHeight = reactionsAllowed && !reactionsBelow ? cardHeight + capsuleHeight + 8 : cardHeight;

    const vv = typeof window !== "undefined" && window.visualViewport ? window.visualViewport : null;
    const innerWidth = vv ? vv.width : (typeof window !== "undefined" ? window.innerWidth : 360);
    const innerHeight = vv ? vv.height : (typeof window !== "undefined" ? window.innerHeight : 640);
    const offsetTop = vv ? vv.offsetTop : 0;
    const offsetLeft = vv ? vv.offsetLeft : 0;
    const safe = getSafeAreaInsets();
    const minTop = offsetTop + safe.top + 12;
    const maxBottom = offsetTop + innerHeight - safe.bottom - 12;
    const minLeft = offsetLeft + safe.left + 12;
    const maxRight = offsetLeft + innerWidth - safe.right - 12;

    // Horizontal positioning:
    let x;
    if (clientX + menuWidth <= maxRight) {
      x = Math.max(minLeft, clientX);
      alignRight = false;
    } else if (clientX - menuWidth >= minLeft) {
      x = Math.min(maxRight - menuWidth, clientX - menuWidth);
      alignRight = true;
    } else {
      x = Math.max(minLeft, Math.min(clientX - menuWidth / 2, maxRight - menuWidth));
      alignRight = clientX > offsetLeft + innerWidth / 2;
    }

    // Vertical positioning:
    if (clientY - capsuleHeight - 16 >= minTop) {
      reactionsBelow = false;
    } else {
      reactionsBelow = true;
    }

    let y;
    const neededBelow = cardHeight + (reactionsBelow ? capsuleHeight + 8 : 0) + 12;
    if (clientY + neededBelow <= maxBottom) {
      y = Math.max(minTop, clientY + 4);
    } else if (clientY - totalHeight - 12 >= minTop) {
      y = clientY - totalHeight - 4;
    } else {
      y = Math.max(minTop, maxBottom - totalHeight);
    }

    menuPosition = { top: y, left: x };

    await tick();
    if (menuNode) {
      const rect = menuNode.getBoundingClientRect();

      if (rect.bottom > maxBottom) {
        menuPosition.top = Math.max(minTop, menuPosition.top - (rect.bottom - maxBottom));
      }
      if (rect.top < minTop) {
        menuPosition.top = minTop;
      }
      if (rect.right > maxRight) {
        menuPosition.left = Math.max(minLeft, menuPosition.left - (rect.right - maxRight));
      }
      if (rect.left < minLeft) {
        menuPosition.left = minLeft;
      }
    }
  }

  onDestroy(() => {
    cleanupBack();
  });

  let lastActiveMsgId = null;

  $: if (activeAt) {
    const currentMsgId = activeAt?.msg?.id ?? null;
    if (currentMsgId !== lastActiveMsgId) {
      lastActiveMsgId = currentMsgId;
      reactionsExpanded = false;
      viewMode = "menu";
      detailedReactions = {};
      ensureReactionsLoaded().catch(() => {});
    }
    if (!unregisterBack) {
      unregisterBack = registerBackHandler(() => {
        if (reactionsExpanded) {
          reactionsExpanded = false;
          return false;
        }
        if (viewMode === "readBy") {
          viewMode = "menu";
          return false;
        }
        dispatch("close", { update: false });
        return true;
      });
    }
    const vv = typeof window !== "undefined" && window.visualViewport ? window.visualViewport : null;
    const defaultX = vv ? vv.offsetLeft + vv.width / 2 : (typeof window !== "undefined" ? window.innerWidth / 2 : 0);
    const defaultY = vv ? vv.offsetTop + vv.height / 2 : (typeof window !== "undefined" ? window.innerHeight / 2 : 0);
    const clientX = activeAt?.e?.clientX ?? defaultX;
    const clientY = activeAt?.e?.clientY ?? defaultY;
    updatePosition(clientX, clientY);
  } else {
    lastActiveMsgId = null;
    cleanupBack();
  }

  $: if (reactionsExpanded && menuNode) {
    tick().then(() => {
      const card = menuNode?.querySelector(".reactions-picker-card");
      if (card) {
        const rect = card.getBoundingClientRect();
        const vv = typeof window !== "undefined" && window.visualViewport ? window.visualViewport : null;
        const maxBottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 16;
        const minTop = (vv ? vv.offsetTop : 0) + 16;
        const maxRight = (vv ? vv.offsetLeft + vv.width : window.innerWidth) - 12;
        const minLeft = (vv ? vv.offsetLeft : 0) + 12;

        if (rect.bottom > maxBottom) {
          const shift = rect.bottom - maxBottom;
          menuPosition.top = Math.max(minTop, menuPosition.top - shift);
        }
        if (rect.top < minTop) {
          menuPosition.top = minTop;
        }
        if (rect.right > maxRight) {
          const shiftX = rect.right - maxRight;
          menuPosition.left = Math.max(minLeft, menuPosition.left - shiftX);
        }
        if (rect.left < minLeft) {
          menuPosition.left = minLeft;
        }
      }
    });
  }

  const clickReaction = async (emoji) => {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      await handleReaction(chat, targetMsg, emoji);
    }
    dispatch("close", { action: "reaction", msg: targetMsg });
    cleanupBack();
  };

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

  function handleCopyMedia() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("copyMedia", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  function handleSaveMedia() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("saveMedia", { msg: targetMsg });
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

  function handleShareLink() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("shareLink", { msg: targetMsg });
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

  function handleMarkAsUnread() {
    const targetMsg = activeAt?.msg;
    if (targetMsg) {
      dispatch("markUnread", { msg: targetMsg });
    }
    dispatch("close", {});
    cleanupBack();
  }

  async function handleTogglePin() {
    const targetMsg = activeAt?.msg;
    if (!targetMsg) return;
    const isPinned = chat?.pinnedMessage?.id === targetMsg.id;
    try {
      if (isPinned) {
        if (typeof $API.unpinMessage === "function") {
          await $API.unpinMessage(chat.id);
        }
        const updatedChat = { ...chat, pinnedMessage: null };
        getChat(chat.id).chatInfo.set(updatedChat);
        await saveChats([updatedChat]);
        showAlert("Сообщение откреплено");
      } else {
        await $API.pinMessage(chat.id, targetMsg.id, true);
        const updatedChat = { ...chat, pinnedMessage: targetMsg };
        getChat(chat.id).chatInfo.set(updatedChat);
        await saveChats([updatedChat]);
        showAlert("Сообщение закреплено");
      }
    } catch (e) {
      console.error("Failed to toggle pin message:", e);
      showAlert("Не удалось изменить закрепление");
    }
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

  $: readers = (() => {
    if (!activeAt?.msg || !chat?.participants) return [];
    const msg = activeAt.msg;
    const msgTime = Number(msg.time) || 0;
    if (msgTime <= 0) return [];
    const senderId = Number(msg.sender);
    const list = [];
    for (const [uidStr, markVal] of Object.entries(chat.participants)) {
      const uid = Number(uidStr);
      const mark = Number(markVal);
      if (!uid || uid === senderId) continue;
      if (mark >= msgTime) {
        list.push({
          userId: uid,
          readTime: mark,
        });
      }
    }
    list.sort((a, b) => b.readTime - a.readTime);
    return list;
  })();

  async function handleOpenSeenBy() {
    viewMode = "readBy";
    const targetMsg = activeAt?.msg;
    if (chat?.id && targetMsg?.id) {
      try {
        const res = await $API.getDetailedReactions(chat.id, targetMsg.id);
        const list = res?.payload?.reactions || res?.reactions || [];
        if (Array.isArray(list)) {
          const map = {};
          for (const item of list) {
            if (item?.userId && item?.reaction) {
              map[Number(item.userId)] = item.reaction;
            }
          }
          detailedReactions = map;
        }
      } catch (err) {
        console.error("Failed to load detailed reactions:", err);
      }
    }
  }

  function handleBackFromSeenBy() {
    viewMode = "menu";
  }

  function handleOpenReaderProfile(uid) {
    if (!uid) return;
    dispatch("close", {});
    cleanupBack();
    openProfile({ userId: uid });
  }

  $: photoAttach = activeAt?.msg?.attaches?.find((a) => (a._type || a.type) === "PHOTO");
  $: mediaAttach = activeAt?.msg?.attaches?.find((a) => {
    const t = a._type || a.type;
    return t === "PHOTO" || t === "VIDEO" || t === "FILE" || t === "AUDIO";
  });
  $: isPinned = Boolean(activeAt?.msg && chat?.pinnedMessage?.id === activeAt.msg.id);
  $: reactionsAllowed = Boolean(activeAt?.msg && !activeAt.msg.deleted && (chat.reactions == null || chat.reactions.isActive !== false));
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if activeAt && activeAt.msg}
  {@const msg = activeAt.msg}
  {@const isMe = Number(msg.sender) === Number($currentUser)}
  {@const isDeleted = msg.deleted === true}
  {@const msgTime = Number(msg.time) || 0}
  {@const canEdit = isMe && !isDeleted && (msgTime > 0 ? (Date.now() - msgTime <= editTimeoutSec * 1000) : true)}
  {@const hasHistory = !!(msg.edited || msg.status === 'EDITED' || (Array.isArray(msg.history) && msg.history.length > 0))}
  {@const canPin = !isDeleted && canPinInChat(chat, $currentUser)}
  {@const hasText = !!(msg.text?.trim())}
  {@const isChannel = chat?.type === "CHANNEL"}

  <div
    class="dropout-backdrop"
    on:click|preventDefault|stopPropagation={handleBackdropClick}
    on:pointerdown|preventDefault|stopPropagation={handleBackdropClick}
    on:touchstart|preventDefault|stopPropagation={handleBackdropClick}
    on:touchend|preventDefault|stopPropagation={handleBackdropClick}
    transition:fade={{ duration: 150 }}
  ></div>

  <div
    class="dropout-container message-actions-dropout"
    class:align-left={!alignRight}
    bind:this={menuNode}
    style="top:{menuPosition.top}px; left:{menuPosition.left}px;"
    on:click|stopPropagation
    transition:fade={{ duration: 150 }}
  >
    {#if !reactionsExpanded}
      {#if reactionsAllowed && !reactionsBelow}
        <div
          class="reaction-capsule"
          transition:fade={{ duration: 160 }}
        >
          <div class="reaction-strip">
            {#each $reactionEmojis.slice(0, 7) as emoji, i (emoji + '_' + i)}
              {@const isSelectedReaction = msg.reactionInfo?.yourReaction === emoji}
              <button
                type="button"
                class="reaction-pill"
                class:is-active={isSelectedReaction}
                in:fly={{ y: 8, duration: 160, delay: i * 20 }}
                on:click|stopPropagation={() => clickReaction(emoji)}
                aria-label="Reaction {emoji}"
              >
                {emoji}
              </button>
            {/each}

            {#if $reactionEmojis.length > 7}
              <button
                type="button"
                class="reaction-expand-btn"
                in:fly={{ y: 8, duration: 160, delay: 7 * 20 }}
                on:click|stopPropagation={() => { reactionsExpanded = true; }}
                title="Все реакции"
              >
                <span class="mask-icon expand-icon" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg');"></span>
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <div
        class="telegram-dropout-card"
        transition:scale={{ duration: 180, start: 0.92, opacity: 0 }}
      >
        {#if viewMode === "readBy"}
          <div class="read-by-panel" in:scale={{ duration: 150, start: 0.92, opacity: 0 }}>
            <button type="button" class="read-by-back-header" on:click|stopPropagation={handleBackFromSeenBy}>
              <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg');"></span>
              <span class="action-label">Назад</span>
            </button>
            <div class="dropout-divider"></div>
            <div class="read-by-list">
              {#if readers.length === 0}
                <div class="read-by-empty">Сообщение пока никто не просмотрел</div>
              {:else}
                {#each readers as reader (reader.userId)}
                  <SeenByItem
                    userId={reader.userId}
                    readTime={reader.readTime}
                    reaction={detailedReactions[reader.userId] || null}
                    compact={true}
                    on:click={() => handleOpenReaderProfile(reader.userId)}
                  />
                {/each}
              {/if}
            </div>
          </div>
        {:else}
          <div class="actions-group">
            {#if canEdit}
              <button type="button" class="action-row" on:click={handleEditMessage}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/edit.svg'); mask-image: url('/icons/edit.svg');"></span>
                <span class="action-label">Редактировать</span>
              </button>
            {/if}

            {#if !isChannel}
              <button type="button" class="action-row" on:click={handleSetReply}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/reply.svg'); mask-image: url('/icons/reply.svg');"></span>
                <span class="action-label">Ответить</span>
              </button>
            {/if}

            <button type="button" class="action-row" on:click={handleForward}>
              <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/forward.svg'); mask-image: url('/icons/forward.svg');"></span>
              <span class="action-label">Переслать</span>
            </button>

            {#if hasText}
              <button type="button" class="action-row" on:click={handleCopy}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/copy.svg'); mask-image: url('/icons/copy.svg');"></span>
                <span class="action-label">Скопировать текст</span>
              </button>
            {/if}

            {#if photoAttach}
              <button type="button" class="action-row" on:click={handleCopyMedia}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/gallery.svg'); mask-image: url('/icons/gallery.svg');"></span>
                <span class="action-label">Копировать фото</span>
              </button>
            {/if}

            {#if mediaAttach}
              <button type="button" class="action-row" on:click={handleSaveMedia}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/download.svg'); mask-image: url('/icons/download.svg');"></span>
                <span class="action-label">{mediaAttach._type === 'PHOTO' || mediaAttach._type === 'VIDEO' ? 'Сохранить в галерею' : 'Сохранить файл'}</span>
              </button>
            {/if}

            {#if isChannel}
              <button type="button" class="action-row" on:click={handleShareLink}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg');"></span>
                <span class="action-label">Поделиться ссылкой</span>
              </button>
            {/if}

            <button type="button" class="action-row" on:click={handleMarkAsUnread}>
              <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/message-unread.svg'); mask-image: url('/icons/message-unread.svg');"></span>
              <span class="action-label action-multiline">Отметить<br />непрочитанным</span>
            </button>

            {#if canPin}
              <button type="button" class="action-row" on:click={handleTogglePin}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/pin.svg'); mask-image: url('/icons/pin.svg');"></span>
                <span class="action-label">{isPinned ? "Открепить" : "Закрепить"}</span>
              </button>
            {/if}

            <button type="button" class="action-row" on:click={handleSelect}>
              <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/check-circle.svg'); mask-image: url('/icons/check-circle.svg');"></span>
              <span class="action-label">Выбрать</span>
            </button>

            {#if hasHistory}
              <button type="button" class="action-row" on:click={handleHistoryMessage}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg');"></span>
                <span class="action-label">История изменений</span>
              </button>
            {/if}

            {#if !isMe}
              <button type="button" class="action-row report-row" on:click={handleReportMessage}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/warning.svg'); mask-image: url('/icons/warning.svg');"></span>
                <span class="action-label">Пожаловаться</span>
              </button>
            {/if}

            {#if (chat?.type === "CHAT" || chat?.type === "GROUP") && readers.length > 0}
              <div class="dropout-divider"></div>
              <button type="button" class="action-row seen-by-row" on:click|stopPropagation={handleOpenSeenBy}>
                <span class="mask-icon action-icon" style="-webkit-mask-image: url('/icons/eye.svg'); mask-image: url('/icons/eye.svg');"></span>
                <span class="action-label">Прочитали</span>
                <span class="mask-icon seen-by-arrow" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg');"></span>
              </button>
            {/if}

            {#if isMe || !isChannel}
              <div class="dropout-divider"></div>
              <button type="button" class="action-row delete-row" on:click={handleDeleteMessage}>
                <span class="mask-icon action-icon delete-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg');"></span>
                <span class="action-label delete-label">Удалить</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      {#if reactionsAllowed && reactionsBelow}
        <div
          class="reaction-capsule is-below"
          transition:fade={{ duration: 160 }}
        >
          <div class="reaction-strip">
            {#each $reactionEmojis.slice(0, 7) as emoji, i (emoji + '_' + i)}
              {@const isSelectedReaction = msg.reactionInfo?.yourReaction === emoji}
              <button
                type="button"
                class="reaction-pill"
                class:is-active={isSelectedReaction}
                in:fly={{ y: 8, duration: 160, delay: i * 20 }}
                on:click|stopPropagation={() => clickReaction(emoji)}
                aria-label="Reaction {emoji}"
              >
                {emoji}
              </button>
            {/each}

            {#if $reactionEmojis.length > 7}
              <button
                type="button"
                class="reaction-expand-btn"
                in:fly={{ y: 8, duration: 160, delay: 7 * 20 }}
                on:click|stopPropagation={() => { reactionsExpanded = true; }}
                title="Все реакции"
              >
                <span class="mask-icon expand-icon" style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg');"></span>
              </button>
            {/if}
          </div>
        </div>
      {/if}
    {:else}
      <div
        class="reactions-picker-card"
        transition:scale={{ duration: 180, start: 0.92, opacity: 0 }}
      >
        {#each $reactionEmojis as emoji, i (emoji + '_' + i)}
          {@const isSelectedReaction = msg.reactionInfo?.yourReaction === emoji}
          <button
            type="button"
            class="picker-pill"
            class:is-active={isSelectedReaction}
            on:click|stopPropagation={() => clickReaction(emoji)}
            aria-label="Reaction {emoji}"
          >
            {emoji}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dropout-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-dropdown-backdrop, 5);
    background: rgba(0, 0, 0, 0.55);
  }

  .dropout-container {
    position: fixed;
    z-index: var(--z-dropdown, 6);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    user-select: none;
    width: fit-content;
    max-width: calc(100vw - 24px);
  }

  .dropout-container.align-left {
    align-items: flex-start;
  }

  .reaction-capsule {
    background: var(--reaction-capsule-bg, #202129);
    border: none;
    border-radius: var(--reaction-capsule-radius, 9999px);
    padding: 4px 8px;
    box-sizing: border-box;
    white-space: nowrap;
    z-index: var(--z-panel, 2);
    margin-bottom: 8px;
  }

  .reaction-capsule.is-below {
    margin-bottom: 0;
    margin-top: 8px;
  }

  .reaction-strip {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
  }

  .reaction-pill {
    font-size: 20px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
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
    background: var(--reaction-chip-active-bg, rgba(123, 76, 214, 0.45));
  }

  .reaction-expand-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.14);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: background 0.15s ease, transform 0.15s ease;
  }

  .reaction-expand-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: scale(1.1);
  }

  .expand-icon {
    width: 14px;
    height: 14px;
    background-color: var(--dropout-icon, #ffffff);
  }

  .telegram-dropout-card {
    display: flex;
    flex-direction: column;
    width: 252px;
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--dropout-card-bg, #23242d);
    border: none;
    border-radius: 14px;
    box-sizing: border-box;
  }

  .actions-group {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
  }

  .action-row,
  .read-by-back-header {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    min-height: 46px;
    padding: 6px 14px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
    box-sizing: border-box;
  }

  .action-row:hover,
  .read-by-back-header:hover {
    background: var(--dropout-item-hover, rgba(255, 255, 255, 0.08));
  }

  .action-row:active,
  .read-by-back-header:active {
    background: var(--dropout-item-active, rgba(255, 255, 255, 0.14));
  }

  .action-icon {
    width: 22px;
    height: 22px;
    background-color: var(--dropout-icon, #ffffff);
    flex-shrink: 0;
  }

  .dropout-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 2px 0;
    flex-shrink: 0;
  }

  .read-by-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .read-by-list {
    display: flex;
    flex-direction: column;
    padding: 4px;
    max-height: 260px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .read-by-empty {
    padding: 20px 14px;
    text-align: center;
    font-size: 14px;
    color: var(--msg-views-color, #8b98a5);
  }

  .action-label {
    flex: 1;
    font-size: 15px;
    font-weight: 400;
    color: var(--dropout-text, #ffffff);
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .action-label.action-multiline {
    white-space: normal;
    line-height: 1.25;
  }

  .delete-row .delete-icon {
    background-color: var(--dropout-danger-icon, #ef4444) !important;
  }

  .delete-row .delete-label {
    color: var(--dropout-danger-text, #ef4444) !important;
  }

  .delete-row:hover {
    background: var(--dropout-danger-hover, rgba(239, 68, 68, 0.12));
  }

  .report-row:hover {
    background: rgba(251, 146, 60, 0.12);
  }

  .seen-by-row {
    justify-content: space-between;
  }

  .seen-by-arrow {
    width: 16px;
    height: 16px;
    background-color: var(--msg-views-color, #8b98a5);
    flex-shrink: 0;
    transform: rotate(-90deg);
  }

  .seen-by-row:hover .seen-by-arrow {
    background-color: var(--dropout-text, #ffffff);
  }

  .reactions-picker-card {
    background: var(--reaction-capsule-bg, #1a1c23);
    border: 1px solid var(--dropout-border, rgba(255, 255, 255, 0.08));
    border-radius: var(--dropout-radius, 18px);
    padding: 12px 14px;
    width: 320px;
    max-width: calc(100vw - 24px);
    max-height: min(340px, calc(100vh - 48px));
    overflow-y: auto;
    overscroll-behavior: contain;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 8px 4px;
    justify-items: center;
    align-items: center;
    box-sizing: border-box;
  }

  .picker-pill {
    width: 34px;
    height: 34px;
    font-size: 22px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    cursor: pointer;
    line-height: 1;
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.12s ease;
  }

  .picker-pill:hover {
    transform: scale(1.22);
    background: rgba(255, 255, 255, 0.12);
  }

  .picker-pill:active {
    transform: scale(0.92);
  }

  .picker-pill.is-active {
    background: var(--reaction-chip-active-bg, rgba(123, 76, 214, 0.45));
  }
</style>