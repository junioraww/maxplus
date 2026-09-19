<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import logs, { total } from "$lib/stores/logs";
  import { slide, fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";

  $: from = $page.url.searchParams.get("from") || "/auth/login";

  export let isTab = false;

  let expandedId = null;

  const toggleLog = (id) => {
    expandedId = expandedId === id ? null : id;
  };

  const getLogType = (log) => {
    if (log.request) return "request";
    if (log.response) return "response";
    return "generic";
  };

  async function copy() {
    try {
      const log = $logs.find(x => x.id === expandedId);
      await navigator.clipboard.writeText(JSON.stringify(log.data, null, 2));
      console.log("Лог скопирован");
    } catch (err) {
      console.error("Ошибка копирования:", err);
    }
  }

  let logsContainer;
  let previousScrollTop = 0;

  $: preparedLogs = $logs.map(log => ({
    ...log,
    formatted: JSON.stringify(log.data, null, 1),
  }));

  logs.subscribe(x => {
    if (logsContainer?.scrollTop) {
      logsContainer.scrollTop += 47;
    }
  });

  $: {
    $logs;

    if (logsContainer) {
      console.log(logsContainer.scrollTop)
      /*
      previousScrollTop = logsContainer.scrollTop;

      requestAnimationFrame(() => {
        logsContainer.scrollTop = previousScrollTop;
      });*/
    }
  }
</script>

<div class="logs-page" class:is-tab={isTab}>
  <header>
    <h1>Сетевые логи</h1>
    <span class="count">Всего {$total} запросов</span>
  </header>

  <div class="logs-container" bind:this={logsContainer}>
    {#each preparedLogs as log (log.id)}
      <div
        in:fade={{ duration: 300 }}
        class="log-item {log.type}"
        class:expanded={expandedId === log.id}
      >
        <div
          class="log-header"
          on:click={() => toggleLog(log.id)}>
          <span class="badge">{log.type.toUpperCase()}</span>
          <span class="preview">{log.timestamp} | {log.preview}...</span>
        </div>

        {#if expandedId === log.id}
          <div class="log-content" transition:fade={{ duration: 100 }}>
            <pre>{log.formatted}</pre>
            <img
              class="copy"
              on:click={copy}
              src="/icons/copy.svg">
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if !isTab}
    <div class="footer-panel">
      <button class="back-btn" on:click={() => goto(from)}> Назад </button>
    </div>
  {/if}
</div>

<style>
  .logs-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    color: #ddd;
    padding: 20px;
    box-sizing: border-box;
  }

  .logs-page.is-tab {
    height: 100%;
    padding-bottom: 20px;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    color: #fff;
  }

  .count {
    font-size: 0.8rem;
    opacity: 0.6;
    background: #333;
    padding: 4px 10px;
    border-radius: 20px;
  }

  .logs-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 10px;
  }

  .log-item {
    background: #2b2b33;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.1s;
    overflow: hidden;
    flex-shrink: 0;
  }

  .log-item:hover {
    background: #32323b;
    border-color: #4a4a55;
  }

  .log-item.expanded {
    border-color: #6366f1;
    background: #2d2d38;
    white-space: normal;
    height: auto;
  }

  .log-header {
    display: flex;
    align-items: center;
    padding: 10px 15px;
    gap: 12px;
    font-family: "Fira Code", monospace;
    font-size: 0.85rem;
  }

  .preview {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.7;
  }

  .badge {
    font-size: 0.7rem;
    font-weight: bold;
    padding: 2px 6px;
    border-radius: 4px;
    min-width: 70px;
    text-align: center;
  }

  .request .badge {
    background: #3b82f6;
    color: white;
  }

  .response .badge {
    background: #10b981;
    color: white;
  }

  .error .badge {
    background: #f22727;
    color: white;
  }

  .generic .badge {
    background: #6b7280;
    color: white;
  }

  .log-content {
    padding: 10px 15px 25px 15px;
    border-top: 1px solid #3a3a42;
    background: #1e1e24;
    overflow: auto;
    position: relative;
    cursor: default;
  }

  pre {
    margin: 10px 0 0;
    font-size: 0.85rem;
    color: #a5b4fc;
    line-height: 1.4;
  }

  .copy {
    position: absolute;
    right: 10px;
    bottom: 20px;
    opacity: 0.6;
    transition: opacity 0.05s transform 0.2s;
  }

  .copy:active {
    opacity: 0.5;
    transform: scale(0.95);
  }

  .footer-panel {
    display: flex;
    justify-content: flex-end;
    padding-top: 16px;
    border-top: 1px solid #2c2c35;
    z-index: 1;
  }

  .back-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #6366f1;
    color: white;
    border: none;
    padding: 10px 40px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .back-btn:hover {
    background: #4f46e5;
  }

  .logs-container::-webkit-scrollbar {
    width: 6px;
  }

  .logs-container::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 10px;
  }
</style>
