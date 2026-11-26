<script>
  import { onMount } from "svelte";
  import { slide, fade } from "svelte/transition";
  import { page } from "$app/stores";
  import SettingsPageWrapper from "$components/settings/SettingsPageWrapper.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import {
    openAvatarGallery,
    openSafeAvatarPicker,
    openInactiveTtlSheet,
    showConfirm,
  } from "$lib/stores/session";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";
  import { getSafeAvatarMediaUrl } from "$lib/services/uplink";
  import { disableMaxPlusAvatars } from "$lib/stores/avatarSettings";
  import { privacyConfig, loadPrivacySettings } from "$lib/stores/privacySettings";

  let firstName = "";
  let lastName = "";
  let description = "";
  let initialized = false;
  let showMenu = false;

  function openProfileAvatarPicker() {
    openSafeAvatarPicker({
      initialUid: deepAvatarUid || "",
      initialTab: deepAvatarUid ? "id" : "catalog",
      onApplySuccess: () => notify("Аватарка успешно установлена"),
    });
  }

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
  });

  export let isTab = false;
  export let onClose = null;
  $: from = $page.url.searchParams.get("from") || "/?card=settings";
  $: deepAvatarUid = $page.url.searchParams.get("avatar");
  $: if (deepAvatarUid) {
    openProfileAvatarPicker();
  }

  let loading = false;
  let avatarBusy = false;
  let avatarPreviewEl;
  let statusNotice = "";
  let noticeTimer;

  onMount(() => {
    loadPrivacySettings();
  });

  function notify(text) {
    statusNotice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      statusNotice = "";
    }, 2200);
  }

  function formatInactiveTtl(ttl) {
    const raw = String(ttl || "6M").toUpperCase();
    if (raw === "1M" || raw === "1") return "Если я не захожу 1 месяц";
    if (raw === "3M" || raw === "3") return "Если я не захожу 3 месяца";
    if (raw === "6M" || raw === "6") return "Если я не захожу 6 месяцев";
    if (raw === "1Y" || raw === "12") return "Если я не захожу 1 год";
    const m = parseInt(raw, 10);
    if (!Number.isFinite(m) || m <= 0) return "Если я не захожу 6 месяцев";
    if (m === 1) return "Если я не захожу 1 месяц";
    if (m >= 2 && m <= 4) return `Если я не захожу ${m} месяца`;
    return `Если я не захожу ${m} месяцев`;
  }

  $: selfAvatarUrl = $currentUserDetails?.baseRawUrl || $currentUserDetails?.baseUrl || null;
  $: selfPhotoId = $currentUserDetails?.photoId || null;
  $: canDeleteSelfAvatar = Boolean(selfPhotoId || selfAvatarUrl);
  $: selfSafeAvatarUid =
    !$disableMaxPlusAvatars && $currentUserDetails?.id
      ? $safeAvatarMapStore.get(Number($currentUserDetails.id)) ||
        $safeAvatarMapStore.get(String($currentUserDetails.id)) ||
        null
      : null;

  $: changed =
    firstName !== original.firstName ||
    lastName !== original.lastName ||
    description !== original.description;

  function openSelfGallery(e) {
    const highResSafeUrl = selfSafeAvatarUid ? getSafeAvatarMediaUrl(selfSafeAvatarUid) : null;
    const galleryUrl = highResSafeUrl || selfAvatarUrl;
    if (galleryUrl || $currentUserDetails?.id) {
      const targetEl = avatarPreviewEl || e?.currentTarget;
      const rect = targetEl?.getBoundingClientRect?.();
      openAvatarGallery({
        initialUrl: selfAvatarUrl || galleryUrl,
        initialPhotoId: selfPhotoId,
        fallbackUrl: selfAvatarUrl,
        targetEntityId: Number($currentUserDetails?.id || $currentUser),
        safeAvatarUid: selfSafeAvatarUid,
        userId: $currentUserDetails?.id,
        isOwnProfile: true,
        canUpload: true,
        originEl: targetEl,
        originRect: rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : null,
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
        await $API.updateProfile(firstName.trim(), lastName.trim(), description.trim());
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

  async function handleLogout() {
    const ok = await showConfirm({
      title: "Выйти из профиля?",
      message: "Вы сможете снова войти в аккаунт в любой момент.",
      confirmText: "Выйти",
      cancelText: "Отмена",
      confirmDanger: true,
    });
    if (!ok) return;
    await $API.logout();
  }

  async function handleDeleteProfile() {
    const ok = await showConfirm({
      title: "Удалить профиль?",
      message: "Ваш профиль, переписки и контакты будут безвозвратно удалены.",
      confirmText: "Удалить",
      cancelText: "Отмена",
      confirmDanger: true,
    });
    if (!ok) return;
    try {
      const res = await $API.call(199, {});
      if (res?.error) {
        notify(res.title || res.message || "Не удалось удалить профиль");
        return;
      }
      await $API.logout();
    } catch (e) {
      notify(e?.message || "Не удалось удалить профиль");
    }
  }
</script>

<SettingsPageWrapper title="" {from} {isTab} {onClose}>
  <div class="header-menu-wrap" slot="header-extra">
    <button
      type="button"
      class="header-dots-btn"
      aria-label="Меню профиля"
      on:click|stopPropagation={() => (showMenu = !showMenu)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    </button>

    {#if showMenu}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="menu-backdrop" on:click={() => (showMenu = false)}></div>
      <div class="profile-dropdown">
        <button
          type="button"
          class="dropdown-item"
          on:click={() => {
            showMenu = false;
            openProfileAvatarPicker();
          }}
        >
          Сменить аватарку
        </button>
        {#if canDeleteSelfAvatar}
          <button
            type="button"
            class="dropdown-item danger"
            on:click={() => {
              showMenu = false;
              handleDeleteAvatar();
            }}
          >
            Удалить фото
          </button>
        {/if}
        <button
          type="button"
          class="dropdown-item danger"
          on:click={() => {
            showMenu = false;
            handleLogout();
          }}
        >
          Выйти из профиля
        </button>
        <button
          type="button"
          class="dropdown-item danger"
          on:click={() => {
            showMenu = false;
            handleDeleteProfile();
          }}
        >
          Удалить профиль
        </button>
      </div>
    {/if}
  </div>

  <div class="profile-page">
    <div class="avatar-hero">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="avatar-preview-wrap" bind:this={avatarPreviewEl} on:click={openSelfGallery}>
        <Avatar size={96} isSelf={true} contactId={$currentUserDetails?.id} />
        <button
          type="button"
          class="avatar-camera-badge"
          title="Сменить фото"
          on:click|stopPropagation={openProfileAvatarPicker}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
      </div>
    </div>

    <div class="fields-stack">
      <input
        class="profile-input"
        bind:value={firstName}
        type="text"
        placeholder="Имя"
        maxlength="32"
      />
      <input
        class="profile-input"
        bind:value={lastName}
        type="text"
        placeholder="Фамилия"
        maxlength="32"
      />
      <textarea
        class="profile-textarea"
        bind:value={description}
        placeholder="О себе"
        maxlength="250"
      ></textarea>
    </div>

    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="ttl-card" on:click={() => openInactiveTtlSheet()}>
      <div class="ttl-info">
        <span class="ttl-label">Удалить профиль</span>
        <span class="ttl-value">{formatInactiveTtl($privacyConfig?.inactiveTtl)}</span>
      </div>
      <svg class="ttl-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>

    <button type="button" class="logout-card-btn" on:click={handleLogout}>
      Выйти из профиля
    </button>

    {#if statusNotice}
      <div class="notice-pill" transition:fade={{ duration: 150 }}>
        {statusNotice}
      </div>
    {/if}
  </div>

  <svelte:fragment slot="footer">
    {#if changed}
      <div class="actions-panel">
        <button class="save-btn" on:click={save} disabled={loading} transition:slide={{ duration: 180 }}>
          {loading ? "Сохранение..." : "Сохранить изменения"}
        </button>
      </div>
    {/if}
  </svelte:fragment>
</SettingsPageWrapper>

<style>
  .header-menu-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .header-dots-btn {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--settings-icon-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .header-dots-btn:hover {
    background: var(--settings-card-hover, rgba(255, 255, 255, 0.06));
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-dropdown-backdrop, 85);
  }

  .profile-dropdown {
    position: absolute;
    top: 44px;
    right: 0;
    min-width: 196px;
    background: var(--dropout-bg, #1c1e24);
    border: 1px solid var(--dropout-border, rgba(255, 255, 255, 0.08));
    border-radius: 16px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    z-index: var(--z-dropdown, 90);
  }

  .dropdown-item {
    border: none;
    background: transparent;
    color: var(--dropout-text, #ffffff);
    font-size: 15px;
    text-align: left;
    padding: 11px 12px;
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.14s;
  }

  .dropdown-item:hover {
    background: var(--dropout-item-hover, rgba(255, 255, 255, 0.08));
  }

  .dropdown-item.danger {
    color: var(--settings-danger, #ce4257);
  }

  .profile-page {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 12px 24px;
  }

  .avatar-hero {
    display: flex;
    justify-content: center;
    padding: 4px 0 10px;
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
    border: 2px solid var(--settings-bg, #0f0f12);
    background: var(--settings-accent, #007aff);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: var(--z-floating, 5);
  }

  .fields-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .profile-input,
  .profile-textarea {
    width: 100%;
    background: var(--settings-card-bg, #25262d);
    border: none;
    border-radius: var(--settings-card-radius, 16px);
    color: var(--settings-text-primary, #ffffff);
    padding: 16px;
    box-sizing: border-box;
    font-family: var(--settings-font-body, var(--font-family-base));
    font-size: 16px;
    outline: none;
  }

  .profile-input::placeholder,
  .profile-textarea::placeholder {
    color: var(--settings-text-muted, rgba(255, 255, 255, 0.52));
  }

  .profile-textarea {
    min-height: 104px;
    resize: vertical;
  }

  .ttl-card {
    background: var(--settings-card-bg, #25262d);
    border-radius: var(--settings-card-radius, 16px);
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    cursor: pointer;
    transition: background-color 0.14s;
  }

  .ttl-card:hover {
    background: var(--settings-card-elevated, #2e3038);
  }

  .ttl-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .ttl-label {
    font-size: 13px;
    color: var(--settings-text-muted, rgba(255, 255, 255, 0.52));
  }

  .ttl-value {
    font-size: 16px;
    font-weight: 500;
    color: var(--settings-text-primary, #ffffff);
  }

  .ttl-chevron {
    color: var(--settings-icon-muted);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .logout-card-btn {
    width: 100%;
    height: 54px;
    border: none;
    border-radius: var(--settings-card-radius, 16px);
    background: var(--settings-card-bg, #25262d);
    color: var(--settings-text-primary, #ffffff);
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.14s, transform 0.1s;
  }

  .logout-card-btn:hover {
    background: var(--settings-card-elevated, #2e3038);
  }

  .logout-card-btn:active {
    transform: scale(0.985);
  }

  .notice-pill {
    align-self: center;
    background: var(--settings-card-elevated, #2e3038);
    border: 1px solid var(--settings-separator);
    color: var(--settings-text-primary);
    font-size: 13px;
    padding: 8px 16px;
    border-radius: 999px;
  }

  .actions-panel {
    flex-shrink: 0;
    display: flex;
    padding: 12px 12px max(16px, calc(16px + var(--safe-bottom, 0px)));
    background: var(--settings-bg, #0f0f12);
    border-top: 1px solid var(--settings-separator);
  }

  .save-btn {
    width: 100%;
    height: 52px;
    border: none;
    border-radius: 14px;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    background: var(--settings-accent, #007aff);
    color: #ffffff;
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
