<script>
  import { createEventDispatcher } from "svelte";
  import Switch from "$components/common/Switch.svelte";

  export let title = "";
  export let subtitle = "";
  export let value = "";
  export let icon = "";
  export let noIconInvert = false;
  export let badge = "";
  export let isToggle = false;
  export let checked = false;
  export let disabled = false;
  export let chevron = true;
  export let danger = false;
  export let accent = false;
  export let clickable = true;
  export let active = false;

  const dispatch = createEventDispatcher();

  function handleClick(e) {
    if (disabled) return;
    if (isToggle) {
      checked = !checked;
      dispatch("change", { checked });
    }
    dispatch("click", e);
  }

  function handleSwitchChange(e) {
    if (disabled) return;
    checked = e.detail?.checked ?? !checked;
    dispatch("change", { checked });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="settings-row"
  class:clickable={clickable && !disabled}
  class:disabled
  class:danger
  class:accent
  class:active
  on:click={handleClick}
>
  {#if $$slots.icon}
    <div class="settings-row-icon">
      <slot name="icon" />
    </div>
  {:else if icon}
    <div class="settings-row-icon">
      <img
        src={icon.startsWith("/") || icon.startsWith("icons/") ? icon : `/icons/${icon}`}
        alt=""
        class="settings-row-img"
        class:no-invert={noIconInvert}
      />
    </div>
  {/if}

  <div class="settings-row-body">
    <div class="settings-row-title">
      {#if title}
        <span>{title}</span>
      {:else}
        <slot name="title" />
      {/if}
    </div>
    {#if subtitle}
      <div class="settings-row-subtitle">{subtitle}</div>
    {:else if $$slots.subtitle}
      <div class="settings-row-subtitle"><slot name="subtitle" /></div>
    {/if}
  </div>

  <div class="settings-row-right">
    {#if badge}
      <span class="settings-row-badge">{badge}</span>
    {/if}
    {#if value}
      <span class="settings-row-value">{value}</span>
    {/if}
    <slot name="right" />
    {#if isToggle}
      <div class="settings-row-switch">
        <Switch bind:checked {disabled} ariaLabel={title} on:change={handleSwitchChange} />
      </div>
    {:else if chevron}
      <svg class="settings-row-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    {/if}
  </div>
</div>

<style>
  .settings-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 52px;
    padding: 10px 16px;
    color: var(--settings-text-primary);
    font-family: var(--settings-font-body, var(--font-family-base));
    transition: background-color 0.14s ease;
  }

  .settings-row.clickable {
    cursor: pointer;
  }

  .settings-row.clickable:hover {
    background-color: var(--settings-card-hover);
  }

  .settings-row.clickable:active,
  .settings-row.active {
    background-color: var(--settings-card-active);
  }

  .settings-row.disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }

  .settings-row.danger .settings-row-title,
  .settings-row.danger .settings-row-icon {
    color: var(--settings-danger);
  }

  .settings-row.accent .settings-row-title,
  .settings-row.accent .settings-row-icon {
    color: var(--settings-accent);
  }

  .settings-row-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--settings-icon-secondary);
  }

  .settings-row-img {
    width: 22px;
    height: 22px;
    object-fit: contain;
    display: block;
    filter: brightness(0) invert(var(--icon-invert, 1));
    opacity: 0.85;
  }

  .settings-row-img.no-invert {
    filter: none;
    opacity: 1;
  }

  .settings-row.danger .settings-row-img {
    filter: invert(41%) sepia(87%) saturate(2330%) hue-rotate(334deg) brightness(101%) contrast(101%);
  }

  .settings-row-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .settings-row-title {
    font-size: 16px;
    font-weight: 400;
    line-height: 1.3;
    color: var(--settings-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-row-subtitle {
    font-size: 13px;
    line-height: 1.35;
    color: var(--settings-text-muted);
  }

  .settings-row-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .settings-row-value {
    font-size: 14px;
    color: var(--settings-text-muted);
    max-width: 140px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-row-badge {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: var(--settings-accent);
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .settings-row-chevron {
    color: var(--settings-icon-muted);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .settings-row-switch {
    display: flex;
    align-items: center;
  }
</style>
