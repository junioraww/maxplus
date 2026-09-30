<script>
  import { platform, version as getVersion } from "@tauri-apps/plugin-os";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { app } from "@tauri-apps/api";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import CreditsModal from "$components/main/CreditsModal.svelte";

  let version = "...";
  let environment = "...";
  let doingStuff = "";
  let checking = false;
  let showCredits = false;

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
      const response = await fetch(
        "https://api.github.com/repos/me0wkie/maxplus/releases/latest",
      );
      const data = await response.json();
      if (!data.tag_name) alert("Не удалось соединиться с GitHub!");
      else {
        if (data.tag_name !== version) openUrl(data.html_url);
        else alert("Обновлений нет!");
      }
    } catch (e) {
      console.error(e);
      alert("Не удалось соединиться с GitHub!");
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
    environment =
      _platform[0].toUpperCase() +
      _platform.slice(1) +
      " " +
      (await getVersion());
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

<SettingsPageWrapper title="О приложении" {from} {onClose}>
  <div class="content">
    <div class="hero-section">
      <div on:click={updatePhrase} class="app-icon-wrap">
        <img class="app-logo" src="/favicon.png" alt="Max+" />
      </div>
      <h1>Max+</h1>
      <p class="description">Клиент «Макс» {phrase}</p>
    </div>

    <div class="card sources-card">
      <div class="card-title">Исходный код</div>
      <div class="sources-list">
        <div class="source-item" on:click={openGit}>
          <img class="source-icon github-icon" src="/icons/web/github.svg" alt="GitHub" />
          <span class="source-name">GitHub</span>
          <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
        <div class="divider"></div>
        <div class="source-item" on:click={openBerg}>
          <img class="source-icon" src="/icons/web/codeberg.svg" alt="Codeberg" />
          <span class="source-name">Codeberg</span>
          <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    </div>

    <div class="card info-card">
      <div class="info-row">
        <span>Версия приложения</span>
        <strong>{version}</strong>
      </div>
      <div class="divider"></div>
      <div class="info-row">
        <span>Платформа</span>
        <strong>{environment}</strong>
      </div>
      <div class="divider"></div>
      <div class="info-row">
        <span>Собрано</span>
        <strong>{__BUILD_DATE__}</strong>
      </div>
    </div>

    <div class="card credits-card" on:click={() => (showCredits = true)}>
      <div class="source-item">
        <svg class="source-icon star-icon" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
        <span class="source-name">Благодарности</span>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </div>
    </div>
  </div>

  <div class="actions-panel" slot="footer">
    <button class="check-btn" on:click={checkUpdates} disabled={checking}>
      Проверить обновления{doingStuff}
    </button>
  </div>
</SettingsPageWrapper>

{#if showCredits}
  <CreditsModal on:close={() => (showCredits = false)} />
{/if}

<style>
  .content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .hero-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 0 8px;
    text-align: center;
    flex-shrink: 0;
  }

  .app-icon-wrap {
    margin-bottom: 12px;
    transition: 0.1s transform;
  }

  .app-icon-wrap:active {
    transform: scale(0.97);
  }

  .app-logo {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  }

  h1 {
    color: #ffffff;
    font-size: 24px;
    font-weight: 700;
    margin: 0;
  }

  .description {
    color: #888;
    margin: 6px 0 0;
    font-size: 0.95rem;
  }

  .card {
    background: #24252a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .card-title {
    padding: 12px 16px 8px;
    font-size: 0.78rem;
    color: #7b7b88;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .sources-list {
    display: flex;
    flex-direction: column;
  }

  .source-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    min-height: 48px;
    box-sizing: border-box;
    cursor: pointer;
    transition: background 0.12s;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .source-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .source-item:active {
    background: rgba(255, 255, 255, 0.08);
  }

  .source-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .github-icon {
    background: #fff;
    border-radius: 50%;
  }

  .source-name {
    flex: 1;
    color: #fff;
    font-size: 0.95rem;
    font-weight: 500;
  }

  .chevron {
    color: #555;
    flex-shrink: 0;
  }

  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 0 16px;
    flex-shrink: 0;
  }

  .info-card {
    display: flex;
    flex-direction: column;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 13px 16px;
    min-height: 44px;
    box-sizing: border-box;
    font-size: 0.92rem;
    flex-shrink: 0;
  }

  .info-row span {
    color: #888;
  }

  .info-row strong {
    color: #fff;
    font-weight: 500;
  }

  .actions-panel {
    flex-shrink: 0;
    padding: 14px 16px;
    padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));
    background: #212126;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .check-btn {
    width: 100%;
    height: 44px;
    min-height: 44px;
    flex-shrink: 0;
    box-sizing: border-box;
    background: #3390ec;
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.12s, opacity 0.15s, background 0.15s;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .check-btn:hover {
    background: #2b7ecf;
  }

  .check-btn:active {
    transform: scale(0.98);
  }

  .check-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
