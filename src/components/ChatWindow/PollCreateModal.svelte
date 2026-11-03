<script>
  import { createEventDispatcher } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { showAlert } from "$lib/utils/alert";

  const dispatch = createEventDispatcher();
  export let onCreate = null;

  const POLL_FLAG_ANONYMOUS = 4;

  let title = "";
  let options = ["", ""];
  let isAnonymous = false;

  function addOption() {
    if (options.length >= 10) return showAlert("Максимум 10 вариантов ответа");
    options = [...options, ""];
  }

  function removeOption(idx) {
    if (options.length <= 2) return showAlert("Опрос должен содержать минимум 2 варианта");
    options = options.filter((_, i) => i !== idx);
  }

  function submit() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return showAlert("Введите вопрос");
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (cleanOptions.length < 2) return showAlert("Заполните хотя бы 2 варианта ответа");

    const settings = isAnonymous ? POLL_FLAG_ANONYMOUS : 0;

    const detail = { title: cleanTitle, options: cleanOptions, settings };
    dispatch("create", detail);
    if (onCreate) onCreate(detail);
    dispatch("close");
  }
</script>

<div class="poll-modal-backdrop" on:click={() => dispatch("close")} transition:fade={{ duration: 150 }}>
  <div class="poll-modal-window" on:click|stopPropagation transition:scale={{ start: 0.95, duration: 150 }}>
    <div class="poll-modal-header">
      <h3>Новый опрос</h3>
      <button type="button" class="poll-close-btn" on:click={() => dispatch("close")}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="poll-modal-body">
      <div class="poll-input-group">
        <label class="poll-label" for="poll-question-input">Вопрос</label>
        <textarea id="poll-question-input" class="poll-textarea" placeholder="Задайте вопрос..." rows="2" bind:value={title} maxlength="255"></textarea>
      </div>

      <div class="poll-input-group">
        <label class="poll-label">Варианты ответа</label>
        <div class="poll-options-list">
          {#each options as opt, i}
            <div class="poll-option-row">
              <input type="text" class="poll-text-input" placeholder="Вариант {i + 1}" bind:value={options[i]} maxlength="100" />
              <button
                type="button"
                class="poll-remove-opt-btn"
                class:disabled={options.length <= 2}
                disabled={options.length <= 2}
                on:click={() => removeOption(i)}
                title={options.length <= 2 ? "Минимум 2 варианта" : "Удалить вариант"}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          {/each}
        </div>

        {#if options.length < 10}
          <button type="button" class="poll-add-opt-btn" on:click={addOption}>+ Добавить вариант</button>
        {/if}
      </div>

      <div class="poll-settings-group">
        <label class="poll-switch-row">
          <span>Анонимное голосование</span>
          <input type="checkbox" bind:checked={isAnonymous} />
        </label>
      </div>
    </div>

    <div class="poll-modal-footer">
      <button type="button" class="poll-btn-cancel" on:click={() => dispatch("close")}>Отмена</button>
      <button type="button" class="poll-btn-submit" on:click={submit}>Создать опрос</button>
    </div>
  </div>
</div>

<style>
  .poll-modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.72); display: flex; align-items: center; justify-content: center; z-index: var(--z-modal, 7); padding: 16px; }
  .poll-modal-window { background: #1e2025; border-radius: 14px; width: 100%; max-width: 350px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); display: flex; flex-direction: column; overflow: hidden; }
  .poll-modal-header, .poll-modal-footer, .poll-switch-row { display: flex; align-items: center; justify-content: space-between; }
  .poll-modal-header { padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
  .poll-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: #f3f4f6; }
  .poll-close-btn, .poll-add-opt-btn, .poll-remove-opt-btn { background: none; border: none; cursor: pointer; }
  .poll-close-btn { color: #9ca3af; padding: 4px; border-radius: 4px; }
  .poll-close-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
  .poll-modal-body { padding: 16px 18px; overflow-y: auto; max-height: 65vh; display: flex; flex-direction: column; gap: 14px; }
  .poll-input-group, .poll-options-list, .poll-settings-group { display: flex; flex-direction: column; gap: 6px; }
  .poll-label { font-size: 11px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
  .poll-textarea, .poll-text-input { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 12px; color: #f3f4f6; font-size: 13.5px; outline: none; transition: border-color 0.15s; font-family: inherit; }
  .poll-textarea:focus, .poll-text-input:focus { border-color: #3b82f6; }
  .poll-textarea { resize: none; }
  .poll-option-row { position: relative; display: flex; align-items: center; width: 100%; }
  .poll-option-row .poll-text-input { width: 100%; box-sizing: border-box; padding-right: 36px; }
  .poll-remove-opt-btn { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); color: #9ca3af; padding: 6px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: opacity 0.15s, color 0.15s; opacity: 0.8; }
  .poll-remove-opt-btn.disabled { opacity: 0.35; cursor: not-allowed; }
  .poll-remove-opt-btn:hover:not(.disabled) { color: #ef4444; }
  .poll-add-opt-btn { align-self: flex-start; color: #3b82f6; font-size: 13px; padding: 4px 0; }
  .poll-add-opt-btn:hover { text-decoration: underline; }
  .poll-settings-group { gap: 10px; border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px; }
  .poll-switch-row { font-size: 13.5px; color: #e5e7eb; cursor: pointer; }
  .poll-modal-footer { justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid rgba(255, 255, 255, 0.08); background: rgba(0, 0, 0, 0.1); }
  .poll-btn-cancel, .poll-btn-submit { padding: 8px 14px; border-radius: 8px; font-size: 13.5px; cursor: pointer; font-weight: 500; }
  .poll-btn-cancel { background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); color: #e5e7eb; }
  .poll-btn-cancel:hover { background: rgba(255, 255, 255, 0.05); }
  .poll-btn-submit { background: #3b82f6; border: none; color: #fff; }
  .poll-btn-submit:hover { background: #2563eb; }
</style>
