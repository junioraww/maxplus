<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import ChatItem from "./ChatItem.svelte";

  export let chats = [];
  export let isSelectionMode = false;
  export let selectedChats = new Set();
  export let loading = false;

  const dispatch = createEventDispatcher();

  const CHUNK_SIZE = 25;
  let visibleCount = CHUNK_SIZE;

  let listEl;
  let sentinelEl;
  let observer;

  function loadMore() {
    if (visibleCount < chats.length) {
      visibleCount = Math.min(visibleCount + CHUNK_SIZE, chats.length);
    }
  }

  function handleIntersect(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        loadMore();
      }
    }
  }

  function handleListScroll(e) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      loadMore();
    }
  }

  onMount(() => {
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(handleIntersect, {
        root: listEl,
        rootMargin: "300px",
      });
      if (sentinelEl) {
        observer.observe(sentinelEl);
      }
    }
  });

  onDestroy(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });

  $: if (sentinelEl && observer) {
    observer.disconnect();
    if (visibleCount < chats.length) {
      observer.observe(sentinelEl);
    }
  }

  $: visibleChats = chats.slice(0, visibleCount);
</script>

<div
  bind:this={listEl}
  class="chat-list-inner"
  on:scroll={handleListScroll}
>
  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if chats.length === 0}
    <div class="state">Нет чатов</div>
  {:else}
    {#each visibleChats as chat (chat.id)}
      <ChatItem
        {chat}
        selectionMode={isSelectionMode}
        isSelected={selectedChats.has(chat.id)}
        on:open
        on:longpress
        on:toggle
      />
    {/each}

    {#if visibleCount < chats.length}
      <div bind:this={sentinelEl} class="scroll-sentinel"></div>
    {/if}
  {/if}
</div>

<style>
  .chat-list-inner {
    flex: 1;
    overflow-y: auto;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    contain: layout;
    -webkit-overflow-scrolling: touch;
  }

  .state {
    text-align: center;
    color: #777;
    margin-top: 50px;
  }

  .scroll-sentinel {
    height: 1px;
    width: 100%;
    pointer-events: none;
    opacity: 0;
  }
</style>
