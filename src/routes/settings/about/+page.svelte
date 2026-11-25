<script>
  import { platform, version as getVersion } from "@tauri-apps/plugin-os";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { app } from "@tauri-apps/api";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";
  import CreditsModal from "$components/main/CreditsModal.svelte";
  import { unloadAllPlugins } from "$lib/plugins/runtime";
  import { showAlert } from "$lib/utils/alert";

  let version = "...";
  let environment = "...";
  let doingStuff = "";
  let checking = false;
  let showCredits = false;

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  async function checkUpdates() {
    if (checking) return;
    checking = true;
    const pointAnimation = setInterval(() => {
      if (doingStuff.length === 3) doingStuff = "";
      else doingStuff += ".";
    }, 100);
    try {
      const response = await fetch("https://api.github.com/repos/me0wkie/maxplus/releases/latest");
      const data = await response.json();
      if (!data.tag_name) {
        showAlert("Не удалось соединиться с GitHub!");
      } else if (data.tag_name !== version) {
        await unloadAllPlugins();
        openUrl(data.html_url);
      } else {
        showAlert("Обновлений нет!");
      }
    } catch (e) {
      console.error(e);
      showAlert("Не удалось соединиться с GitHub!");
    } finally {
      setTimeout(() => {
        checking = false;
        clearInterval(pointAnimation);
        doingStuff = "";
      }, 400);
    }
  }

  onMount(async () => {
    version = "v" + (await app.getVersion());
    const _platform = await platform();
    environment = _platform[0].toUpperCase() + _platform.slice(1) + " " + (await getVersion());
  });

  function openGit() {
    openUrl("https://github.com/junioraww/maxplus");
  }

  function openBerg() {
    openUrl("https://codeberg.org/meowkie/maxplus");
  }

  let phrase = getPhrase();

  function getPhrase() {
    const phrases = [
      "для любителей шифров.",
      "для нетакусек.",
      "без магии. Почти.",
      "для особо недоверчивых.",
      "для тех самых.",
      "для тех, кто понял.",
      "с привкусом паранойи.",
      "без лишних вопросов.",
      "с духом DIY.",
      "BLAZINGLY FAST!",
      "для любителей плюсов.",
      "с большим характером.",
    ];
    return phrases[Math.floor(Math.random() * phrases.length)];
  }

  function updatePhrase() {
    let generated = phrase;
    while (generated === phrase) {
      generated = getPhrase();
    }
    phrase = generated;
  }
</script>

<SettingsPageWrapper title="О приложении" {from} {isTab} {onClose}>
  <div class="about-page">
    <div class="about-hero">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div on:click={updatePhrase} class="app-icon-wrap">
        <img class="app-logo" src="/favicon.png" alt="Max+" />
      </div>
      <h1 class="app-title">Max+</h1>
      <p class="app-desc">Клиент «Макс» {phrase}</p>
    </div>

    <SettingsSection title="Исходный код">
      <SettingsRow title="GitHub" on:click={openGit}>
        <img slot="icon" class="src-icon github-icon" src="/icons/web/github.svg" alt="GitHub" />
      </SettingsRow>
      <SettingsRow title="Codeberg" on:click={openBerg}>
        <img slot="icon" class="src-icon" src="/icons/web/codeberg.svg" alt="Codeberg" />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection title="Сведения">
      <SettingsRow title="Версия приложения" value={version} chevron={false} clickable={false} />
      <SettingsRow title="Платформа" value={environment} chevron={false} clickable={false} />
      <SettingsRow title="Собрано" value={__BUILD_DATE__} chevron={false} clickable={false} />
    </SettingsSection>

    <SettingsSection>
      <SettingsRow title="Благодарности" on:click={() => (showCredits = true)}>
        <svg slot="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </SettingsRow>
    </SettingsSection>
  </div>

  <div class="about-footer" slot="footer">
    <button type="button" class="check-btn" on:click={checkUpdates} disabled={checking}>
      Проверить обновления{doingStuff}
    </button>
  </div>
</SettingsPageWrapper>

{#if showCredits}
  <CreditsModal on:close={() => (showCredits = false)} />
{/if}

<style>
  .about-page {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px 12px 12px;
  }

  .about-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 8px 16px 8px;
  }

  .app-icon-wrap {
    width: 84px;
    height: 84px;
    border-radius: 22px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
    cursor: pointer;
    transition: transform 0.14s ease;
    margin-bottom: 12px;
  }

  .app-icon-wrap:active {
    transform: scale(0.94);
  }

  .app-logo {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .app-title {
    margin: 0 0 4px;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 22px;
    font-weight: 700;
    color: var(--settings-text-primary);
  }

  .app-desc {
    margin: 0;
    font-size: 14px;
    color: var(--settings-text-muted);
  }

  .src-icon {
    width: 22px;
    height: 22px;
    object-fit: contain;
    display: block;
  }

  .github-icon {
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .about-footer {
    padding: 10px 12px max(16px, calc(16px + var(--safe-bottom, 0px)));
    background: var(--settings-bg, #0f0f12);
    border-top: 1px solid var(--settings-separator);
    flex-shrink: 0;
  }

  .check-btn {
    width: 100%;
    height: 52px;
    border: none;
    border-radius: 14px;
    background: var(--settings-accent, #007aff);
    color: #ffffff;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s, transform 0.1s;
  }

  .check-btn:hover:not(:disabled) {
    background: var(--settings-accent-hover, #1a88ff);
  }

  .check-btn:active:not(:disabled) {
    transform: scale(0.985);
  }

  .check-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
