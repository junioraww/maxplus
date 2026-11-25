<script>
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";
</script>

<SettingsPageWrapper title="Язык" {from} {isTab} {onClose}>
  <div class="language-page">
    <SettingsSection title="Язык интерфейса" footer="Пока поддерживается только русский язык.">
      <SettingsRow title="Русский" subtitle="Russian" chevron={false} active={true}>
        <svg slot="right" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--settings-accent, #007aff)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </SettingsRow>
    </SettingsSection>
  </div>
</SettingsPageWrapper>

<style>
  .language-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 24px;
  }
</style>
