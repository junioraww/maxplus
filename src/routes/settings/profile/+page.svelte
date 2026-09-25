<script>
  import { fly, slide } from "svelte/transition";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import API, { currentUserDetails } from "$lib/stores/api";
  import { formatTimeAgo } from "$lib/utils/time.js";

  let firstName = "";
  let lastName = "";
  let description = "";
  let updated = "";

  currentUserDetails.subscribe((details) => {
    if (!details?.names) return;

    firstName = details.names[0].firstName;
    lastName = details.names[0].lastName;
    description = details.description;
    updated = "Обновлено " + formatTimeAgo(details.updateTime);
  });

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let loading = false;

  const original = {
    firstName,
    lastName,
    description,
  };

  $: changed =
    firstName !== original.firstName ||
    lastName !== original.lastName ||
    description !== original.description;

  async function save() {
    if (!changed || loading) return;

    loading = true;

    try {
      const descriptionChanged = description !== original.description;

      if (descriptionChanged) {
        await $API.updateProfile(
          firstName.trim(),
          lastName.trim(),
          description.trim(),
        );
      } else {
        await $API.updateProfile(firstName.trim(), lastName.trim());
      }

      original.firstName = firstName;
      original.lastName = lastName;
      original.description = description;
    } catch (e) {
      console.error(e);
      alert("Не удалось обновить профиль");
    } finally {
      loading = false;
    }
  }
</script>

<SettingsPageWrapper title="Профиль" {from} {onClose}>
  <span class="badge" slot="header-extra">
    {updated}
  </span>

  <div class="content">
    <div class="profile-card" in:fly={{ y: 15, duration: 350, opacity: 0 }}>
      <div class="field">
        <label>Имя</label>
        <input
          bind:value={firstName}
          type="text"
          placeholder="Введите имя"
          maxlength="32"
        />
      </div>

      <div class="field">
        <label>Фамилия</label>
        <input
          bind:value={lastName}
          type="text"
          placeholder="Введите фамилию"
          maxlength="32"
        />
      </div>

      <div class="field">
        <label>Описание профиля</label>
        <textarea
          bind:value={description}
          placeholder="Расскажите о себе"
          maxlength="250"
        ></textarea>
      </div>
    </div>
  </div>

  <svelte:fragment slot="footer">
    {#if changed}
      <div class="actions-panel">
        <button
          class="save-btn"
          on:click={save}
          disabled={loading}
          transition:slide={{ duration: 180 }}
        >
          {#if loading}
            Сохранение...
          {:else}
            Сохранить изменения
          {/if}
        </button>
      </div>
    {/if}
  </svelte:fragment>
</SettingsPageWrapper>

<style>
  .badge {
    font-size: 0.75rem;
    padding: 4px 10px;
    border-radius: 999px;
    background: #2c2c35;
    color: #888;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    box-sizing: border-box;
  }

  .content::-webkit-scrollbar {
    width: 4px;
  }

  .content::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 999px;
  }

  .profile-card {
    background: #26262e;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  label {
    font-size: 0.78rem;
    color: #7b7b88;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  input,
  textarea {
    width: 100%;
    background: #1f1f26;
    border: 1px solid transparent;
    border-radius: 12px;
    color: white;
    padding: 14px;
    box-sizing: border-box;
    font-size: 0.95rem;
    outline: none;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  input:focus,
  textarea:focus {
    border-color: #3390ec;
    background: #20202a;
  }

  textarea {
    min-height: 120px;
    resize: vertical;
    font-family: inherit;
  }

  .actions-panel {
    flex-shrink: 0;
    display: flex;
    padding: 14px 16px;
    background: #212126;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .save-btn {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 12px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    background: #3390ec;
    color: white;
    transition:
      transform 0.12s,
      opacity 0.15s,
      background 0.15s;
  }

  .save-btn:hover {
    background: #2b7ecf;
  }

  .save-btn:active {
    transform: scale(0.98);
  }

  .save-btn:disabled {
    opacity: 0.7;
  }
</style>
