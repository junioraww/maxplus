<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import API from "$lib/stores/api";
  import { registerBackHandler } from "$lib/utils/backButton.js";
  import SeenByItem from "./SeenByItem.svelte";

  export let chat = null;
  export let msg = null;
  export let readers = [];

  const dispatch = createEventDispatcher();
  let detailedReactions = {};
  let unregisterBack = null;

  function close() {
    dispatch("close");
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      close();
    }
  }

  onMount(async () => {
    unregisterBack = registerBackHandler(() => {
      close();
      return true;
    });

    if (chat?.id && msg?.id) {
      try {
        const res = await $API.getDetailedReactions(chat.id, msg.id);
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
  });

  onDestroy(() => {
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
  });

  function getPluralTitle(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${count} человек`;
    if (mod10 === 1) return `${count} человек`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} человека`;
    return `${count} человек`;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop" transition:fade={{ duration: 150 }} on:click={close}>
  <div class="modal-box" transition:scale={{ start: 0.95, duration: 150 }} on:click|stopPropagation>
    <div class="modal-header">
      <div class="header-left">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
        </svg>
        <div class="header-titles">
          <h3>Просмотры сообщения</h3>
          <span class="header-subtitle">{getPluralTitle(readers.length)}</span>
        </div>
      </div>
      <button class="close-btn" type="button" on:click={close} title="Закрыть">✕</button>
    </div>

    <div class="modal-body">
      {#if readers.length === 0}
        <div class="empty-state">
          Сообщение пока никто не просмотрел
        </div>
      {:else}
        <div class="readers-list">
          {#each readers as reader (reader.userId)}
            <SeenByItem
              userId={reader.userId}
              readTime={reader.readTime}
              reaction={detailedReactions[reader.userId] || null}
            />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-box {
    background: #17191d;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    width: 100%;
    max-width: 440px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    color: #248bfe;
  }

  .header-titles {
    display: flex;
    flex-direction: column;
  }

  .header-left h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #edf0f5;
  }

  .header-subtitle {
    font-size: 12px;
    color: #8b98a5;
  }

  .close-btn {
    background: none;
    border: none;
    color: #8b98a5;
    cursor: pointer;
    font-size: 16px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: 0.15s;
  }

  .close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .modal-body {
    padding: 8px 12px;
    overflow-y: auto;
    max-height: calc(80vh - 70px);
    display: flex;
    flex-direction: column;
  }

  .readers-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: #8b98a5;
    font-size: 14px;
  }
</style>
