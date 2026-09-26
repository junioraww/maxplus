<script>
  import { createEventDispatcher, onDestroy } from "svelte";
  import { get as sessionGet } from "$lib/stores/session";
  import { fade, fly } from "svelte/transition";
  import { tick } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import { handleReaction } from "$components/ChatWindow/actions";
  import API, { currentSessionChats, currentUser, serverConfig } from "$lib/stores/api";
  import {
    saveChats,
  } from "$lib/stores/messages";

  export let activeAt;
  export let chat;

  const dispatch = createEventDispatcher();

  let menuPosition = { top: 0, left: 0 };
  let menuNode;

  const reactions = sessionGet("reactions") || [];

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
    const { offsetWidth, offsetHeight } = menuNode;
    const { innerWidth, innerHeight } = window;
    let x = clientX;
    let y = clientY;
    if (x + offsetWidth > innerWidth) {
      x = x - offsetWidth;
      if (x < 0) x = innerWidth - offsetWidth - 10;
    }
    if (y + offsetHeight > innerHeight) {
      y = y - offsetHeight;
      if (y < 0) y = innerHeight - offsetHeight - 10;
    }
    menuPosition = { top: y, left: x };
    cleanupBack();
    unregisterBack = registerBackHandler(() => {
      dispatch("close", { update: false });
    });
  }

  $: if (activeAt) {
    updatePosition(activeAt.e.clientX, activeAt.e.clientY);
  } else {
    cleanupBack();
  }

  const clickReaction = async (emoji) => {
    handleReaction(chat, activeAt.msg, emoji);

    dispatch("close", { action: "reaction" });
    cleanupBack();
  };

  onDestroy(() => {
    cleanupBack();
  });

  function handleSetReply() {
    dispatch("reply", { id: activeAt.msg.id });
    dispatch("close", {});
    cleanupBack();
  }

  async function handlePinMessage() {
    const response = await $API.pinMessage(chat.id, activeAt.msg.id);

    currentSessionChats.update(chats => {
      const idx = chats.findIndex(x => x.id === chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      chats.push(chat);
    });

    await saveChats([ chat ]);

    dispatch("close", {});
    cleanupBack();
  }

  function handleEditMessage() {
    dispatch("edit", { msg: activeAt.msg });
    dispatch("close", {});
    cleanupBack();
  }

  function handleHistoryMessage() {
    dispatch("history", { msg: activeAt.msg });
    dispatch("close", {});
    cleanupBack();
  }

  async function handleDeleteMessage() {
    const response = await $API.deleteMessage(chat.id, activeAt.msg.id, false);

    dispatch("close", { action: "delete" });
    cleanupBack();
  }
  $: editTimeoutSec = Number($serverConfig?.["edit-timeout"]) || 86400;
</script>

{#if activeAt}
  {@const isMe = Number(activeAt.msg?.sender) === Number($currentUser)}
  {@const isDeleted = activeAt.msg?.deleted === true}
  {@const msgTime = Number(activeAt.msg?.time) || 0}
  {@const canEdit = isMe && !isDeleted && (msgTime > 0 ? (Date.now() - msgTime <= editTimeoutSec * 1000) : true)}
  {@const hasHistory = !!(activeAt.msg?.edited || activeAt.msg?.status === 'EDITED' || (Array.isArray(activeAt.msg?.history) && activeAt.msg.history.length > 0))}

  <div
    class="message-actions-dropout"
    bind:this={menuNode}
    transition:fly={{ y: -10, duration: 200 }}
    style="top:{menuPosition.top}px; left:{menuPosition.left}px;"
    on:click|stopPropagation
  >
    {#if !chat.reactions || !!chat.reactions.isActive}
      <div
        class="reactions-picker"
        on:wheel={(e) => {
          if (e.currentTarget.scrollWidth > e.currentTarget.clientWidth) {
            e.preventDefault();
            e.currentTarget.scrollLeft += e.deltaY / 4;
          }
        }}
      >
        {#each reactions as emoji (emoji)}
          <button on:click={() => clickReaction(emoji)}>{emoji}</button>
        {/each}
      </div>
    {/if}

    <div class="actions">
      {#if canEdit}
        <button on:click={handleEditMessage}>Изменить</button>
      {/if}
      {#if hasHistory}
        <button on:click={handleHistoryMessage}>История изменений</button>
      {/if}
      <button on:click={() => handleSetReply()}>Ответить</button>
      <button on:click={() => handlePinMessage()}>Закрепить</button>
      <button on:click={() => handleDeleteMessage()}>Удалить</button>
    </div>
  </div>
{/if}

<style>
  .message-actions-dropout {
    position: fixed;
    z-index: 10;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 150px;
    max-width: 200px;
  }

  .message-actions-dropout button {
    padding: 10px 15px;
    border: none;
    background: none;
    color: white;
    text-align: left;
    cursor: pointer;
    width: 100%;
    font-size: 14px;
    letter-spacing: 1px;
    text-align: center;
  }

  .reactions-picker {
    display: flex;
    justify-content: space-around;
    padding: 4px;
    width: 200px;
    overflow-x: scroll;
    overflow-y: hidden;
  }

  .reactions-picker::-webkit-scrollbar {
    display: none;
  }

  .actions button {
    background: #111116;
    opacity: 0.8;
    transition: background 0.1s;
  }

  .actions button:hover {
    background: #333339;
  }

  .reactions-picker button {
    font-size: 20px;
    padding: 4px;
    border-radius: 50%;
    line-height: 1;
    transition:
      transform 0.1s,
      background-color 0.1s;
    border: none;
    background: none;
    cursor: pointer;
  }
</style>
