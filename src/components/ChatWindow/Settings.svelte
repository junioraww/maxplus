<script>
  import { switchEnc } from "$components/ChatWindow/e2e";
  import { fade, fly, scale } from "svelte/transition";
  import { dict } from '$lib/crypto/text-codec';
  import API from "$lib/stores/api";
  import { isChatMuted } from "$lib/utils/notifications";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings.js";

  export let chat;
  export let messages;
  export let shown;
  export let chatSettings;

  $: muted = chat ? isChatMuted(chat) : false;

  async function toggleMute() {
    if (!chat) return;
    const nextDDU = muted ? 0 : -1;
    await $API.setChatMute(chat.id, nextDDU);
    showToast(muted ? "Уведомления включены" : "Уведомления отключены");
  }

  let saveTimeout;
  let showPassword = false;
  let hasDictionary = (async() => !!(await dict.getDictionary()))();

  let toastMessage = "";
  let toastTimer;

  function showToast(text) {
    toastMessage = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage = "";
    }, 2200);
  }

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
      showToast("Пароль сохранен");
    }, 500);
  }

  async function setObfuscation(type) {
    if (type === "words") {
      hasDictionary = !!(await dict.getDictionary());
    }
    $chatSettings.obfuscation = type;
    $chatSettings.obfs = type;
    showToast(type === "zh" ? "Маскировка: Китайский" : type === "words" ? "Маскировка: Книжные слова" : "Маскировка отключена");
  }

  async function swapReader() {
    $chatSettings.reader = !$chatSettings.reader;
    showToast($chatSettings.reader ? "Отчеты о прочтении включены" : "Отчеты о прочтении выключены");
  }

  function toggleAutoDownload() {
    autoDownloadEncryptedMedia.toggle();
    showToast($autoDownloadEncryptedMedia ? "Автозагрузка включена" : "Автозагрузка отключена");
  }

  function copyFingerprint() {
    if ($chatSettings?.session?.fingerprint) {
      navigator.clipboard.writeText($chatSettings.session.fingerprint);
      showToast("Ключ сессии скопирован");
    }
  }

  function close() {
    shown = false;
  }
</script>

