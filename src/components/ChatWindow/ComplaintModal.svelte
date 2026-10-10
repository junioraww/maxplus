<script>
  import { IconButton, MenuItem, Modal } from "$components/ui";
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

<Modal open={true} bare zIndex={120} closeOnEsc={false} onclose={() => dispatch("close")}>
  <div
    class="modal-sheet"
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
      <IconButton class="complaintmodal-btn-close" onclick={() => dispatch("close")}>✕</IconButton>
    </div>

    <div class="reasons-list">
      {#each reasons as reason (reason.id)}
        <MenuItem class="complaintmodal-reason-row" disabled={submitting} onclick={() => submitComplaint(reason)}><span class="reason-title">{reason.title}</span>
          <svg viewBox="0 0 24 24" class="arrow-icon">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" fill="currentColor"/>
          </svg></MenuItem>
      {/each}
    </div>
  </div>
</Modal>

<style>

  .modal-sheet {
    background: #1c1d29;
    border-radius: 18px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.65);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .header-icon {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: rgba(239, 68, 68, 0.14);
    color: var(--status-danger);
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
    color: var(--text-primary);
  }

  .sheet-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  :global(.complaintmodal-btn-close)  { width: 28px; }


  .reasons-list {
    display: flex;
    flex-direction: column;
    padding: 8px 12px 14px 12px;
    max-height: 360px;
    overflow-y: auto;
  }

  :global(.complaintmodal-reason-row)  { width: 100%; }



  .arrow-icon {
    width: 18px;
    height: 18px;
    color: rgba(255, 255, 255, 0.4);
  }

</style>
