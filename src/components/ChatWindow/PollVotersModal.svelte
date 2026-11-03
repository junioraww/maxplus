<script>
  import { createEventDispatcher, onMount } from "svelte";
  import { fade, scale } from "svelte/transition";
  import API from "$lib/stores/api";
  import Session from "$lib/stores/session";
  import SeenByItem from "./SeenByItem.svelte";

  export let chatId = null;
  export let messageId = null;
  export let pollId = null;
  export let answer = null;

  const dispatch = createEventDispatcher();
  let voters = [];
  let loading = true;

  $: answerText = answer?.text || "";
  $: answerId = Number(answer?.answerId ?? answer?.id ?? 0);

  function close() {
    dispatch("close");
  }

  function handleKeydown(e) {
    if (e.key === "Escape") close();
  }

  function openProfile(userId) {
    if (!userId) return;
    $Session.profile = { userId: Number(userId) };
    close();
  }

  onMount(async () => {
    if (Array.isArray(answer?.votes) && answer.votes.length > 0) {
      voters = answer.votes.map((v) => ({
        userId: Number(v.userId || v.user_id || v),
        timestamp: Number(v.timestamp || 0),
      }));
    }

    if (chatId && messageId && pollId && answerId) {
      try {
        const res = await $API.getPollVoters(chatId, messageId, pollId, answerId, 0, 50);
        const list = res?.payload?.voters || res?.voters || res?.items || (Array.isArray(res) ? res : []);
        if (Array.isArray(list) && list.length > 0) {
          const serverVoters = list.map((v) => ({
            userId: Number(v.userId || v.user_id || v),
            timestamp: Number(v.timestamp || 0),
          }));
          const serverIds = new Set(serverVoters.map((v) => v.userId));
          voters = [
            ...voters.filter((v) => !serverIds.has(v.userId)),
            ...serverVoters,
          ];
        }
      } catch (_) {
      } finally {
        loading = false;
      }
    } else {
      loading = false;
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop" transition:fade={{ duration: 150 }} on:click={close}>
  <div class="modal-box" transition:scale={{ start: 0.95, duration: 150 }} on:click|stopPropagation>
    <div class="modal-header">
      <div class="header-titles">
        <h3>Проголосовавшие</h3>
        <span class="header-subtitle">{answerText}</span>
      </div>
      <button class="close-btn" type="button" on:click={close} title="Закрыть">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="modal-body">
      {#if voters.length === 0}
        <div class="empty-state">
          {loading ? "Загрузка..." : "Никто еще не выбрал этот ответ"}
        </div>
      {:else}
        <div class="voters-list">
          {#each voters as voter (voter.userId)}
            <div class="voter-row" on:click={() => openProfile(voter.userId)}>
              <SeenByItem userId={voter.userId} readTime={voter.timestamp} />
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.72); display: flex; align-items: center; justify-content: center; z-index: var(--z-modal, 7); padding: 16px; box-sizing: border-box; }
  .modal-box { background: #1e2025; border-radius: 14px; width: 100%; max-width: 380px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6); overflow: hidden; }
  .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
  .header-titles h3 { margin: 0; font-size: 15px; font-weight: 600; color: #f3f4f6; }
  .header-subtitle { font-size: 12px; color: var(--text-secondary, #9ca3af); display: block; margin-top: 2px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .close-btn { background: none; border: none; color: var(--text-secondary, #9ca3af); cursor: pointer; padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s; }
  .close-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
  .modal-body { padding: 8px; overflow-y: auto; flex: 1; min-height: 120px; }
  .empty-state { padding: 32px 16px; text-align: center; color: var(--text-secondary, #9ca3af); font-size: 13px; }
  .voters-list { display: flex; flex-direction: column; gap: 2px; }
  .voter-row { cursor: pointer; border-radius: 10px; }
  .voter-row:hover { background: rgba(255, 255, 255, 0.05); }
</style>
