<script>
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import SettingsDropout from "$components/settings/SettingsDropout.svelte";
  import Switch from "$components/common/Switch.svelte";
  import { getCurrentAccount, getDatabaseFilesCount } from "$lib/stores/accounts";
  import { checkHardwareBiometry } from "$lib/services/hardwareSecurity";
  import { openLockScreen } from "$lib/stores/lockScreen";
  import { showAlert } from "$lib/utils/alert";
  import {
    autoLockTimer,
    setAutoLockTimer,
    loadAccountAutoLockTimer,
    AUTO_LOCK_OPTIONS,
  } from "$lib/stores/autoLock";
  import {
    camouflageSettings,
    saveCamouflageSettings,
    generateNewSeed,
    activeProceduralTheme,
    lockCamouflage,
    pluginCustomApps
  } from "$lib/camouflage/store";
  import DecoyApp from "$components/camouflage/DecoyApp.svelte";
  import { keyboardOpen, keyboardHeight } from "$lib/stores/keyboard";

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let account = null;
  let encryption = undefined;
  let fileCount = null;
  let biometryStatus = { available: false, biometryType: 0 };
  let loading = true;

  let showPinModal = false;
  let newPin = "";
  let pinError = "";
  let showPreview = false;

  const APP_TYPES = [
    { id: "calculator", label: "Калькулятор" },
    { id: "notes", label: "Заметки" },
    { id: "todo", label: "Задачи" },
    { id: "converter", label: "Конвертер" }
  ];

  const APP_ICONS = {
    calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="16" y1="18" x2="16" y2="18.01"/><line x1="12" y1="18" x2="12" y2="18.01"/><line x1="8" y1="18" x2="8" y2="18.01"/>',
    notes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    todo: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    converter: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'
  };

  $: allAppTypes = [...APP_TYPES, ...$pluginCustomApps];
  $: isLockConfigured = Boolean(encryption || ($camouflageSettings?.enabled && $camouflageSettings?.pin));

  onMount(async () => {
    await loadData();
    if (typeof window !== "undefined") {
      window.addEventListener("focus", loadData);
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", loadData);
    }
  });

  async function loadData() {
    try {
      const [acc, biometry] = await Promise.all([
        getCurrentAccount(),
        checkHardwareBiometry(),
      ]);
      account = acc;
      if (acc) {
        encryption = acc.encryption;
        await loadAccountAutoLockTimer(acc);
        fileCount = await getDatabaseFilesCount(acc.id).catch(() => null);
      }
      biometryStatus = biometry;
    } finally {
      loading = false;
    }
  }

  async function handleAutoLockChange(seconds) {
    if (!account) return;
    await setAutoLockTimer(seconds, account.id);
  }

  async function handleToggleCamouflage() {
    const nextState = !$camouflageSettings.enabled;
    if (nextState && (!$camouflageSettings.pin || $camouflageSettings.pin === "0000")) {
      openPinModal();
      return;
    }
    await saveCamouflageSettings({ enabled: nextState });
    showAlert(nextState ? "Режим маскировки включен" : "Режим маскировки выключен");
  }

  async function selectAppType(typeId) {
    await saveCamouflageSettings({
      appType: typeId,
      seed: generateNewSeed()
    });
  }

  async function handleRerollStyle() {
    const seed = generateNewSeed();
    await saveCamouflageSettings({ seed });
    showAlert("Стиль маскировки обновлен");
  }

  function openPinModal() {
    newPin = "";
    pinError = "";
    showPinModal = true;
  }

  async function savePin() {
    if (!/^\d{4}$/.test(newPin)) {
      pinError = "PIN должен содержать ровно 4 цифры";
      return;
    }
    await saveCamouflageSettings({ pin: newPin, enabled: true });
    showPinModal = false;
    showAlert("PIN сохранен: " + newPin);
  }

  async function lockNow() {
    if (!isLockConfigured) {
      showAlert("Сначала включите биометрию, графический ключ или маскировку");
      return;
    }
    if ($camouflageSettings.enabled) {
      lockCamouflage();
    } else if (encryption) {
      openLockScreen({ mode: "decrypt" });
    }
  }

  function handleEnableHardware() {
    openLockScreen({
      mode: "create",
      lockType: "hardware",
      account,
      onSuccess: async () => {
        await loadData();
        showAlert("Биометрия включена");
      }
    });
  }

  function handleEnablePattern() {
    openLockScreen({
      mode: "create",
      lockType: "pin",
      account,
      onSuccess: async () => {
        await loadData();
        showAlert("Графический ключ установлен");
      }
    });
  }

  function handleDisableEncryption() {
    openLockScreen({
      mode: "disable",
      account,
      onSuccess: async () => {
        await loadData();
        showAlert("Шифрование отключено");
      }
    });
  }
