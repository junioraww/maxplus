<script>
  import { createEventDispatcher } from "svelte";
  import { fade, scale } from "svelte/transition";

  export let options = [];
  export let value = "";

  const dispatch = createEventDispatcher();
  let isOpen = false;
  let openUp = false;
  let triggerEl;

  $: selectedOption = options.find((o) => (o.id ?? o.value) === value) || options[0];
  $: displayLabel = selectedOption ? (selectedOption.name ?? selectedOption.label ?? "") : "";

  function toggle() {
    if (!isOpen && triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      openUp = window.innerHeight - rect.bottom < 220;
    }
    isOpen = !isOpen;
  }

  function handleSelect(opt) {
    const val = opt.id ?? opt.value;
    value = val;
    isOpen = false;
    dispatch("change", val);
  }

  function handleKeydown(e) {
    if (e.key === "Escape" && isOpen) {
      isOpen = false;
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="camo-dropout-wrap" bind:this={triggerEl}>
  <button
    type="button"
    class="dropout-trigger"
    class:active={isOpen}
    on:click={toggle}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
  >
    <span class="trigger-label">{displayLabel}</span>
    <svg
      class="chevron-icon"
      class:rotated={isOpen}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>

  {#if isOpen}
    <div class="dropout-backdrop" on:click={() => (isOpen = false)} transition:fade={{ duration: 100 }}></div>
    <div class="dropout-popover" class:open-up={openUp} transition:scale={{ duration: 120, start: 0.96 }}>
      {#each options as opt}
        {@const optVal = opt.id ?? opt.value}
        {@const optName = opt.name ?? opt.label}
        {@const isSelected = optVal === value}
        <button
          type="button"
          class="popover-item"
          class:selected={isSelected}
          on:click={() => handleSelect(opt)}
        >
          <span class="item-text">{optName}</span>
          {#if isSelected}
            <svg
              class="check-svg"
              width="15"
              height="15"
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
  .camo-dropout-wrap {
    position: relative;
    display: inline-block;
  }

  .dropout-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--camo-surface2, #282a30);
    color: var(--camo-text, #ffffff);
    border: 1px solid var(--camo-border, rgba(255, 255, 255, 0.12));
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 0.88rem;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    transition: background 0.15s, border-color 0.15s;
    user-select: none;
  }

  .dropout-trigger:hover, .dropout-trigger.active {
    background: var(--camo-surface, #1e2024);
    border-color: var(--camo-accent, #ff9f0a);
  }

  .trigger-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 170px;
    font-weight: 500;
  }

  .chevron-icon {
    flex-shrink: 0;
    transition: transform 0.18s ease;
    opacity: 0.8;
  }

  .chevron-icon.rotated {
    transform: rotate(180deg);
  }

  .dropout-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: transparent;
  }

  .dropout-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    min-width: 180px;
    max-width: 260px;
    max-height: 240px;
    overflow-y: auto;
    background: var(--camo-surface2, #202228);
    border: 1px solid var(--camo-border, rgba(255, 255, 255, 0.14));
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    padding: 4px;
    z-index: 10001;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dropout-popover.open-up {
    top: auto;
    bottom: calc(100% + 6px);
  }

  .popover-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--camo-text, #ffffff);
    font-size: 0.85rem;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s;
  }

  .popover-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .popover-item.selected {
    color: var(--camo-accent, #ff9f0a);
    font-weight: 600;
    background: rgba(255, 255, 255, 0.05);
  }

  .item-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check-svg {
    flex-shrink: 0;
    margin-left: 8px;
    color: var(--camo-accent, #ff9f0a);
  }
</style>
