<script>
  import { createEventDispatcher } from "svelte";
  import { Modal, Button, Input } from "$components/ui";

  export let title = "Ввод данных";
  export let submitText = "Сохранить";
  export let cancelText = "Отмена";

  export let fields = [
    { key: "name", label: "Имя", placeholder: "Введите имя", value: "" }
  ];

  const dispatch = createEventDispatcher();

  /** @type {Record<string, string>} */
  let formData = {};
  fields.forEach((field) => {
    formData[field.key] = field.value || "";
  });

  function submit() {
    dispatch("submit", formData);
  }
</script>

<Modal open={true} size="sm" {title} class="input-modal" onclose={() => dispatch("cancel")}>
  <form class="fields" on:submit|preventDefault={submit}>
    {#each fields as field (field.key)}
      <Input
        label={field.label}
        placeholder={field.placeholder}
        type={field.type || "text"}
        multiline={!!field.multiline}
        rows={field.rows || 3}
        bind:value={formData[field.key]}
      />
    {/each}
  </form>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => dispatch("cancel")}>{cancelText}</Button>
    <Button onclick={submit}>{submitText}</Button>
  {/snippet}
</Modal>

<style>
  .fields { display: flex; flex-direction: column; gap: 12px; }
  :global(.input-modal .modal__footer > *) { flex: 1; }
</style>
