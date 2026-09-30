<script>
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings.js";
  import {
    saveOthersDeletedMessages,
    hideMyDeletedMessages,
  } from "$lib/stores/deletionSettings.js";

  export let isTab = false;
  export let onClose = null;

  $: from = $page.url.searchParams.get("from") || "/?card=settings";
</script>

<SettingsPageWrapper title="Расширенные настройки" {from} {isTab} {onClose}>
  {#if isTab}
    <header class="tab-header">
      <h1>Расширенные настройки</h1>
    </header>
  {/if}

  <div class="content-container">
    <div class="section-header">
      <h2>Медиа</h2>
    </div>

    <div class="settings-card">
      <div
        class="toggle-row"
        on:click={() => autoDownloadEncryptedMedia.toggle()}
      >
        <div class="toggle-info">
          <span class="toggle-title">Автозагрузка зашифрованных медиа</span>
          <span class="toggle-desc"
            >Автоматически скачивать зашифрованные файлы и изображения</span
          >
        </div>
        <div class="toggle-track" class:active={$autoDownloadEncryptedMedia}>
          <div
            class="toggle-thumb"
            class:active={$autoDownloadEncryptedMedia}
          ></div>
        </div>
      </div>
    </div>

    <div class="section-header">
      <h2>Удаление сообщений</h2>
    </div>

    <div class="settings-card">
      <div
        class="toggle-row"
        on:click={() => saveOthersDeletedMessages.toggle()}
      >
        <div class="toggle-info">
          <span class="toggle-title">Сохранять чужие удаленные сообщения</span>
          <span class="toggle-desc"
            >Оставлять в чате сообщения, удаленные собеседником</span
          >
        </div>
        <div class="toggle-track" class:active={$saveOthersDeletedMessages}>
          <div
            class="toggle-thumb"
            class:active={$saveOthersDeletedMessages}
          ></div>
        </div>
      </div>

      <div class="card-divider"></div>

      <div
        class="toggle-row"
        on:click={() => hideMyDeletedMessages.toggle()}
      >
        <div class="toggle-info">
          <span class="toggle-title">Скрывать мои удаленные сообщения</span>
          <span class="toggle-desc"
            >Не показывать удаленные вами сообщения в истории чата</span
          >
        </div>
        <div class="toggle-track" class:active={$hideMyDeletedMessages}>
          <div
            class="toggle-thumb"
            class:active={$hideMyDeletedMessages}
          ></div>
        </div>
      </div>
    </div>
  </div>
</SettingsPageWrapper>

<style>
  .tab-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: #212126;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
  }

  .tab-header h1 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #fff;
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-card {
    background: #26262e;
    border-radius: 12px;
    border: 1px solid #333;
    padding: 16px;
  }

  .card-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 14px 0;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    user-select: none;
    transition: opacity 0.2s;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .toggle-title {
    font-size: 1rem;
    font-weight: 500;
    color: #fff;
  }

  .toggle-desc {
    font-size: 0.82rem;
    color: #888;
  }

  .toggle-track {
    width: 44px;
    height: 24px;
    background: #3a3a3c;
    border-radius: 12px;
    position: relative;
    transition: background-color 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-track.active {
    background: #248bfe;
  }

  .toggle-thumb {
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toggle-thumb.active {
    transform: translateX(20px);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
</style>
