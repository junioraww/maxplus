<script>
  import { alerts, removeAlert } from '$lib/utils/alert.js';
  import { fly, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';

  function handleAlertClick(alert) {
    if (alert.onClick) {
      alert.onClick();
    }
    removeAlert(alert.id);
  }
</script>

<div class="alerts-container">
  {#each $alerts as alert (alert.id)}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="alert"
      class:clickable={!!alert.onClick}
      in:fly={{ y: 30, duration: 300 }}
      out:fade={{ duration: 200 }}
      animate:flip={{ duration: 300 }}
      on:click={() => handleAlertClick(alert)}
    >
      <div class="text">{alert.data}</div>

      {#if alert.calledAt}
        {@const text = String(alert.calledAt)}
        {@const cutIndex = Math.max(0, text.length - 22)}
        {@const startStr = text.slice(0, cutIndex)}
        {@const endStr = text.slice(cutIndex)}

        <div class="caller-info" title={text}>
          <span class="start">{startStr}</span>
          <span class="end">{endStr}</span>
        </div>
      {/if}

      {#if alert.description}
        <div class="description">{alert.description}</div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .alerts-container {
    position: fixed;
    bottom: 24px;
    left: 16px;
    right: 16px;
    z-index: 9999;

    display: flex;
    flex-direction: column;
    gap: 12px;
    pointer-events: none;
  }

  @media (min-width: 480px) {
    .alerts-container {
      left: auto;
      width: 340px;
    }
  }

  .alert {
    pointer-events: auto;
    background-color: #222222;
    color: #ffffff;
    padding: 14px 18px;
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);

    display: flex;
    flex-direction: column;
    gap: 4px;

    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }

  .alert.clickable {
    cursor: pointer;
    transition: transform 0.1s ease, background-color 0.2s ease;
  }

  .alert.clickable:active {
    transform: scale(0.97);
    background-color: #333333;
  }

  .text {
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .description {
    font-size: 13px;
    color: #b3b3b3;
    line-height: 1.4;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .caller-info {
    display: flex;
    font-size: 11px;
    color: #666666;
    font-family: monospace;
    line-height: 1.2;
    margin-bottom: 2px;
    width: 100%;
  }

  .caller-info .start {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 1;
    min-width: 0;
  }

  .caller-info .end {
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
