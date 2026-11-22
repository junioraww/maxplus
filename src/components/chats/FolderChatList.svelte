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
    dispatch("loadMore");
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
    dispatch("scroll", { scrollTop: el.scrollTop });
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      loadMore();
    }
  }

  function handleWheel(e) {
    if (listEl && listEl.scrollTop <= 0 && e.deltaY < -15) {
      dispatch("wheelUp");
    } else if (e.deltaY > 15) {
      dispatch("wheelDown");
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
  on:wheel={handleWheel}
>
  {#if loading}
    <div class="state">Загрузка...</div>
  {:else if chats.length === 0}
    <div class="empty-folder-state">
      <div class="empty-icon-wrap">
        <img src="/icons/folder.svg" class="empty-folder-icon" alt="" />
      </div>
      <h3 class="empty-title font-title">В этой папке пусто</h3>
      <p class="empty-subtitle">Чаты появятся здесь автоматически или добавьте их вручную</p>
    </div>
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

    <div class="chat-list-bottom-actions">
      <button class="bottom-action-item" on:click={() => dispatch("findContact")}>
        <div class="action-icon-wrap">
          <img src="/icons/phone.svg" width="24" height="24" alt="" />
        </div>
        <span class="action-label">Найти по номеру телефона</span>
      </button>
      <button class="bottom-action-item" on:click={() => dispatch("inviteLink")}>
        <div class="action-icon-wrap">
          <img src="/icons/link.svg" width="24" height="24" alt="" />
        </div>
        <span class="action-label">Пригласить по ссылке</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .chat-list-inner {
    flex: 1;
    overflow-y: auto;
    margin: 0;
    display: flex;
    flex-direction: column;
    contain: layout;
    -webkit-overflow-scrolling: touch;
  }

  .state {
    text-align: center;
    color: var(--text-muted, #8b929e);
    font-size: 16px;
    margin-top: 60px;
  }

  .empty-folder-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px 40px;
    text-align: center;
    user-select: none;
    margin: auto 0;
  }

  .empty-icon-wrap {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.04);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
  }

  .empty-folder-icon {
    width: 36px;
    height: 36px;
    opacity: 0.45;
    filter: brightness(0) invert(1);
  }

  .empty-title {
    font-size: 17px;
    font-weight: var(--font-weight-title, 600);
    line-height: 22px;
    color: #ffffff;
    margin: 0 0 8px;
  }

  .empty-subtitle {
    font-size: 14px;
    font-weight: var(--font-weight-normal, 400);
    line-height: 18px;
    color: var(--text-muted, #8b929e);
    margin: 0;
    max-width: 260px;
  }

  .scroll-sentinel {
    height: 1px;
    width: 100%;
    pointer-events: none;
    opacity: 0;
  }

  .chat-list-bottom-actions {
    display: flex;
    flex-direction: column;
    padding: 8px 0 24px;
    margin-top: 4px;
  }

  .bottom-action-item {
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 12px 0 18px;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background-color 0.15s ease;
    width: 100%;
    box-sizing: border-box;
  }

  .bottom-action-item:hover {
    background-color: var(--bg-surface-subtle, rgba(255, 255, 255, 0.05));
  }

  .action-icon-wrap {
    width: 24px;
    height: 24px;
    margin-right: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .action-icon-wrap img {
    width: 24px;
    height: 24px;
    opacity: 0.9;
  }

  .action-label {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
    line-height: 20px;
  }
</style>
