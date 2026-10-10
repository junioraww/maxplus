<script>
  import { Button, IconButton, Modal } from "$components/ui";
  import { fade, scale } from "svelte/transition";
  import { createEventDispatcher, onMount } from "svelte";
  import API from "$lib/stores/api";
  import Avatar from "$components/main/Avatar.svelte";

  export let chat;

  const dispatch = createEventDispatcher();

  let requests = [];
  let isLoading = true;
  let processingIds = new Set();
  let statusMessage = "";

  onMount(() => {
    loadRequests();
  });

  async function loadRequests() {
    isLoading = true;
    try {
      const res = await $API.fetchJoinRequests(chat.id);
      requests = Array.isArray(res) ? res : (res?.members || []);
    } catch (e) {
      requests = [];
    } finally {
      isLoading = false;
    }
  }

  async function handleAccept(userId) {
    if (processingIds.has(userId)) return;
    processingIds.add(userId);
    processingIds = new Set(processingIds);
    try {
      await $API.confirmJoinRequests(chat.id, [userId]);
      requests = requests.filter(r => (r.contact?.id || r.id) !== userId);
      dispatch("processed", { userId, accepted: true });
    } catch (e) {
      statusMessage = "Ошибка при подтверждении";
    } finally {
      processingIds.delete(userId);
      processingIds = new Set(processingIds);
    }
  }

  async function handleDecline(userId) {
    if (processingIds.has(userId)) return;
    processingIds.add(userId);
    processingIds = new Set(processingIds);
    try {
      await $API.declineJoinRequests(chat.id, [userId]);
      requests = requests.filter(r => (r.contact?.id || r.id) !== userId);
      dispatch("processed", { userId, accepted: false });
    } catch (e) {
      statusMessage = "Ошибка при отклонении";
    } finally {
      processingIds.delete(userId);
      processingIds = new Set(processingIds);
    }
  }

  async function acceptAll() {
    const allIds = requests.map(r => r.contact?.id || r.id).filter(Boolean);
    if (!allIds.length) return;
    isLoading = true;
    try {
      await $API.confirmJoinRequests(chat.id, allIds);
      requests = [];
      dispatch("processed", { all: true, accepted: true });
    } catch (e) {
      statusMessage = "Ошибка при принятии всех";
    } finally {
      isLoading = false;
    }
  }

  function close() {
    dispatch("close");
  }
</script>

<Modal open={true} bare closeOnEsc={true} onclose={close}>
  <div class="modal-card">
    <div class="modal-head">
      <div class="title-wrap">
        <h3>Заявки на вступление</h3>
        <span class="sub-label">{requests.length} ожидает подтверждения</span>
      </div>
      <IconButton class="groupjoinrequestsmodal-btn-close" onclick={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </IconButton>
    </div>

    {#if requests.length > 1}
      <div class="bulk-bar">
        <Button class="groupjoinrequestsmodal-btn-bulk" onclick={acceptAll} disabled={isLoading}>
          Принять всех
        </Button>
      </div>
    {/if}

    <div class="requests-scroll">
      {#if isLoading}
        <div class="state-msg">Загрузка заявок...</div>
      {:else if requests.length === 0}
        <div class="state-msg">Нет активных заявок</div>
      {:else}
        {#each requests as req ((req.contact?.id || req.id))}
          {@const uid = req.contact?.id || req.id}
          {@const name = req.contact?.displayName || req.contact?.names?.[0]?.name || "Пользователь"}
          <div class="request-row">
            <Avatar contactId={uid} size={40} />
            <div class="user-meta">
              <span class="user-title">{name}</span>
              <span class="user-sub">ID: {uid}</span>
            </div>
            <div class="action-buttons">
              <IconButton class="groupjoinrequestsmodal-btn-icon groupjoinrequestsmodal-accept" title="Принять" disabled={processingIds.has(uid)} onclick={() => handleAccept(uid)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </IconButton>
              <IconButton class="groupjoinrequestsmodal-btn-icon groupjoinrequestsmodal-decline" title="Отклонить" disabled={processingIds.has(uid)} onclick={() => handleDecline(uid)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </IconButton>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if statusMessage}
      <div class="status-banner" transition:fade={{ duration: 150 }}>
        {statusMessage}
      </div>
    {/if}

    <div class="modal-foot">
      <Button class="groupjoinrequestsmodal-btn groupjoinrequestsmodal-btn-secondary" onclick={close}>Закрыть</Button>
    </div>
  </div>
</Modal>

<style>

  .modal-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
    border-radius: 18px;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    max-height: 80vh;
    overflow: hidden;
    color: var(--text-primary);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .title-wrap h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .sub-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  :global(.groupjoinrequestsmodal-btn-close)  { width: 32px; }


  .bulk-bar {
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: flex-end;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }



  .requests-scroll {
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 120px;
  }

  .state-msg {
    padding: 36px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
  }

  .request-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
  }

  .user-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .user-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-sub {
    font-size: 12px;
    color: var(--text-muted);
  }

  .action-buttons {
    display: flex;
    gap: 6px;
  }

  :global(.groupjoinrequestsmodal-btn-icon)  { width: 34px; }






  .status-banner {
    margin: 4px 16px;
    font-size: 13px;
    color: var(--status-danger);
    text-align: center;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.18);
    border-top: 1px solid var(--border-subtle);
  }



</style>
