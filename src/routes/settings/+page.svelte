<script>
  import { goto } from "$app/navigation";
  import {
    openSettingsPage,
    openAvatarGallery,
    openProfileQrSheet,
    openChat,
  } from "$lib/stores/session";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import Avatar from "$components/main/Avatar.svelte";
  import SettingsSection from "$components/settings/SettingsSection.svelte";
  import SettingsRow from "$components/settings/SettingsRow.svelte";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import { openDigitalIdApp, openSferumApp } from "$lib/stores/webapp";
  import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";
  import { getSafeAvatarMediaUrl } from "$lib/services/uplink";
  import { disableMaxPlusAvatars } from "$lib/stores/avatarSettings";
  import { activeThemeId } from "$lib/stores/theme";
  import { activeStoryViewer, openStoryComposer, selfStoryPreview } from "$lib/stores/stories";
  import { showAlert } from "$lib/utils/alert";

  const pluginSettingsSections = getMountStore("settings:section");

  let contact = null;
  let phone = "";
  let rawPhone = "";
  let name = "";
  let profileNick = "";
  let selfAvatarBusy = false;
  let selfAvatarWrapEl;
  let scrollContainerEl;
  let scrollProgress = 0;

  $: selfAvatarUrl = $currentUserDetails?.baseRawUrl || $currentUserDetails?.baseUrl || null;
  $: selfPhotoId = $currentUserDetails?.photoId || null;
  $: canDeleteSelfAvatar = Boolean(selfPhotoId || selfAvatarUrl);
  $: selfSafeAvatarUid = !$disableMaxPlusAvatars
    ? ($safeAvatarMapStore.get(Number($currentUserDetails?.id)) ||
        $safeAvatarMapStore.get(String($currentUserDetails?.id)) ||
        ($currentUser
          ? $safeAvatarMapStore.get(Number($currentUser)) || $safeAvatarMapStore.get(String($currentUser))
          : null) ||
        null)
    : null;

  $: updateSelf($currentUserDetails);

  function formatPhone(raw) {
    if (!raw) return "";
    const digits = String(raw).replace(/\D/g, "");
    if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
      return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
    }
    return `+${digits}`;
  }

  function updateSelf(user) {
    if (!user || !user.names) return;
    rawPhone = user.phone ? `+${user.phone}` : "";
    phone = formatPhone(user.phone);
    name = [user.names[0]?.firstName, user.names[0]?.lastName].filter(Boolean).join(" ");
    profileNick = user.link ? `@${String(user.link).replace(/^.*\/@?/, "").replace(/^@/, "")}` : "";
    contact = user;
  }

  function openSelfAvatar(e) {
    const highResSafeUrl = selfSafeAvatarUid ? getSafeAvatarMediaUrl(selfSafeAvatarUid) : null;
    const galleryUrl = highResSafeUrl || selfAvatarUrl;
    if (galleryUrl || contact?.id) {
      const targetEl = selfAvatarWrapEl || e?.currentTarget;
      const rect = targetEl?.getBoundingClientRect?.();
      openAvatarGallery({
        initialUrl: selfAvatarUrl || galleryUrl,
        initialPhotoId: selfPhotoId,
        fallbackUrl: selfAvatarUrl,
        targetEntityId: Number($currentUserDetails?.id || $currentUser),
        safeAvatarUid: selfSafeAvatarUid,
        userId: contact?.id ?? $currentUser,
        isOwnProfile: true,
        canUpload: true,
        originEl: targetEl,
        originRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        originRadius: 50,
        onUpload: handleSelfAvatarUpload,
        onDelete: handleSelfAvatarDelete,
      });
    } else {
      handleSelfAvatarUpload();
    }
  }

  async function handleSelfAvatarUpload() {
    if (selfAvatarBusy) return null;
    selfAvatarBusy = true;
    try {
      return await $API.uploadProfilePhoto();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      selfAvatarBusy = false;
    }
  }

  async function handleSelfAvatarDelete(targetPhotoId = null, targetUrl = null) {
    if (selfAvatarBusy || !canDeleteSelfAvatar) return;
    selfAvatarBusy = true;
    try {
      await $API.deleteProfilePhoto(targetPhotoId || selfPhotoId, targetUrl || selfAvatarUrl);
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      selfAvatarBusy = false;
    }
  }

  async function copyText(text, label) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showAlert(`${label} скопирован`);
    } catch {
      showAlert(text);
    }
  }

  function openSavedMessages() {
    openChat(0);
  }

  function openMyStories() {
    const myId = Number($currentUserDetails?.id || $currentUser);
    if ($selfStoryPreview?.stories?.length && myId) {
      activeStoryViewer.set({ ownerId: myId, storyId: $selfStoryPreview.stories[0]?.id || null });
    } else {
      openStoryComposer();
    }
  }

  async function inviteFriends() {
    const rawLink = $currentUserDetails?.link;
    const shareUrl = rawLink
      ? rawLink.startsWith("http")
        ? rawLink
        : `https://max.ru/${rawLink.replace(/^@/, "")}`
      : "https://max.ru";
    const text = `Присоединяйся ко мне в MAX: ${shareUrl}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "MAX", text, url: shareUrl });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showAlert("Ссылка-приглашение скопирована");
    } catch {
      showAlert(shareUrl);
    }
  }

  function handleScroll() {
    if (!scrollContainerEl) return;
    const y = scrollContainerEl.scrollTop;
    scrollProgress = Math.max(0, Math.min(1, (y - 60) / 80));
  }
</script>

<div class="settings-root">
  <div class="settings-main-topbar" class:scrolled={scrollProgress > 0.15}>
    <button
      type="button"
      class="topbar-icon-btn"
      title="QR-код профиля"
      aria-label="QR-код профиля"
      on:click={() => openProfileQrSheet()}
    >
      <img src="/icons/qr.svg" alt="QR" class="topbar-icon-img" />
    </button>

    <div class="topbar-title" style="opacity: {scrollProgress};">
      Настройки
    </div>

    <button
      type="button"
      class="topbar-icon-btn"
      title="Редактировать профиль"
      aria-label="Редактировать профиль"
      on:click={() => openSettingsPage("profile")}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    </button>
  </div>

  <div class="settings-scroll" bind:this={scrollContainerEl} on:scroll={handleScroll}>
    <div class="settings-hero" style="opacity: {1 - scrollProgress * 0.6};">
      <div class="self-avatar-wrap" bind:this={selfAvatarWrapEl}>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="self-avatar-clickable" on:click={openSelfAvatar}>
          <Avatar size={96} isSelf={true} contactId={contact?.id} />
        </div>
      </div>

      <div class="hero-name">{name || "Загрузка..."}</div>

      {#if phone || profileNick}
        <div class="hero-meta">
          {#if phone}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="hero-meta-link" on:click={() => copyText(rawPhone || phone, "Номер телефона")}>
              {phone}
            </span>
          {/if}
          {#if phone && profileNick}
            <span class="hero-meta-dot">·</span>
          {/if}
          {#if profileNick}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <span class="hero-meta-link" on:click={() => copyText(profileNick, "Никнейм")}>
              {profileNick}
            </span>
          {/if}
        </div>
      {/if}
    </div>

    <div class="settings-sections">
      <SettingsSection>
        <SettingsRow icon="bot.svg" noIconInvert={true} title="Войти в Сферум" on:click={() => openSferumApp()} />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon="link.svg" title="Пригласить друзей" accent={true} chevron={false} on:click={inviteFriends} />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon="bell.svg" title="Уведомления и звук" on:click={() => openSettingsPage("notifications")} />
        <SettingsRow icon="lock.svg" title="Безопасность" on:click={() => openSettingsPage("privacy")} />
        <SettingsRow icon="devices.png" title="Устройства" on:click={() => openSettingsPage("sessions")} />
        <SettingsRow icon="chats.svg" title="Сообщения" on:click={() => openSettingsPage("messages")} />
        <SettingsRow icon="contacts.svg" title="Контакты" on:click={() => openSettingsPage("contacts")} />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon="bookmark.svg" title="Избранное" on:click={openSavedMessages} />
        <SettingsRow icon="camera.svg" title="Мои истории" on:click={openMyStories} />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon="folder.svg" title="Папки с чатами" on:click={() => openSettingsPage("folders")} />
        <SettingsRow
          title="Оформление"
          value={$activeThemeId === "dark" ? "Тёмная" : "Светлая"}
          on:click={() => openSettingsPage("appearance")}
        >
          <svg slot="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
          </svg>
        </SettingsRow>
        <SettingsRow icon="gallery.svg" title="Медиа и память" on:click={() => openSettingsPage("media")} />
        <SettingsRow title="Энергосбережение" on:click={() => openSettingsPage("battery")}>
          <svg slot="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="18" height="10" rx="2" ry="2" />
            <line x1="22" y1="11" x2="22" y2="13" />
            <line x1="6" y1="10" x2="6" y2="14" />
            <line x1="10" y1="10" x2="10" y2="14" />
          </svg>
        </SettingsRow>
        <SettingsRow title="Язык" value="Русский" on:click={() => openSettingsPage("language")}>
          <svg slot="icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection>
        <SettingsRow icon="digital_id.svg" title="Цифровой ID" on:click={() => openDigitalIdApp()} />
        <SettingsRow icon="about.svg" title="О приложении" on:click={() => openSettingsPage("about")} />
        <SettingsRow icon="logout.svg" title="Сменить аккаунт" on:click={() => goto("/auth/select?from=account")} />
      </SettingsSection>

      <SettingsSection title="Продвинутые настройки">
        <SettingsRow icon="crypto.svg" title="Блокировка приложения" on:click={() => openSettingsPage("lock")} />
        <SettingsRow icon="phone.svg" title="Плагины" on:click={() => openSettingsPage("plugins")} />
        <SettingsRow icon="params.svg" title="Расширенные настройки" on:click={() => openSettingsPage("advanced")} />
        <SettingsRow icon="logs.svg" title="Сетевые логи" on:click={() => openSettingsPage("logs")} />
      </SettingsSection>

      {#each $pluginSettingsSections as item (item.id)}
        <div class="plugin-settings-section" data-plugin-mount={item.pluginId || item.id}>
          {@html item.html}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .settings-root {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--settings-bg, #0f0f12);
    color: var(--settings-text-primary, #ffffff);
    font-family: var(--settings-font-body, var(--font-family-base));
    overflow: hidden;
  }

  .settings-main-topbar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: calc(var(--settings-topbar-height, 56px) + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0;
    background-color: var(--settings-topbar-bg, #0f0f12);
    border-bottom: 1px solid transparent;
    transition: border-color 0.2s ease;
    flex-shrink: 0;
    z-index: var(--z-header, 4);
  }

  .settings-main-topbar.scrolled {
    border-bottom-color: var(--settings-separator, rgba(255, 255, 255, 0.09));
  }

  .topbar-icon-btn {
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
    transition: background-color 0.15s ease, transform 0.12s ease;
    flex-shrink: 0;
  }

  .topbar-icon-btn:hover {
    background-color: var(--settings-card-hover, rgba(255, 255, 255, 0.06));
  }

  .topbar-icon-btn:active {
    transform: scale(0.92);
  }

  .topbar-icon-img {
    width: 22px;
    height: 22px;
    object-fit: contain;
    filter: brightness(0) invert(var(--icon-invert, 1));
  }

  .topbar-title {
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 18px;
    font-weight: 600;
    color: var(--settings-text-primary, #ffffff);
    transition: opacity 0.12s linear;
    pointer-events: none;
  }

  .settings-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: max(28px, calc(24px + var(--safe-bottom, 0px)));
  }

  .settings-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 20px 24px;
    text-align: center;
  }

  .self-avatar-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 12px;
  }

  .self-avatar-clickable {
    cursor: pointer;
    transition: transform 0.14s ease;
  }

  .self-avatar-clickable:active {
    transform: scale(0.96);
  }

  .hero-name {
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 22px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--settings-text-primary, #ffffff);
    margin-bottom: 6px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hero-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 14px;
    line-height: 1.3;
  }

  .hero-meta-link {
    color: var(--settings-accent, #007aff);
    cursor: pointer;
    transition: opacity 0.14s;
  }

  .hero-meta-link:hover {
    opacity: 0.8;
  }

  .hero-meta-dot {
    color: var(--settings-text-secondary, rgba(255, 255, 255, 0.68));
  }

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 0 12px;
  }

  .plugin-settings-section {
    width: 100%;
  }
</style>
