<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Session, {
    get as sessionGet,
    set as sessionSet,
  } from "$lib/stores/session";
  import { getAccounts, getDevice, saveDevice } from "$lib/stores/accounts";
  import { generateDevice } from "$lib/utils/device";
  import { activeThemeId, toggleTheme } from "$lib/stores/theme";
  import API from "$lib/stores/api";
  import { isNo2FaError } from "$lib/api/MobileApi";

  import AuroraBackground from "$components/main/auth/AuroraBackground.svelte";
  import MaxLogo from "$components/main/auth/MaxLogo.svelte";
  import CountryPickerModal from "$components/main/auth/CountryPickerModal.svelte";

  let country = {
    name: "Россия",
    code: "+7",
    flag: "🇷🇺",
    mask: "### ### ## ##",
  };

  let rawDigits = "";
  let formattedPhone = "";
  let isPickerOpen = false;
  let error = "";
  let loading = false;
  let phoneInputRef;

  $: requiredLength = country.mask ? (country.mask.match(/#/g) || []).length : 10;
  $: isValid = rawDigits.length === requiredLength;

  async function ensureDevice() {
    let dev = sessionGet("device");
    if (!dev?.deviceId) {
      dev = await getDevice().catch(() => null);
    }
    if (!dev?.deviceId) {
      dev = generateDevice();
      await saveDevice(dev);
    }
    sessionSet("device", dev);
    return dev;
  }

  onMount(async () => {
    await ensureDevice();

    const savedPhone = sessionGet("phone");
    if (savedPhone) {
      if (savedPhone.startsWith("+7") && savedPhone.length > 2) {
        setRawDigits(savedPhone.slice(2));
      }
    }
  });

  function setRawDigits(val) {
    const clean = val.replace(/\D/g, "").slice(0, requiredLength);
    rawDigits = clean;
    formattedPhone = applyMask(clean, country.mask);
  }

  function applyMask(digits, mask) {
    if (!mask) return digits;
    let res = "";
    let di = 0;
    for (let i = 0; i < mask.length && di < digits.length; i++) {
      if (mask[i] === "#") {
        res += digits[di++];
      } else {
        res += mask[i];
      }
    }
    return res;
  }

  function handlePhoneInput(e) {
    error = "";
    const inputVal = e.target.value;
    setRawDigits(inputVal);
  }

  function handleCountrySelect(e) {
    country = e.detail;
    isPickerOpen = false;
    setRawDigits(rawDigits);
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollLeft = 0;
      if (document.body) document.body.scrollLeft = 0;
    }
    if (phoneInputRef) {
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.scrollTo(0, 0);
          if (document.documentElement) document.documentElement.scrollLeft = 0;
          if (document.body) document.body.scrollLeft = 0;
        }
        phoneInputRef.focus();
      }, 50);
    }
  }

  async function handleToggleTheme() {
    await toggleTheme();
  }

  async function handleContinue() {
    if (loading) return;

    if (!isValid) {
      error = "Введите полный номер телефона";
      return;
    }

    await ensureDevice();
    performAuth();
  }

  async function performAuth() {
    if (loading) return;
    error = "";
    loading = true;

    const fullPhone = `${country.code}${rawDigits}`;
    sessionSet("phone", fullPhone);

    try {
      const response = await $API.startAuth(fullPhone);

      if (response?.success) {
        if (response.codeDelay) sessionSet("codeDelay", response.codeDelay);
        if (response.codeLength) sessionSet("codeLength", response.codeLength);
        sessionSet("authPayload", response);

        if (response.authType === "CALL_OUT" || response.requestType === "CALL_OUT" || response.callNumber) {
          goto("/auth/callout");
        } else {
          goto("/auth/verify");
        }
      } else {
        loading = false;
        if (isNo2FaError(response)) {
          goto("/auth/restrict");
          return;
        }
        error = response?.title || response?.message || "Ошибка отправки кода";
      }
    } catch (e) {
      loading = false;
      if (isNo2FaError(e)) {
        goto("/auth/restrict");
        return;
      }
      error = e?.message || "Не удалось связаться с сервером";
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && isValid) {
      handleContinue();
    }
  }
</script>

