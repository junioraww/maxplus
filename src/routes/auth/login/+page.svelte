<script>
  import { Button } from "$components/ui";
  import { invoke } from "@tauri-apps/api/core";
  import { goto } from "$app/navigation";

  import {
    getAccounts,
    addAccount,
    setCurrentAccount,
  } from "$lib/stores/accounts";
  import {
    get as sessionGet,
    set as sessionSet,
  } from "$lib/stores/session.js";
  import API, {
    currentUser
  } from "$lib/stores/api";

  import BackButton from "$components/main/auth/BackButton.svelte";

  const countries = [
    { id: "ru", flag: "🇷🇺", name: "Россия", code: "+7", length: 10 },
    { id: "by", flag: "🇧🇾", name: "Беларусь", code: "+375", length: 9 },
    { id: "kz", flag: "🇰🇿", name: "Казахстан", code: "+7", length: 10 },
    { id: "uz", flag: "🇺🇿", name: "Узбекистан", code: "+998", length: 9 },
    { id: "kg", flag: "🇰🇬", name: "Киргизия", code: "+996", length: 9 },
    { id: "tj", flag: "🇹🇯", name: "Таджикистан", code: "+992", length: 9 },
    { id: "am", flag: "🇦🇲", name: "Армения", code: "+374", length: 8 },
    { id: "az", flag: "🇦🇿", name: "Азербайджан", code: "+994", length: 9 },
  ];

  let countryId = "ru";
  let digits = "";
  let display = "";
  let error = "";
  let loading = false;

  $: country = countries.find((c) => c.id === countryId) || countries[0];
  $: placeholder = country.length === 10 ? "123 456 78 90" : "12 345 67 89".slice(0, country.length + 3);
  $: canSubmit = digits.length === country.length && !loading;

  function format(value, length) {
    const d = value.slice(0, length);
    const groups = length === 10 ? [3, 3, 2, 2] : length === 9 ? [2, 3, 2, 2] : [2, 2, 2, 2];
    const parts = [];
    let i = 0;
    for (const g of groups) {
      if (i >= d.length) break;
      parts.push(d.slice(i, i + g));
      i += g;
    }
    return parts.join(" ");
  }

  function onInput(e) {
    let raw = e.target.value.replace(/\D/g, "");
    // Вставили номер целиком с кодом страны (например +7 999... или 8 999...)
    const codeDigits = country.code.slice(1);
    if (raw.length > country.length) {
      if (raw.startsWith(codeDigits)) raw = raw.slice(codeDigits.length);
      else if (country.code === "+7" && raw.startsWith("8")) raw = raw.slice(1);
    }
    digits = raw.slice(0, country.length);
    display = format(digits, country.length);
    e.target.value = display;
    error = "";
  }

  function onCountryChange() {
    digits = digits.slice(0, country.length);
    display = format(digits, country.length);
    error = "";
  }

  async function login() {
    if (!canSubmit) return;

    if (!sessionGet("device")) {
      error = "Сначала настройте данные устройства — нажмите на значок глобуса слева сверху";
      return;
    }

    const phone = country.code + digits;
    error = "";
    loading = true;
    sessionSet("phone", phone);

    try {
      const response = await $API.startAuth(phone);
      if (response.success) {
        if (response.codeDelay) sessionSet("codeDelay", response.codeDelay);
        goto("/auth/verify");
      } else {
        error = response.title || response.message || "Не удалось отправить код";
      }
    } catch (e) {
      error = String(e?.message || e);
    } finally {
      loading = false;
    }
  }

  async function showBackButton() {
    return !!(await getAccounts()).length;
  }

  const openDevices = () => sessionSet("devicesPage", true);
  const openDevSettings = () => sessionSet("devSettings", true);

  function loginByQr() {
    goto("/auth/qr");
  }

  const readFile = path => invoke("read_file", { path });

  async function importAccount() {
    const select = await invoke("pick", { type: "JSON" }); // TODO implement this type on Rust side

    if (!select) return;

    console.log('Reading file:', select);
    const data = await readFile(select.uri);
    const text = new TextDecoder().decode(new Uint8Array(data));

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return alert("JSON-файл содержит ошибки!")
    }

    if (!json.version || json.type !== "account") return alert("Неверный файл - это не конфиг аккаунта!");

    if (json.version === 1) {
      const { meta } = json;
      const response = await addAccount(meta.token, meta.device);
      await setCurrentAccount(response.id);
      currentUser.set(undefined);
      goto("/");
    } else {
      return alert("Это конфиг для более новой версии Max+!")
    }
  }
</script>

