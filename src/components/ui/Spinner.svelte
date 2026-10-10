<script>
  /** @type {{ size?: number, class?: string }} */
  let { size = 20, class: className = '' } = $props();
</script>

<span class="spinner {className}" style:--spinner-size="{size}px" role="status" aria-label="Загрузка"></span>

<style>
  .spinner {
    display: inline-block;
    width: var(--spinner-size);
    height: var(--spinner-size);
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
