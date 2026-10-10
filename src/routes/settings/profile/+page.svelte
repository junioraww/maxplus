<script>
  import { Button } from "$components/ui";
  import { fly, slide, fade } from "svelte/transition";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import { openAvatarGallery } from "$lib/stores/session";
  import API, { currentUserDetails } from "$lib/stores/api";
  import { formatTimeAgo } from "$lib/utils/time.js";

  let firstName = "";
  let lastName = "";
  let description = "";
  let updated = "";
  let initialized = false;

  const original = {
    firstName: "",
    lastName: "",
    description: "",
  };

  currentUserDetails.subscribe((details) => {
    if (!details?.names) return;

    if (!initialized) {
      firstName = details.names[0].firstName || "";
      lastName = details.names[0].lastName || "";
      description = details.description || "";
      original.firstName = firstName;
      original.lastName = lastName;
      original.description = description;
      initialized = true;
    }
    updated = details.updateTime ? "Обновлено " + formatTimeAgo(details.updateTime) : "";
  });

  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";

  let loading = false;
  let avatarBusy = false;
  let avatarPreviewEl;
  let statusNotice = "";
  let noticeTimer;

  function notify(text) {
    statusNotice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      statusNotice = "";
    }, 2200);
  }

  $: selfAvatarUrl = $currentUserDetails?.baseRawUrl || $currentUserDetails?.avatar || $currentUserDetails?.baseUrl || null;
  $: selfPhotoId = $currentUserDetails?.photoId || null;
  $: canDeleteSelfAvatar = Boolean(selfPhotoId || selfAvatarUrl);

  $: changed =
    firstName !== original.firstName ||
    lastName !== original.lastName ||
    description !== original.description;

  function openSelfGallery(e) {
    if (selfAvatarUrl || $currentUserDetails?.id) {
      const targetEl = avatarPreviewEl || e?.currentTarget;
      const rect = targetEl?.getBoundingClientRect?.();
      openAvatarGallery({
        initialUrl: selfAvatarUrl,
        initialPhotoId: selfPhotoId,
        userId: $currentUserDetails?.id,
        isOwnProfile: true,
        canUpload: true,
        originEl: targetEl,
        originRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        originRadius: 50,
        onUpload: handleUploadAvatar,
        onDelete: handleDeleteAvatar,
        onDownloaded: () => notify("Фото сохранено"),
        onError: (msg) => notify(msg || "Ошибка"),
      });
    } else {
      handleUploadAvatar();
    }
  }

  async function handleUploadAvatar() {
    if (avatarBusy) return null;
    avatarBusy = true;
    try {
      const res = await $API.uploadProfilePhoto();
      if (res) {
        notify("Фото профиля обновлено");
      }
      return res;
    } catch (e) {
      notify(e?.message || "Не удалось загрузить фото");
      throw e;
    } finally {
      avatarBusy = false;
    }
  }

  async function handleDeleteAvatar(targetPhotoId = null, targetUrl = null) {
    if (avatarBusy || !canDeleteSelfAvatar) return;
    avatarBusy = true;
    try {
      await $API.deleteProfilePhoto(targetPhotoId || selfPhotoId, targetUrl || selfAvatarUrl);
      notify("Фото профиля удалено");
    } catch (e) {
      notify(e?.message || "Не удалось удалить фото");
      throw e;
    } finally {
      avatarBusy = false;
    }
  }

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
      notify("Изменения сохранены");
    } catch (e) {
      console.error(e);
      notify("Не удалось обновить профиль");
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
    <div class="avatar-section" in:fly={{ y: 12, duration: 300, opacity: 0 }}>
      <div
        class="avatar-preview-wrap"
        bind:this={avatarPreviewEl}
        on:click={openSelfGallery}
      >
        <Avatar size={92} isSelf={true} contactId={$currentUserDetails?.id} />
        <button
          type="button"
          class="avatar-camera-badge"
          title="Изменить фото"
          disabled={avatarBusy}
          on:click|stopPropagation={handleUploadAvatar}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <div class="avatar-buttons">
        <Button variant="primary" class="pg-profile-avatar-action-btn" disabled={avatarBusy} onclick={handleUploadAvatar}>
          {avatarBusy ? "Загрузка..." : "Загрузить фото"}
        </Button>
        {#if canDeleteSelfAvatar}
          <Button variant="danger" class="pg-profile-avatar-action-btn" disabled={avatarBusy} onclick={() => handleDeleteAvatar()}>
            Удалить
          </Button>
        {/if}
      </div>
    </div>

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

    {#if statusNotice}
      <div class="notice-pill" transition:fade={{ duration: 150 }}>
        {statusNotice}
      </div>
    {/if}
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
    color: var(--text-muted);
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .content::-webkit-scrollbar {
    width: 4px;
  }

  .content::-webkit-scrollbar-thumb {
    background: var(--bg-surface-2);
    border-radius: 999px;
  }

  .avatar-section {
    background: var(--bg-surface-2);
    border-radius: 16px;
    border: 1px solid var(--border-subtle);
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .avatar-preview-wrap {
    position: relative;
    cursor: pointer;
    transition: transform 0.14s;
  }

  .avatar-preview-wrap:active {
    transform: scale(0.96);
  }

  .avatar-camera-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid #26262e;
    background: var(--accent-primary);
    color: var(--button-primary-contrast);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
    transition: background 0.15s, transform 0.12s, opacity 0.15s;
  }

  .avatar-camera-badge:hover {
    background: #4ea4f6;
  }

  .avatar-camera-badge:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .avatar-buttons {
    display: flex;
    align-items: center;
    gap: 10px;
  }


  :global(.pg-profile-avatar-action-btn):active  { transform: scale(0.96); }






  .profile-card {
    background: var(--bg-surface-2);
    border-radius: 16px;
    border: 1px solid var(--border-subtle);
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
    color: var(--text-primary);
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
    border-color: var(--accent-primary);
    background: #20202a;
  }

  textarea {
    min-height: 120px;
    resize: vertical;
    font-family: inherit;
  }

  .notice-pill {
    align-self: center;
    background: rgba(30, 30, 38, 0.95);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-size: 0.85rem;
    padding: 8px 16px;
    border-radius: 999px;
  }

  .actions-panel {
    flex-shrink: 0;
    display: flex;
    padding: 14px 16px;
    background: var(--bg-topbar);
    border-top: 1px solid var(--border-subtle);
  }

  .save-btn {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 12px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    background: var(--accent-primary);
    color: var(--button-primary-contrast);
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
