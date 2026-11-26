<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";

  export let options = [];
  export let value = null;
  export let placeholder = "Выберите...";
  export let disabled = false;
  export let onChange = null;

  const dispatch = createEventDispatcher();

  let open = false;
  let rootEl = null;

  $: selected = options.find((o) => String(o.value) === String(value)) || null;

  function toggle() {
    if (disabled) return;
    open = !open;
  }

  function selectOption(opt) {
    if (opt?.disabled) return;
    value = opt.value;
    open = false;
    dispatch("change", opt.value);
    if (typeof onChange === "function") onChange(opt.value, opt);
  }

  function handleDocClick(e) {
    if (open && rootEl && !rootEl.contains(e.target)) {
      open = false;
    }
  }

  function handleKeyDown(e) {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      open = false;
    }
  }

  onMount(() => {
    document.addEventListener("click", handleDocClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  });

  onDestroy(() => {
    document.removeEventListener("click", handleDocClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
  });
</script>

<div class="mx-dropdown" class:is-open={open} class:is-disabled={disabled} bind:this={rootEl}>
  <button
    type="button"
    class="mx-dropdown-trigger"
    {disabled}
    on:click|stopPropagation={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <span class="mx-dropdown-value">
      {#if selected}
        <span class="mx-dropdown-label">{selected.label}</span>
        {#if selected.sublabel}
          <span class="mx-dropdown-sub">{selected.sublabel}</span>
        {/if}
      {:else}
        <span class="mx-dropdown-placeholder">{placeholder}</span>
      {/if}
    </span>
    <span
      class="mask-icon mx-dropdown-chevron"
      style="-webkit-mask-image: url('/icons/chevron-down.svg'); mask-image: url('/icons/chevron-down.svg'); width: 16px; height: 16px;"
    ></span>
  </button>

  {#if open}
    <div class="mx-dropdown-menu" role="listbox">
      {#each options as opt (opt.value)}
        {@const isSelected = String(opt.value) === String(value)}
        <button
          type="button"
          class="mx-dropdown-item"
          class:is-selected={isSelected}
          disabled={opt.disabled}
          role="option"
          aria-selected={isSelected}
          on:click|stopPropagation={() => selectOption(opt)}
        >
          <span class="mx-dropdown-item-text">
            <span class="mx-dropdown-item-label">{opt.label}</span>
            {#if opt.sublabel}
              <span class="mx-dropdown-item-sub">{opt.sublabel}</span>
            {/if}
          </span>
          {#if isSelected}
            <span
              class="mask-icon mx-dropdown-check"
              style="-webkit-mask-image: url('/icons/check.svg'); mask-image: url('/icons/check.svg'); width: 15px; height: 15px;"
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .mx-dropdown {
    position: relative;
    width: 100%;
    font-family: var(--font-family-base, system-ui, sans-serif);
  }

  .mx-dropdown-trigger {
    width: 100%;
    min-height: 42px;
    padding: 8px 12px;
    border-radius: 12px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    background: var(--bg-input, #26262e);
    color: var(--text-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .mx-dropdown.is-open .mx-dropdown-trigger {
    border-color: var(--accent-primary, #248bfe);
  }

  .mx-dropdown.is-disabled .mx-dropdown-trigger {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mx-dropdown-value {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .mx-dropdown-label {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mx-dropdown-sub {
    font-size: 12px;
    color: var(--text-secondary, #8b929e);
    white-space: nowrap;
  }

  .mx-dropdown-placeholder {
    font-size: 14px;
    color: var(--text-muted, #697282);
  }

  .mx-dropdown-chevron {
    background-color: var(--text-secondary, #8b929e);
    flex-shrink: 0;
    transition: transform 0.18s ease;
  }

  .mx-dropdown.is-open .mx-dropdown-chevron {
    transform: rotate(180deg);
  }

  .mx-dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: var(--z-dropdown, 90);
    background: var(--bg-surface-elevated, #24252b);
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
    border-radius: 14px;
    padding: 5px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mx-dropdown-item {
    width: 100%;
    padding: 9px 10px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--text-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
  }

  .mx-dropdown-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.07);
  }

  .mx-dropdown-item.is-selected {
    background: var(--accent-subtle, rgba(36, 139, 254, 0.14));
    color: var(--accent-primary, #248bfe);
  }

  .mx-dropdown-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .mx-dropdown-item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .mx-dropdown-item-label {
    font-size: 13.5px;
    font-weight: 500;
  }

  .mx-dropdown-item-sub {
    font-size: 11.5px;
    color: var(--text-secondary, #8b929e);
  }

  .mx-dropdown-check {
    background-color: var(--accent-primary, #248bfe);
    flex-shrink: 0;
  }
</style>
