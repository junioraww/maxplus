<script>
  import { createEventDispatcher } from "svelte";

  export let editingMessage = null;

  const dispatch = createEventDispatcher();

  function cancel() {
    dispatch("cancel");
  }
</script>

{#if editingMessage}
  <div class="editing-banner">
    <div class="editing-line"></div>
    <div class="editing-details">
      <div class="editing-title">Редактирование</div>
      <div class="editing-snippet">{editingMessage.text || 'Вложения'}</div>
    </div>
    <button class="editing-cancel-btn" type="button" on:click={cancel} title="Отменить">
      <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 18px; height: 18px;"></span>
    </button>
  </div>
{/if}

<style>
  .editing-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 2px 12px;
    background: transparent;
    border: none;
    box-sizing: border-box;
    width: 100%;
  }

  .editing-line {
    width: 2.5px;
    height: 32px;
    background: var(--accent-primary, #248bfe);
    border-radius: 1.5px;
    flex-shrink: 0;
  }

  .editing-details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .editing-title {
    font-size: 13px;
    font-weight: 400;
    line-height: 16px;
    color: var(--text-secondary, #8a8d9b);
  }

  .editing-snippet {
    font-size: 15px;
    line-height: 19px;
    color: #ffffff;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .editing-cancel-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #8a8d9b);
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    transition: color 0.15s ease, background-color 0.15s ease;
  }

  .editing-cancel-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }
</style>
