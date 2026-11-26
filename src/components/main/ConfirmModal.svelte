<script>
  import { createEventDispatcher, getContext, onMount, onDestroy } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  const inPortal = Boolean(getContext("appPortalHost"));

  export let title = "Подтверждение";
  export let message = "Вы уверены?";
  export let confirmText = "Удалить";
  export let cancelText = "Отмена";
  export let isDangerous = true;
  export let onConfirm = null;
  export let onCancel = null;
  export let close = null;
  export let setBackHandler = null;

  const dispatch = createEventDispatcher();
  let isClosing = false;
  let unregisterBack = null;

  $: if (setBackHandler) {
    setBackHandler(() => {
      handleCancel();
      return false;
    });
  }

  onMount(() => {
    if (!setBackHandler && !inPortal) {
      unregisterBack = registerBackHandler(() => {
        handleCancel();
        return false;
      });
    }
  });

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
  });

  function handleCancel() {
    if (isClosing) return;
    isClosing = true;
    if (onCancel) onCancel();
    dispatch("cancel");
    dispatch("close");
    if (close) {
      close(false);
    } else {
      setTimeout(() => {
        isClosing = false;
      }, 180);
    }
  }

  function handleConfirm() {
    if (isClosing) return;
    isClosing = true;
    if (onConfirm) onConfirm();
    dispatch("confirm");
    dispatch("close");
    if (close) {
      close(true);
    } else {
      setTimeout(() => {
        isClosing = false;
      }, 180);
    }
  }
</script>

<div
  class="modal-backdrop"
  class:is-portal-child={Boolean(setBackHandler || inPortal)}
  class:modal-closing={isClosing}
  on:click={handleCancel}
  role="presentation"
>
  <div
    class="modal-card"
    class:modal-closing={isClosing}
    on:click|stopPropagation
    role="alertdialog"
  >
    <div class="modal-content">
      <h3 class="modal-title">{title}</h3>
      {#if message}<p class="modal-message">{message}</p>{/if}
      <slot />
    </div>

    <div class="modal-actions">
      <button class="action-btn cancel-btn" on:click={handleCancel} type="button">{cancelText}</button>
      <button class="action-btn confirm-btn" class:danger={isDangerous} on:click={handleConfirm} type="button">{confirmText}</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: transparent;
    z-index: var(--z-modal, 7); display: flex; justify-content: center; align-items: center;
    padding: 20px; box-sizing: border-box;
  }
  .modal-backdrop.is-portal-child {
    position: relative; inset: auto; z-index: auto; padding: 0;
  }
  .modal-backdrop.is-portal-child .modal-card {
    animation: none;
  }
  .modal-backdrop.modal-closing {
    animation: modalFadeOut 0.18s cubic-bezier(0.4, 0, 1, 1) forwards;
  }
  .modal-card {
    background: var(--bg-surface); width: 100%; max-width: 340px;
    border-radius: 20px; display: flex; flex-direction: column; color: var(--text-primary); border: 1px solid var(--border-subtle);
    overflow: hidden; padding: 24px 20px 20px; box-sizing: border-box;
    will-change: transform, opacity;
    animation: modalPopIn 0.22s cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
    box-shadow: var(--shadow-elevated);
  }
  .modal-card.modal-closing {
    animation: modalPopOut 0.18s cubic-bezier(0.4, 0, 1, 1) forwards;
  }
  @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes modalFadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes modalPopIn {
    from { opacity: 0; transform: scale3d(0.92, 0.92, 1); }
    to { opacity: 1; transform: scale3d(1, 1, 1); }
  }
  @keyframes modalPopOut {
    from { opacity: 1; transform: scale3d(1, 1, 1); }
    to { opacity: 0; transform: scale3d(0.92, 0.92, 1); }
  }
  .modal-content { text-align: center; display: flex; flex-direction: column; gap: 8px; }
  .modal-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--text-primary); }
  .modal-message { margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.45; }
  .modal-actions { display: flex; gap: 10px; margin-top: 24px; }
  .action-btn {
    flex: 1; height: 44px; border-radius: 22px; border: none; font-size: 14px; font-weight: 600;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, opacity 0.15s;
  }
  .cancel-btn { background: var(--bg-pill); color: var(--text-primary); }
  .cancel-btn:hover { background: var(--bg-active); }
  .confirm-btn { background: var(--accent-primary); color: var(--accent-contrast, #ffffff); }
  .confirm-btn:hover { background: var(--accent-primary-hover); }
  .confirm-btn.danger { background: var(--status-danger); color: #ffffff; }
  .confirm-btn.danger:hover { opacity: 0.9; }
</style>
