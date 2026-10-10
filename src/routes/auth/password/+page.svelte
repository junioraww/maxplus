<script>
  import { onDestroy, onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session.js";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import API from "$lib/stores/api";
  import { parseApiError } from "$lib/api/MobileApi.js";

  let error = "";
  let info = "";
  let password = "";
  let loading = false;
  let inputEl;
  const challenge = sessionGet("challenge");

  function back() {
    goto("/auth/login");
  }

  const unregisterBack = registerBackHandler(back);

  onDestroy(() => {
    unregisterBack();
  });

  onMount(async () => {
    if (!challenge || !challenge.trackId) {
      goto("/auth/login");
      return;
    }
    await tick();
    inputEl?.focus();
  });

  async function verify() {
    if (loading) return;
    if (!password) {
      error = "Введите пароль";
      return;
    }
    if (!challenge?.trackId) {
      goto("/auth/login");
      return;
    }

    error = "";
    info = "";
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

  function handleKeydown(e) {
    if (e.key === "Enter") verify();
  }

  function forgot() {
    error = "";
    info = "Сбросить пароль можно в приложении MAX на телефоне: Настройки → Конфиденциальность → Пароль";
  }
</script>

<div class="pw-page">
  <button class="pw-back" type="button" aria-label="Назад" on:click={back}>
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 12H4" /><path d="M10 6l-6 6 6 6" />
    </svg>
  </button>

  <div class="pw-content">
    <div class="pw-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" />
        <rect x="4.5" y="10" width="15" height="10.5" rx="3" />
        <circle cx="9" cy="15.25" r="0.6" fill="currentColor" />
        <circle cx="12" cy="15.25" r="0.6" fill="currentColor" />
        <circle cx="15" cy="15.25" r="0.6" fill="currentColor" />
      </svg>
    </div>

    <h1 class="pw-title">Введите пароль для входа</h1>
    <p class="pw-subtitle">Ваш профиль дополнительно защищён</p>

    <input
      bind:this={inputEl}
      class="pw-input"
      class:pw-input--error={!!error}
      type="password"
      bind:value={password}
      placeholder="Пароль"
      autocomplete="current-password"
      on:keydown={handleKeydown}
      on:input={() => (error = "")}
    />

    {#if error}
      <div class="pw-note pw-note--error">{error}</div>
    {:else if challenge?.hint}
      <div class="pw-note">{challenge.hint}</div>
    {/if}

    <button class="pw-submit" type="button" disabled={loading} on:click={verify}>
      {#if loading}
        <span class="pw-spinner" aria-hidden="true"></span>
      {:else}
        Продолжить
      {/if}
    </button>

    {#if info}
      <div class="pw-info">{info}</div>
    {/if}
  </div>

  <button class="pw-forgot" type="button" on:click={forgot}>Забыли пароль?</button>
</div>

<style>
  .pw-page {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    box-sizing: border-box;
    padding: calc(env(safe-area-inset-top, 0px) + 12px) 14px calc(env(safe-area-inset-bottom, 0px) + 28px);
    background: var(--bg-primary, #f5f6fa);
    color: var(--text-primary);
  }

  .pw-back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin-left: -4px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .pw-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 420px;
    margin: 0 auto;
    padding-top: 36px;
  }

  .pw-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 86px;
    height: 86px;
    border-radius: 50%;
    background: var(--bg-surface-2, #e9eaee);
    color: var(--text-muted, #7c7c84);
  }

  .pw-title {
    margin: 28px 0 0;
    font-size: 19px;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
  }

  .pw-subtitle {
    margin: 10px 0 0;
    font-size: 14px;
    line-height: 1.35;
    color: var(--text-muted, #7c7c84);
    text-align: center;
  }

  .pw-input {
    width: 100%;
    height: 47px;
    margin-top: 28px;
    padding: 0 11px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 12px;
    background: var(--bg-surface-2, #e9eaee);
    color: var(--text-primary);
    font-size: 16px;
    outline: none;
    caret-color: var(--text-primary);
  }

  .pw-input::placeholder {
    color: var(--text-muted, #8a8a93);
  }

  .pw-input--error {
    border-color: #ff3b30;
  }

  .pw-note {
    align-self: flex-start;
    margin: 8px 0 0 11px;
    font-size: 12px;
    line-height: 1.3;
    color: var(--text-muted, #7c7c84);
    word-break: break-word;
  }

  .pw-note--error {
    color: #ff3b30;
  }

  .pw-submit {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 54px;
    margin-top: 26px;
    border: none;
    border-radius: 18px;
    background: var(--accent-primary, #3478f6);
    color: #fff;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .pw-submit:disabled {
    opacity: 0.7;
    cursor: default;
  }

  .pw-submit:active:not(:disabled) {
    opacity: 0.85;
  }

  .pw-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: pw-spin 0.8s linear infinite;
  }

  @keyframes pw-spin {
    to { transform: rotate(360deg); }
  }

  .pw-info {
    margin-top: 16px;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text-muted, #7c7c84);
    text-align: center;
  }

  .pw-forgot {
    align-self: center;
    margin-top: auto;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--accent-primary, #3478f6);
    font-size: 15px;
    cursor: pointer;
  }
</style>
