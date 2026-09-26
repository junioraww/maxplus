<script>
  import { onDestroy } from "svelte";
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
  let code = "";
  let loading = false;
  const name = sessionGet("name");
  const state = !name ? "login" : "register";

  const unregisterBack = registerBackHandler(() => {
    goto("/auth/" + state);
  });

  onDestroy(() => {
    unregisterBack();
  });

  async function verify() {
    if (loading) return;
    if (code.length !== 6) {
      error = "Длина кода - 6 символов!";
      return;
    }

    error = "";
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
  <p>Введите код, отправленный по указанному номеру телефона</p>
  <div class="form">
    <div class="error">{error}</div>
    <input
      type="text"
      inputmode="numeric"
      maxlength="6"
      value={code}
      on:input={onInput}
      placeholder="Код подтверждения"
      required
    />
    <ActionButton text="Подтвердить" action={verify}/>
  </div>
  <BackButton/>
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
    max-width: min(300px, 90%);
    margin: 0 auto;
  }

  .auth-page h1 {
    margin: 0;
  }

  .auth-page p {
    margin: 10px 0;
    font-size: 14px;
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
    border: 1px solid #333;
    font-size: 1rem;
    background-color: #26262e;
    color: #ccc;
    outline: none;
    text-align: center;
    letter-spacing: 2px;
  }

  .error {
    color: #ff5555;
    font-size: 14px;
    min-height: 20px;
    word-break: break-all;
  }
</style>
