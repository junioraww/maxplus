<script>
  export let title = "";
  export let footer = "";
  export let padding = false;
</script>

<div class="settings-section">
  {#if title}
    <div class="settings-section-title">{title}</div>
  {:else if $$slots.title}
    <div class="settings-section-title"><slot name="title" /></div>
  {/if}

  <div class="settings-section-card" class:with-padding={padding}>
    <slot />
  </div>

  {#if footer}
    <div class="settings-section-footer">{footer}</div>
  {:else if $$slots.footer}
    <div class="settings-section-footer"><slot name="footer" /></div>
  {/if}
</div>

<style>
  .settings-section {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .settings-section-title {
    padding: 0 16px 8px;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 13px;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: 0.2px;
    color: var(--settings-text-muted);
    text-transform: uppercase;
  }

  .settings-section-card {
    background-color: var(--settings-card-bg);
    border-radius: var(--settings-card-radius, 16px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .settings-section-card.with-padding {
    padding: 14px 16px;
  }

  .settings-section-footer {
    padding: 8px 16px 0;
    font-family: var(--settings-font-body, var(--font-family-base));
    font-size: 13px;
    line-height: 1.4;
    color: var(--settings-text-muted);
  }
</style>
