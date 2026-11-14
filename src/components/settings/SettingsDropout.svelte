<script>
  import { createEventDispatcher } from "svelte";
  import { fade, scale } from "svelte/transition";

  export let label = "";
  export let description = "";
  export let options = [];
  export let value = null;
  export let disabled = false;

  const dispatch = createEventDispatcher();
  let isOpen = false;
  let openUpwards = false;
  let dropoutEl;

  $: selectedOption = options.find((o) => o.value === value) || options[0];

  function toggle() {
    if (disabled) return;
    if (!isOpen && dropoutEl) {
      const rect = dropoutEl.getBoundingClientRect();
      openUpwards = (window.innerHeight - rect.bottom) < 280;
    }
    isOpen = !isOpen;
  }

  function select(opt) {
    if (disabled) return;
    value = opt.value;
    isOpen = false;
    dispatch("change", opt.value);
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && isOpen) {
      isOpen = false;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="settings-dropout" class:disabled bind:this={dropoutEl}>
  <div class="dropout-header" on:click={toggle}>
    <div class="text-col">
      <span class="label">{label}</span>
      {#if description}
        <span class="description">{description}</span>
      {/if}
    </div>
    <button type="button" class="value-btn" aria-haspopup="listbox" aria-expanded={isOpen}>
      <span class="value-text">{selectedOption ? selectedOption.label : ""}</span>
      <svg
        class="chevron"
        class:rotated={isOpen}
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
  </div>

  {#if isOpen}
    <div class="backdrop" on:click={() => (isOpen = false)} transition:fade={{ duration: 120 }}></div>
    <div class="dropdown-menu" class:open-up={openUpwards} transition:scale={{ duration: 140, start: 0.96 }}>
      {#each options as opt}
        <button
          type="button"
          class="menu-item"
          class:selected={opt.value === value}
          on:click={() => select(opt)}
        >
          <span class="item-label">{opt.label}</span>
          {#if opt.value === value}
            <svg
              class="check-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .settings-dropout {
    position: relative;
    width: 100%;
    box-sizing: border-box;
  }

  .settings-dropout.disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .dropout-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: #1b1c21;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 12px 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s, border-color 0.15s;
  }

  .dropout-header:hover {
    background: #202127;
    border-color: rgba(255, 255, 255, 0.12);
  }

  .text-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .label {
    color: white;
    font-size: 0.92rem;
    font-weight: 500;
  }

  .description {
    color: #888;
    font-size: 0.78rem;
    line-height: 1.3;
  }

  .value-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 6px 10px;
    color: #3390ec;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .value-btn:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .chevron {
    color: #888;
    transition: transform 0.18s ease;
  }

  .chevron.rotated {
    transform: rotate(180deg);
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 45;
  }

  .dropdown-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    min-width: 190px;
    max-height: 260px;
    overflow-y: auto;
    background: #24252a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dropdown-menu.open-up {
    top: auto;
    bottom: calc(100% + 6px);
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    color: #ddd;
    font-size: 0.88rem;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
    color: white;
  }

  .menu-item.selected {
    color: #3390ec;
    font-weight: 600;
  }

  .check-icon {
    color: #3390ec;
    flex-shrink: 0;
  }
</style>
