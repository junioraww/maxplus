<script>
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

<div class="modal-backdrop" transition:fade={{ duration: 180 }} on:click={close}>
  <div class="modal-card" transition:scale={{ duration: 200, start: 0.94 }} on:click|stopPropagation>
    <div class="modal-head">
      <div class="title-wrap">
        <h3>Заявки на вступление</h3>
        <span class="sub-label">{requests.length} ожидает подтверждения</span>
      </div>
      <button type="button" class="btn-close" on:click={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    {#if requests.length > 1}
      <div class="bulk-bar">
        <button type="button" class="btn-bulk" on:click={acceptAll} disabled={isLoading}>
          Принять всех
        </button>
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
              <button
                type="button"
                class="btn-icon accept"
                title="Принять"
                disabled={processingIds.has(uid)}
                on:click={() => handleAccept(uid)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
              <button
                type="button"
                class="btn-icon decline"
                title="Отклонить"
                disabled={processingIds.has(uid)}
                on:click={() => handleDecline(uid)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
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
      <button type="button" class="btn btn-secondary" on:click={close}>Закрыть</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
  }

  .modal-card {
    background: #1e2025;
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.65);
    border-radius: 18px;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    max-height: 80vh;
    overflow: hidden;
    color: #edf0f5;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .title-wrap h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    color: #f8fafc;
  }

  .sub-label {
    font-size: 12px;
    color: #8b98a5;
  }

  .btn-close {
    background: none;
    border: none;
    color: #8b98a5;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    transition: 0.15s;
  }

  .btn-close:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .bulk-bar {
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: flex-end;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .btn-bulk {
    background: rgba(43, 130, 246, 0.14);
    color: #3b82f6;
    border: none;
    font-size: 13px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 7px;
    cursor: pointer;
    transition: 0.15s;
  }

  .btn-bulk:hover:not(:disabled) {
    background: rgba(43, 130, 246, 0.25);
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
    color: #64748b;
    font-size: 14px;
  }

  .request-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(255, 255, 255, 0.05);
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
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-sub {
    font-size: 12px;
    color: #8b98a5;
  }

  .action-buttons {
    display: flex;
    gap: 6px;
  }

  .btn-icon {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: 0.15s;
  }

  .btn-icon.accept {
    background: rgba(34, 197, 94, 0.14);
    color: #4ade80;
  }

  .btn-icon.accept:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.28);
  }

  .btn-icon.decline {
    background: rgba(239, 68, 68, 0.14);
    color: #f87171;
  }

  .btn-icon.decline:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.28);
  }

  .btn-icon:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .status-banner {
    margin: 4px 16px;
    font-size: 13px;
    color: #f87171;
    text-align: center;
  }

  .modal-foot {
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.18);
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: 0.15s;
  }

  .btn-secondary {
    background: rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
  }
</style>
