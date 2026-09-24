<script>
  import { platform, version as getVersion } from "@tauri-apps/plugin-os";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { app } from "@tauri-apps/api";
  import { page } from "$app/stores";

  import ActionButton from "$components/main/auth/ActionButton.svelte";

  let autoCheck = true;
  let version = "...";
  let environment = "...";

  let doingStuff = "";
  let checking = false;

  $: from = $page.url.searchParams.get("from") || "/auth/login";

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

  function toggleAutoCheck() {
    autoCheck = !autoCheck;
  }

  onMount(async () => {
    version = "v" + await app.getVersion();
    const _platform = await platform();
    environment =
      _platform[0].toUpperCase() +
      _platform.slice(1) +
      " " +
      (await getVersion());
  });

  function openGit() {
    openUrl("https://github.com/me0wkie/maxplus");
  }

  function openBerg() {
    openUrl("https://codeberg.org/meowkie/maxplus");
  }

  function getPhrase() {
    const phrases = [
      "для любителей шифров.",
      "с минимумом функций.",
      "для нетакусек."
    ]

    return phrases[Math.floor(Math.random() * phrases.length)]
  }
</script>

<div class="page">
  <h1>Max+</h1>
  <a class="description">Клиент «Макс» {getPhrase()}</a>

  <div class="sources">
    <p class="text" style="margin-bottom: 10px;">Исходный код:</p>
    <div class="source github" on:click={openGit}>
      <img class="icon" src="/icons/web/github.svg">
      <a>GitHub</a>
    </div>
    <div class="source berg" on:click={openBerg}>
      <img class="icon" src="/icons/web/codeberg.svg">
      <a>Codeberg</a>
    </div>
  </div>
  <div class="about">
    <div class="version">
      <p>Версия приложения: <a>{version}</a></p>
      <p><a>{environment}</a></p>
      <p>Собрано <a>{__BUILD_DATE__}</a></p>
    </div>
  </div>

  <div class="actions-panel">
    <button class="check-btn" on:click={checkUpdates}>
      Обновить{doingStuff}
    </button>
    <button class="back-btn" on:click={() => goto(from)}>Назад</button>
  </div>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background-color: #1a1a1f;
    color: #ddd;
  }

  h1 {
    color: #6366f1;
    font-size: 28px;
    margin-bottom: 5px;
    text-align: center;
    margin-bottom: 0;
  }

  .description {
    color: #ddd;
    margin: 20px 0;
    text-align: center;
    max-width: 80%;
    align-self: center;
  }

  .sources {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: white;
    font-size: 16px;
    font-weight: 500;
  }

  a {
    color: #3ff;
    text-decoration: none;
  }

  p {
    margin: 0;
    text-align: center;
  }

  .source {
    display: flex;
    align-items: center;
    margin: 10px 0;
    gap: 10px;
    font-weight: 400;
  }

  .github {
    position: relative;
    right: 10px;
  }

  .github img {
    background-color: #fff;
    clip-path: circle(48%);
  }

  .source img {
    height: 32px;
  }

  .about {
    display: flex;
    flex-direction: column;
    margin: 10px 0;
    flex: 1;
  }

  .version {
    display: flex;
    flex-direction: column;
  }

  .version a {
    color: white;
  }

  .actions-panel {
    padding: 20px;
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: 20px;
  }

  button {
    gap: 8px;
    color: white;
    border: none;
    padding: 10px 40px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .check-btn {
    background: #f25527dd;
    flex: 1;
  }

  .check-btn:hover {
    background: #f25527bb;
  }

  .back-btn {
    background: #6366f1;
  }

  .back-btn:hover {
    background: #4f46e5;
  }

  .auto-check {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #bbb;
    font-size: 14px;
  }
</style>
