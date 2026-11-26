<script>
  import { onMount } from "svelte";
  import Switch from "$components/common/Switch.svelte";
  import { getChat, getChatSettings } from "$lib/stores/messages";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings";
  import API, { currentUser } from "$lib/stores/api";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { switchEnc } from "$components/ChatWindow/e2e";

  export let chat = null;
  export let userId = null;
  export let close = null;
  export let onClose = null;
  export let setBackHandler = null;

  $: effectiveChatId = (() => {
    if (chat?.id != null) return chat.id;
    if (userId != null && $currentUser != null) {
      try {
        return Number(BigInt(userId) ^ BigInt($currentUser));
      } catch (e) {}
    }
    return undefined;
  })();

  $: chatSettings = effectiveChatId != null ? getChatSettings(effectiveChatId) : null;

  let showPassword = false;
  let copyToast = false;
  let toastText = "";
  let toastTimer = null;

  function showNotification(text) {
    toastText = text;
    copyToast = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      copyToast = false;
    }, 2000);
  }

  function handleBack() {
    if (typeof close === "function") {
      close();
    } else if (typeof onClose === "function") {
      onClose();
    } else if (typeof window !== "undefined") {
      history.back();
    }
    return false;
  }

  $: if (setBackHandler) {
    setBackHandler(handleBack);
  }

  let unregisterBack = null;
  onMount(() => {
    if (!setBackHandler) {
      unregisterBack = registerBackHandler(handleBack);
    }
    return () => {
      if (unregisterBack) unregisterBack();
      if (toastTimer) clearTimeout(toastTimer);
    };
  });

  let switchingEnc = false;

  async function triggerSwitchEnc() {
    if (!$chatSettings || switchingEnc) return;
    const targetChat =
      chat ||
      (effectiveChatId != null
        ? getChat(effectiveChatId)?.getInfo?.() || { id: effectiveChatId, type: "DIALOG" }
        : null);
    if (!targetChat) return;

    const wasEnc = Boolean(
      $chatSettings?.session?.shared_secret ||
        $chatSettings?.session?.fingerprint ||
        $chatSettings?.keys?.current
    );

    switchingEnc = true;
    try {
      const ok = await switchEnc(targetChat, chatSettings, null);
      if (ok) {
        showNotification(wasEnc ? "Шифрование отключено" : "Запрос на новую сессию отправлен");
      }
    } finally {
      switchingEnc = false;
    }
  }

  function copyFingerprint() {
    if (!$chatSettings?.session?.fingerprint) return;
    navigator.clipboard.writeText($chatSettings.session.fingerprint);
    showNotification("Отпечаток ключа скопирован");
  }

  function onPasswordInput(e) {
    if (!$chatSettings) return;
    const pwd = e.target.value;
    if (pwd.length && !$chatSettings.obfuscation && !$chatSettings.obfs) {
      $chatSettings.obfuscation = "zh";
      $chatSettings.obfs = "zh";
    }
    $chatSettings.password = pwd;
  }

  function setObfuscation(val) {
    if (!$chatSettings) return;
    $chatSettings.obfuscation = val;
    $chatSettings.obfs = val;
  }

  function swapReader() {
    if (!$chatSettings) return;
    $chatSettings.reader = !$chatSettings.reader;
  }

  function swapAutoDownload() {
    $autoDownloadEncryptedMedia = !$autoDownloadEncryptedMedia;
  }
</script>

