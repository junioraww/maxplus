<script>
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import API, { currentUserDetails } from "$lib/stores/api";
  import { showAlert } from "$lib/utils/alert";

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let loading = true;
  let busy = false;
  let status = null;
  let mode = "status";

  let setupTrackId = "";
  let newPassword = "";
  let confirmPassword = "";
  let hint = "";
  let email = "";
  let code = "";
  let cooldown = 0;
  let cooldownInterval = null;

  let currentPassword = "";
  let changeNewPassword = "";
  let changeConfirmPassword = "";
  let changeHint = "";

  onMount(async () => {
    await loadStatus();
  });

  onDestroy(() => {
    if (cooldownInterval) clearInterval(cooldownInterval);
  });

  async function loadStatus() {
    loading = true;
    try {
      status = await $API.getTwoFactorStatus();
    } catch (e) {
      const profile = $currentUserDetails;
      if (profile?.profileOptions?.includes(2)) {
        status = { enabled: true, trackId: null, hint: null, email: null };
      } else {
        showAlert(e?.message || e || "Не удалось загрузить статус пароля");
      }
    } finally {
      loading = false;
    }
  }

  function resetState() {
    mode = "status";
    setupTrackId = "";
    newPassword = "";
    confirmPassword = "";
    hint = "";
    email = "";
    code = "";
    currentPassword = "";
    changeNewPassword = "";
    changeConfirmPassword = "";
    changeHint = "";
    if (cooldownInterval) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
    cooldown = 0;
  }

  function proceedPasswordStep() {
    if (!newPassword || newPassword.length < 6) {
      showAlert("Пароль должен содержать минимум 6 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert("Пароли не совпадают");
      return;
    }
    mode = "setup_hint";
  }

  function proceedHintStep(skip = false) {
    if (skip) hint = "";
    mode = "setup_email";
  }

  async function sendEmailCode() {
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      showAlert("Укажите корректный адрес электронной почты");
      return;
    }

    busy = true;
    try {
      const resp = await $API.requestTwoFactorEmailCode(setupTrackId || null, trimmed);
      setupTrackId = resp?.trackId || setupTrackId;
      startCooldown(Number(resp?.blockingDuration) || 60);
      mode = "setup_code";
    } catch (e) {
      showAlert(e?.message || e || "Не удалось отправить код на почту");
    } finally {
      busy = false;
    }
  }

  function startCooldown(sec) {
    if (cooldownInterval) clearInterval(cooldownInterval);
    cooldown = sec;
    cooldownInterval = setInterval(() => {
      cooldown -= 1;
      if (cooldown <= 0) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
      }
    }, 1000);
  }

  async function finishSetup(withEmail = false) {
    if (withEmail && !code.trim()) {
      showAlert("Введите код подтверждения");
      return;
    }

    busy = true;
    try {
      await $API.setupTwoFactorPassword({
        password: newPassword,
        hint: hint.trim() || null,
        email: withEmail ? email.trim() : null,
        code: withEmail ? code.trim() : null,
        trackId: setupTrackId || null,
      });
      showAlert("Облачный пароль успешно установлен");
      resetState();
      await loadStatus();
    } catch (e) {
      showAlert(e?.message || e || "Ошибка при установке пароля");
    } finally {
      busy = false;
    }
  }

  async function submitChangePassword() {
    if (!currentPassword) {
      showAlert("Введите текущий пароль");
      return;
    }
    if (!changeNewPassword || changeNewPassword.length < 6) {
      showAlert("Новый пароль должен содержать минимум 6 символов");
      return;
    }
    if (changeNewPassword !== changeConfirmPassword) {
      showAlert("Новые пароли не совпадают");
      return;
    }

    busy = true;
    try {
      await $API.changeTwoFactorPassword({
        currentPassword,
        newPassword: changeNewPassword,
        newHint: changeHint.trim() || null,
      });
      showAlert("Пароль успешно изменён");
      resetState();
      await loadStatus();
    } catch (e) {
      showAlert(e?.message || e || "Ошибка при изменении пароля");
    } finally {
      busy = false;
    }
  }

  async function submitDisablePassword() {
    if (!currentPassword) {
      showAlert("Введите текущий пароль");
      return;
    }

    busy = true;
    try {
      await $API.removeTwoFactorPassword({ currentPassword });
      showAlert("Облачный пароль отключён");
      resetState();
      await loadStatus();
    } catch (e) {
      showAlert(e?.message || e || "Неверный пароль или ошибка");
    } finally {
      busy = false;
    }
  }
</script>