<div class="auth-screen" class:dark-theme={$activeThemeId === "dark"}>
  <AuroraBackground />

  <header class="top-nav">
    <button
      type="button"
      class="icon-button"
      on:click={() => goto("/auth/select?from=login")}
      aria-label="Выбрать аккаунт"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
    </button>

    <div class="logo-center">
      <MaxLogo size={32} />
    </div>

    <button
      type="button"
      class="icon-button"
      on:click={handleToggleTheme}
      aria-label="Сменить тему"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    </button>
  </header>

  <main class="content-container">
    <div class="title-section">
      <h1 class="main-heading">
        С каким номером<br />телефона хотите войти?
      </h1>
    </div>

    <div class="input-card">
      <button
        type="button"
        class="country-btn"
        on:click={() => (isPickerOpen = true)}
        aria-label="Выбрать страну"
      >
        <span class="country-flag">{country.flag}</span>
        <span class="country-code">{country.code}</span>
        <svg class="chevron-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      <input
        bind:this={phoneInputRef}
        type="tel"
        inputmode="numeric"
        class="phone-field"
        placeholder="123 456 78 90"
        value={formattedPhone}
        on:input={handlePhoneInput}
        on:keydown={handleKeyDown}
        autocomplete="tel"
      />
    </div>

    <p class="field-hint">
      Для входа нужен номер страны из списка — нажмите на флаг, чтобы выбрать
    </p>

    {#if error}
      <div class="error-notice">{error}</div>
    {/if}
  </main>

  <footer class="bottom-section">
    <button
      type="button"
      class="submit-button"
      class:active={isValid && !loading}
      disabled={!isValid || loading}
      on:click={handleContinue}
    >
      {loading ? "Отправка..." : "Продолжить"}
    </button>

    <p class="disclaimer-text">
      Нажимая «Продолжить», вы принимаете <span class="highlight">политику конфиденциальности</span>, <span class="highlight">пользовательское соглашение</span> и <span class="highlight">правила персональных рекомендаций</span>
    </p>
  </footer>

  {#if isPickerOpen}
    <CountryPickerModal
      selectedCode={country.code}
      on:select={handleCountrySelect}
      on:close={() => (isPickerOpen = false)}
    />
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
    --auth-card-bg: #ffffff;
    --auth-border: #e5e5ea;

    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    width: 100%;
    max-width: 100vw;
    background-color: var(--auth-bg);
    color: var(--auth-text);
    box-sizing: border-box;
    padding-top: var(--safe-top, 0px);
    padding-bottom: var(--safe-bottom, 0px);
    overflow-x: hidden;
    contain: paint;
  }

  .auth-screen.dark-theme {
    --auth-bg: #17181c;
    --auth-text: #ffffff;
    --auth-text-secondary: #8e8e93;
    --auth-input-bg: rgba(255, 255, 255, 0.09);
    --auth-accent: #007aff;
    --auth-btn-disabled-bg: rgba(255, 255, 255, 0.12);
    --auth-btn-disabled-text: rgba(255, 255, 255, 0.28);
    --auth-card-bg: #1c1d22;
    --auth-border: rgba(255, 255, 255, 0.1);
  }

  .top-nav {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    padding: 0 16px;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .icon-button {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--auth-text);
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .icon-button:active {
    background-color: rgba(127, 127, 127, 0.12);
  }

  .logo-center {
    display: flex;
    align-items: center;
  }

  .content-container {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 36px 20px 0 20px;
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .title-section {
    text-align: center;
    margin-bottom: 24px;
  }

  .main-heading {
    margin: 0 auto;
    max-width: 280px;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--auth-text);
    letter-spacing: -0.2px;
  }

  .input-card {
    display: flex;
    align-items: center;
    height: 52px;
    background-color: var(--auth-input-bg);
    border-radius: 16px;
    padding: 0 14px;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
    transition: box-shadow 0.15s ease;
  }

  .input-card:focus-within {
    box-shadow: 0 0 0 1.5px rgba(0, 122, 255, 0.45);
  }

  .country-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--auth-text);
    font-family: inherit;
    font-size: 15.5px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .country-flag {
    font-size: 19px;
    line-height: 1;
  }

  .country-code {
    font-size: 15.5px;
    font-weight: 500;
    color: var(--auth-text);
  }

  .chevron-icon {
    color: var(--auth-text-secondary);
    margin-left: -2px;
  }

  .phone-field {
    flex: 1;
    min-width: 0;
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-size: 15.5px;
    font-family: inherit;
    color: var(--auth-text);
    font-weight: 400;
    letter-spacing: 0.3px;
    padding: 0;
    -webkit-user-select: text;
    user-select: text;
  }

  .phone-field::placeholder {
    color: var(--auth-text-secondary);
    opacity: 0.85;
  }

  .field-hint {
    margin: 10px 4px 0 4px;
    font-size: 12.5px;
    line-height: 1.35;
    color: var(--auth-text-secondary);
    text-align: left;
  }

  .error-notice {
    margin-top: 14px;
    padding: 10px 14px;
    background-color: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    border-radius: 10px;
    font-size: 14px;
    text-align: center;
  }

  .bottom-section {
    position: relative;
    z-index: 2;
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

  .disclaimer-text {
    margin: 14px 0 0 0;
    font-size: 11.5px;
    line-height: 1.32;
    color: var(--auth-text-secondary);
    text-align: center;
    max-width: 320px;
  }

  .disclaimer-text .highlight {
    color: var(--auth-text);
    font-weight: 500;
  }
</style>
