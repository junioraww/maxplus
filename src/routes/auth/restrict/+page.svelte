<script>
  import { goto } from "$app/navigation";
  import { activeThemeId } from "$lib/stores/theme";
  import { registerBackHandler } from "$lib/utils/backButton";

  function handleGoLogin() {
    goto("/auth/login");
  }

  function handleGoRecovery() {
    goto("/auth/recovery");
  }

  const unregisterBack = registerBackHandler(handleGoLogin);
</script>

<div class="auth-screen" class:dark-theme={$activeThemeId === "dark"}>
  <header class="top-nav">
    <button
      type="button"
      class="back-button"
      on:click={handleGoLogin}
      aria-label="Назад"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
    </button>
  </header>

  <main class="content-container">
    <div class="restrict-graphic-container">
      <div class="glow-disc"></div>
      <div class="icon-holder">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <rect x="9" y="11" width="6" height="5" rx="1.5" stroke="currentColor" stroke-width="1.6"/>
          <path d="M10 11V9a2 2 0 114 0v2" stroke="currentColor" stroke-width="1.6"/>
        </svg>
      </div>
    </div>

    <h1 class="main-heading">
      Установите пароль на&nbsp;устройстве, где вы уже вошли в MAX
    </h1>

    <p class="sub-heading">
      Для этого перейдите в&nbsp;Настройки&nbsp;→ Безопасность&nbsp;→ Пароль для&nbsp;входа.<br /><br />
      После этого вы сможете войти здесь.
    </p>
  </main>

  <footer class="bottom-section">
    <button
      type="button"
      class="primary-button"
      on:click={handleGoLogin}
    >
      Повторить вход
    </button>

    <button
      type="button"
      class="secondary-button"
      on:click={handleGoRecovery}
    >
      Нет доступа к устройству
    </button>
  </footer>
</div>

<style>
  .auth-screen {
    --auth-bg: #ffffff;
    --auth-text: #000000;
    --auth-text-secondary: #8e8e93;
    --auth-accent: #007aff;
    --auth-glow: rgba(0, 122, 255, 0.08);
    --auth-icon-color: #007aff;
    --auth-sec-btn-text: #007aff;

    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    width: 100%;
    background-color: var(--auth-bg);
    color: var(--auth-text);
    box-sizing: border-box;
    padding-top: var(--safe-top, 0px);
    padding-bottom: var(--safe-bottom, 0px);
    overflow-x: hidden;
  }

  .auth-screen.dark-theme {
    --auth-bg: #17181c;
    --auth-text: #ffffff;
    --auth-text-secondary: #8e8e93;
    --auth-accent: #007aff;
    --auth-glow: rgba(0, 122, 255, 0.14);
    --auth-icon-color: #007aff;
    --auth-sec-btn-text: #0a84ff;
  }

  .top-nav {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    height: 48px;
  }

  .back-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    background: transparent;
    color: var(--auth-text);
    cursor: pointer;
    border-radius: 50%;
    transition: background 0.15s ease;
  }

  .back-button:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .dark-theme .back-button:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .content-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 24px;
    box-sizing: border-box;
  }

  .restrict-graphic-container {
    position: relative;
    width: 200px;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
  }

  .glow-disc {
    position: absolute;
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--auth-glow) 0%, transparent 70%);
  }

  .icon-holder {
    position: relative;
    z-index: 2;
    width: 88px;
    height: 88px;
    border-radius: 50%;
    background-color: var(--auth-glow);
    color: var(--auth-icon-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .main-heading {
    margin: 0 0 8px 0;
    max-width: 320px;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
    text-align: center;
    letter-spacing: -0.2px;
  }

  .sub-heading {
    margin: 0;
    max-width: 320px;
    font-size: 14px;
    line-height: 1.5;
    text-align: center;
    color: var(--auth-text-secondary);
  }

  .bottom-section {
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .primary-button {
    width: 100%;
    height: 52px;
    border-radius: 16px;
    border: none;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    background-color: var(--auth-accent);
    color: #ffffff;
    transition: transform 0.1s ease, opacity 0.15s ease;
  }

  .primary-button:active {
    transform: scale(0.985);
  }

  .secondary-button {
    width: 100%;
    height: 44px;
    border-radius: 16px;
    border: none;
    background: transparent;
    font-size: 15px;
    font-weight: 500;
    color: var(--auth-sec-btn-text);
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .secondary-button:hover {
    opacity: 0.85;
  }
</style>
