<script>
  import { fade, scale, fly } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import API from "$lib/stores/api.js";

  const dispatch = createEventDispatcher();

  let name = "";
  let phone = "+7";
  let isLoading = false;
  let groupName = "";
  let mode = "contact";

  let errors = {
    name: "",
    phone: "",
  };

  const validate = () => {
    let isValid = true;
    errors = { name: "", phone: "" };

    if (!name || name.length < 1) {
      errors.name = "Введите имя контакта";
      isValid = false;
    }

    const cleanPhone = phone.replace(/\s+/g, "");
    if (cleanPhone.length < 5) {
      errors.phone = "Некорректный формат";
      isValid = false;
    }

    return isValid;
  };

  const submitHandler = async () => {
    if (isLoading) return;

    isLoading = true;

    let response;

    if (mode === "contact") {
      if (!validate()) {
        isLoading = false;
        return;
      }

      response = await $API.addContact(name, "+" + phone);
    }

    if (mode === "group") {
      if (!groupName.trim()) {
        isLoading = false;
        return;
      }

      response = await $API.createGroup(groupName);
    }

    isLoading = false;

    if (!response?.success) {
      errors.phone = response?.error || "Ошибка";
      return;
    }

    dispatch("close");
  };

  function formatPhone(value) {
    const digits = value.replace(/\D/g, "");

    let formatted = "+7";
    if (digits.length > 1) formatted += " " + digits.slice(1, 4);
    if (digits.length >= 5) formatted += " " + digits.slice(4, 7);
    if (digits.length >= 8) formatted += "-" + digits.slice(7, 9);
    if (digits.length >= 10) formatted += "-" + digits.slice(9, 11);

    return formatted;
  }

  function handleInput(event) {
    const rawValue = event.target.value;
    phone = rawValue.replace(/\D/g, "");
    event.target.value = formatPhone(rawValue);
    errors.phone = "";
  }

  const close = () => dispatch("close");
</script>

<div
  class="modal-backdrop"
  transition:fade={{ duration: 200 }}
  on:click={close}
>
  <div
    transition:fly={{ duration: 300, y: 50 }}
    on:click|stopPropagation
    class="tabs"
  >
    <button class:active={mode === "contact"} on:click={() => (mode = "contact")}>
      Контакт
    </button>
    <button class:active={mode === "group"} on:click={() => (mode = "group")}>
      Группа
    </button>
  </div>

  <div
    class="modal"
    transition:scale={{ duration: 200, start: 0.95 }}
    on:click|stopPropagation
  >
    <div class="header">
      <h3>{ mode === "contact" ? "Новый контакт" : "Новая группа" }</h3>
      <button class="close-btn" on:click={close}>&times;</button>
    </div>

    <div class="content">
      {#if mode === "contact"}
        <div class="input-group">
          <label>Имя</label>
          <div class="input-wrapper" class:has-error={errors.name}>
            <input
              type="text"
              bind:value={name}
              placeholder="Иван Иванов"
              on:input={() => (errors.name = "")}
            />
          </div>
          {#if errors.name}
            <span class="error-msg" transition:fade>{errors.name}</span>
          {/if}
        </div>

        <div class="input-group">
          <label>Номер телефона</label>
          <div class="input-wrapper" class:has-error={errors.phone}>
            <input
              type="tel"
              value={formatPhone(phone)}
              placeholder="+7 999 000-00-00"
              on:input={handleInput}
            />
          </div>
          {#if errors.phone}
            <span class="error-msg" transition:fade>{errors.phone}</span>
          {/if}
        </div>
      {:else}
        <div class="input-group">
          <label>Название группы</label>
          <div class="input-wrapper">
            <input
              type="text"
              bind:value={groupName}
              placeholder="Друзья / Работа / Семья"
            />
          </div>
        </div>
      {/if}
    </div>

    <div class="footer">
      <button class="btn cancel" on:click={close}>Отмена</button>
      <button class="btn save" on:click={submitHandler} disabled={isLoading}>
        {#if isLoading}
          ...
        {:else}
          {mode === "contact" ? "Добавить контакт" : "Создать группу"}
        {/if}
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
    background: rgba(0, 0, 0, 0.6);
    z-index: 100;
    display: flex;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(2px);
    flex-direction: column;
    gap: 10px;
  }

  .modal {
    background: #252525;
    width: 90%;
    max-width: 350px;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    color: #fff;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
    border: 1px solid #333;
  }

  .tabs {
    display: flex;
    gap: 8px;
    width: 90%;
    max-width: 350px;
    display: flex;
  }

  .tabs button {
    flex: 1;
    background: #1a1a1a;
    border: none;
    color: #aaa;
    padding: 8px 6px;
    border-radius: 12px;
    cursor: pointer;
  }

  .tabs button.active {
    background: #007afd;
    color: white;
    border-color: #007afd;
  }

  .header {
    padding: 15px 20px;
    border-bottom: 1px solid #333;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .close-btn:hover {
    color: #fff;
  }

  .content {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .input-group label {
    display: block;
    margin-bottom: 8px;
    color: #aaa;
    font-size: 13px;
    font-weight: 500;
  }

  .input-wrapper {
    background: #1a1a1a;
    border: 1px solid #444;
    border-radius: 8px;
    transition: 0.2s;
  }
  .input-wrapper:focus-within {
    border-color: #007afd;
    background: #151515;
  }
  .input-wrapper.has-error {
    border-color: #ff4b4b;
  }

  input {
    width: 100%;
    padding: 10px 12px;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 15px;
    outline: none;
  }
  input::placeholder {
    color: #555;
  }

  .error-msg {
    display: block;
    color: #ff4b4b;
    font-size: 12px;
    margin-top: 5px;
    padding-left: 2px;
  }

  .footer {
    padding: 15px 20px;
    border-top: 1px solid #333;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    background: #222;
    border-radius: 0 0 14px 14px;
  }

  .btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 14px;
    transition: 0.2s;
  }
  .btn.cancel {
    background: transparent;
    color: #007afd;
  }
  .btn.cancel:hover {
    background: rgba(0, 122, 253, 0.1);
  }

  .btn.save {
    background: #007afd;
    color: #fff;
  }
  .btn.save:hover {
    background: #006ce0;
  }
  .btn.save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
