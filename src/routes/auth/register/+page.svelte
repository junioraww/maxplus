<script>
  import { Input } from "$components/ui";
  import { goto } from "$app/navigation";
  import {
    set as sessionSet,
    get as sessionGet
  } from "$lib/stores/session.js";
  import API from "$lib/stores/api";

  import OpenDevSettingsButton from "$components/main/dev/OpenButton.svelte";
  import OpenDevicesButton from "$components/main/devices/OpenButton.svelte";
  import ActionButton from "$components/main/auth/ActionButton.svelte";

  let error = "";
  let phone = "";
  let name = "";

  async function register() {
    if (phone.length < 7) {
      error = "Это не номер!";
      return;
    }

    if (!sessionGet("device")) return alert("Нажмите на иконку телефона, чтобы настроить данные входа!");

    error = "";
    console.log("Запрос на регистрацию:", { phone, name });
    if (!phone.startsWith("+")) phone = "+" + phone;

    sessionSet("phone", phone);
    sessionSet("name", name);

    const response = await $API.startAuth(phone);

    if (!response.success) {
      error = "Ошибка!";
      alert(response.title);
    } else {
      if (response.codeDelay) sessionSet("codeDelay", response.codeDelay);
      goto("/auth/verify");
    }
  }
</script>

<div class="auth-page">
  <h1>Регистрация</h1>
  <div class="form">
    <div class="error">{error}</div>
    <Input
      type="text"
      bind:value={name}
      placeholder="Псевдоним"
    />
    <Input
      type="tel"
      bind:value={phone}
      placeholder="Номер телефона"
    />
    <ActionButton text="Получить код" action={register}/>
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
    color: var(--text-primary);
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


  .link {
    margin-top: 20px;
    font-size: 15px;
    color: var(--accent-primary);
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
