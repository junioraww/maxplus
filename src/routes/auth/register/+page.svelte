<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session.js";
  import API from "$lib/stores/api";
  import { getDevice } from "$lib/stores/accounts";

  import OpenDevSettingsButton from "$components/main/dev/OpenButton.svelte";
  import OpenDevicesButton from "$components/main/devices/OpenButton.svelte";
  import ActionButton from "$components/main/auth/ActionButton.svelte";

  let error = "";
  let phone = sessionGet("phone") || "";
  let name = sessionGet("name") || "";
  const existingRegisterToken = sessionGet("registerToken");

  onMount(async () => {
    if (!sessionGet("device")) {
      const dev = await getDevice();
      if (dev) sessionSet("device", dev);
    }
  });

  async function completeExistingRegistration() {
    if (!name.trim()) {
      error = "Введите псевдоним!";
      return;
    }

    if (!sessionGet("device")) {
      const dev = await getDevice();
      if (dev) {
        sessionSet("device", dev);
      } else {
        return alert("Нажмите на иконку телефона, чтобы настроить данные входа!");
      }
    }

    error = "";
    try {
      const regResponse = await $API.submitRegister(name.trim());
      if (regResponse?.error) {
        error = regResponse.title || regResponse.message || "Ошибка регистрации";
        return;
      }
      sessionSet("registerToken", null);
      goto("/");
    } catch (e) {
      error = e?.message || "Ошибка регистрации";
    }
  }

  async function register() {
    if (phone.length < 7) {
      error = "Это не номер!";
      return;
    }

    if (!sessionGet("device")) {
      const dev = await getDevice();
      if (dev) {
        sessionSet("device", dev);
      } else {
        return alert("Нажмите на иконку телефона, чтобы настроить данные входа!");
      }
    }

    error = "";
    if (!phone.startsWith("+")) phone = "+" + phone;

    sessionSet("phone", phone);
    sessionSet("name", name);

    const response = await $API.startAuth(phone);

    if (!response?.success) {
      error = response?.title || response?.message || "Ошибка отправки кода";
    } else {
      if (response.codeDelay) sessionSet("codeDelay", response.codeDelay);
      if (response.codeLength) sessionSet("codeLength", response.codeLength);
      sessionSet("authPayload", response);
      goto("/auth/verify");
    }
  }
</script>

<div class="auth-page">
  <h1>Регистрация</h1>
  <div class="form">
    <div class="error">{error}</div>
    <input
      type="text"
      bind:value={name}
      placeholder="Псевдоним"
      required
    />
    {#if !existingRegisterToken}
      <input
        type="tel"
        bind:value={phone}
        placeholder="Номер телефона"
        required
      />
      <ActionButton text="Получить код" action={register}/>
    {:else}
      <ActionButton text="Завершить регистрацию" action={completeExistingRegistration}/>
    {/if}
  </div>
  <a href="/auth/login" class="link">Уже есть аккаунт? <u>Войти</u></a>
</div>

<OpenDevSettingsButton />
<OpenDevicesButton />

<style>
  .auth-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    text-align: center;
    color: #ddd;
  }

  .auth-page h1 {
    margin: 0;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: min(300px, 90%);
  }

  input {
    padding: 0.75rem;
    border-radius: 8px;
    border: 1px solid #333;
    font-size: 1rem;
    background-color: #26262e;
    color: #ccc;
    outline: none;
  }

  .link {
    margin-top: 20px;
    font-size: 15px;
    color: #4a90e2;
    text-decoration: none;
    transition: transform 0.2s;
  }

  .link:hover {
    transform: scale(1.02);
  }

  .error {
    color: red;
    font-size: 15px;
    height: 22px;
    word-break: break-all;
  }
</style>
