<script>
  import { Section } from "$components/ui";
  import { Toggle } from "$components/ui";
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

<SettingsPageWrapper tabHeader title="Расширенные настройки" {from} {isTab} {onClose}>
  <div class="content-container">
    <Section title="Медиа" padded>
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
        <Toggle readonly checked={$autoDownloadEncryptedMedia} />
      </div>
    </Section>

    <Section title="Удаление сообщений" padded>
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
        <Toggle readonly checked={$saveOthersDeletedMessages} />
      </div>

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
        <Toggle readonly checked={$hideMyDeletedMessages} />
      </div>
    </Section>
  </div>
</SettingsPageWrapper>

<style>


  .content-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    color: var(--text-primary);
  }

  .toggle-desc {
    font-size: 0.82rem;
    color: var(--text-muted);
  }






</style>
