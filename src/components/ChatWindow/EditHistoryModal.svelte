<script>
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

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop" transition:fade={{ duration: 150 }} on:click={close}>
  <div class="modal-box" transition:scale={{ start: 0.95, duration: 150 }} on:click|stopPropagation>
    <div class="modal-header">
      <div class="header-left">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
        </svg>
        <h3>История изменений</h3>
      </div>
      <button class="close-btn" type="button" on:click={close} title="Закрыть">✕</button>
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
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
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
    max-width: 520px;
    max-height: 85vh;
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
    gap: 10px;
    color: #248bfe;
  }

  .header-left h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #edf0f5;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #8b929e;
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .version-card {
    background: #1e2025;
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
    color: #38bdf8;
  }

  .diff-badge {
    background: rgba(255, 255, 255, 0.08);
    color: #94a3b8;
  }

  .version-time {
    font-size: 11px;
    color: #64748b;
  }

  .text-content {
    margin: 0;
    font-size: 14px;
    line-height: 20px;
    color: #edf0f5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .old-text {
    color: #94a3b8;
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
    color: #4ade80;
    text-decoration: none;
    border-radius: 2px;
    padding: 1px 2px;
  }

  .chunk-del {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
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
    color: #94a3b8;
  }

  .attaches-diff {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }

  .attach-change.add {
    color: #4ade80;
  }

  .attach-change.remove {
    color: #f87171;
  }

  .empty-state {
    text-align: center;
    padding: 24px;
    color: #64748b;
    font-size: 13px;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
