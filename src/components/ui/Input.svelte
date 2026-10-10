<script>
  /**
   * Поле ввода с подписью, подсказкой и ошибкой. Поддерживает bind:value.
   * @type {{
   *   value?: string, label?: string, hint?: string, error?: string,
   *   type?: string, placeholder?: string, multiline?: boolean, rows?: number,
   *   id?: string, class?: string, [key: string]: any
   * }}
   */
  let {
    value = $bindable(''), label, hint, error, type = 'text', placeholder = '',
    multiline = false, rows = 3, id = `in-${Math.random().toString(36).slice(2, 9)}`,
    class: className = '', ...rest
  } = $props();
</script>

<div class="field {className}" class:field--error={!!error}>
  {#if label}<label class="field__label" for={id}>{label}</label>{/if}
  {#if multiline}
    <textarea {id} class="field__control" {rows} {placeholder} bind:value {...rest}></textarea>
  {:else}
    <input {id} class="field__control" {type} {placeholder} bind:value {...rest} />
  {/if}
  {#if error}<span class="field__msg field__msg--error">{error}</span>
  {:else if hint}<span class="field__msg">{hint}</span>{/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field__label { font-size: 13px; color: var(--text-secondary, #999); }
  .field__control {
    width: 100%; box-sizing: border-box; padding: 10px 14px; font: inherit; font-size: 15px;
    color: var(--text-primary, #060708); background: var(--bg-surface, rgba(255,255,255,0.06));
    border: 1px solid var(--border-subtle, rgba(255,255,255,0.12)); border-radius: 12px; outline: none; resize: vertical;
    transition: border-color 0.15s ease;
  }
  .field__control:focus { border-color: var(--stroke-themed, #007aff); }
  .field--error .field__control { border-color: var(--status-danger, #ff3b30); }
  .field__msg { font-size: 12px; color: var(--text-secondary, #999); }
  .field__msg--error { color: var(--status-danger, #ff3b30); }
</style>