<SettingsPageWrapper title="Облачный пароль" {from} {onClose}>
  <div class="container">
    {#if loading}
      <div class="status-msg">Загрузка данных...</div>
    {:else if mode === "status"}
      {#if !status?.enabled}
        <div class="card">
          <p class="status warning">Статус: <b>неактивно</b></p>
          <p class="description">
            Облачный пароль запрашивается при входе в аккаунт с нового устройства в дополнение к коду подтверждения.
          </p>
          <button class="primary-btn" disabled={busy} on:click={() => { mode = "setup_password"; }}>
            Установить пароль
          </button>
        </div>
      {:else}
        <div class="card">
          <p class="status success">Статус: <b>активно</b></p>
          <p class="description">
            Двухфакторная аутентификация включена. Пароль защищает ваш аккаунт от несанкционированного доступа.
          </p>

          {#if status.hint || status.email}
            <div class="info-list">
              {#if status.hint}
                <div class="info-row">
                  <span class="info-label">Подсказка:</span>
                  <strong class="info-val">{status.hint}</strong>
                </div>
              {/if}

              {#if status.email}
                <div class="info-row">
                  <span class="info-label">Почта:</span>
                  <strong class="info-val">{status.email}</strong>
                </div>
              {/if}
            </div>
          {/if}

          <button class="primary-btn" on:click={() => { mode = "change_password"; currentPassword = ""; }}>
            Сменить пароль
          </button>

          <button class="danger-btn" on:click={() => { mode = "auth_for_disable"; currentPassword = ""; }}>
            Отключить
          </button>
        </div>
      {/if}

    {:else if mode === "setup_password"}
      <div class="card">
        <div class="step-indicator">Шаг 1 из 3</div>
        <h3 class="card-title">Придумайте пароль</h3>
        <p class="description">
          Используйте надежный пароль длиной не менее 6 символов.
        </p>

        <div class="field">
          <label for="new-pass">Новый пароль</label>
          <input
            id="new-pass"
            type="password"
            placeholder="Введите пароль"
            bind:value={newPassword}
          />
        </div>

        <div class="field">
          <label for="confirm-pass">Повторите пароль</label>
          <input
            id="confirm-pass"
            type="password"
            placeholder="Повторите пароль"
            bind:value={confirmPassword}
          />
        </div>

        <button class="primary-btn" disabled={busy} on:click={proceedPasswordStep}>
          Далее
        </button>
        <button class="secondary-btn" disabled={busy} on:click={resetState}>
          Отмена
        </button>
      </div>

    {:else if mode === "setup_hint"}
      <div class="card">
        <div class="step-indicator">Шаг 2 из 3</div>
        <h3 class="card-title">Подсказка для пароля</h3>
        <p class="description">
          Подсказка поможет вспомнить пароль, если вы его забудете. Она не должна содержать сам пароль.
        </p>

        <div class="field">
          <label for="hint-input">Подсказка</label>
          <input
            id="hint-input"
            type="text"
            placeholder="Например: любимая книга"
            maxlength="64"
            bind:value={hint}
          />
        </div>

        <button class="primary-btn" disabled={busy} on:click={() => proceedHintStep(false)}>
          Далее
        </button>
        <button class="secondary-btn" disabled={busy} on:click={() => proceedHintStep(true)}>
          Пропустить
        </button>
        <button class="text-btn" disabled={busy} on:click={() => { mode = "setup_password"; }}>
          Назад
        </button>
      </div>

    {:else if mode === "setup_email"}
      <div class="card">
        <div class="step-indicator">Шаг 3 из 3</div>
        <h3 class="card-title">Почта для восстановления</h3>
        <p class="description">
          На указанный адрес будет отправлен код. Почта позволит сбросить пароль при утрате.
        </p>

        <div class="field">
          <label for="email-input">Электронная почта</label>
          <input
            id="email-input"
            type="email"
            placeholder="name@example.com"
            bind:value={email}
          />
        </div>

        <button class="primary-btn" disabled={busy} on:click={sendEmailCode}>
          Отправить код
        </button>
        <button class="secondary-btn" disabled={busy} on:click={() => finishSetup(false)}>
          Пропустить
        </button>
        <button class="text-btn" disabled={busy} on:click={() => { mode = "setup_hint"; }}>
          Назад
        </button>
      </div>

    {:else if mode === "setup_code"}
      <div class="card">
        <div class="step-indicator">Подтверждение почты</div>
        <h3 class="card-title">Введите код</h3>
        <p class="description">
          Мы отправили письмо с кодом на <b>{email}</b>.
        </p>

        <div class="field">
          <label for="code-input">Код из письма</label>
          <input
            id="code-input"
            type="text"
            placeholder="Код подтверждения"
            maxlength="16"
            bind:value={code}
          />
        </div>

        <button class="primary-btn" disabled={busy} on:click={() => finishSetup(true)}>
          Завершить
        </button>

        {#if cooldown > 0}
          <div class="cooldown-text">Отправить повторно через {cooldown} сек.</div>
        {:else}
          <button class="secondary-btn" disabled={busy} on:click={sendEmailCode}>
            Отправить код повторно
          </button>
        {/if}

        <button class="text-btn" disabled={busy} on:click={() => { mode = "setup_email"; }}>
          Изменить адрес
        </button>
      </div>

    {:else if mode === "change_password"}
      <div class="card">
        <h3 class="card-title">Смена пароля</h3>
        <p class="description">
          Введите ваш текущий пароль, а также новый пароль и подсказку.
        </p>

        <div class="field">
          <label for="ch-cur-pass">Текущий пароль</label>
          <input
            id="ch-cur-pass"
            type="password"
            placeholder="Введите текущий пароль"
            bind:value={currentPassword}
          />
        </div>

        <div class="field">
          <label for="ch-new-pass">Новый пароль</label>
          <input
            id="ch-new-pass"
            type="password"
            placeholder="Минимум 6 символов"
            bind:value={changeNewPassword}
          />
        </div>

        <div class="field">
          <label for="ch-confirm-pass">Повторите новый пароль</label>
          <input
            id="ch-confirm-pass"
            type="password"
            placeholder="Повторите новый пароль"
            bind:value={changeConfirmPassword}
          />
        </div>

        <div class="field">
          <label for="ch-hint">Новая подсказка (необязательно)</label>
          <input
            id="ch-hint"
            type="text"
            placeholder="Подсказка для нового пароля"
            maxlength="64"
            bind:value={changeHint}
          />
        </div>

        <button class="primary-btn" disabled={busy} on:click={submitChangePassword}>
          Сохранить пароль
        </button>
        <button class="secondary-btn" disabled={busy} on:click={resetState}>
          Отмена
        </button>
      </div>

    {:else if mode === "auth_for_disable"}
      <div class="card">
        <h3 class="card-title">Отключение пароля</h3>
        <p class="description">
          Для отключения защиты введите ваш текущий облачный пароль. После этого аккаунт будет защищён только кодом из SMS.
        </p>

        <div class="field">
          <label for="cur-pass-disable">Текущий пароль</label>
          <input
            id="cur-pass-disable"
            type="password"
            placeholder="Введите текущий пароль"
            bind:value={currentPassword}
          />
        </div>

        <button class="danger-btn" disabled={busy} on:click={submitDisablePassword}>
          Отключить защиту
        </button>
        <button class="secondary-btn" disabled={busy} on:click={resetState}>
          Отмена
        </button>
      </div>
    {/if}
  </div>
</SettingsPageWrapper>

<style>
  .container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 20px 16px;
    box-sizing: border-box;
    width: 100%;
    min-height: 100%;
  }

  .card {
    width: 100%;
    max-width: 380px;
    background: #24252a;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .card-title {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
    color: white;
  }

  .step-indicator {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #3390ec;
    font-weight: 600;
  }

  .status {
    margin: 0;
    font-size: 1.05rem;
  }

  .status.success {
    color: #68d391;
  }

  .status.warning {
    color: #f6c453;
  }

  .description {
    margin: 0;
    color: #9ca3af;
    line-height: 1.5;
    font-size: 0.92rem;
  }

  .info-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    background: #1b1c21;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    padding: 10px 14px;
  }

  .info-label {
    color: #888;
    font-size: 0.88rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .info-val {
    color: white;
    font-size: 0.92rem;
    word-break: break-all;
    text-align: right;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-size: 0.85rem;
    color: #888;
  }

  input {
    width: 100%;
    background: #1f1f26;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    color: white;
    padding: 13px 14px;
    box-sizing: border-box;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  input:focus {
    border-color: #3390ec;
    background: #20202a;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    font-weight: 600;
    width: 100%;
    height: 44px;
    border-radius: 12px;
    font-size: 0.95rem;
    transition: transform 0.12s, opacity 0.15s, background 0.15s;
  }

  button:active {
    transform: scale(0.98);
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .primary-btn {
    background: #3390ec;
    color: white;
  }

  .primary-btn:hover:not(:disabled) {
    background: #2b7ecf;
  }

  .secondary-btn {
    background: rgba(255, 255, 255, 0.06);
    color: #ddd;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .secondary-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .danger-btn {
    background: rgba(239, 68, 68, 0.15);
    color: #ff595a;
    border: 1px solid rgba(239, 68, 68, 0.25);
  }

  .danger-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
  }

  .text-btn {
    background: transparent;
    color: #888;
    height: 36px;
  }

  .text-btn:hover:not(:disabled) {
    color: #bbb;
  }

  .cooldown-text {
    text-align: center;
    font-size: 0.85rem;
    color: #888;
  }

  .status-msg {
    color: #888;
    font-size: 0.95rem;
  }

  @media (max-width: 400px) {
    .container {
      padding: 0;
      align-items: center;
    }

    .card {
      max-width: 100%;
      border-radius: 0;
      border-left: none;
      border-right: none;
      padding: 20px 16px;
    }
  }
</style>
