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

<SettingsPageWrapper title="Энергосбережение" {from} {isTab} {onClose}>
  <div class="battery-page">
    <SettingsSection
      title="Анимации и производительность"
      footer="Отключение анимаций помогает снизить нагрузку на батарею и процессор."
    >
      <SettingsRow
        title="Анимации интерфейса"
        subtitle="Плавные переходы экранов и панелей"
        isToggle={true}
        checked={$clientSettings.animationsEnabled}
        on:change={(e) => updateClientSetting("animationsEnabled", e.detail.checked)}
      />
      <SettingsRow
        title="Автовоспроизведение стикеров"
        subtitle="Проигрывать анимированные стикеры в чатах"
        isToggle={true}
        checked={$clientSettings.stickersAutoPlay}
        on:change={(e) => updateClientSetting("stickersAutoPlay", e.detail.checked)}
      />
      <SettingsRow
        title="Уменьшить движение"
        subtitle="Минимизировать эффекты параллакса и анимации"
        isToggle={true}
        checked={$clientSettings.reducedMotion}
        on:change={(e) => updateClientSetting("reducedMotion", e.detail.checked)}
      />
    </SettingsSection>
  </div>
</SettingsPageWrapper>

<style>
  .battery-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 24px;
  }
</style>
