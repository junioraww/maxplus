<script>
  import { createEventDispatcher } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  export let initialRule = null;

  const dispatch = createEventDispatcher();

  let name = initialRule?.name || "";
  let pattern = initialRule?.pattern || "";
  let target = initialRule?.target || "url";
  let is_regex = initialRule?.is_regex ?? false;
  let errorMessage = "";

  function close() {
    dispatch("close");
  }

  function handleSave() {
    errorMessage = "";
    const cleanPattern = pattern.trim();
    if (!cleanPattern) {
      errorMessage = "Введите шаблон или URL для блокировки";
      return;
    }

    if (is_regex) {
      try {
        new RegExp(cleanPattern);
      } catch (err) {
        errorMessage = "Некорректное регулярное выражение: " + err.message;
        return;
      }
    }

    dispatch("save", {
      id: initialRule?.id,
      name: name.trim() || cleanPattern,
      pattern: cleanPattern,
      target,
      is_regex,
      enabled: initialRule ? initialRule.enabled : true,
    });
  }

  function handleKeydown(e) {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSave();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="modal-backdrop" on:click={close} transition:fade={{ duration: 150 }}>
  <div class="modal-card" on:click|stopPropagation transition:fly={{ y: 20, duration: 200, easing: cubicOut }}>
    <div class="modal-header">
      <div class="modal-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
        </svg>
        <span>{initialRule ? "Редактировать правило" : "Новое правило блокировки"}</span>
      </div>
      <button class="icon-close" on:click={close}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>

    <div class="modal-body">
      {#if errorMessage}
        <div class="error-banner" transition:fade={{ duration: 100 }}>
          {errorMessage}
        </div>
      {/if}

      <div class="field">
        <label for="rule-name">Название правила (опционально)</label>
        <input
          id="rule-name"
          type="text"
          placeholder="Например: Блокировка аналитики"
          bind:value={name}
        />
      </div>

      <div class="field">
        <label for="rule-target">Область проверки</label>
        <div class="target-toggle">
          <button
            type="button"
            class="toggle-btn"
            class:active={target === "url"}
            on:click={() => (target = "url")}
          >
            Весь URL
          </button>
          <button
            type="button"
            class="toggle-btn"
            class:active={target === "host"}
            on:click={() => (target = "host")}
          >
            Host / Домен
          </button>
          <button
            type="button"
            class="toggle-btn"
            class:active={target === "ip"}
            on:click={() => (target = "ip")}
          >
            IP / Хост
          </button>
        </div>
      </div>

      <div class="field">
        <label for="rule-pattern">
          Шаблон поиска {is_regex ? "(RegExp)" : "(Подстрока)"}
        </label>
        <input
          id="rule-pattern"
          type="text"
          class="code-input"
          placeholder={is_regex ? "mc\\.yandex\\.ru|google-analytics" : "yandex.ru/metrika"}
          bind:value={pattern}
        />
      </div>

      <div class="field-checkbox">
        <label class="checkbox-container">
          <input type="checkbox" bind:checked={is_regex} />
          <span class="custom-checkbox"></span>
          <span class="checkbox-label">Использовать регулярное выражение (Regex)</span>
        </label>
      </div>

      <div class="hint-box">
        При совпадении правила сетевой запрос будет немедленно сброшен (connection dropped) без возврата данных.
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-cancel" on:click={close}>Отмена</button>
      <button class="btn-save" on:click={handleSave}>
        {initialRule ? "Сохранить" : "Добавить правило"}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal, 7);
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--shadow-elevated);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .icon-close {
    background: none;
    border: none;
    color: var(--icon-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    display: flex;
  }

  .icon-close:hover {
    color: var(--icon-primary);
    background: var(--bg-hover);
  }

  .modal-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .error-banner {
    background: var(--status-danger-subtle);
    border: 1px solid var(--status-danger);
    color: var(--status-danger);
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .field input {
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 10px 12px;
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }

  .field input:focus {
    border-color: var(--accent-primary);
  }

  .code-input {
    font-family: var(--font-family-mono);
    font-size: 12.5px !important;
  }

  .target-toggle {
    display: flex;
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 2px;
    gap: 2px;
  }

  .toggle-btn {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    padding: 7px 0;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .toggle-btn.active {
    background: var(--bg-surface);
    color: var(--text-primary);
    font-weight: 600;
  }

  .field-checkbox {
    margin-top: -4px;
  }

  .checkbox-container {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-container input {
    position: absolute;
    opacity: 0;
    cursor: pointer;
    height: 0;
    width: 0;
  }

  .custom-checkbox {
    width: 18px;
    height: 18px;
    background: var(--checkbox-bg);
    border: 1.5px solid var(--checkbox-border);
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }

  .checkbox-container input:checked ~ .custom-checkbox {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .checkbox-container input:checked ~ .custom-checkbox::after {
    content: "";
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg) translate(-1px, -1px);
  }

  .checkbox-label {
    font-size: 12.5px;
    color: var(--text-primary);
  }

  .hint-box {
    background: var(--accent-subtle);
    border: 1px solid var(--accent-subtle-hover);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 11.5px;
    color: var(--accent-primary);
    line-height: 1.4;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 18px;
    background: var(--bg-surface-secondary);
    border-top: 1px solid var(--border-subtle);
  }

  .btn-cancel {
    background: var(--bg-pill);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--bg-active);
    color: var(--text-primary);
  }

  .btn-save {
    background: var(--accent-primary);
    border: none;
    color: var(--accent-contrast, #ffffff);
    padding: 8px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-save:hover {
    background: var(--accent-primary-hover);
  }
</style>