{#if shown}
<div
  class="tg-overlay"
  on:click={close}
  in:fade={{ duration: 200 }}
  out:fade={{ duration: 180 }}
>
  <div
    class="tg-modal"
    on:click|stopPropagation
    in:fly={{ y: 50, duration: 250 }}
    out:fly={{ y: 50, duration: 200 }}
  >
    <div class="tg-grabber"></div>

    <div class="tg-header">
      <div class="tg-header-info">
        <h2 class="tg-title">Настройки чата</h2>
        {#if chat?.title}
          <div class="tg-chat-name">{chat.title}</div>
        {/if}
      </div>
      <button class="tg-close-btn" on:click={close} aria-label="Закрыть">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="tg-body">
      {#if chat?.type !== "CHAT"}
        <div class="tg-section-header">Сквозное шифрование (асимметричное)</div>
        <div class="tg-card">
          <div class="tg-row">
            <div class="tg-row-icon tg-icon-shield">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div class="tg-row-main">
              <div class="tg-row-title">Сквозное шифрование</div>
              <div class="tg-row-subtitle">
                {#if $chatSettings.keys?.current || $chatSettings.session}
                  <span class="tg-badge tg-badge-success">Активно</span>
                {:else if $chatSettings.pending}
                  <span class="tg-badge tg-badge-warning">Запрос отправлен</span>
                {:else}
                  <span class="tg-badge tg-badge-muted">Отключено</span>
                {/if}
              </div>
            </div>
            <button
              class="tg-btn-action"
              class:danger={$chatSettings.keys?.current || $chatSettings.session}
              on:click={() => switchEnc(chat, chatSettings, messages)}
            >
              { !($chatSettings.keys?.current || $chatSettings.session) ? "Новая сессия" : "Отключить" }
            </button>
          </div>

          {#if $chatSettings.session?.fingerprint}
            <div class="tg-row tg-fingerprint-row" on:click={copyFingerprint}>
              <div class="tg-row-icon tg-icon-key">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="7.5" cy="15.5" r="4.5"/>
                  <path d="M21 2l-9.6 9.6M15.5 7.5l3 3M18.5 4.5l3 3"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title">Ключ сессии</div>
                <div class="tg-fingerprint-emojis">
                  {$chatSettings.session.fingerprint}
                </div>
              </div>
              <button class="tg-copy-btn" title="Скопировать ключ">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
          {/if}
        </div>

        <div class="tg-caption">
          {#if $chatSettings.session?.fingerprint}
            Сравните эти 4 эмодзи с собеседником для проверки безопасности соединения.
          {:else}
            При включении переписка шифруется на устройстве, прочитать её можете только вы и собеседник.
          {/if}
          <div class="tg-caption-tag">Шифрование доступно между пользователями Max+</div>
        </div>
      {/if}

      <div class="tg-section-header">Симметричный ключ (XOR)</div>
      <div class="tg-card">
        <div class="tg-row tg-input-row">
          <div class="tg-row-icon tg-icon-lock">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <div class="tg-row-main">
            <input
              type={showPassword ? "text" : "password"}
              value={$chatSettings.password || ""}
              on:input={onPasswordInput}
              class="tg-input"
              placeholder="Введите общий секрет чата"
            />
          </div>
          <button
            class="tg-eye-btn"
            on:click={() => (showPassword = !showPassword)}
            aria-label="Показать пароль"
          >
            {#if showPassword}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            {:else}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>
      <div class="tg-caption">Дополнительный общий пароль для симметричного шифрования.</div>

      <div class="tg-section-header">Обфускация трафика</div>
      <div class="tg-segmented">
        <button
          class="tg-seg-btn"
          class:active={!$chatSettings.obfuscation}
          on:click={() => setObfuscation(null)}
        >
          <span class="tg-seg-title">Без маскировки</span>
          <span class="tg-seg-sub">OFF</span>
        </button>

        <button
          class="tg-seg-btn"
          class:active={$chatSettings.obfuscation === "zh"}
          on:click={() => setObfuscation("zh")}
        >
          <span class="tg-seg-title">Китайский</span>
          <span class="tg-seg-sub">Zh</span>
        </button>

        <button
          class="tg-seg-btn"
          class:active={$chatSettings.obfuscation === "words"}
          on:click={() => setObfuscation("words")}
        >
          <span class="tg-seg-title">Книжные слова</span>
          <span class="tg-seg-sub">Tol</span>
        </button>
      </div>

      <div class="tg-caption">
        {#if $chatSettings.obfuscation === "zh"}
          Зашифрованный текст визуально маскируется иероглифами.
        {:else if $chatSettings.obfuscation === "words"}
          {#await hasDictionary}
            Проверка словаря...
          {:then has}
            {#if has}
              Зашифрованный текст превращается в поток литературных слов.
            {:else}
              <span class="tg-warn-text">Словарь не найден. Загрузите список слов в настройках приложения.</span>
            {/if}
          {/await}
        {:else}
          Символы передаются в стандартном зашифрованном виде.
        {/if}
      </div>

      <div class="tg-section-header">Параметры чата</div>
      <div class="tg-card">
        <div class="tg-row tg-toggle-row" on:click={toggleMute}>
          <div class="tg-row-icon tg-icon-bell">
            {#if muted}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
                <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
                <path d="M18 8a6 6 0 0 0-9.33-5"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            {:else}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            {/if}
          </div>
          <div class="tg-row-main">
            <div class="tg-row-title">Уведомления</div>
            <div class="tg-row-subtitle">{muted ? "Отключены" : "Включены"}</div>
          </div>
          <div class="tg-switch" class:active={!muted}>
            <div class="tg-switch-thumb"></div>
          </div>
        </div>

        <div class="tg-row tg-toggle-row" on:click={swapReader}>
          <div class="tg-row-icon tg-icon-check">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <div class="tg-row-main">
            <div class="tg-row-title">Помечать прочитанным</div>
            <div class="tg-row-subtitle">{$chatSettings.reader ? "Автоматически" : "Вручную"}</div>
          </div>
          <div class="tg-switch" class:active={$chatSettings.reader}>
            <div class="tg-switch-thumb"></div>
          </div>
        </div>

        <div class="tg-row tg-toggle-row" on:click={toggleAutoDownload}>
          <div class="tg-row-icon tg-icon-download">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div class="tg-row-main">
            <div class="tg-row-title">Автозагрузка зашифрованных медиа</div>
            <div class="tg-row-subtitle">{$autoDownloadEncryptedMedia ? "Разрешена" : "Выключена"}</div>
          </div>
          <div class="tg-switch" class:active={$autoDownloadEncryptedMedia}>
            <div class="tg-switch-thumb"></div>
          </div>
        </div>

        <div class="tg-row tg-disabled-row">
          <div class="tg-row-icon tg-icon-save">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
          </div>
          <div class="tg-row-main">
            <div class="tg-row-title">Сохранить переписку</div>
            <div class="tg-row-subtitle">Экспорт сообщений и файлов</div>
          </div>
          <span class="tg-badge tg-badge-soon">Скоро</span>
        </div>
      </div>
    </div>

    {#if toastMessage}
      <div class="tg-toast" in:fly={{ y: 20, duration: 180 }} out:fade={{ duration: 150 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>{toastMessage}</span>
      </div>
    {/if}
  </div>
</div>
{/if}

<style>
  .tg-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 120;
  }

  .tg-modal {
    position: relative;
    width: 100%;
    max-width: 500px;
    background: #212121;
    border-radius: 20px 20px 0 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: none;
    padding: 0 16px calc(24px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    max-height: min(90vh, 680px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
  }

  .tg-grabber {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    margin: 8px auto 4px auto;
    flex-shrink: 0;
  }

  .tg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 4px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .tg-header-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tg-title {
    margin: 0;
    color: #ffffff;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.2px;
  }

  .tg-chat-name {
    color: #8774e1;
    font-size: 13px;
    font-weight: 500;
  }

  .tg-close-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: #aaaaaa;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
  }

  .tg-close-btn:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }

  .tg-close-btn:active {
    transform: scale(0.92);
  }

  .tg-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 12px 2px 24px;
    display: flex;
    flex-direction: column;
  }

  .tg-section-header {
    flex-shrink: 0;
    color: #707579;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 16px 6px 8px;
  }

  .tg-section-header:first-of-type {
    margin-top: 4px;
  }

  .tg-card {
    flex-shrink: 0;
    background: #2b2b2b;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    overflow: hidden;
  }

  .tg-row {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    min-height: 52px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    box-sizing: border-box;
  }

  .tg-row:last-child {
    border-bottom: none;
  }

  .tg-toggle-row {
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }

  .tg-toggle-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .tg-row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tg-icon-shield {
    background: rgba(51, 144, 236, 0.15);
    color: #3390ec;
  }

  .tg-icon-key {
    background: rgba(250, 173, 20, 0.15);
    color: #faad14;
  }

  .tg-icon-lock {
    background: rgba(135, 116, 225, 0.15);
    color: #8774e1;
  }

  .tg-icon-bell {
    background: rgba(255, 160, 0, 0.15);
    color: #ffa000;
  }

  .tg-icon-check {
    background: rgba(46, 201, 113, 0.15);
    color: #2ecc71;
  }

  .tg-icon-download {
    background: rgba(0, 188, 212, 0.15);
    color: #00bcd4;
  }

  .tg-icon-save {
    background: rgba(158, 158, 158, 0.15);
    color: #9e9e9e;
  }

  .tg-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tg-row-title {
    color: #ffffff;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.35;
    word-break: break-word;
  }

  .tg-row-subtitle {
    color: #707579;
    font-size: 13px;
    line-height: 1.3;
    word-break: break-word;
  }

  .tg-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .tg-badge-success {
    background: rgba(46, 201, 113, 0.18);
    color: #2ecc71;
  }

  .tg-badge-warning {
    background: rgba(255, 160, 0, 0.18);
    color: #ffa000;
  }

  .tg-badge-muted {
    background: rgba(255, 255, 255, 0.08);
    color: #aaaaaa;
  }

  .tg-badge-soon {
    background: rgba(255, 255, 255, 0.08);
    color: #707579;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .tg-btn-action {
    border: none;
    border-radius: 8px;
    padding: 7px 14px;
    background: #3390ec;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s, opacity 0.15s;
    flex-shrink: 0;
  }

  .tg-btn-action:hover {
    background: #4ea4f6;
  }

  .tg-btn-action:active {
    transform: scale(0.96);
  }

  .tg-btn-action.danger {
    background: rgba(229, 57, 53, 0.18);
    color: #ff595a;
  }

  .tg-btn-action.danger:hover {
    background: rgba(229, 57, 53, 0.28);
  }

  .tg-fingerprint-row {
    cursor: pointer;
    transition: background 0.15s;
  }

  .tg-fingerprint-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .tg-fingerprint-emojis {
    font-size: 20px;
    letter-spacing: 6px;
    margin-top: 2px;
  }

  .tg-copy-btn {
    border: none;
    background: transparent;
    color: #707579;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }

  .tg-copy-btn:hover {
    color: #3390ec;
    background: rgba(51, 144, 236, 0.1);
  }

  .tg-caption {
    flex-shrink: 0;
    color: #707579;
    font-size: 13px;
    line-height: 1.4;
    margin: 8px 10px 4px;
  }

  .tg-caption-tag {
    color: #3390ec;
    margin-top: 4px;
    font-size: 12px;
  }

  .tg-warn-text {
    color: #ff595a;
  }

  .tg-input-row {
    padding-right: 8px;
  }

  .tg-input {
    width: 100%;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 15px;
    outline: none;
    padding: 0;
  }

  .tg-input::placeholder {
    color: #707579;
  }

  .tg-eye-btn {
    border: none;
    background: transparent;
    color: #707579;
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }

  .tg-eye-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.06);
  }

  .tg-segmented {
    flex-shrink: 0;
    display: flex;
    gap: 6px;
    background: #2b2b2b;
    border-radius: 12px;
    padding: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .tg-seg-btn {
    flex: 1;
    border: none;
    background: transparent;
    border-radius: 8px;
    padding: 8px 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    cursor: pointer;
    transition: background 0.18s, color 0.18s, transform 0.12s;
  }

  .tg-seg-btn:active {
    transform: scale(0.97);
  }

  .tg-seg-title {
    color: #aaaaaa;
    font-size: 13px;
    font-weight: 500;
  }

  .tg-seg-sub {
    color: #707579;
    font-size: 11px;
    font-weight: 700;
  }

  .tg-seg-btn.active {
    background: #3390ec;
    box-shadow: 0 2px 8px rgba(51, 144, 236, 0.4);
  }

  .tg-seg-btn.active .tg-seg-title,
  .tg-seg-btn.active .tg-seg-sub {
    color: #ffffff;
  }

  .tg-switch {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: #3d3d3d;
    position: relative;
    transition: background 0.22s ease;
    flex-shrink: 0;
  }

  .tg-switch.active {
    background: #3390ec;
  }

  .tg-switch-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ffffff;
    position: absolute;
    top: 2px;
    left: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 0.22s cubic-bezier(0.3, 0, 0.1, 1);
  }

  .tg-switch.active .tg-switch-thumb {
    transform: translateX(20px);
  }

  .tg-disabled-row {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .tg-toast {
    position: absolute;
    bottom: calc(20px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 16px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 10;
    pointer-events: none;
  }

  .tg-toast svg {
    color: #2ecc71;
  }
</style>
