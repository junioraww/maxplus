<script>
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session";
  import { registerBackHandler } from "$lib/utils/backButton";
  import API from "$lib/stores/api";
  import { parseApiError } from "$lib/api/MobileApi";
  import { activeThemeId } from "$lib/stores/theme";

  let error = "";
  let password = "";
  let showPassword = false;
  let loading = false;
  let passwordInputRef;

  const challenge = sessionGet("challenge");

  function goBack() {
    goto("/auth/login");
  }

  const unregisterBack = registerBackHandler(goBack);

  onDestroy(() => {
    unregisterBack();
  });

  onMount(() => {
    if (!challenge || !challenge.trackId) {
      goto("/auth/login");
      return;
    }
    if (passwordInputRef) passwordInputRef.focus();
  });

  async function handleVerify() {
    if (loading || !password) return;
    if (!challenge?.trackId) {
      goto("/auth/login");
      return;
    }

    error = "";
    loading = true;

    try {
      const response = await $API.checkPassword(password, challenge.trackId);
      if (response?.error) {
        error = parseApiError(response);
        loading = false;
        return;
      }
      sessionSet("challenge", null);
      loading = false;
      goto("/");
    } catch (e) {
      loading = false;
      error = parseApiError(e);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && password) {
      handleVerify();
    }
  }

  function handleForgotPassword() {
    goto("/auth/recovery");
  }
</script>

<div class="auth-screen" class:dark-theme={$activeThemeId === "dark"}>
  <header class="top-nav">
    <button
      type="button"
      class="back-button"
      on:click={goBack}
      aria-label="Назад"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
    </button>
  </header>

  <main class="content-container">
    <div class="icon-badge">
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#8e8e93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="10.5" width="16" height="11" rx="3.5" ry="3.5"></rect>
        <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5"></path>
        <circle cx="8.5" cy="16" r="1" fill="#8e8e93" stroke="none"></circle>
        <circle cx="12" cy="16" r="1" fill="#8e8e93" stroke="none"></circle>
        <circle cx="15.5" cy="16" r="1" fill="#8e8e93" stroke="none"></circle>
      </svg>
    </div>

    <h1 class="main-heading">Введите пароль для входа</h1>
    <p class="sub-heading">Ваш профиль дополнительно защищён</p>

    {#if challenge?.hint}
      <div class="hint-text">Подсказка: {challenge.hint}</div>
    {/if}

    <div class="input-card">
      <input
        bind:this={passwordInputRef}
        type={showPassword ? "text" : "password"}
        class="password-field"
        placeholder="Пароль"
        bind:value={password}
        on:keydown={handleKeyDown}
      />
      <button
        type="button"
        class="toggle-visibility"
        on:click={() => (showPassword = !showPassword)}
        aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
      >
        {#if showPassword}
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
            <line x1="1" y1="1" x2="23" y2="23"></line>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        {/if}
      </button>
    </div>

    {#if error}
      <div class="error-notice">{error}</div>
    {/if}
  </main>

  <footer class="bottom-section">
    <button
      type="button"
      class="submit-button"
      class:active={Boolean(password) && !loading}
      disabled={!password || loading}
      on:click={handleVerify}
    >
      {loading ? "Проверка..." : "Продолжить"}
    </button>

    <button
      type="button"
      class="forgot-link"
      on:click={handleForgotPassword}
    >
      Забыли пароль?
    </button>
  </footer>
</div>

<style>
  .auth-screen {
    --auth-bg: #ffffff;
    --auth-text: #000000;
    --auth-text-secondary: #8e8e93;
    --auth-input-bg: #eff0f4;
    --auth-accent: #007aff;
    --auth-btn-disabled-bg: rgba(0, 0, 0, 0.06);
    --auth-btn-disabled-text: rgba(0, 0, 0, 0.28);
    --auth-pill: #f2f2f2;

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
    --auth-input-bg: rgba(255, 255, 255, 0.09);
    --auth-accent: #007aff;
    --auth-btn-disabled-bg: rgba(255, 255, 255, 0.12);
    --auth-btn-disabled-text: rgba(255, 255, 255, 0.28);
    --auth-pill: #282932;
  }

  .top-nav {
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 12px;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .back-button {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--auth-text);
    cursor: pointer;
  }

  .back-button:active {
    background-color: rgba(127, 127, 127, 0.12);
  }

  .content-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 20px 0 20px;
    text-align: center;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .icon-badge {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    background-color: #f0f1f4;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
  }

  .auth-screen.dark-theme .icon-badge {
    background-color: #212228;
  }

  .main-heading {
    margin: 0 0 8px 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.25;
    color: var(--auth-text);
    letter-spacing: -0.2px;
  }

  .sub-heading {
    margin: 0 0 24px 0;
    font-size: 14px;
    line-height: 1.35;
    color: var(--auth-text-secondary);
    max-width: 300px;
  }

  .hint-text {
    margin-top: -12px;
    margin-bottom: 20px;
    font-size: 14px;
    color: var(--auth-accent);
  }

  .input-card {
    width: 100%;
    height: 52px;
    background-color: var(--auth-input-bg);
    border-radius: 14px;
    padding: 0 14px;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    transition: box-shadow 0.15s ease;
  }

  .input-card:focus-within {
    box-shadow: 0 0 0 1.5px rgba(0, 122, 255, 0.45);
  }

  .password-field {
    flex: 1;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-size: 17px;
    font-family: inherit;
    color: var(--auth-text);
    padding: 0;
    -webkit-user-select: text;
    user-select: text;
  }

  .password-field::placeholder {
    color: var(--auth-text-secondary);
  }

  .toggle-visibility {
    background: transparent;
    border: none;
    color: var(--auth-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
  }

  .error-notice {
    margin-top: 14px;
    padding: 10px 14px;
    background-color: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    border-radius: 10px;
    font-size: 14px;
  }

  .bottom-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 20px 24px 20px;
    margin-top: auto;
    width: 100%;
    max-width: 440px;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
  }

  .submit-button {
    width: 100%;
    height: 52px;
    border-radius: 16px;
    border: none;
    background-color: var(--auth-btn-disabled-bg);
    color: var(--auth-btn-disabled-text);
    font-size: 15.5px;
    font-weight: 600;
    font-family: inherit;
    cursor: default;
    transition: background-color 0.2s ease, color 0.2s ease, transform 0.1s ease;
  }

  .submit-button.active {
    background-color: var(--auth-accent);
    color: #ffffff;
    cursor: pointer;
  }

  .submit-button.active:active {
    transform: scale(0.985);
  }

  .forgot-link {
    margin-top: 18px;
    background: transparent;
    border: none;
    color: #007aff;
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 4px;
  }

  .forgot-link:hover {
    text-decoration: underline;
  }
</style>
