<script>
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session";
  import { registerBackHandler } from "$lib/utils/backButton";
  import API from "$lib/stores/api";
  import { parseApiError, isNo2FaError } from "$lib/api/MobileApi";
  import { activeThemeId } from "$lib/stores/theme";
  import OtpCodeInput from "$components/main/auth/OtpCodeInput.svelte";

  let error = "";
  let code = "";
  let loading = false;
  let resending = false;

  const phone = sessionGet("phone") || "";
  const name = sessionGet("name");
  const authPayload = sessionGet("authPayload") || {};
  const serverCodeLength = sessionGet("codeLength") || authPayload.codeLength;
  const codeLength = typeof serverCodeLength === "number" && serverCodeLength > 0 ? serverCodeLength : 6;

  const initialDelay = sessionGet("codeDelay");
  let timerSeconds = typeof initialDelay === "number" && initialDelay > 0 ? initialDelay : 60;
  let timerInterval = null;

  function detectCallVerification(auth, phoneNumber) {
    if (auth?.requestType && String(auth.requestType).includes("CALL")) return true;
    const clean = (phoneNumber || "").replace(/[^\d+]/g, "");
    if (clean.startsWith("+374") || clean.startsWith("374")) return true;
    return false;
  }

  let isCall = detectCallVerification(authPayload, phone);

  function formatDisplayPhone(raw) {
    if (!raw) return "";
    const clean = raw.replace(/[^\d+]/g, "");
    if (clean.startsWith("+7") && clean.length === 12) {
      return `+7 ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)}`;
    }
    return raw;
  }

  $: displayPhone = formatDisplayPhone(phone);

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
    goto("/auth/login");
  }

  const unregisterBack = registerBackHandler(goBack);

  onMount(() => {
    if (!phone) {
      goto("/auth/login");
      return;
    }
    startTimer();
  });

  onDestroy(() => {
    stopTimer();
    unregisterBack();
  });

  async function handleResend() {
    if (resending || timerSeconds > 0 || !phone) return;
    resending = true;
    error = "";

    try {
      const response = await $API.resendAuth(phone);
      if (response?.error) {
        error = parseApiError(response);
      } else {
        sessionSet("authPayload", response);
        isCall = detectCallVerification(response, phone);
        timerSeconds = response?.codeDelay || 60;
        startTimer();
      }
    } catch (e) {
      error = parseApiError(e);
    } finally {
      resending = false;
    }
  }

  async function handleVerify(enteredCode) {
    if (loading) return;
    const targetCode = enteredCode || code;
    if (targetCode.length !== codeLength) return;

    error = "";
    loading = true;

    try {
      const response = await $API.checkCode(targetCode);

      if (response?.error) {
        if (isNo2FaError(response)) {
          loading = false;
          goto("/auth/restrict");
          return;
        }
        error = parseApiError(response);
        loading = false;
        return;
      }

      if (response?.passwordChallenge) {
        sessionSet("challenge", response.passwordChallenge);
        loading = false;
        goto("/auth/password");
        return;
      }

      const isRegistration = response?.tokenAttrs?.REGISTER && !response?.tokenAttrs?.LOGIN;
      if (isRegistration) {
        const registerToken = response?.tokenAttrs?.REGISTER?.token;
        sessionSet("registerToken", registerToken);
        if (response?.presetAvatars) {
          sessionSet("presetAvatars", response.presetAvatars);
        }
        loading = false;
        goto("/auth/register");
        return;
      }

      await $API.handleLoginResponse(response);
      loading = false;
      goto("/");
    } catch (e) {
      loading = false;
      if (isNo2FaError(e)) {
        goto("/auth/restrict");
        return;
      }
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
    <h1 class="main-heading">
      Отправили код<br />на {displayPhone}
    </h1>

    <p class="sub-heading">
      {#if isCall}
        Вам поступит звонок-сброс. Введите последние {codeLength} цифр номера входящего вызова.
      {:else}
        Если не получили СМС, проверьте чат<br />«Коды подтверждения» в MAX
      {/if}
    </p>

    <OtpCodeInput
      length={codeLength}
      bind:value={code}
      disabled={loading}
      on:complete={(e) => handleVerify(e.detail)}
    />

    {#if error}
      <div class="error-notice">{error}</div>
    {/if}
  </main>

  <footer class="bottom-section">
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
        {resending ? "Отправка..." : isCall ? "Запросить повторный звонок" : "Отправить код повторно"}
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
    padding: 24px 20px 0 20px;
    text-align: center;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
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
    max-width: 320px;
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
    padding: 16px 20px 24px 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: auto;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
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
    padding: 8px 12px;
  }

  .resend-btn:hover {
    text-decoration: underline;
  }

  .resend-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
