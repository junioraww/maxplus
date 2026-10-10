<script>
  /**
   * Переключатель (switch). Поддерживает bind:checked.
   * @type {{ checked?: boolean, disabled?: boolean, label?: string, onchange?: (v: boolean) => void, class?: string }}
   */
  let { checked = $bindable(false), disabled = false, readonly = false, label, onchange, class: className = '' } = $props();
  function toggle() { if (disabled) return; checked = !checked; onchange?.(checked); }
</script>

{#if readonly}
  <span class="toggle toggle--readonly {className}" class:toggle--on={checked} class:toggle--disabled={disabled} aria-hidden="true"><span class="toggle__thumb"></span></span>
{:else}
<button type="button" role="switch" aria-checked={checked} aria-label={label} class="toggle {className}" class:toggle--on={checked} {disabled} onclick={toggle}>
  <span class="toggle__thumb"></span>
</button>
{/if}

<style>
  .toggle {
    position: relative; width: 44px; height: 26px; flex-shrink: 0; padding: 0; border: none;
    border-radius: 13px; background: var(--bg-surface-2, rgba(255,255,255,0.2)); cursor: pointer;
    transition: background 0.2s ease;
  }
  .toggle--readonly { display: inline-block; pointer-events: none; }
  .toggle--disabled { opacity: 0.5; }
  .toggle--on { background: var(--accent-primary, #007aff); }
  .toggle:disabled { opacity: 0.5; cursor: default; }
  .toggle__thumb {
    position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); transition: transform 0.2s ease;
  }
  .toggle--on .toggle__thumb { transform: translateX(18px); }
</style>
