<script>
  import { fade, fly } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let title = "Подтверждение";
  export let message = "Вы уверены?";
  export let confirmText = "Удалить";
  export let cancelText = "Отмена";
  export let isDangerous = true;

  const dispatch = createEventDispatcher();
</script>

<div
  class="modal-backdrop"
  transition:fade={{ duration: 200 }}
  on:click={() => dispatch("cancel")}
>
  <div
    class="modal"
    transition:fly={{ y: 20, duration: 250 }}
    on:click|stopPropagation
  >
    <div class="content">
      <h3>{title}</h3>
      <p>{message}</p>
    </div>

    <div class="footer">
      <button class="btn cancel" on:click={() => dispatch("cancel")}
        >{cancelText}</button
      >
      <button
        class="btn confirm"
        class:danger={isDangerous}
        on:click={() => dispatch("confirm")}
      >
        {confirmText}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.65);
    z-index: 200;
    display: flex;
    justify-content: center;
    align-items: center;
    will-change: opacity;
  }

  .modal {
    background: #252525;
    width: 85%;
    max-width: 320px;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    color: #fff;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    border: 1px solid #333;
    overflow: hidden;
    will-change: transform, opacity;
    transform: translateZ(0);
  }

  .content {
    padding: 24px 20px;
    text-align: center;
  }

  .content h3 {
    margin: 0 0 10px 0;
    font-size: 18px;
    font-weight: 600;
    color: #fff;
  }

  .content p {
    margin: 0;
    font-size: 14px;
    color: #aaa;
    line-height: 1.5;
  }

  .footer {
    display: flex;
    border-top: 1px solid #333;
    height: 50px;
  }

  .btn {
    flex: 1;
    background: transparent;
    border: none;
    font-size: 16px;
    cursor: pointer;
    transition: 0.2s;
  }

  .btn:active {
    background: #333;
  }

  .btn.cancel {
    color: #007afd;
    border-right: 1px solid #333;
  }

  .btn.confirm {
    color: #007afd;
    font-weight: 600;
  }

  .btn.confirm.danger {
    color: #ff4b4b;
  }
</style>
