<script>
  import { createEventDispatcher, getContext, onDestroy } from "svelte";
  import { get as sessionGet } from "$lib/stores/session";
  import { fade, fly } from "svelte/transition";
  import { tick } from "svelte";

  import { handleReaction } from "$components/ChatWindow/actions";
  import { currentSessionChats } from "$lib/stores/api";
  import {
    saveChats,
  } from "$lib/stores/messages";
  import API from "$lib/stores/api";

  export let activeAt;
  export let chat;

  const dispatch = createEventDispatcher();

  let menuPosition = { top: 0, left: 0 };
  let menuNode;

  const reactions = sessionGet("reactions") || [];

  const onBack = getContext("onBack");

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
    if (onBack.chatSettings) onBack.chatSettings();
    onBack["dropout"] = () => {
      dispatch("close", { update: false });
      delete onBack["dropout"];
    };
  }

  $: if (activeAt) {
    updatePosition(activeAt.e.clientX, activeAt.e.clientY);
  }

  const clickReaction = async (emoji) => {
    handleReaction(chat, activeAt.msg, emoji);

    dispatch("close", { action: "reaction" });

    if (onBack.dropout) delete onBack["dropout"];
  };

  onDestroy(() => {
    delete onBack["dropout"];
  });

  function handleSetReply() {
    dispatch("reply", { id: activeAt.msg.id });
    dispatch("close", {});

    if (onBack.dropout) delete onBack["dropout"];
  }

  async function handlePinMessage() {
    const response = await $API.pinMessage(chat.id, activeAt.msg.id);

    // TODO Optimize
    currentSessionChats.update(chats => {
      const idx = chats.findIndex(x => x.id === chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      chats.push(chat);
    });

    await saveChats([ chat ]);

    dispatch("close", {});
    if (onBack.dropout) delete onBack["dropout"];
  }

  async function handleDeleteMessage() {
    const response = await $API.deleteMessage(chat.id, activeAt.msg.id, false);

    /*$API.savedMessages[chat.id] = $API.savedMessages[chat.id].filter(
      (x) => x.id !== activeAt.msg.id,
    );*/

    dispatch("close", { action: "delete" });
    if (onBack.dropout) delete onBack["dropout"];
  }
</script>

{#if activeAt}
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