<div class="auth-page">
  <header class="topbar">
    <button class="icon-btn" on:click={openDevices} aria-label="Данные устройства" title="Данные устройства">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M2.5 12h19" />
        <path d="M12 2.5c2.6 2.6 4 6 4 9.5s-1.4 6.9-4 9.5c-2.6-2.6-4-6-4-9.5s1.4-6.9 4-9.5z" />
      </svg>
    </button>

    <div class="brand">
      <span class="brand__mark" aria-hidden="true"></span>
      <span class="brand__name">max</span>
    </div>

    <button class="icon-btn" on:click={openDevSettings} aria-label="Помощь и настройки отладки" title="Настройки отладки">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4" />
        <circle cx="12" cy="17.4" r="0.6" fill="currentColor" />
      </svg>
    </button>
  </header>

  <BackButton condition={showBackButton} path="/auth/select" top={64} />

  <main class="content">
    <h1>С каким номером телефона<br />хотите войти?</h1>

    <form class="form" on:submit|preventDefault={login}>
      <div class="phone" class:phone--error={!!error}>
        <label class="country" title={country.name}>
          <span class="country__flag">{country.flag}</span>
          <span class="country__code">{country.code}</span>
          <svg class="country__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7" /></svg>
          <select bind:value={countryId} on:change={onCountryChange} aria-label="Страна">
            {#each countries as c}
              <option value={c.id}>{c.flag} {c.name} {c.code}</option>
            {/each}
          </select>
        </label>
        <input
          class="phone__input"
          type="tel"
          inputmode="numeric"
          autocomplete="tel-national"
          value={display}
          on:input={onInput}
          {placeholder}
          aria-label="Номер телефона"
        />
      </div>

      {#if error}
        <p class="hint hint--error">{error}</p>
      {:else}
        <p class="hint">Для входа нужен номер из России или страны из списка — нажмите на флаг, чтобы выбрать</p>
      {/if}

      <div class="submit">
        <Button type="submit" variant="primary" size="lg" full disabled={!canSubmit} {loading}>Продолжить</Button>
      </div>
    </form>
  </main>

  <footer class="footer">
    <p class="legal">
      Нажимая «Продолжить», вы принимаете <span>политику конфиденциальности</span>,
      <span>пользовательское соглашение</span> и <span>правила персональных рекомендаций</span>
    </p>
    <button class="link" on:click={loginByQr}>Войти по QR-коду</button>
    <div class="extra">
      <a href="/auth/register">Создать аккаунт</a>
      <span>·</span>
      <button on:click={importAccount}>Импорт аккаунта</button>
    </div>
  </footer>
</div>

<style>
  .auth-page {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    box-sizing: border-box;
    padding: calc(var(--safe-area-top, 0px) + 12px) 20px calc(var(--safe-area-bottom, 0px) + 20px);
    background: var(--bg-surface);
    color: var(--text-primary);
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .icon-btn:active { background: var(--bg-surface-2); }

  .brand {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .brand__mark {
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #3d8bff 0%, #5b4dff 50%, #b03dff 100%);
    -webkit-mask: url("/icons/logo_foreground.svg") center / contain no-repeat;
    mask: url("/icons/logo_foreground.svg") center / contain no-repeat;
  }

  .brand__name {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: #2b2b33;
    line-height: 1;
  }

  .content {
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
  }

  h1 {
    margin: 40px 0 36px;
    font-size: 26px;
    line-height: 1.25;
    font-weight: 700;
    text-align: center;
  }

  .form {
    display: flex;
    flex-direction: column;
  }

  .phone {
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 16px;
    border-radius: 16px;
    background: var(--bg-surface-2);
    box-shadow: inset 0 0 0 1.5px transparent;
    transition: box-shadow 0.15s ease;
  }

  .phone:focus-within { box-shadow: inset 0 0 0 1.5px var(--accent-primary); }
  .phone--error, .phone--error:focus-within { box-shadow: inset 0 0 0 1.5px var(--status-danger); }

  .country {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-right: 12px;
    font-size: 20px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .country__flag { font-size: 22px; line-height: 1; }
  .country__code { color: var(--text-primary); }
  .country__chevron { color: var(--text-primary); }

  .country select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 16px;
  }

  .phone__input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 20px;
    letter-spacing: 0.3px;
    color: var(--text-primary);
  }

  .phone__input::placeholder { color: var(--text-subtle); }

  .hint {
    margin: 10px 4px 0;
    font-size: 15px;
    line-height: 1.35;
    color: var(--text-muted);
  }

  .hint--error { color: var(--status-danger); }

  .submit { margin-top: 36px; }

  .submit :global(.btn) {
    height: 56px;
    border-radius: 18px;
    font-size: 18px;
  }

  .submit :global(.btn:disabled) { opacity: 0.4; }

  .footer {
    margin-top: auto;
    padding-top: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    text-align: center;
  }

  .legal {
    margin: 0;
    max-width: 440px;
    font-size: 14px;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .legal span { color: var(--text-primary); }

  .link, .extra button {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }

  .link {
    font-size: 17px;
    font-weight: 500;
    color: var(--accent-primary);
  }

  .extra {
    display: flex;
    gap: 8px;
    font-size: 13px;
    color: var(--text-subtle);
  }

  .extra a, .extra button {
    color: var(--text-subtle);
    text-decoration: none;
    font-size: 13px;
  }
</style>
