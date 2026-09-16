<script>
  import { fade, fly } from "svelte/transition";
  import { createEventDispatcher } from "svelte";

  export let title = "Ввод данных";
  export let submitText = "Сохранить";
  export let cancelText = "Отмена";

  export let fields = [
    {
      key: "name",
      label: "Имя",
      placeholder: "Введите имя",
      value: ""
    }
  ];

  const dispatch = createEventDispatcher();

  let formData = {};

  fields.forEach((field) => {
    formData[field.key] = field.value || "";
  });

  function submit() {
    dispatch("submit", formData);
  }
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

      {#each fields as field}
        <div class="field">
          <label>{field.label}</label>

          {#if field.multiline}
            <textarea
              bind:value={formData[field.key]}
              placeholder={field.placeholder}
              rows={field.rows || 3}
            />
          {:else}
            <input
              bind:value={formData[field.key]}
              placeholder={field.placeholder}
              type={field.type || "text"}
            />
          {/if}
        </div>
      {/each}
    </div>

    <div class="footer">
      <button
        class="btn cancel"
        on:click={() => dispatch("cancel")}
      >
        {cancelText}
      </button>

      <button
        class="btn submit"
        on:click={submit}
      >
        {submitText}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: 200;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .modal {
    background: #252525;
    width: 85%;
    max-width: 340px;
    border-radius: 14px;
    color: #fff;
    border: 1px solid #333;
    overflow: hidden;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  }

  .content {
    padding: 20px;
  }

  .content h3 {
    margin: 0 0 16px;
    text-align: center;
    font-size: 18px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }

  .field label {
    font-size: 13px;
    color: #aaa;
  }

  .field input {
    height: 42px;
    padding: 0 12px;
    border-radius: 8px;
    border: 1px solid #3a3a3a;
    background: #1f1f1f;
    color: white;
    outline: none;
    font-size: 14px;
  }

  .field input:focus {
    border-color: #007afd;
  }

  .field textarea {
    min-height: 80px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #3a3a3a;
    background: #1f1f1f;
    color: white;
    outline: none;
    font-size: 14px;
    resize: none;
  }

  .footer {
    display: flex;
    border-top: 1px solid #333;
    height: 50px;
  }

  .btn {
    flex: 1;
    border: none;
    background: transparent;
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

  .btn.submit {
    color: #007afd;
    font-weight: 600;
  }
</style>
