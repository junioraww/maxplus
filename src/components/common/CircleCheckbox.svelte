<script>
  export let checked = false;
  export let size = 24;
  export let disabled = false;
</script>

<span
  class="circle-checkbox"
  class:checked
  class:disabled
  style="width: {size}px; height: {size}px;"
  aria-hidden="true"
>
  {#if checked}
    <svg
      width={Math.round(size * 0.56)}
      height={Math.round(size * 0.56)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  {/if}
</span>

<style>
  .circle-checkbox {
    border-radius: 50%;
    border: 2px solid var(--msg-selection-checkbox-border, rgba(255, 255, 255, 0.35));
    background: transparent;
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-sizing: border-box;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.12s ease;
  }

  .circle-checkbox.checked {
    background: var(--accent-primary, #248bfe);
    border-color: var(--accent-primary, #248bfe);
  }

  .circle-checkbox.disabled {
    opacity: 0.45;
  }
</style>
