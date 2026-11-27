<script>
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { openChat } from "$lib/stores/session";
  import { showAlert } from "$lib/utils/alert";
  import { normalizePhone } from "$lib/utils/text";

  export let initialPhone = "+";
  export let close = null;
  export let setBackHandler = null;

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
      if (res?.contact?.id && $currentUser) {
        const dialogId = Number(BigInt($currentUser) ^ BigInt(res.contact.id));
        openChat(dialogId);
      }
      dispatch("close");
      if (typeof close === "function") close({ saved: true, contact: res?.contact });
    } catch (e) {
      phoneError = "Не удалось сохранить контакт";
      showAlert(phoneError);
    } finally {
      isSaving = false;
    }
  }
</script>

<BottomSheet title="Новый контакт" maxHeight="85vh" {close} {setBackHandler} on:close={() => { dispatch("close"); if (close) close(); }}>
  <div class="sheet-content">
    <div class="avatar-preview">
      <div class="avatar-circle">
        <img src="/icons/profile.svg" alt="" width="36" height="36" class="theme-icon" />
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
  </div>

  <svelte:fragment slot="footer">
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
  </svelte:fragment>
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
    background: var(--bg-input);
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
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
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    background: var(--bg-input, #1e2027);
    color: var(--text-primary, #ffffff);
    font-size: 15px;
    padding: 0 14px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }

  .input-field input:focus {
    border-color: var(--accent-primary, #248bfe);
    background: var(--bg-surface-secondary, #232530);
  }

  .input-field input::placeholder {
    color: var(--text-muted, #6d7380);
  }

  .input-field.error input {
    border-color: var(--status-danger, #ef4444);
  }

  .error-text {
    font-size: 12px;
    color: var(--status-danger, #ef4444);
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
    background: var(--accent-primary, #248bfe);
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
    background: var(--accent-primary-hover, #1b74d9);
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
