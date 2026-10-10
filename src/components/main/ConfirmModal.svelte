<script>
  import { createEventDispatcher } from "svelte";
  import { Modal, Button } from "$components/ui";

  export let title = "Подтверждение";
  export let message = "Вы уверены?";
  export let confirmText = "Удалить";
  export let cancelText = "Отмена";
  export let isDangerous = true;

  const dispatch = createEventDispatcher();
</script>

<Modal open={true} size="sm" showClose={false} class="confirm-modal" onclose={() => dispatch("cancel")}>
  <div class="content">
    <h3>{title}</h3>
    <p>{message}</p>
    <slot />
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => dispatch("cancel")}>{cancelText}</Button>
    <Button variant={isDangerous ? "danger" : "primary"} onclick={() => dispatch("confirm")}>{confirmText}</Button>
  {/snippet}
</Modal>

<style>
  .content { padding-top: 16px; text-align: center; }
  .content h3 { margin: 0 0 10px; font-size: 18px; font-weight: 600; color: var(--text-primary); }
  .content p { margin: 0; font-size: 14px; color: var(--text-secondary, var(--text-muted)); line-height: 1.5; }
  :global(.confirm-modal .modal__footer > *) { flex: 1; }
</style>
