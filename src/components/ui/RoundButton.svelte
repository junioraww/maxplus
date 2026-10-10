<script>
  /**
   * Круглая акцентная кнопка (squircle) — единый компонент для действий в шапке.
   * Иконка по умолчанию — плюс, можно передать свою через children.
   * @type {{ label: string, onclick?: (e: MouseEvent) => void, size?: number, variant?: 'primary', children?: import('svelte').Snippet, [key: string]: any }}
   */
  let { label, onclick, size = 32, variant = 'primary', children, ...rest } = $props();
</script>

<button
  type="button"
  class="round-button round-button--{variant}"
  style:--round-button-size="{size}px"
  aria-label={label}
  title={label}
  {onclick}
  {...rest}
>
  <svg class="shape" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" fill="none" aria-hidden="true">
    <path d="M26 0C30.8966 0 35.6698 0.794071 40.0291 3.12545C43.8424 5.16485 46.8352 8.15757 48.8746 11.9709C51.2059 16.3302 52 21.1034 52 26C52 31.4424 50.9139 36.2158 48.8746 40.0291C46.8352 43.8424 43.8424 46.8352 40.0291 48.8745C35.6698 51.2059 30.8966 52 26 52C20.5576 52 15.7842 50.9139 11.9709 48.8745C8.15757 46.8352 5.16485 43.8424 3.12545 40.0291C0.786468 35.6556 0.0294538 30.9057 0 26C0 20.5576 1.08606 15.7842 3.12545 11.9709C5.16485 8.15757 8.15757 5.16485 11.9709 3.12545C15.7842 1.08606 20.5576 0 26 0Z" fill="var(--button-background-color, var(--button-primary))" />
  </svg>
  <span class="content">
    {#if children}
      {@render children()}
    {:else}
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    {/if}
  </span>
</button>

<style>
  .round-button {
    position: relative;
    isolation: isolate;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: var(--round-button-size);
    height: var(--round-button-size);
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.12s ease, opacity 0.12s ease;
  }

  .round-button--primary {
    color: var(--button-icon-color, var(--button-primary-contrast, #fff));
  }

  .round-button:hover { opacity: 0.92; }
  .round-button:active { transform: scale(0.94); }
  .round-button:focus-visible {
    outline: 2px solid var(--stroke-themed, #007aff);
    outline-offset: 2px;
    border-radius: 30%;
  }

  .shape {
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .content {
    display: flex;
    align-items: center;
    justify-content: center;
    color: inherit;
  }
</style>
