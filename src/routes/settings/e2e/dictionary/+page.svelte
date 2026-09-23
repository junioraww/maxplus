<script>
  import { appCacheDir, join } from '@tauri-apps/api/path';
  import { invoke, Channel } from "@tauri-apps/api/core";
  import { fade, fly, slide } from "svelte/transition";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";

  import { makeDictionary, dict } from "$lib/crypto/text-codec";

  const basicUrl = "https://github.com/me0wkie/text-codec/raw/refs/heads/main/in.txt";
  let downloading = false;
  let status = { total: 0, perc: 0 }

  $: from = $page.url.searchParams.get("from") || "/auth/login";

  $: url = (async() => {
    const entry = await dict.getUrl();
    if (!entry) return basicUrl;
    return entry;
  })();

  $: downloaded = dict.getUrl();
  let dictionary = dict.getDictionary();

  async function download() {
    downloading = true;
    status.total = 0;
    status.perc = 0;

    const entry = await url;

    const cacheDir = await appCacheDir();
    const filePath = await join(cacheDir, 'raw.txt');

    try {
      const onProgress = new Channel();
      onProgress.onmessage = ({ progress, total }) => {
        status.total = progress;
        status.perc = total > 0 ? Math.round(progress / total * 100) : 0;
      };

      await invoke("download_to_path", {
        url: entry,
        path: filePath,
        onProgress,
      });

      const text = await invoke("read_file", { path: filePath });

      await makeDictionary(text);
      dictionary = dict.getDictionary();

      downloaded = entry;
      await dict.setUrl(entry);
    } catch (e) {
      alert(e)
    } finally {
      downloading = false;
      status.total = 0;
      status.perc = 0;
    }
  }

  /*async function handleInput(event) {
    const rawValue = event.target.value;
  }*/
</script>

<div class="page">
  <header>
    <h1>Словарь шифрования</h1>
  </header>

  <div class="content">
    <div class="footer">Набор слов для обфускации (запутывания). Например, превращает "123" в "Том Красил Забор"</div>

    {#await dictionary}
    {:then data}
      <div class="info">
        <img
        src={ downloading ? "/icons/reload.svg" : "/icons/crypto.svg" }
        class:spin={downloading}
        class="icon"/>
        <div class="text">Слов: <b>{ data?.dict8 ? (data.dict8?.length + data.dict16?.length) : 0 }</b></div>
      </div>
    {/await}
  </div>

  {#await url}
  {:then loaded}
  <div>
    <input
      value={loaded}
      placeholder="Ссылка"
    >
  </div>
  {/await}

  <div class="actions-panel">
    <div class="save-wrap">
      {#if url !== downloaded}
        <button
            class="save-btn"
            on:click={download}
            style="
              background:
                linear-gradient(
                  90deg,
                  #2f8f58 0%,
                  #2f8f58 {status.perc}%,
                  #3cb371 {status.perc}%,
                  #3cb371 100%
                );
            "
          >
          {#if downloading}
            Скачивание {status.perc}%
          {:else}
            Скачать текущий
          {/if}
        </button>
      {/if}
    </div>

    <button class="back-btn" on:click={() => goto(from)}>Назад</button>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100vh;
    overflow: hidden;
    background: #1a1a1f;
    color: #ddd;
    box-sizing: border-box;
  }

  header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px 20px;
  }

  h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 700;
    color: white;
  }

  .badge {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 999px;
    background: #2c2c35;
    color: #888;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px 20px 16px;
    display: flex;
    flex-direction: column;
  }

  .content::-webkit-scrollbar {
    width: 4px;
  }

  .content::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 999px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .footer {
    color: #aaa;
    text-align: justify;
  }

  .info {
    display: flex;
    margin: auto;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    line-height: 36px;
  }

  .info .icon {
    font-size: 42px;
    padding: 0;
  }

  .info .icon.spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  input,
  textarea {
    width: 100%;
    background: #1f1f26;
    border: 1px solid transparent;
    color: white;
    padding: 14px;
    box-sizing: border-box;
    font-size: 0.95rem;
    outline: none;
    transition:
      border-color 0.15s,
      background 0.15s;
    direction: rtl;
    text-align: left;
  }

  input:focus,
  textarea:focus {
    border-color: #6366f1;
    background: #20202a;
  }

  textarea {
    min-height: 120px;
    resize: vertical;
    font-family: inherit;
  }

  .actions-panel {
    flex-shrink: 0;
    display: flex;
    gap: 12px;
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
    background: #1a1a1f;
    border-top: 1px solid #2c2c35;
    justify-content: end;
    margin-top: auto;
  }

  .save-wrap {
    flex: 1;
    display: flex;
    align-items: center;
  }

  .save-btn,
  .back-btn {
    border: none;
    border-radius: 12px;
    font-size: 0.92rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.12s,
      opacity 0.15s,
      background 0.15s;
  }

  .save-btn {
    width: 100%;
    padding: 10px 40px;

    background: #3cb371;
    color: white;
  }

  .save-btn:hover {
    background: #35a565;
  }

  .save-btn:active,
  .back-btn:active {
    transform: scale(0.98);
  }

  .save-btn:disabled {
    opacity: 0.7;
  }

  .back-btn {
    min-width: 120px;
    background: #6366f1;
    color: white;
    padding: 10px 40px;
  }

  .back-btn:hover {
    background: #4f46e5;
  }

  @media (max-width: 640px) {
    .actions-panel {
      gap: 10px;
    }
  }
</style>
