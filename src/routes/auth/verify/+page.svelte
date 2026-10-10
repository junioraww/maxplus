<script>
  import { Button } from "$components/ui";
  import { onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session.js";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import BackButton from "$components/main/auth/BackButton.svelte";
  import ActionButton from "$components/main/auth/ActionButton.svelte";

  import API from "$lib/stores/api";
  import { parseApiError } from "$lib/api/MobileApi.js";

  let error = "";
  let infoMessage = "";
  let code = "";
  let loading = false;
  let resending = false;

  const phone = sessionGet("phone") || "";
  const initialDelay = sessionGet("codeDelay");
  let timerSeconds = typeof initialDelay === "number" && initialDelay > 0 ? initialDelay : 60;
  let timerInterval = null;

  const name = sessionGet("name");
  const state = !name ? "login" : "register";

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

  onMount(() => {
    startTimer();
  });

  const unregisterBack = registerBackHandler(() => {
    goto("/auth/" + state);
  });

  onDestroy(() => {
    stopTimer();
    unregisterBack();
  });

  async function resendCode() {
    if (resending || timerSeconds > 0) return;
    if (!phone) {
      error = "Номер телефона не найден";
      return;
    }

    resending = true;
    error = "";
    infoMessage = "";

    try {
      const response = await $API.resendAuth(phone);
      if (response?.error) {
        error = parseApiError(response);
      } else {
        infoMessage = "Код отправлен по SMS";
        timerSeconds = response?.codeDelay || 60;
        startTimer();
      }
    } catch (e) {
      error = parseApiError(e);
    } finally {
      resending = false;
    }
  }

  async function verify() {
    if (loading) return;
    if (code.length !== 6) {
      error = "Длина кода - 6 символов!";
      return;
    }

    error = "";
    infoMessage = "";
    loading = true;

    try {
      const response = await $API.checkCode(code);

      if (response?.error) {
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
        if (!name) {
          sessionSet("registerToken", response?.tokenAttrs?.REGISTER?.token);
          loading = false;
          goto("/auth/register");
          return;
        }
        const regResponse = await $API.submitRegister(name);
        await $API.handleLoginResponse(regResponse);
        loading = false;
        goto("/");
        return;
      }

      await $API.handleLoginResponse(response);
      loading = false;
      goto("/");
    } catch (e) {
      loading = false;
      error = parseApiError(e);
    }
  }

  function onInput(e) {
    error = "";
    code = e.target.value.trim();
    if (code.length === 6) {
      verify();
    }
  }
</script>

<div class="auth-page">
  <h1>Подтверждение</h1>
  {#if phone}
    <div class="phone-badge">{phone}</div>
  {/if}
  <p class="subtitle">
    Код подтверждения мог отправиться в MAX на другом устройстве или по SMS.
  </p>
  <div class="form">
    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if infoMessage}
      <div class="info">{infoMessage}</div>
    {/if}
    <input
      type="text"
      inputmode="numeric"
      maxlength="6"
      value={code}
      on:input={onInput}
      placeholder="******"
      required
    />
    <ActionButton text="Подтвердить" action={verify}/>

    <div class="resend-container">
      {#if timerSeconds > 0}
        <span class="timer-label">Отправить повторно через {timerSeconds} сек</span>
      {:else}
        <Button variant="ghost" class="pg-verify-resend-action" onclick={resendCode} disabled={resending}>
          {resending ? "Отправка..." : "Отправить код по SMS"}
        </Button>
      {/if}
    </div>
  </div>
  <BackButton/>
</div>

<style>
  .auth-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    text-align: center;
    color: var(--text-primary);
    max-width: min(340px, 92%);
    margin: 0 auto;
    padding: 20px 0;
    box-sizing: border-box;
  }

  .auth-page h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }

  .phone-badge {
    margin-top: 8px;
    font-size: 16px;
    font-weight: 500;
    color: var(--accent-primary);
    letter-spacing: 0.5px;
  }

  .subtitle {
    margin: 10px 0 12px 0;
    font-size: 13.5px;
    color: #a0a0a8;
    line-height: 1.4;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  input {
    padding: 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    font-size: 1.25rem;
    background-color: var(--bg-surface-2);
    color: var(--text-primary);
    outline: none;
    text-align: center;
    letter-spacing: 4px;
    font-weight: 600;
  }

  input:focus {
    border-color: #4a90e2;
  }

  .resend-container {
    margin-top: 6px;
    min-height: 24px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .timer-label {
    font-size: 13.5px;
    color: var(--text-muted);
  }




  .error {
    color: #ff5555;
    font-size: 13.5px;
    min-height: 18px;
    word-break: break-word;
  }

  .info {
    color: #4cd964;
    font-size: 13.5px;
    min-height: 18px;
    word-break: break-word;
  }
</style>
