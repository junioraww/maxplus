<script>
  import { IconButton, Modal } from "$components/ui";
  import { createEventDispatcher } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { computeTextDiff } from '$lib/utils/diff.js';

  export let msg = null;

  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
    }
  }

  $: historyList = (() => {
    if (!msg || !Array.isArray(msg.history)) return [];
    return [...msg.history].sort((a, b) => (b.at || 0) - (a.at || 0));
  })();

  function formatTime(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    return date.toLocaleString([], {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function resolveDiff(entry, currentText) {
    if (entry.diff && Array.isArray(entry.diff)) {
      return entry.diff;
    }
    if (typeof entry.text === 'string') {
      return computeTextDiff(entry.text, currentText || '');
    }
    return [];
  }
</script>


<Modal open={true} size="lg" showClose={false} class="edit-history-modal" onclose={close}>
    <div class="modal-header">
      <div class="header-left">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
        </svg>
        <h3>История изменений</h3>
      </div>
      <IconButton class="edithistorymodal-close-btn" onclick={close} title="Закрыть">✕</IconButton>
    </div>

    <div class="modal-body">
      <div class="version-card current-version">
        <div class="version-meta">
          <span class="badge current-badge">Текущая версия</span>
          {#if msg.edited_at || msg.time}
            <span class="version-time">{formatTime(msg.edited_at || msg.time)}</span>
          {/if}
        </div>
        <div class="version-content">
          {#if msg.text}
            <p class="text-content">{msg.text}</p>
          {/if}
          {#if msg.attaches?.length}
            <div class="attaches-summary">
              📎 Вложений: {msg.attaches.length}
            </div>
          {/if}
        </div>
      </div>

      {#if historyList.length === 0}
        <div class="empty-state">
          Нет сохранённых предыдущих редакций
        </div>
      {:else}
        <div class="history-list">
          {#each historyList as entry, idx}
            {@const diff = resolveDiff(entry, msg.text)}
            <div class="version-card">
              <div class="version-meta">
                <span class="badge diff-badge">Правка #{historyList.length - idx}</span>
                <span class="version-time">{formatTime(entry.at)}</span>
              </div>

              {#if diff && diff.length}
                <div class="diff-container">
                  {#each diff as chunk}
                    {#if chunk.op === '+'}
                      <span class="chunk-add">{chunk.text}</span>
                    {:else if chunk.op === '-'}
                      <span class="chunk-del">{chunk.text}</span>
                    {:else}
                      <span class="chunk-eq">{chunk.text}</span>
                    {/if}
                  {/each}
                </div>
              {:else if entry.text}
                <p class="text-content old-text">{entry.text}</p>
              {/if}

              {#if entry.attaches_diff}
                <div class="attaches-diff">
                  {#if entry.attaches_diff.added?.length}
                    <div class="attach-change add">
                      + Добавлено вложений: {entry.attaches_diff.added.length}
                    </div>
                  {/if}
                  {#if entry.attaches_diff.removed?.length}
                    <div class="attach-change remove">
                      − Удалено вложений: {entry.attaches_diff.removed.length}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </Modal>

<style>
  :global(.edit-history-modal .modal__body) { padding: 0; }


  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--accent-primary);
  }

  .header-left h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }



  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .version-card {
    background: var(--bg-surface);
    border-radius: 12px;
    padding: 12px 14px;
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .current-version {
    border-color: rgba(36, 139, 254, 0.3);
    background: rgba(36, 139, 254, 0.06);
  }

  .version-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .current-badge {
    background: rgba(36, 139, 254, 0.2);
    color: var(--accent-primary);
  }

  .diff-badge {
    background: var(--bg-surface);
    color: var(--text-muted);
  }

  .version-time {
    font-size: 11px;
    color: var(--text-muted);
  }

  .text-content {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .old-text {
    color: var(--text-muted);
  }

  .diff-container {
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(0, 0, 0, 0.25);
    padding: 8px 10px;
    border-radius: 8px;
  }

  .chunk-add {
    background: rgba(34, 197, 94, 0.2);
    color: var(--status-success);
    text-decoration: none;
    border-radius: 2px;
    padding: 1px 2px;
  }

  .chunk-del {
    background: var(--danger-subtle-strong);
    color: var(--status-danger);
    text-decoration: line-through;
    border-radius: 2px;
    padding: 1px 2px;
  }

  .chunk-eq {
    color: #cbd5e1;
  }

  .attaches-summary {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }

  .attaches-diff {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }

  .attach-change.add {
    color: var(--status-success);
  }

  .attach-change.remove {
    color: var(--status-danger);
  }

  .empty-state {
    text-align: center;
    padding: 24px;
    color: var(--text-muted);
    font-size: 13px;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
