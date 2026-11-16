<script>
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import API from "$lib/stores/api";
  import { showAlert } from "$lib/utils/alert";
  import { normalizePhone } from "$lib/utils/text";

  export let initialPhone = "+";

  const dispatch = createEventDispatcher();

  let firstName = "";
  let lastName = "";
  let phone = initialPhone.startsWith("+") ? initialPhone : "+" + initialPhone.replace(/\+/g, "");
  let firstNameError = "";
  let phoneError = "";
  let isSaving = false;

  function handlePhoneInput(e) {
    let raw = e.target.value.replace(/[^\d+]/g, "");
    if (!raw.startsWith("+")) raw = "+" + raw.replace(/\+/g, "");
    phone = raw;
    e.target.value = phone;
    phoneError = "";
  }

  function validate() {
    firstNameError = "";
    phoneError = "";
    let valid = true;

    if (!firstName.trim()) {
      firstNameError = "Введите имя";
      valid = false;
    }

    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) {
      phoneError = "Некорректный номер телефона";
      valid = false;
    }

    return valid;
  }

  async function handleSave() {
    if (isSaving || !validate()) return;
    isSaving = true;

    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    const formattedPhone = normalizePhone(phone);

    try {
      const res = await $API.addContact(fullName, formattedPhone);
      if (!res?.success && res?.contact == null) {
        phoneError = res?.localizedMessage || res?.message || "Пользователь не найден";
        showAlert(phoneError);
        isSaving = false;
        return;
      }
      showAlert("Контакт добавлен");
      dispatch("saved", res.contact);
      dispatch("close");
    } catch (e) {
      phoneError = "Не удалось сохранить контакт";
      showAlert(phoneError);
    } finally {
      isSaving = false;
    }
  }
</script>

<BottomSheet title="Новый контакт" maxHeight="85vh" on:close={() => dispatch("close")}>
  <div class="sheet-content">
    <div class="avatar-preview">
      <div class="avatar-circle">
        <img src="/icons/profile.svg" alt="" width="36" height="36" />
      </div>
    </div>

    <div class="form-body">
      <div class="input-field" class:error={firstNameError}>
        <input
          type="text"
          placeholder="Имя"
          bind:value={firstName}
          on:input={() => (firstNameError = "")}
          disabled={isSaving}
        />
        {#if firstNameError}
          <span class="error-text">{firstNameError}</span>
        {/if}
      </div>

      <div class="input-field">
        <input
          type="text"
          placeholder="Фамилия (необязательно)"
          bind:value={lastName}
          disabled={isSaving}
        />
      </div>

      <div class="input-field" class:error={phoneError}>
        <input
          type="tel"
          placeholder="Номер телефона"
          value={phone}
          on:input={handlePhoneInput}
          disabled={isSaving}
        />
        {#if phoneError}
          <span class="error-text">{phoneError}</span>
        {/if}
      </div>
    </div>

    <div class="action-footer">
      <button
        class="save-btn"
        on:click={handleSave}
        disabled={isSaving}
        type="button"
      >
        {isSaving ? "Сохранение..." : "Сохранить"}
      </button>
    </div>
  </div>
</BottomSheet>

<style>
  .sheet-content {
    display: flex;
    flex-direction: column;
    padding: 12px 18px 24px;
    gap: 20px;
    box-sizing: border-box;
  }

  .avatar-preview {
    display: flex;
    justify-content: center;
    padding: 6px 0 12px;
  }

  .avatar-circle {
    width: 76px;
    height: 76px;
    border-radius: 50%;
    background: #2a2c35;
    color: #8c93a0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .form-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .input-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-field input {
    width: 100%;
    height: 48px;
    border-radius: 14px;
    border: 1px solid #333642;
    background: #1e2027;
    color: #ffffff;
    font-size: 15px;
    padding: 0 14px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .input-field input:focus {
    border-color: #0077ff;
    background: #232530;
  }

  .input-field input::placeholder {
    color: #6d7380;
  }

  .input-field.error input {
    border-color: #ff4d4f;
  }

  .error-text {
    font-size: 12px;
    color: #ff4d4f;
    padding-left: 6px;
  }

  .action-footer {
    display: flex;
    margin-top: 8px;
  }

  .save-btn {
    width: 100%;
    height: 48px;
    border-radius: 14px;
    border: none;
    background: #0077ff;
    color: #ffffff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s ease, opacity 0.15s ease;
  }

  .save-btn:hover:not(:disabled) {
    background: #0066dd;
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
