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
  import OtpCodeInput from "$components/main/auth/OtpCodeInput.svelte";

  let error = "";
  let code = "";
  let loading = false;
  let resending = false;

  const challenge = sessionGet("challenge") || {};
  const maskedEmail = challenge?.email || "f********s@y*****.ru";

  let timerSeconds = 59;
  let timerInterval = null;

  function formatTimer(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      if (timerSeconds > 0) {
        timerSeconds -= 1;
      } else {
        stopTimer();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function goBack() {
    goto("/auth/password");
  }

  const unregisterBack = registerBackHandler(goBack);

  onMount(async () => {
    if (!challenge?.trackId) {
      goto("/auth/login");
      return;
    }
    startTimer();
    if ($API?.requestTwoFactorEmailCode && challenge?.email) {
      try {
        await $API.requestTwoFactorEmailCode(challenge.trackId, challenge.email);
      } catch (e) {
        console.warn(e);
      }
    }
  });

  onDestroy(() => {
    stopTimer();
    unregisterBack();
  });

  async function handleResend() {
    if (resending || timerSeconds > 0) return;
    resending = true;
    error = "";

    try {
      if ($API?.requestTwoFactorEmailCode && challenge?.email) {
        await $API.requestTwoFactorEmailCode(challenge.trackId, challenge.email);
      }
      timerSeconds = 59;
      startTimer();
    } catch (e) {
      error = parseApiError(e);
    } finally {
      resending = false;
    }
  }

  function handleNoEmailAccess() {
    alert("Если у вас нет доступа к привязанной почте, обратитесь в службу поддержки для восстановления аккаунта.");
  }

  async function handleVerify(enteredCode) {
    if (loading) return;
    const targetCode = enteredCode || code;
    if (targetCode.length !== 6) return;

    error = "";
    loading = true;

    try {
      if ($API?.twoFactor) {
        const response = await $API.twoFactor("verify_email", {
          trackId: challenge.trackId,
          code: targetCode,
        });

        if (response?.error) {
          error = parseApiError(response);
          loading = false;
          return;
        }

        sessionSet("challenge", null);
        loading = false;
        goto("/");
      } else {
        sessionSet("challenge", null);
        loading = false;
        goto("/");
      }
    } catch (e) {
      loading = false;
      error = parseApiError(e);
    }
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
      <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#8e8e93" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="15" rx="5" ry="5"></rect>
        <circle cx="8" cy="11.5" r="1.2" fill="#8e8e93" stroke="none"></circle>
        <circle cx="12" cy="11.5" r="1.2" fill="#8e8e93" stroke="none"></circle>
        <circle cx="16" cy="11.5" r="1.2" fill="#8e8e93" stroke="none"></circle>
      </svg>
    </div>

    <h1 class="main-heading">Какой код пришёл на почту?</h1>
    <p class="sub-heading">Проверьте почту {maskedEmail}</p>

    <OtpCodeInput
      length={6}
      bind:value={code}
      disabled={loading}
      on:complete={(e) => handleVerify(e.detail)}
    />

    {#if error}
      <div class="error-notice">{error}</div>
    {/if}
  </main>

  <footer class="bottom-section">
    <button
      type="button"
      class="no-access-link"
      on:click={handleNoEmailAccess}
    >
      Нет доступа к почте?
    </button>

    {#if timerSeconds > 0}
      <div class="timer-text">
        Получить новый код можно через {formatTimer(timerSeconds)}
      </div>
    {:else}
      <button
        type="button"
        class="resend-btn"
        disabled={resending}
        on:click={handleResend}
      >
        {resending ? "Отправка..." : "Отправить код повторно"}
      </button>
    {/if}
  </footer>
</div>

<style>
  .auth-screen {
    --auth-bg: #ffffff;
    --auth-text: #000000;
    --auth-text-secondary: #8e8e93;
    --auth-input-bg: #eff0f4;
    --auth-accent: #007aff;
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
    --auth-bg: #121316;
    --auth-text: #ffffff;
    --auth-text-secondary: #8e8e93;
    --auth-input-bg: #212228;
    --auth-accent: #007aff;
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
    width: 84px;
    height: 84px;
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
    font-size: 22px;
    font-weight: 700;
    color: var(--auth-text);
    letter-spacing: -0.2px;
  }

  .sub-heading {
    margin: 0 0 16px 0;
    font-size: 15px;
    color: var(--auth-text-secondary);
    max-width: 300px;
  }

  .error-notice {
    margin-top: 10px;
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
    gap: 12px;
    width: 100%;
    max-width: 440px;
    margin-left: auto;
    margin-right: auto;
    box-sizing: border-box;
  }

  .no-access-link {
    background: transparent;
    border: none;
    color: #007aff;
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 4px;
  }

  .no-access-link:hover {
    text-decoration: underline;
  }

  .timer-text {
    font-size: 14px;
    color: #8e8e93;
    text-align: center;
  }

  .resend-btn {
    background: transparent;
    border: none;
    color: #007aff;
    font-size: 15px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    padding: 4px;
  }

  .resend-btn:hover {
    text-decoration: underline;
  }

  .resend-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
