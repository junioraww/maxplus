<script>
  import { switchEnc } from "$components/ChatWindow/e2e";
  import { fade, fly, scale } from "svelte/transition";
  import { dict } from '$lib/crypto/text-codec';
  import API from "$lib/stores/api";
  import { isChatMuted } from "$lib/utils/notifications";

  export let chat;
  export let messages;
  export let shown;
  export let chatSettings;

  $: muted = isChatMuted(chat);

  async function toggleMute() {
    const nextDDU = muted ? 0 : -1;
    await $API.setChatMute(chat.id, nextDDU);
  }

  let saveTimeout;
  let showPassword = false;
  let hasDictionary = (async() => !!(await dict.getDictionary()))();

  function onPasswordInput(event) {
    const password = event.target.value;

    if (password.length) {
      if (!$chatSettings.obfuscation) setObfuscation("zh");
    } else {
      if ($chatSettings.obfuscation) setObfuscation(null);
    }

    clearTimeout(saveTimeout);

    saveTimeout = setTimeout(() => {
      $chatSettings.password = password;
    }, 500);
  }

  function startEncryption() {
    if (!$chatSettings.obfuscation) setObfuscation("zh");
  }

  async function setObfuscation(type) {
    if (type === "words") {
      hasDictionary = !!(await dict.getDictionary());
    }
    $chatSettings.obfuscation = type;
    $chatSettings.obfs = type;
  }

  async function swapReader() {
    $chatSettings.reader = !$chatSettings.reader;
  }

  function close() {
    shown = false;
  }
</script>

