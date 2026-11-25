<script>
  import { createEventDispatcher } from "svelte";

  export let checked = false;
  export let disabled = false;
  export let size = "default"; // "default" (44x24) or "small" (36x20)
  export let ariaLabel = "Переключатель";
  export let standalone = false;

  const dispatch = createEventDispatcher();

  function handleClick(e) {
    if (disabled) return;
    if (standalone) {
      e.stopPropagation();
      checked = !checked;
      dispatch("change", checked);
    }
  }

  function handleKeydown(e) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      checked = !checked;
      dispatch("change", checked);
    }
  }
</script>

<div
  role="switch"
  tabindex={disabled ? -1 : 0}
  aria-checked={checked}
  aria-label={ariaLabel}
  class="app-switch size-{size}"
  class:is-active={checked}
  class:is-disabled={disabled}
  class:is-standalone={standalone}
  on:click={handleClick}
  on:keydown={handleKeydown}
>
  <span class="switch-track">
    <span class="switch-thumb"></span>
  </span>
</div>

<style>
  .app-switch {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    outline: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }

  .app-switch:focus-visible .switch-track {
    box-shadow: 0 0 0 2px var(--accent-primary, #248bfe);
  }

  .switch-track {
    position: relative;
    width: 44px;
    height: 24px;
    background: rgba(255, 255, 255, 0.16);
    border-radius: 12px;
    transition: background-color 0.22s cubic-bezier(0.25, 0.1, 0.25, 1);
    box-sizing: border-box;
    display: block;
    pointer-events: none;
  }

  .app-switch.is-active .switch-track {
    background: var(--accent-primary, #248bfe);
  }

  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background: #ffffff;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.28);
    transition: transform 0.22s cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  .app-switch.is-active .switch-thumb {
    transform: translateX(20px);
  }

  /* Small variant */
  .app-switch.size-small .switch-track {
    width: 36px;
    height: 20px;
    border-radius: 10px;
  }

  .app-switch.size-small .switch-thumb {
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
  }

  .app-switch.size-small.is-active .switch-thumb {
    transform: translateX(16px);
  }

  .app-switch.is-disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
