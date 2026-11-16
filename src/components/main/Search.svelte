<script>
  export let placeholder = "Поиск";
  export let input = null;
  export let search = "";

  let focused = false;

  function handleInput(e) {
    search = e.target.value;
    if (input) input(search);
  }

  function clearQuery() {
    search = "";
    if (input) input("");
  }
</script>

<div class="search-block" class:active={focused}>
  <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
  <input
    type="text"
    {placeholder}
    value={search}
    on:input={handleInput}
    on:focus={() => (focused = true)}
    on:focusout={() => (focused = false)}
  />
  {#if search.length}
    <button type="button" class="clear-btn" on:click={clearQuery}>
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  {/if}
</div>

<style>
  .search-block {
    background-color: var(--bg-input, #26262e);
    color: var(--text-muted, #8b929e);
    width: 100%;
    height: 38px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    position: relative;
    font-size: 16px;
    box-sizing: border-box;
    padding: 0 12px;
    gap: 8px;
    transition: background-color 0.15s ease;
  }

  .search-icon {
    flex-shrink: 0;
    opacity: 0.7;
    color: var(--text-muted, #8b929e);
  }

  .search-block input {
    width: 100%;
    outline: none;
    border: none;
    background: none;
    font-size: 16px;
    line-height: 20px;
    color: var(--text-primary, #ffffff);
    padding: 0;
  }

  .search-block input::placeholder {
    color: var(--text-muted, #8b929e);
  }

  .clear-btn {
    background: none;
    border: none;
    padding: 4px;
    margin: 0;
    color: var(--text-muted, #8b929e);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .clear-btn:hover {
    color: var(--text-primary, #ffffff);
  }
</style>
