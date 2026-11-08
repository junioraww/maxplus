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
  import { registerBackHandler } from "$lib/utils/backButton";

  let step = 1;
  let error = "";
  let loading = false;
  let registerToken = null;

  let firstName = sessionGet("name") || "";
  let lastName = "";

  const defaultPresets = [
    { id: 2981369, name: "Космо", gradient: "linear-gradient(135deg, #FF6B6B 0%, #FFE66D 100%)", emoji: "🦊" },
    { id: 2981370, name: "Луна", gradient: "linear-gradient(135deg, #6B73FF 0%, #000DFF 100%)", emoji: "🐱" },
    { id: 2981371, name: "Аврора", gradient: "linear-gradient(135deg, #A8EDEA 0%, #FED6E3 100%)", emoji: "🐼" },
    { id: 2981372, name: "Нео", gradient: "linear-gradient(135deg, #5EE7DF 0%, #B490CA 100%)", emoji: "🦁" },
    { id: 2981373, name: "Орион", gradient: "linear-gradient(135deg, #D4FC79 0%, #96E6A1 100%)", emoji: "🐻" },
    { id: 2981374, name: "Солярис", gradient: "linear-gradient(135deg, #FA709A 0%, #FEE140 100%)", emoji: "🐨" }
  ];

  let presetCategories = [];
  let selectedPreset = null;
  let customAvatarUrl = null;
  let fileInputRef;

  onMount(() => {
    registerToken = sessionGet("registerToken");
    if (!registerToken) {
      goto("/auth/login");
      return;
    }

    const serverPresets = sessionGet("presetAvatars");
    if (Array.isArray(serverPresets) && serverPresets.length > 0) {
      presetCategories = serverPresets;
    }
  });

  function handleBack() {
    if (step === 2) {
      step = 1;
    } else {
      goto("/auth/login");
    }
  }

  const unregisterBack = registerBackHandler(handleBack);

  function handleStep1Submit() {
    const trimmed = firstName.trim();
    if (!trimmed) {
      error = "Введите имя";
      return;
    }
    error = "";
    step = 2;
  }

  function handleStep1KeyDown(e) {
    if (e.key === "Enter" && firstName.trim()) {
      handleStep1Submit();
    }
  }

  function handleSelectPreset(preset) {
    selectedPreset = preset;
    customAvatarUrl = null;
  }

  function handleFileChange(e) {
    const file = e.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      customAvatarUrl = event.target?.result;
      selectedPreset = null;
    };
    reader.readAsDataURL(file);
  }

  function triggerPickPhoto() {
    if (fileInputRef) fileInputRef.click();
  }

  async function completeRegistration() {
    if (loading) return;
    const trimmedFirst = firstName.trim();
    if (!trimmedFirst) {
      step = 1;
      error = "Введите имя";
      return;
    }

    const trimmedLast = lastName.trim() || null;
    error = "";
    loading = true;

    try {
      let regResponse;
      if (selectedPreset?.id) {
        regResponse = await $API.submitRegisterWithAvatar(
          trimmedFirst,
          trimmedLast,
          selectedPreset.id,
          "PRESET_AVATAR"
        );
      } else {
        regResponse = await $API.submitRegister(trimmedFirst, trimmedLast);
      }

      if (regResponse?.error) {
        error = parseApiError(regResponse);
        loading = false;
        return;
      }

      sessionSet("registerToken", null);
      sessionSet("name", trimmedFirst);
      loading = false;
      goto("/");
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
      on:click={handleBack}
      aria-label="Назад"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
    </button>
  </header>

  {#if step === 1}
    <main class="content-container">
      <h1 class="main-heading">Как вас зовут?</h1>
      <p class="sub-heading">Так вас будут видеть другие пользователи</p>

      <div class="input-card">
        <input
          type="text"
          class="text-field"
          placeholder="Имя"
          maxlength="60"
          bind:value={firstName}
          on:keydown={handleStep1KeyDown}
          autofocus
        />
      </div>

      <div class="input-card secondary-card">
        <input
          type="text"
          class="text-field"
          placeholder="Фамилия (необязательно)"
          maxlength="60"
          bind:value={lastName}
          on:keydown={handleStep1KeyDown}
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
        class:active={Boolean(firstName.trim()) && !loading}
        disabled={!firstName.trim() || loading}
        on:click={handleStep1Submit}
      >
        {firstName.trim() ? "Продолжить" : "Введите имя"}
      </button>
    </footer>
  {:else}
    <main class="content-container">
      <h1 class="main-heading">Каким будет фото профиля?</h1>
      <p class="sub-heading">Загрузите своё или подберите аватар</p>

      <div class="avatar-hero-container">
        <div
          class="avatar-hero-circle"
          style={selectedPreset?.gradient ? `background: ${selectedPreset.gradient}` : ""}
          on:click={triggerPickPhoto}
          role="button"
          tabindex="0"
        >
          {#if customAvatarUrl}
            <img src={customAvatarUrl} alt="Аватар" class="custom-avatar-img" />
          {:else if selectedPreset}
            {#if selectedPreset.url}
              <img src={selectedPreset.url} alt={selectedPreset.name} class="custom-avatar-img" />
            {:else}
              <span class="preset-emoji-hero">{selectedPreset.emoji || "✨"}</span>
            {/if}
          {:else}
            <div class="avatar-empty-placeholder">
              <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
          {/if}
          <div class="avatar-camera-pill">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 9a3 3 0 100 6 3 3 0 000-6zm-7 10h14a2 2 0 002-2V8a2 2 0 00-2-2h-3.17l-1.24-1.35A2 2 0 0015.12 4H8.88a2 2 0 00-1.47.65L6.17 6H3a2 2 0 00-2 2v9a2 2 0 002 2z"/>
            </svg>
          </div>
        </div>
      </div>

      <input
        type="file"
        accept="image/*"
        class="hidden-file-input"
        bind:this={fileInputRef}
        on:change={handleFileChange}
      />

      <div class="presets-section">
        <div class="presets-title">Выберите аватар</div>
        <div class="presets-grid">
          {#if presetCategories.length > 0}
            {#each presetCategories as category}
              {#each category.avatars || [] as avatar}
                <button
                  type="button"
                  class="preset-item"
                  class:selected={selectedPreset?.id === avatar.id}
                  on:click={() => handleSelectPreset(avatar)}
                >
                  <img src={avatar.url} alt="Аватар" class="preset-img" />
                  {#if selectedPreset?.id === avatar.id}
                    <div class="preset-check">✓</div>
                  {/if}
                </button>
              {/each}
            {/each}
          {:else}
            {#each defaultPresets as preset}
              <button
                type="button"
                class="preset-item"
                style="background: {preset.gradient}"
                class:selected={selectedPreset?.id === preset.id}
                on:click={() => handleSelectPreset(preset)}
              >
                <span class="preset-emoji">{preset.emoji}</span>
                {#if selectedPreset?.id === preset.id}
                  <div class="preset-check">✓</div>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      </div>

      {#if error}
        <div class="error-notice">{error}</div>
      {/if}
    </main>

    <footer class="bottom-section">
      <button
        type="button"
        class="submit-button active"
        disabled={loading}
        on:click={completeRegistration}
      >
        {#if loading}
          Сохранение...
        {:else if selectedPreset || customAvatarUrl}
          Начать общение
        {:else}
          Продолжить без фото
        {/if}
      </button>
    </footer>
  {/if}
</div>

<style>
  .auth-screen {
    --auth-bg: #ffffff;
    --auth-text: #000000;
    --auth-text-secondary: #8e8e93;
    --auth-input-bg: rgba(0, 0, 0, 0.05);
    --auth-accent: #007aff;
    --auth-btn-disabled-bg: rgba(0, 0, 0, 0.06);
    --auth-btn-disabled-text: rgba(0, 0, 0, 0.28);
    --auth-avatar-bg: #f2f2f7;
    --auth-camera-pill-bg: #007aff;
    --auth-camera-pill-color: #ffffff;

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
    --auth-avatar-bg: #282932;
    --auth-camera-pill-bg: #007aff;
    --auth-camera-pill-color: #ffffff;
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
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
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
    max-width: 280px;
    font-size: 14px;
    line-height: 1.35;
    text-align: center;
    color: var(--auth-text-secondary);
  }

  .input-card {
    width: 100%;
    height: 52px;
    background-color: var(--auth-input-bg);
    border-radius: 16px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    box-sizing: border-box;
    transition: background-color 0.2s ease;
  }

  .input-card.secondary-card {
    margin-top: 10px;
  }

  .input-card:focus-within {
    background-color: rgba(0, 122, 255, 0.06);
  }

  .dark-theme .input-card:focus-within {
    background-color: rgba(0, 122, 255, 0.12);
  }

  .text-field {
    width: 100%;
    height: 100%;
    border: none;
    background: transparent;
    font-size: 16px;
    color: var(--auth-text);
    outline: none;
  }

  .text-field::placeholder {
    color: var(--auth-text-secondary);
  }

  .avatar-hero-container {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
  }

  .avatar-hero-circle {
    position: relative;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background-color: var(--auth-avatar-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    transition: transform 0.15s ease;
  }

  .avatar-hero-circle:hover {
    transform: scale(1.02);
  }

  .custom-avatar-img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .preset-emoji-hero {
    font-size: 54px;
    line-height: 1;
    user-select: none;
  }

  .avatar-empty-placeholder {
    color: var(--auth-text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .avatar-camera-pill {
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: var(--auth-camera-pill-bg);
    color: var(--auth-camera-pill-color);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }

  .hidden-file-input {
    display: none;
  }

  .presets-section {
    width: 100%;
    margin-top: 8px;
  }

  .presets-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--auth-text-secondary);
    margin-bottom: 12px;
    text-align: center;
  }

  .presets-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 10px;
    width: 100%;
  }

  .preset-item {
    position: relative;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, border-color 0.15s ease;
    background: var(--auth-avatar-bg);
  }

  .preset-item:hover {
    transform: scale(1.08);
  }

  .preset-item.selected {
    border-color: var(--auth-accent);
    transform: scale(1.08);
  }

  .preset-emoji {
    font-size: 24px;
    line-height: 1;
    user-select: none;
  }

  .preset-img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .preset-check {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background-color: var(--auth-accent);
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
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
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
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
</style>
