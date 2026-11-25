<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";
  import { clientSettings, initClientSettings, updateClientSetting } from "$lib/stores/clientSettings";

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  onMount(() => {
    initClientSettings();
  });
</script>

<SettingsPageWrapper title="Сообщения" {from} {isTab} {onClose}>
  <div class="messages-page">
    <SettingsSection title="Отправка и отображение">
      <SettingsRow
        title="Отправка по Enter"
        subtitle="Клавиша Enter отправляет сообщение на клавиатуре"
        isToggle={true}
        checked={$clientSettings.sendByEnter}
        on:change={(e) => updateClientSetting("sendByEnter", e.detail.checked)}
      />
      <SettingsRow
        title="Крупные эмодзи"
        subtitle="Увеличивать сообщения, состоящие только из эмодзи"
        isToggle={true}
        checked={$clientSettings.largeEmoji}
        on:change={(e) => updateClientSetting("largeEmoji", e.detail.checked)}
      />
    </SettingsSection>
  </div>
</SettingsPageWrapper>

<style>
  .messages-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 24px;
  }
</style>