<div class="advanced-settings-screen">
  <header class="advanced-topbar">
    <button type="button" class="btn-topbar-back" on:click={handleBack} aria-label="Назад">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/arrow-left.svg'); mask-image: url('/icons/arrow-left.svg'); width: 22px; height: 22px;"></span>
    </button>
    <div class="topbar-title-wrap">
      <h1 class="topbar-title">Расширенные настройки</h1>
      {#if chat?.title}
        <span class="topbar-subtitle">{chat.title}</span>
      {/if}
    </div>
  </header>

  <div class="advanced-content-scroll">
    <div class="advanced-cards-list">
      <div class="advanced-card">
        <div class="advanced-card-caption">Шифрование</div>

        {#if chat?.type !== "CHAT"}
          <div class="advanced-item-row">
            <div class="advanced-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/shield.svg'); mask-image: url('/icons/shield.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="advanced-item-content">
              <div class="advanced-item-title">Сквозное шифрование (E2E)</div>
              <div class="advanced-item-subtitle">
                {#if $chatSettings?.session?.shared_secret || $chatSettings?.session?.fingerprint || $chatSettings?.keys?.current}
                  <span class="status-badge success">Активно</span>
                {:else if $chatSettings?.pending}
                  <span class="status-badge warning">Запрос отправлен</span>
                {:else}
                  <span class="status-badge muted">Отключено</span>
                {/if}
              </div>
            </div>
            <button
              type="button"
              class="advanced-pill-btn"
              class:danger={$chatSettings?.session?.shared_secret || $chatSettings?.session?.fingerprint || $chatSettings?.keys?.current}
              disabled={switchingEnc}
              on:click={triggerSwitchEnc}
            >
              {!($chatSettings?.session?.shared_secret || $chatSettings?.session?.fingerprint || $chatSettings?.keys?.current) ? "Новая сессия" : "Отключить"}
            </button>
          </div>

          {#if $chatSettings?.session?.fingerprint}
            <div class="advanced-item-row clickable" on:click={copyFingerprint}>
              <div class="advanced-item-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/lock.svg'); mask-image: url('/icons/lock.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="advanced-item-content">
                <div class="advanced-item-title">Отпечаток сессии</div>
                <div class="fingerprint-emojis">
                  {$chatSettings.session.fingerprint}
                </div>
              </div>
              <button type="button" class="btn-copy" title="Скопировать" aria-label="Скопировать отпечаток">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/copy.svg'); mask-image: url('/icons/copy.svg'); width: 18px; height: 18px;"></span>
              </button>
            </div>
          {/if}
        {/if}

        <!-- Symmetric XOR password -->
        <div class="advanced-input-item">
          <div class="advanced-item-icon">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/lock.svg'); mask-image: url('/icons/lock.svg'); width: 22px; height: 22px;"></span>
          </div>
          <input
            type={showPassword ? "text" : "password"}
            value={$chatSettings?.password || ""}
            on:input={onPasswordInput}
            class="advanced-input-field"
            placeholder="Симметричный ключ (XOR пароль)"
          />
          <button
            type="button"
            class="btn-eye"
            on:click={() => (showPassword = !showPassword)}
            aria-label="Показать пароль"
          >
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/stories/eye.svg'); mask-image: url('/icons/stories/eye.svg'); width: 18px; height: 18px;"></span>
          </button>
        </div>
      </div>

      <div class="advanced-card">
        <div class="advanced-card-caption">Маскировка сообщений</div>
        <div class="advanced-segmented-row">
          <button
            type="button"
            class="seg-btn"
            class:active={!$chatSettings?.obfuscation}
            on:click={() => setObfuscation(null)}
          >
            <span>Без маскировки</span>
          </button>
          <button
            type="button"
            class="seg-btn"
            class:active={$chatSettings?.obfuscation === "zh"}
            on:click={() => setObfuscation("zh")}
          >
            <span>Китайский</span>
          </button>
          <button
            type="button"
            class="seg-btn"
            class:active={$chatSettings?.obfuscation === "words"}
            on:click={() => setObfuscation("words")}
          >
            <span>Книжные слова</span>
          </button>
        </div>
      </div>

      <div class="advanced-card">
        <div class="advanced-card-caption">Другие настройки Max+</div>

        <div class="advanced-item-row clickable" on:click={swapReader}>
          <div class="advanced-item-icon">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/stories/eye.svg'); mask-image: url('/icons/stories/eye.svg'); width: 22px; height: 22px;"></span>
          </div>
          <div class="advanced-item-content">
            <div class="advanced-item-title">Отчеты о прочтении</div>
            <div class="advanced-item-subtitle">Отправлять статус «прочитано» собеседнику</div>
          </div>
          <Switch checked={Boolean($chatSettings?.reader)} ariaLabel="Отчеты о прочтении" />
        </div>

        <div class="advanced-item-row clickable" on:click={swapAutoDownload}>
          <div class="advanced-item-icon">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/image-plus.svg'); mask-image: url('/icons/image-plus.svg'); width: 22px; height: 22px;"></span>
          </div>
          <div class="advanced-item-content">
            <div class="advanced-item-title">Автозагрузка медиа</div>
            <div class="advanced-item-subtitle">Автоматически скачивать зашифрованные медиа</div>
          </div>
          <Switch checked={$autoDownloadEncryptedMedia} ariaLabel="Автозагрузка медиа" />
        </div>
      </div>
    </div>
  </div>

  {#if copyToast}
    <div class="advanced-toast">
      <span>{toastText}</span>
    </div>
  {/if}
</div>

<style>
  .advanced-settings-screen {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--bg-primary, #121212);
    color: var(--text-primary, #ffffff);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .advanced-topbar {
    height: 56px;
    min-height: 56px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
    background: var(--bg-surface, #1e1e1e);
    border-bottom: 1px solid var(--border-light, rgba(255, 255, 255, 0.08));
    z-index: var(--z-header, 4);
  }

  .btn-topbar-back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--text-primary, #ffffff);
    cursor: pointer;
    transition: background 0.15s;
    margin-left: -6px;
  }

  .btn-topbar-back:hover {
    background: var(--hover-surface, rgba(255, 255, 255, 0.08));
  }

  .topbar-title-wrap {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .topbar-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .topbar-subtitle {
    font-size: 12px;
    color: var(--text-secondary, #8e8e93);
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .advanced-content-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 12px 32px 12px;
    -webkit-overflow-scrolling: touch;
  }

  .advanced-cards-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
  }

  .advanced-card {
    background: var(--bg-surface, #1e1e1e);
    border-radius: 14px;
    padding: 12px 0;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  /* Indented blue caption strictly aligned directly above row text (to the right of icon) */
  .advanced-card-caption {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent, #0077ff);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 16px 8px 54px;
  }

  .advanced-item-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
    min-height: 52px;
    box-sizing: border-box;
    transition: background 0.15s;
  }

  .advanced-item-row.clickable {
    cursor: pointer;
  }

  .advanced-item-row.clickable:hover {
    background: var(--hover-surface, rgba(255, 255, 255, 0.05));
  }

  .advanced-item-icon {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #8e8e93);
    flex-shrink: 0;
  }

  .advanced-item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .advanced-item-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary, #ffffff);
  }

  .advanced-item-subtitle {
    font-size: 13px;
    color: var(--text-secondary, #8e8e93);
  }

  .status-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
  }

  .status-badge.success {
    background: rgba(52, 199, 89, 0.15);
    color: #34c759;
  }

  .status-badge.warning {
    background: rgba(255, 149, 0, 0.15);
    color: #ff9500;
  }

  .status-badge.muted {
    background: rgba(142, 142, 147, 0.15);
    color: #8e8e93;
  }

  .advanced-pill-btn {
    padding: 6px 14px;
    border-radius: 18px;
    border: none;
    background: var(--accent, #0077ff);
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .advanced-pill-btn:hover {
    opacity: 0.9;
  }

  .advanced-pill-btn.danger {
    background: #ff3b30;
  }

  .fingerprint-emojis {
    font-size: 17px;
    letter-spacing: 2px;
    margin-top: 3px;
    word-break: break-all;
  }

  .btn-copy, .btn-eye {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-secondary, #8e8e93);
    cursor: pointer;
    border-radius: 50%;
    transition: background 0.15s, color 0.15s;
  }

  .btn-copy:hover, .btn-eye:hover {
    background: var(--hover-surface, rgba(255, 255, 255, 0.08));
    color: var(--text-primary, #ffffff);
  }

  .advanced-input-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 10px 16px;
  }

  .advanced-input-field {
    flex: 1;
    background: var(--bg-input, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--border-light, rgba(255, 255, 255, 0.1));
    border-radius: 8px;
    padding: 8px 12px;
    color: var(--text-primary, #ffffff);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }

  .advanced-input-field:focus {
    border-color: var(--accent, #0077ff);
  }

  .advanced-segmented-row {
    display: flex;
    gap: 8px;
    padding: 6px 16px 8px 16px;
  }

  .seg-btn {
    flex: 1;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-light, rgba(255, 255, 255, 0.1));
    background: transparent;
    color: var(--text-secondary, #8e8e93);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
  }

  .seg-btn.active {
    background: var(--accent, #0077ff);
    color: #ffffff;
    border-color: var(--accent, #0077ff);
  }

  .advanced-toast {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    color: #ffffff;
    padding: 10px 20px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: var(--z-toast, 120);
    animation: toastIn 0.2s cubic-bezier(0.1, 0.9, 0.2, 1);
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translate(-50%, 10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .mask-icon {
    display: inline-block;
    background-color: currentColor;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-position: center;
    mask-position: center;
  }
</style>
