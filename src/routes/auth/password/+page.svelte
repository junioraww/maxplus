<script>
  import { getContext, onDestroy, onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session.js";

  import BackButton from "$components/main/auth/BackButton.svelte";
  import ActionButton from "$components/main/auth/ActionButton.svelte";

  import API from "$lib/stores/api";
  import { parseApiError } from "$lib/api/MobileApi.js";

  let error = "";
  let password = "";
  let showPassword = false;
  let loading = false;
  const challenge = sessionGet("challenge");

  const onBack = getContext("onBack");
  if (onBack) {
    onBack["auth"] = () => {
      goto("/auth/login");
    };
  }
  onDestroy(() => {
    if (onBack) delete onBack["auth"];
  });

  onMount(() => {
    if (!challenge || !challenge.trackId) {
      goto("/auth/login");
    }
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
    if (e.key === "Enter") {
      verify();
    }
  }
</script>

<div class="auth-page">
  <h1>Двухфакторная аутентификация</h1>
  <p>Введите пароль для завершения входа</p>
  {#if challenge?.hint}
    <div class="hint">Подсказка: {challenge.hint}</div>
  {/if}
  <div class="form">
    <div class="error">{error}</div>
    <div class="input-wrapper">
      <input
        type={showPassword ? "text" : "password"}
        bind:value={password}
        placeholder="Пароль"
        on:keydown={handleKeydown}
        required
      />
      <button
        type="button"
        class="toggle-visibility"
        on:click={() => (showPassword = !showPassword)}
        aria-label="Показать пароль"
      >
        {#if showPassword}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
          </svg>
        {/if}
      </button>
    </div>
    <ActionButton text="Проверить" action={verify}/>
  </div>
  <BackButton path="/auth/login"/>
</div>

<style>
  .auth-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 100vh;
    text-align: center;
    color: #ddd;
    max-width: min(340px, 90%);
    margin: 0 auto;
  }

  .auth-page h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 500;
  }

  .auth-page p {
    margin: 10px 0 6px 0;
    font-size: 14px;
    color: #8e8e93;
  }

  .hint {
    font-size: 13px;
    color: #4a90e2;
    margin-bottom: 8px;
    word-break: break-word;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }

  .input-wrapper input {
    width: 100%;
    padding: 0.75rem 2.5rem 0.75rem 0.75rem;
    border-radius: 8px;
    border: 1px solid #333;
    font-size: 1rem;
    background-color: #26262e;
    color: #ccc;
    outline: none;
    box-sizing: border-box;
  }

  .toggle-visibility {
    position: absolute;
    right: 10px;
    background: transparent;
    border: none;
    color: #8e8e93;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
  }

  .toggle-visibility:active {
    opacity: 0.7;
  }

  .error {
    color: #ff5555;
    font-size: 14px;
    min-height: 20px;
    word-break: break-word;
  }
</style>
