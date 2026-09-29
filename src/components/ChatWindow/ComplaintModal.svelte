<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import API from "$lib/stores/api";

  import { complaintReasons, preloadComplaintReasons } from "$lib/stores/complaints.js";

  export let messageId;
  export let chatId;

  const dispatch = createEventDispatcher();

  let submitting = false;

  $: reasons = $complaintReasons;

  onMount(() => {
    preloadComplaintReasons().catch(() => {});
  });

  async function submitComplaint(reason) {
    if (submitting) return;
    submitting = true;
    try {
      await $API.sendComplaint(reason.id, 2, [String(messageId)], chatId);
      dispatch("success", { reason });
    } catch (err) {
      console.error("Complaint submission error:", err);
      dispatch("error", { err });
    } finally {
      submitting = false;
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      dispatch("close");
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="modal-backdrop" on:click={() => dispatch("close")} transition:fade={{ duration: 150 }}>
  <div
    class="modal-sheet"
    on:click|stopPropagation
    transition:fly={{ y: 80, duration: 200 }}
  >
    <div class="sheet-header">
      <div class="header-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z" />
        </svg>
      </div>
      <div class="header-text">
        <h3 class="sheet-title">Пожаловаться</h3>
        <p class="sheet-subtitle">Выберите причину жалобы на сообщение</p>
      </div>
      <button type="button" class="btn-close" on:click={() => dispatch("close")}>✕</button>
    </div>

    <div class="reasons-list">
      {#each reasons as reason (reason.id)}
        <button
          type="button"
          class="reason-row"
          disabled={submitting}
          on:click={() => submitComplaint(reason)}
        >
          <span class="reason-title">{reason.title}</span>
          <svg viewBox="0 0 24 24" class="arrow-icon">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
          </svg>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 120;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-sheet {
    background: #1c1d29;
    border-radius: 18px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65);
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.14);
    color: #f87171;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .header-text {
    flex: 1;
    min-width: 0;
  }

  .sheet-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
  }

  .sheet-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .btn-close {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    color: rgba(255, 255, 255, 0.7);
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
  }

  .btn-close:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
  }

  .reasons-list {
    display: flex;
    flex-direction: column;
    padding: 8px 12px 14px 12px;
    max-height: 360px;
    overflow-y: auto;
  }

  .reason-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 12px 14px;
    background: transparent;
    border: none;
    border-radius: 10px;
    color: #ffffff;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s ease;
    text-align: left;
  }

  .reason-row:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }

  .reason-row:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .arrow-icon {
    width: 18px;
    height: 18px;
    color: rgba(255, 255, 255, 0.4);
  }

  .loading-state {
    padding: 24px;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
  }
</style>
