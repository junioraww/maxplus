<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session";
  import API from "$lib/stores/api";
  import { parseApiError } from "$lib/api/MobileApi";
  import { activeThemeId } from "$lib/stores/theme";

  let error = "";
  let name = sessionGet("name") || "";
  let loading = false;
  let registerToken = null;

  onMount(() => {
    registerToken = sessionGet("registerToken");
    if (!registerToken) {
      goto("/auth/login");
    }
  });

  async function completeRegistration() {
    if (loading) return;
    const trimmed = name.trim();
    if (!trimmed) {
      error = "Введите ваше имя";
      return;
    }

    error = "";
    loading = true;

    try {
      const regResponse = await $API.submitRegister(trimmed);
      if (regResponse?.error) {
        error = parseApiError(regResponse);
        loading = false;
        return;
      }
      sessionSet("registerToken", null);
      sessionSet("name", trimmed);
      loading = false;
      goto("/");
    } catch (e) {
      loading = false;
      error = parseApiError(e);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && name.trim()) {
      completeRegistration();
    }
  }
</script>

<div class="auth-screen" class:dark-theme={$activeThemeId === "dark"}>
  <header class="top-nav">
    <button
      type="button"
      class="back-button"
      on:click={() => goto("/auth/login")}
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
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#1c1c1e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    </div>

    <h1 class="main-heading">Как вас зовут?</h1>
    <p class="sub-heading">Введите имя, которое будут видеть другие пользователи</p>

    <div class="input-card">
      <input
        type="text"
        class="text-field"
        placeholder="Имя или псевдоним"
        bind:value={name}
        on:keydown={handleKeyDown}
        autofocus
      />
    </div>

    {#if error}
      <div class="error-notice">{error}</div>
    {/if}
  </main>

  <footer class="bottom-section">
    <button
      type="button"
      class="submit-button"
      class:active={Boolean(name.trim()) && !loading}
      disabled={!name.trim() || loading}
      on:click={completeRegistration}
    >
      {loading ? "Сохранение..." : "Продолжить"}
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
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background-color: var(--auth-pill);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 24px;
  }

  .icon-badge svg {
    stroke: var(--auth-text);
  }

  .main-heading {
    margin: 0 0 8px 0;
    font-size: 22px;
    font-weight: 700;
    color: var(--auth-text);
    letter-spacing: -0.2px;
  }

  .sub-heading {
    margin: 0 0 28px 0;
    font-size: 15px;
    color: var(--auth-text-secondary);
    max-width: 300px;
  }

  .input-card {
    width: 100%;
    height: 52px;
    background-color: var(--auth-input-bg);
    border-radius: 14px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    box-sizing: border-box;
  }

  .input-card:focus-within {
    box-shadow: 0 0 0 1.5px rgba(0, 122, 255, 0.45);
  }

  .text-field {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-size: 17px;
    font-family: inherit;
    color: var(--auth-text);
  }

  .text-field::placeholder {
    color: var(--auth-text-secondary);
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
    border-radius: 14px;
    border: none;
    background-color: #007aff;
    opacity: 0.7;
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
    font-family: inherit;
    cursor: default;
    transition: opacity 0.2s ease, transform 0.1s ease;
  }

  .submit-button.active {
    opacity: 1;
    cursor: pointer;
  }

  .submit-button.active:active {
    transform: scale(0.985);
  }
</style>