{#if shown}
<div
  class="overlay"
  on:click={close}
  in:fly={{ y: 40,  duration: 260 }}
  out:fly={{ y: 40, duration: 200 }}
>
  <div class="modal" on:click|stopPropagation>
    <div class="header">
      <div class="grabber"></div>
      <div class="buttons">
        <div class="title">
          Настройки
        </div>
        <button class="close-btn" on:click={close}>✕</button>
      </div>
    </div>

    <div class="subtitle">
      Шифрование [beta]
      <button
        style="align-self: flex-end;"
        class="row-action"
        on:click={() => switchEnc(chat, chatSettings, messages)}
      >
        { !$chatSettings.keys.current ? "Новая сессия" : "Отключить" }
      </button>
    </div>
    <div class="group">
      <div class="row">
        <div class="row-title">
          Статус
        </div>
        <div class="row-value">
          { $chatSettings.keys.current ? "Активно"
          : $chatSettings.keys.keys?.some(x => x.edp === null) ? "Предложение отправлено"
          : "Отключено" }
        </div>
      </div>
    </div>

    <div class="footer">
      Когда включено, только вы и собеседник сможете читать сообщения.

      <span class="warning">
        Работает между пользователями Max+
      </span>
    </div>

    <div class="subtitle">Общий секрет</div>
    <div class="group">
      <div class="row password-row">
        <input
          type={showPassword ? "text" : "password"}
          value={$chatSettings.password}
          on:input={onPasswordInput}
          class="input"
          placeholder="Иначе говоря — пароль чата"
        />

        <button
          class="password-toggle"
          on:click={() => (showPassword = !showPassword)}
        >
          {showPassword ? "🙈" : "👁"}
        </button>
      </div>
    </div>

    <div class="footer">
      Использует XOR для симметричного шифрования.
    </div>

    <div class="subtitle">Обфускация</div>
    <div class="obf-buttons">
      <button
        class:active={!$chatSettings.obfuscation}
        class="obf-btn"
        on:click={() => setObfuscation(null)}
      >
        <span class="icon">OFF</span>
        <span>Без обфускации</span>
      </button>

      <button
        class:active={$chatSettings.obfuscation === "zh"}
        class="obf-btn"
        on:click={() => setObfuscation("zh")}
      >
        <span class="icon">Zh</span>
        <span>Китайский</span>
      </button>

      <button
        class:active={$chatSettings.obfuscation === "words"}
        class="obf-btn"
        on:click={() => setObfuscation("words")}
      >
        <span class="icon">Tol</span>
        <span>Книжные слова</span>
      </button>
    </div>

    <div class="footer">
      {#if $chatSettings.obfuscation === "zh"}
        Текст маскируется китайскими символами.
      {:else if $chatSettings.obfuscation === "words"}
        {#await hasDictionary}
        {:then has}
          {#if has}
            Текст превращается в набор литературных слов.
          {:else}
            <a style="color:red;">Загрузите список слов в настройках, раздел "Словарь шифрования"</a>
          {/if}
        {/await}
      {:else}
        Текст не маскируется.
      {/if}
    </div>

    <div class="subtitle">Остальное</div>
    <div class="group">
      <div class="row">
        <div class="row-title">Помечать прочитанным</div>
          <button
            class="row-action"
            on:click={swapReader}
          >
            { $chatSettings.reader ? "Включить" : "Отключить" }
          </button>
      </div>
      <div class="row">
        <div class="row-title">Уведомления</div>
        <button
          class="row-action"
          on:click={toggleMute}
        >
          { muted ? "Включить" : "Отключить" }
        </button>
      </div>
      <div class="row">
        <div class="row-title">
          Сохранить чат
        </div>
        <button class="row-action disabled" disabled>Скоро</button>
      </div>
    </div>
  </div>
</div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.3);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    width: 100%;
    max-width: 520px;
    background: #111;
    border-radius: 28px 28px 0 0;
    padding:
      0
      14px
      calc(24px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    max-height: min(92vh, 600px);
    overflow-y: auto;
  }

  .grabber {
    width: 38px;
    height: 5px;
    border-radius: 999px;
    background: #3a3a3c;
    margin: 0 auto 6px auto;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-direction: column;
    padding: 12px 4px;
    position: sticky;
    top: 0;
    background: #111;
  }

  .buttons {
    display: flex;
    justify-content: space-between;
    width: 100%;
  }

  .title {
    color: white;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }

  .subtitle {
    color: #bbb;
    font-size: 16px;
    font-weight: 600;
    margin: 12px 0;
    margin-left: 2px;
    display: flex;
    width: 100%;
    justify-content: space-between;
  }

  .close-btn {
    width: 34px;
    height: 34px;
    border: none;
    border-radius: 999px;
    background: #2c2c2e;
    color: #f2f2f7;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      transform 0.15s,
      background 0.15s;
  }

  .close-btn:active {
    transform: scale(0.92);
    background: #3a3a3c;
  }

  .group {
    background: #1c1c1e;
    border-radius: 16px;
    overflow: hidden;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 54px;
    padding: 0 16px;
    border-bottom: 1px solid #2c2c2e;
  }

  .row:last-child {
    border-bottom: none;
  }

  .row-left {
    display: flex;
    flex-direction: column;
  }

  .row-title {
    color: white;
    font-size: 16px;
    font-weight: 500;
  }

  .row-subtitle {
    color: #8e8e93;
    font-size: 13px;
  }

  .row-value {
    color: #8e8e93;
    font-size: 15px;
  }

  .row-action {
    border: none;
    background: none;
    color: #0a84ff;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition:
      opacity 0.15s,
      transform 0.12s;
  }

  .row-action:active {
    transform: scale(0.95);
    opacity: 0.7;
  }

  .row-action.disabled {
    color: #636366;
    cursor: not-allowed;
  }

  .password-row {
    gap: 10px;
  }

  .input {
    width: 100%;
    background: transparent;
    border: none;
    color: white;
    font-size: 16px;
    outline: none;
  }

  .password-toggle {
    border: none;
    background: transparent;
    color: #8e8e93;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    transition:
      transform 0.12s,
      opacity 0.15s;
  }

  .password-toggle:active {
    transform: scale(0.9);
    opacity: 0.7;
  }

  .footer {
    color: #8e8e93;
    font-size: 13px;
    margin: 9px 0 9px 4px;
  }

  .warning {
    color: #ff7b7b;
  }

  .obf-buttons {
    display: flex;
    gap: 10px;
  }

  .obf-btn {
    flex: 1;
    height: 56px;
    border: none;
    font-size: 12px;
    border-radius: 12px;
    background: #2c2c2e;
    color: #fff;
    display: flex;
    flex-direction: column;
    justify-content: center;
    cursor: pointer;
    transition: all .15s;
  }

  .obf-btn .icon {
    font-size: 18px;
    font-weight: 1000;
  }

  .obf-btn.active {
    background: #0a84ff;
  }

  .obf-btn:active {
    transform: scale(.96);
}

</style>
