<script>
  export let placeholder;
  export let input; // func

  let focused = false;
  let query = "";

  $: input && input(query);

  function handleClickOutside(event) {
    const isOutside = ![".search-block", ".search-overlay"].some((x) =>
      event.target.closest(x),
    );
    if (isOutside) {
      focused = false;
    }
  }
</script>

<div class="input input--secondary input--neutral input--compact">
  <div class="search-block" class:active={focused}>
    <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
    {#if !query.length}
      <span class="placeholder-text">{placeholder}</span>
    {/if}
    <input
      class="field"
      type="text"
      placeholder=""
      bind:value={query}
      on:focus={() => (focused = true)}
      on:focusout={() => (focused = false)}
    />
  </div>
</div>

<style>
  .input {
    width: 100%;
  }

  .search-block {
    background-color: rgba(118, 118, 128, 0.12);
    color: var(--text-muted);
    width: 100%;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    position: relative;
    font-size: 15px;
    cursor: pointer;
    padding: 0 10px;
    box-sizing: border-box;
    transition: background-color 0.15s;
  }

  .search-block.active {
    cursor: text;
    background-color: rgba(118, 118, 128, 0.18);
  }

  .search-icon {
    flex-shrink: 0;
    color: var(--text-muted);
    margin-right: 8px;
  }

  .placeholder-text {
    position: absolute;
    left: 34px;
    pointer-events: none;
    color: var(--text-muted);
    font-size: 15px;
    opacity: 1;
    transition: opacity 0.1s;
  }

  .search-block.active .placeholder-text {
    opacity: 0;
  }

  .field {
    width: 100%;
    outline: none;
    border: none;
    background: none;
    font-size: 15px;
    display: flex;
    color: var(--text-primary);
    padding: 0;
  }

  .field::placeholder {
    color: var(--text-muted);
  }
</style>
