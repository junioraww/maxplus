<script>
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";
  import { activeThemeId, setTheme } from "$lib/stores/theme";
  import { clientSettings, initClientSettings, updateClientSetting } from "$lib/stores/clientSettings";

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  onMount(() => {
    initClientSettings();
  });

  function handleFontSize(e) {
    updateClientSetting("fontSize", Number(e.target.value));
  }
</script>

<SettingsPageWrapper title="Оформление" {from} {isTab} {onClose}>
  <div class="appearance-page">
    <SettingsSection title="Предпросмотр">
      <div class="chat-preview">
        <div class="bubble incoming" style="font-size: {$clientSettings.fontSize}px;">
          Привет! Как тебе новая тема?
          <span class="bubble-time">12:40</span>
        </div>
        <div class="bubble outgoing" style="font-size: {$clientSettings.fontSize}px;">
          Выглядит отлично, 1-в-1 с оригиналом!
          <span class="bubble-time out">12:41</span>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection title="Тема оформления">
      <SettingsRow
        title="Тёмная"
        subtitle="Space Dark"
        chevron={false}
        active={$activeThemeId === "dark"}
        on:click={() => setTheme("dark")}
      >
        <div slot="right" class="radio-dot" class:checked={$activeThemeId === "dark"}></div>
      </SettingsRow>
      <SettingsRow
        title="Светлая"
        subtitle="Space Light"
        chevron={false}
        active={$activeThemeId === "light"}
        on:click={() => setTheme("light")}
      >
        <div slot="right" class="radio-dot" class:checked={$activeThemeId === "light"}></div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection title="Размер текста сообщений">
      <div class="slider-row">
        <span class="slider-label-small">A</span>
        <input
          type="range"
          min="12"
          max="22"
          step="1"
          value={$clientSettings.fontSize}
          on:input={handleFontSize}
          aria-label="Размер текста сообщений"
        />
        <span class="slider-label-large">A</span>
        <span class="slider-value">{$clientSettings.fontSize} px</span>
      </div>
    </SettingsSection>
  </div>
</SettingsPageWrapper>

<style>
  .appearance-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px 12px 24px;
  }

  .chat-preview {
    padding: 16px;
    background: var(--bg-chat, #161621);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .bubble {
    max-width: 82%;
    padding: 9px 13px;
    border-radius: 16px;
    line-height: 1.35;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
  }

  .bubble.incoming {
    align-self: flex-start;
    background: var(--msg-bubble-in-bg, #373a4e);
    color: var(--msg-bubble-in-text, #ffffff);
    border-bottom-left-radius: 4px;
  }

  .bubble.outgoing {
    align-self: flex-end;
    background: var(--msg-bubble-out-bg, #7b4cd6);
    color: var(--msg-bubble-out-text, #ffffff);
    border-bottom-right-radius: 4px;
  }

  .bubble-time {
    font-size: 11px;
    color: var(--msg-time-color, rgba(255, 255, 255, 0.65));
    margin-left: auto;
  }

  .bubble-time.out {
    color: var(--msg-time-out-color, rgba(255, 255, 255, 0.75));
  }

  .radio-dot {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid var(--settings-icon-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s;
  }

  .radio-dot.checked {
    border-color: var(--settings-accent, #007aff);
  }

  .radio-dot.checked::after {
    content: "";
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--settings-accent, #007aff);
  }

  .slider-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
  }

  .slider-row input[type="range"] {
    flex: 1;
    accent-color: var(--settings-accent, #007aff);
    cursor: pointer;
  }

  .slider-label-small {
    font-size: 13px;
    color: var(--settings-text-muted);
  }

  .slider-label-large {
    font-size: 19px;
    font-weight: 600;
    color: var(--settings-text-primary);
  }

  .slider-value {
    min-width: 44px;
    text-align: right;
    font-size: 13px;
    color: var(--settings-text-muted);
    font-weight: 500;
  }
</style>