</script>

<SettingsPageWrapper title="Блокировка приложения" {from} {onClose}>
  <div class="content-container">
    {#if loading || encryption === undefined}
      <div class="loading-state">
        <span>Загрузка параметров безопасности...</span>
      </div>
    {:else}
      <div class="section-title">Маскировка</div>
      <div class="settings-card">
        <div class="settings-row" on:click={handleToggleCamouflage}>
          <div class="row-info">
            <span class="row-title">Режим маскировки</span>
            <span class="row-desc">
              Подменяет интерфейс приложения при запуске на выбранный инструмент
            </span>
          </div>
          <Switch checked={$camouflageSettings.enabled} ariaLabel="Режим маскировки" />
        </div>

        {#if $camouflageSettings.enabled}
          <div class="divider"></div>

          <div class="inner-block">
            <span class="sub-label">Вид приложения:</span>
            <div class="app-pills">
              {#each allAppTypes as item}
                <button
                  type="button"
                  class="pill-btn"
                  class:selected={$camouflageSettings.appType === item.id}
                  on:click={() => selectAppType(item.id)}
                >
                  <span class="pill-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      {@html APP_ICONS[item.id] || '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'}
                    </svg>
                  </span>
                  <span class="pill-text">{item.label}</span>
                </button>
              {/each}
            </div>
          </div>

          <div class="divider"></div>

          <div class="settings-row" on:click={openPinModal}>
            <div class="row-info">
              <span class="row-title">Секретный PIN-код</span>
              <span class="row-desc">Код для разблокировки настоящего мессенджера</span>
            </div>
            <div class="row-action">
              <span class="pin-display">{$camouflageSettings.pin || "0000"}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </div>
          </div>

          <div class="divider"></div>

          <div class="settings-row">
            <div class="row-info">
              <span class="row-title">Стиль и иконка</span>
              <span class="row-desc">Генерируется процедурно из аппаратного хэша устройства</span>
            </div>
            <div class="style-preview-cluster">
              {#if $activeProceduralTheme?.iconSvg}
                <div class="icon-swatch-badge">
                  {@html $activeProceduralTheme.iconSvg}
                </div>
              {/if}
              <div class="palette-swatch">
                <div
                  class="swatch-dot"
                  style="background: {$activeProceduralTheme?.cssVars?.['--camo-bg'] || '#000'}; border: 1px solid rgba(255,255,255,0.2);"
                ></div>
                <div
                  class="swatch-dot"
                  style="background: {$activeProceduralTheme?.cssVars?.['--camo-surface'] || '#222'};"
                ></div>
                <div
                  class="swatch-dot"
                  style="background: {$activeProceduralTheme?.cssVars?.['--camo-accent'] || '#ff9f0a'};"
                ></div>
              </div>
            </div>
          </div>

          <div class="actions-row">
            <button type="button" class="action-outline-btn" on:click={handleRerollStyle}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
              </svg>
              <span>Случайный стиль</span>
            </button>
            <button type="button" class="action-solid-btn" on:click={() => showPreview = true}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <span>Предпросмотр</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="section-title">Шифрование данных</div>
      <div class="settings-card">
        <div class="settings-row">
          <div class="row-info">
            <span class="row-title">Статус шифрования</span>
            <span class="row-desc">
              {encryption ? "Все локальные данные защищены и зашифрованы" : "Локальная база данных не зашифрована"}
            </span>
          </div>
          <div class="badge" class:badge-success={Boolean(encryption)} class:badge-warning={!encryption}>
            {encryption ? "Активно" : "Неактивно"}
          </div>
        </div>

        {#if encryption}
          <div class="divider"></div>
          <div class="settings-row">
            <div class="row-info">
              <span class="row-title">Тип ключа</span>
              <span class="row-desc">
                {encryption.type === "hardware-1" ? "Аппаратный ключ (Биометрия)" : "Графический ключ"}
              </span>
            </div>
          </div>

          {#if fileCount !== null}
            <div class="divider"></div>
            <div class="settings-row">
              <div class="row-info">
                <span class="row-title">Файлы базы данных</span>
                <span class="row-desc">Зашифрованные контейнеры на устройстве</span>
              </div>
              <span class="counter-text">{fileCount}</span>
            </div>
          {/if}

          <div class="divider"></div>
          <div class="actions-row">
            <button type="button" class="action-outline-btn danger" on:click={handleDisableEncryption}>
              Отключить шифрование
            </button>
          </div>
        {:else}
          <div class="divider"></div>
          <div class="actions-row">
            {#if biometryStatus.available}
              <button
                type="button"
                class="action-solid-btn"
                on:click={handleEnableHardware}
              >
                Включить биометрию
              </button>
              <button
                type="button"
                class="action-outline-btn"
                on:click={handleEnablePattern}
              >
                Графический ключ
              </button>
            {:else}
              <button
                type="button"
                class="action-solid-btn"
                on:click={handleEnablePattern}
              >
                Установить графический ключ
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <div class="section-title">Автоблокировка</div>
      <div class="settings-card">
        <SettingsDropout
          label="Время до блокировки"
          description={isLockConfigured ? "Блокировать приложение при неактивности или скрытии экрана" : "Требуется включить биометрию, графический ключ или маскировку"}
          options={AUTO_LOCK_OPTIONS}
          value={$autoLockTimer}
          disabled={!isLockConfigured}
          on:change={(e) => handleAutoLockChange(e.detail)}
        />

        <div class="divider"></div>

        <div class="actions-row">
          <button
            type="button"
            class="action-outline-btn"
            class:disabled={!isLockConfigured}
            disabled={!isLockConfigured}
            on:click={lockNow}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>Заблокировать сейчас</span>
          </button>
        </div>
      </div>
    {/if}
  </div>

  {#if showPinModal}
    <div
      class="modal-backdrop"
      class:has-keyboard={$keyboardOpen}
      style={$keyboardOpen && $keyboardHeight > 0 ? `bottom: ${$keyboardHeight}px;` : ""}
      on:click={() => showPinModal = false}
      role="presentation"
    >
      <div class="modal-card" on:click|stopPropagation role="dialog">
        <div class="bottom-sheet-handle"></div>
        <h2>Секретный PIN-код</h2>
        <p>Введите 4 цифры для разблокировки приложения из режима маскировки:</p>
        <input
          type="password"
          maxlength="4"
          inputmode="numeric"
          pattern="[0-9]*"
          bind:value={newPin}
          placeholder="••••"
          autofocus
          on:keydown={(e) => {
            if (e.key === "Enter" && newPin.length === 4) savePin();
          }}
          on:input={() => {
            if (newPin.length === 4) pinError = "";
          }}
        />
        {#if pinError}
          <div class="modal-error">{pinError}</div>
        {/if}
        <div class="modal-actions">
          <button type="button" class="modal-cancel-btn" on:click={() => showPinModal = false}>
            Отмена
          </button>
          <button type="button" class="modal-save-btn" on:click={savePin}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showPreview}
    <DecoyApp
      isPreview={true}
      on:closePreview={() => showPreview = false}
      on:previewUnlock={() => {
        showPreview = false;
        showAlert("PIN введен верно! Маскировка успешно открыта.");
      }}
    />
  {/if}
</SettingsPageWrapper>

<style>
  .content-container {
    padding: 16px;
    max-width: 600px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .loading-state {
    padding: 40px;
    text-align: center;
    color: #9ca3af;
    font-size: 0.95rem;
  }

  .section-title {
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #8c8e96;
    margin: 16px 8px 6px 8px;
  }

  .settings-card {
    background: var(--settings-card-bg, #17181c);
    border-radius: var(--settings-card-radius, 16px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .settings-row {
    padding: 14px 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .settings-row:hover {
    background: var(--settings-card-hover, rgba(255, 255, 255, 0.05));
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    margin-right: 12px;
  }

  .row-title {
    font-size: 0.95rem;
    font-weight: 500;
    color: #ffffff;
  }

  .row-desc {
    font-size: 0.82rem;
    color: #8c8e96;
    line-height: 1.35;
  }

  .row-action {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pin-display {
    font-size: 1.1rem;
    letter-spacing: 2px;
    color: #9ca3af;
  }

  .chevron {
    font-size: 1.3rem;
    color: #6b7280;
    line-height: 1;
  }

  .counter-text {
    font-size: 0.95rem;
    font-weight: 600;
    color: #ffffff;
  }

  .divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 0 16px;
  }

  .inner-block {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sub-label {
    font-size: 0.82rem;
    color: #8c8e96;
  }

  .app-pills {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
  }

  .pill-btn {
    background: #33333d;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 10px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #ffffff;
    font-size: 0.84rem;
    cursor: pointer;
    min-width: 0;
    overflow: hidden;
    transition: border-color 0.15s, background 0.15s;
  }

  .pill-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .pill-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pill-btn.selected {
    background: rgba(37, 194, 117, 0.15);
    border-color: #25c275;
    color: #25c275;
    font-weight: 500;
  }

  .style-preview-cluster {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-swatch-badge {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .icon-swatch-badge :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  .palette-swatch {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .swatch-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
  }

  .actions-row {
    padding: 12px 16px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .action-outline-btn, .action-solid-btn {
    flex: 1;
    min-width: 140px;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 0.88rem;
    font-weight: 500;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .action-outline-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .action-outline-btn.danger {
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .action-solid-btn {
    background: #25c275;
    border: none;
    color: #000000;
    font-weight: 600;
  }

  .action-outline-btn:hover, .action-solid-btn:hover {
    opacity: 0.9;
  }

  .action-outline-btn.disabled,
  .action-outline-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .badge {
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .badge-success {
    background: rgba(37, 194, 117, 0.15);
    color: #25c275;
    border: 1px solid rgba(37, 194, 117, 0.3);
  }

  .badge-warning {
    background: rgba(246, 196, 83, 0.15);
    color: #f6c453;
    border: 1px solid rgba(246, 196, 83, 0.3);
  }

  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: var(--keyboard-inset, 0px);
    background: rgba(0, 0, 0, 0.65);
    z-index: var(--z-modal);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    box-sizing: border-box;
    overflow-y: auto;
    transition: bottom 0.18s cubic-bezier(0.1, 0.9, 0.2, 1);
  }

  .modal-backdrop.has-keyboard {
    align-items: flex-end;
  }

  .modal-card {
    background: var(--bg-surface, #26262e);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 20px 20px 0 0;
    padding: 14px 20px calc(16px + max(var(--safe-bottom, 0px) - var(--keyboard-inset, 0px), 0px));
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-sizing: border-box;
  }

  .modal-backdrop.has-keyboard .modal-card {
    padding-bottom: 16px;
  }

  .bottom-sheet-handle {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.2);
    margin: 0 auto 6px;
    flex-shrink: 0;
  }

  .modal-card h2 {
    margin: 0;
    font-size: 1.15rem;
    text-align: center;
  }

  .modal-card p {
    margin: 0;
    font-size: 0.85rem;
    color: #9ca3af;
    line-height: 1.4;
    text-align: center;
  }

  .modal-card input {
    background: #141518;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    color: #ffffff;
    font-size: 1.6rem;
    letter-spacing: 12px;
    text-align: center;
    padding: 12px;
    outline: none;
  }

  .modal-error {
    font-size: 0.8rem;
    color: #ef4444;
    text-align: center;
  }

  .modal-actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  .modal-cancel-btn,
  .modal-save-btn {
    flex: 1;
    height: 44px;
    border: none;
    border-radius: 22px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }

  .modal-cancel-btn {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .modal-cancel-btn:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .modal-save-btn {
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
  }

  .modal-save-btn:hover {
    background: var(--accent-primary-hover, #1b74d9);
  }
</style>
