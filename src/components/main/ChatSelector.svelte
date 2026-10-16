<script>
  import { createEventDispatcher } from "svelte";
  import { currentRealChats } from "$lib/stores/api.js";
  import { getChat } from "$lib/stores/messages.js";
  import ChatItem from "$components/chats/ChatItem.svelte";
  import Search from "$components/main/Search.svelte";

  export let selectedIds = [];
  export let actionTitle = "Выберите чаты";
  export let multiSelect = true;

  const dispatch = createEventDispatcher();
  let searchQuery = "";

  $: allChats = ($currentRealChats || []).map(id => getChat(id).getInfo()).filter(Boolean);
  $: filteredChats = allChats.filter((chat) => {
    if (searchQuery) {
      const title = chat.title || chat.participants?.[0]?.name || "";
      if (!title.toLowerCase().includes(searchQuery.toLowerCase()))
        return false;
    }
    return true;
  });

  function toggleSelection(chatId) {
    if (selectedIds.includes(chatId)) {
      selectedIds = selectedIds.filter((id) => id !== chatId);
    } else {
      if (!multiSelect) selectedIds = [];
      selectedIds = [...selectedIds, chatId];
    }
  }

  function handleDone() {
    dispatch("done", selectedIds);
  }
</script>

<div class="selector-layout">
  <header>
    <div class="row">
      <button class="icon-btn" on:click={() => dispatch("cancel")}>✕</button>
      <h3>{actionTitle}</h3>
      <button class="icon-btn check" on:click={handleDone}>OK</button>
    </div>
    <Search bind:search={searchQuery} placeholder="Поиск чатов..." />
  </header>

  <div class="list">
    {#each filteredChats as chat (chat.id)}
      <div class="select-item" on:click={() => toggleSelection(chat.id)}>
        <div class="pointer-events-none">
          <ChatItem {chat} />
        </div>
        <div class="checkbox" class:checked={selectedIds.includes(chat.id)}>
          {#if selectedIds.includes(chat.id)}✓{/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .selector-layout {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #1e1e1e;
    z-index: 100;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 10px;
    background: #252525;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  h3 {
    margin: 0;
    color: #fff;
    font-size: 18px;
  }
  .icon-btn {
    background: none;
    border: none;
    color: #999;
    font-size: 18px;
    cursor: pointer;
    padding: 10px;
  }
  .icon-btn.check {
    color: #4ade80;
    font-weight: bold;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }

  .select-item {
    position: relative;
    display: flex;
    align-items: center;
    /* pointer-events-none для ChatItem, чтобы клик обрабатывал родитель */
  }
  .pointer-events-none {
    flex: 1;
    pointer-events: none;
  }

  .checkbox {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid #555;
    margin-left: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #1e1e1e;
    font-weight: bold;
    font-size: 14px;
    transition: 0.2s;
  }
  .checkbox.checked {
    background: #4ade80;
    border-color: #4ade80;
  }
</style>
