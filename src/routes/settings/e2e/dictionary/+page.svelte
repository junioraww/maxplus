<script>
  import { appCacheDir, join } from "@tauri-apps/api/path";
  import { invoke, Channel } from "@tauri-apps/api/core";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import { makeDictionary, dict } from "$lib/crypto/text-codec";

  const basicUrl = "https://github.com/me0wkie/text-codec/raw/refs/heads/main/in.txt";
  let downloading = false;
  let status = { total: 0, perc: 0 };

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  $: url = (async () => {
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
    const filePath = await join(cacheDir, "raw.txt");

    try {
      const onProgress = new Channel();
      onProgress.onmessage = ({ progress, total }) => {
        status.total = progress;
        status.perc = total > 0 ? Math.round((progress / total) * 100) : 0;
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
      alert(e);
    } finally {
      downloading = false;
      status.total = 0;
      status.perc = 0;
    }
  }
</script>

<SettingsPageWrapper title="Словарь шифрования" {from} {onClose}>
  <div class="content">
    <div class="description-card">
      Набор слов для обфускации (запутывания). Например, превращает "123" в "Том Красил Забор".
    </div>

    {#await dictionary}
    {:then data}
      <div class="info-card">
        <img
          src={downloading ? "/icons/reload.svg" : "/icons/crypto.svg"}
          class:spin={downloading}
          class="icon"
          alt="icon"
        />
        <div class="info-text">
          Размер словаря: <b>{data?.dict8 ? data.dict8?.length + data.dict16?.length : 0}</b>
        </div>
      </div>
    {/await}

    {#await url}
    {:then loaded}
      <div class="input-card">
        <label>Ссылка на словарь</label>
        <input value={loaded} placeholder="Ссылка" />
      </div>
    {/await}
  </div>

  <div class="actions-panel" slot="footer">
    <button
      class="download-btn"
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
  </div>
</SettingsPageWrapper>

<style>
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .description-card {
    background: #24252a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px;
    color: #aaa;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .info-card {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #24252a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 16px;
  }

  .icon {
    width: 28px;
    height: 28px;
  }

  .icon.spin {
    animation: spin 1s linear infinite;
  }

  .info-text {
    font-size: 0.95rem;
    color: #ddd;
  }

  .info-text b {
    color: #fff;
  }

  .input-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  label {
    font-size: 0.78rem;
    color: #7b7b88;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  input {
    width: 100%;
    background: #1f1f26;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: white;
    padding: 14px;
    box-sizing: border-box;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  input:focus {
    border-color: #3390ec;
    background: #20202a;
  }

  .actions-panel {
    flex-shrink: 0;
    padding: 14px 16px;
    background: #212126;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .download-btn {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 12px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    color: white;
    transition: transform 0.12s, opacity 0.15s;
  }

  .download-btn:active {
    transform: scale(0.98);
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
