<script>
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import {
    get as sessionGet,
    set as sessionSet
  } from "$lib/stores/session";
  import { registerBackHandler } from "$lib/utils/backButton";
  import API from "$lib/stores/api";
  import { parseApiError, isNo2FaError } from "$lib/api/MobileApi";
  import { activeThemeId } from "$lib/stores/theme";

  let error = "";
  let loading = false;
  let refreshing = false;

  const phone = sessionGet("phone") || "";
  const authPayload = sessionGet("authPayload") || {};

  let trackId = authPayload.trackId || "";
  let callNumber = authPayload.callNumber || "";
  let pollingInterval = authPayload.pollingInterval || 3000;
  let timeOut = typeof authPayload.timeOut === "number" ? authPayload.timeOut : 60;

  let timerSeconds = timeOut > 1000 ? Math.round(timeOut / 1000) : timeOut;
  if (!timerSeconds || timerSeconds <= 0) timerSeconds = 60;

  let timerInterval = null;
  let pollInterval = null;

  function formatDisplayPhone(raw) {
    if (!raw) return "";
    const clean = raw.replace(/[^\d+]/g, "");
    if (clean.startsWith("+7") && clean.length === 12) {
      return `+7 ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)}`;
    }
    return raw;
  }

  $: displayPhone = formatDisplayPhone(phone);

  function formatCallNumber(raw) {
    if (!raw) return "";
    const clean = raw.replace(/[^\d+]/g, "");
    if (clean.startsWith("+7") && clean.length === 12) {
      return `+7 ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)}`;
    }
    return raw;
  }

  $: displayCallNumber = formatCallNumber(callNumber);

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

  function startPolling() {
    stopPolling();
    if (!trackId) return;
    const intervalMs = Math.max(pollingInterval, 2000);
    pollInterval = setInterval(async () => {
      if (timerSeconds <= 0) {
        stopPolling();
        return;
      }
      try {
        const resp = await $API.checkCallStatus(trackId);
        if (resp?.error) {
          if (isNo2FaError(resp)) {
            stopPolling();
            goto("/auth/restrict");
            return;
          }
        }
        if (resp?.tokenAttrs?.LOGIN || resp?.token) {
          stopPolling();
          goto("/");
          return;
        }
        if (resp?.tokenAttrs?.REGISTER) {
          stopPolling();
          sessionSet("registerToken", resp.tokenAttrs.REGISTER.token);
          if (resp?.presetAvatars) {
            sessionSet("presetAvatars", resp.presetAvatars);
          }
          goto("/auth/register");
          return;
        }
        if (resp?.status === 2 || resp?.status === "VERIFICATION_PASSED") {
          const authResp = await $API.authByTrack(trackId);
          if (authResp?.tokenAttrs?.LOGIN || authResp?.token) {
            stopPolling();
            goto("/");
            return;
          }
          if (authResp?.tokenAttrs?.REGISTER) {
            stopPolling();
            sessionSet("registerToken", authResp.tokenAttrs.REGISTER.token);
            if (authResp?.presetAvatars) {
              sessionSet("presetAvatars", authResp.presetAvatars);
            }
            goto("/auth/register");
            return;
          }
        }
      } catch (e) {
        if (isNo2FaError(e)) {
          stopPolling();
          goto("/auth/restrict");
        }
      }
    }, intervalMs);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
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
    startPolling();
  });

  onDestroy(() => {
    stopTimer();
    stopPolling();
    unregisterBack();
  });

  function handleCall() {
    if (!callNumber) return;
    window.location.href = `tel:${callNumber}`;
  }

  async function handleRefresh() {
    if (refreshing || !phone) return;
    refreshing = true;
    error = "";

    try {
      const response = await $API.resendAuth(phone);
      if (response?.error) {
        error = parseApiError(response);
      } else {
        if (response.trackId) trackId = response.trackId;
        if (response.callNumber) callNumber = response.callNumber;
        if (response.pollingInterval) pollingInterval = response.pollingInterval;
        timerSeconds = response.timeOut ? (response.timeOut > 1000 ? Math.round(response.timeOut / 1000) : response.timeOut) : 60;
        sessionSet("authPayload", response);
        startTimer();
        startPolling();
      }
    } catch (e) {
      error = parseApiError(e);
    } finally {
      refreshing = false;
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
    <div class="call-badge-wrapper">
      <div class="call-pulse-ring ring-1"></div>
      <div class="call-pulse-ring ring-2"></div>
      <div class="call-badge-circle">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
          <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
        </svg>
      </div>
    </div>

    <h1 class="main-heading">
      Позвоните с&nbsp;номера {displayPhone},<br />чтобы подтвердить вход
    </h1>

    <p class="sub-heading">
      Дождитесь ответа робота<br />и&nbsp;следуйте его подсказкам
    </p>

    {#if error}
      <div class="error-notice">{error}</div>
    {/if}
  </main>

  <footer class="bottom-section">
    {#if timerSeconds > 0}
      <button
        type="button"
        class="submit-button active"
        on:click={handleCall}
      >
        Позвонить на {displayCallNumber}
      </button>
      <div class="timer-notice">
        Позвоните в течение {formatTimer(timerSeconds)}
      </div>
    {:else}
      <button
        type="button"
        class="submit-button active"
        disabled={refreshing}
        on:click={handleRefresh}
      >
        {refreshing ? "Обновление..." : "Обновить номер"}
      </button>
      <div class="timer-notice expired">
        Время истекло, обновите номер
      </div>
    {/if}
  </footer>
</div>

<style>
  .auth-screen {
    --auth-bg: #ffffff;
    --auth-text: #000000;
    --auth-text-secondary: #8e8e93;
    --auth-accent: #007aff;
    --auth-btn-disabled-bg: rgba(0, 0, 0, 0.06);
    --auth-btn-disabled-text: rgba(0, 0, 0, 0.28);
    --auth-badge-bg: rgba(0, 122, 255, 0.1);
    --auth-pulse-color: rgba(0, 122, 255, 0.15);

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
    --auth-btn-disabled-bg: rgba(255, 255, 255, 0.12);
    --auth-btn-disabled-text: rgba(255, 255, 255, 0.28);
    --auth-badge-bg: rgba(0, 122, 255, 0.18);
    --auth-pulse-color: rgba(0, 122, 255, 0.2);
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
    padding: 24px 20px 0;
    box-sizing: border-box;
  }

  .call-badge-wrapper {
    position: relative;
    width: 96px;
    height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
  }

  .call-pulse-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background-color: var(--auth-pulse-color);
    animation: pulseRing 2.4s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  }

  .call-pulse-ring.ring-2 {
    animation-delay: 1.2s;
  }

  @keyframes pulseRing {
    0% {
      transform: scale(0.85);
      opacity: 0.8;
    }
    100% {
      transform: scale(1.4);
      opacity: 0;
    }
  }

  .call-badge-circle {
    position: relative;
    z-index: 2;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    background-color: var(--auth-badge-bg);
    color: var(--auth-accent);
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
    margin: 0 0 24px 0;
    max-width: 300px;
    font-size: 14px;
    line-height: 1.35;
    text-align: center;
    color: var(--auth-text-secondary);
  }

  .error-notice {
    margin-top: 16px;
    font-size: 14px;
    color: #ff3b30;
    text-align: center;
  }

  .bottom-section {
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .submit-button {
    width: 100%;
    height: 52px;
    border-radius: 16px;
    border: none;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    background-color: var(--auth-btn-disabled-bg);
    color: var(--auth-btn-disabled-text);
    transition: background-color 0.2s ease, color 0.2s ease, transform 0.1s ease;
  }

  .submit-button.active {
    background-color: var(--auth-accent);
    color: #ffffff;
  }

  .submit-button.active:active {
    transform: scale(0.985);
  }

  .timer-notice {
    font-size: 13px;
    color: var(--auth-text-secondary);
    text-align: center;
  }

  .timer-notice.expired {
    color: #ff3b30;
  }
</style>
