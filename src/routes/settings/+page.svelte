<script>
  import { Toggle } from "$components/ui";
import { goto } from "$app/navigation";
  import {
    onMount,
    onDestroy
  } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import {
    platform as getPlatform
  } from "@tauri-apps/plugin-os";
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import {
    open
  } from "@tauri-apps/plugin-dialog";
  import {
    scan,
    cancel,
    Format,
    checkPermissions,
    requestPermissions,
    openAppSettings,
  } from "@tauri-apps/plugin-barcode-scanner";

  import { set as sessionSet, openSettingsPage, openAvatarGallery } from "$lib/stores/session";
  import { currentUserDetails } from "$lib/stores/api";
  import Avatar from "$components/main/Avatar.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { openDigitalIdApp, openSferumApp } from "$lib/stores/webapp.js";

  let platform;

  let contact;
  let phone;
  let name;
  let selfAvatarBusy = false;
  let selfAvatarWrapEl;

  $: selfAvatarUrl = $currentUserDetails?.baseRawUrl || $currentUserDetails?.avatar || $currentUserDetails?.baseUrl || null;
  $: selfPhotoId = $currentUserDetails?.photoId || null;
  $: canDeleteSelfAvatar = Boolean(selfPhotoId || selfAvatarUrl);

  function openSelfAvatar(e) {
    if (selfAvatarUrl || contact?.id) {
      const targetEl = selfAvatarWrapEl || e?.currentTarget;
      const rect = targetEl?.getBoundingClientRect?.();
      openAvatarGallery({
        initialUrl: selfAvatarUrl,
        initialPhotoId: selfPhotoId,
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

  let closeScanner = null;
  let unregisterScanner = null;

  onDestroy(() => {
    if (unregisterScanner) unregisterScanner();
  });

  currentUserDetails.subscribe(updateSelf);

  function updateSelf(user) {
    if (!user || !user.names) return;
    phone = user.phone
      ? "+ " +
        user.phone.toString()[0] +
        " " +
        user.phone.toString().slice(1, 4) +
        " *** ** " +
        user.phone.toString().slice(-2, user.phone.toString().length)
      : "";
    name = user.names[0].firstName + " " + user.names[0].lastName;
    contact = user;
  }

  $: buttons = [
    [
      {
        icon: "profile.svg",
        text: "Настроить профиль",
        action: () => openSettingsPage("profile"),
      },
      {
        icon: "bell.svg",
        text: "Уведомления",
        action: () => openSettingsPage("notifications"),
      },
      {
        icon: "crypto.svg",
        text: "Защита пин-кодом",
        action: () => openSettingsPage("lock"),
      },
      {
        icon: "book.svg",
        text: "Словарь шифрования",
        action: () => openSettingsPage("dictionary"),
      },
    ],
    [
      {
        icon: "digital_id.svg",
        text: "Цифровой ID",
        action: () => openDigitalIdApp(),
      },
      {
        icon: "bot.svg",
        text: "Войти в Сферум",
        action: () => openSferumApp(),
      },
    ],
    [
      {
        icon: "logs.svg",
        text: "Сетевые логи",
        action: () => openSettingsPage("logs"),
      },
      {
        icon: "debug.svg",
        text: "Настройки отладки",
        action: () => sessionSet("devSettings", true),
      },
      {
        icon: "about.svg",
        text: "О приложении",
        action: () => openSettingsPage("about"),
      },
    ],
    [
      {
        icon: "phone.svg",
        text: "Плагины",
        action: () => openSettingsPage("plugins"),
      },
      {
        icon: "params.svg",
        text: "Расширенные настройки",
        action: () => openSettingsPage("advanced"),
      },
    ],
    [
      {
        icon: "devices.png",
        text: "Активные сессии",
        action: () => openSettingsPage("sessions"),
      },
      {
        icon: "logout.svg",
        text: "Сменить аккаунт",
        action: () => goto("/auth/select")
      },
    ],
  ];

  function clearAllKeys() {
    clearKeys();
  }

  async function readQRCode(filePath) {
    let url = "";
    try {
      const cleanPath = filePath.replace(/^file:\/\//, "");
      try {
        url = convertFileSrc(cleanPath);
      } catch {
        const bytes = await invoke("read_file", { path: cleanPath });
        const blob = new Blob([new Uint8Array(bytes)]);
        url = URL.createObjectURL(blob);
      }

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);

      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        try {
          const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          const barcodes = await detector.detect(canvas);
          if (barcodes?.length > 0 && barcodes[0].rawValue) {
            return barcodes[0].rawValue;
          }
        } catch {}
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { default: jsQR } = await import("jsqr");
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      return code?.data || null;
    } finally {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    }
  }

  async function scanner() {
    let content = "";

    if (/android|ios/.test(platform)) {
      let cameraAllowed = await checkPermissions();

      if (cameraAllowed.includes("prompt")) await requestPermissions();
      else if (cameraAllowed === "denied") {
        alert(
          "Для сканирования QR нужно разрешение камеры." +
            "\nА зачем ещё вы это используете?",
        );
        await openAppSettings();
      }

      if ((await checkPermissions()) !== "granted") return;

      closeScanner = () => cancel();
      unregisterScanner = registerBackHandler(() => {
        if (closeScanner) closeScanner();
      });
      let scanned;
      try {
        scanned = await scan({ formats: [Format.QRCode] });
      } finally {
        closeScanner = null;
        if (unregisterScanner) {
          unregisterScanner();
          unregisterScanner = null;
        }
      }
      if (!scanned?.content) return;
      content = scanned.content;
    } else {
      const image = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Изображения",
            extensions: ["png", "jpeg", "jpg"],
          },
        ],
      });

      if (!image) return;

      const data = await readQRCode(image);

      if (!data) return alert("QR-код не найден!");

      content = data;
    }

    if (content.includes(":auth")) {
      $API.call(1, { interactive: true });
      $API.call(96, {});
      const response = await $API.call(290, { qrLink: content });
      if (response.error) alert(response.title);
    } else alert(content);
  }

  onMount(async () => {
    platform = await getPlatform();
  });
</script>

<div class="settings">
  <header class="settings-head">
    <h1>Настройки</h1>
    <button class="head-btn" aria-label="Сканировать QR-код" on:click={scanner}>
      <img src={"icons/qr.svg"} class="icon" alt="" />
    </button>
  </header>

  <div class="profile-row" on:click={(e) => buttons.flat().find((b) => b.icon === "profile.svg")?.action?.(e)}>
    <div class="self-avatar-wrap" bind:this={selfAvatarWrapEl} on:click|stopPropagation={openSelfAvatar}>
      <Avatar size={64} isSelf={true} contactId={contact?.id}/>
    </div>
    <div class="profile-text">
      <span class="name">{name}</span>
      <span class="phone">{phone}</span>
    </div>
    <svg class="chevron" width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true">
      <path d="M1.5 1.5L8.5 9l-7 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>

  <div class="buttons">
    {#each buttons as group}
      <div class="group">
        {#each group as btn}
          <div on:click={btn.action} class="button">
            <img src={"icons/" + btn.icon} class="icon" alt="" />
            <span class="label">{btn.text}</span>
            {#if btn.isToggle}
              <Toggle readonly checked={btn.toggleValue} />
            {:else}
              <svg class="chevron" width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true">
                <path d="M1.5 1.5L8.5 9l-7 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .settings {
    --s-text: var(--max-text, #060708);
    --s-muted: var(--max-text-3, #7a7d82);
    --s-chevron: #b0b3b8;
    --s-divider: rgba(0, 0, 0, 0.1);
    position: relative;
    box-sizing: border-box;
    width: 100%;
    flex-grow: 1;
    min-height: 0;
    overflow-y: auto;
    padding: env(safe-area-inset-top, 0px) 0 calc(90px + env(safe-area-inset-bottom));
    background: var(--max-surface, #fff);
    color: var(--s-text);
  }
  /* Иконки в static/icons нарисованы белым: на светлом фоне делаем их чёрными */
  .settings { --s-icon-filter: brightness(0); }
  @media (prefers-color-scheme: dark) {
    .settings { --s-divider: rgba(255, 255, 255, 0.12); --s-chevron: #6b6e73; --s-icon-filter: none; }
  }
  .settings .icon { filter: var(--s-icon-filter); }

  .settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 6px;
  }
  .settings-head h1 {
    margin: 0;
    font-size: 26px;
    line-height: 32px;
    font-weight: 700;
    color: var(--s-text);
  }
  .head-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }
  .head-btn .icon { width: 24px; height: 24px; object-fit: contain; }

  .profile-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px 12px 16px;
    cursor: pointer;
  }
  .self-avatar-wrap {
    flex: 0 0 auto;
    cursor: pointer;
    transition: transform 0.14s;
  }
  .self-avatar-wrap:active { transform: scale(0.96); }
  .profile-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .profile-text .name {
    font-size: 18px;
    line-height: 24px;
    font-weight: 600;
    color: var(--s-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .profile-text .phone {
    font-size: 15px;
    line-height: 20px;
    color: var(--s-muted);
  }

  .chevron {
    flex: 0 0 auto;
    margin-left: auto;
    color: var(--s-chevron);
  }

  .buttons {
    display: flex;
    flex-direction: column;
  }
  .buttons .group {
    position: relative;
    padding: 4px 0;
  }
  .buttons .group::before {
    content: "";
    position: absolute;
    top: 0;
    left: 16px;
    right: 16px;
    height: 1px;
    background: var(--s-divider);
  }
  .buttons .group .button {
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 52px;
    padding: 4px 16px 4px 20px;
    cursor: pointer;
  }
  .buttons .group .button:active { background: rgba(0, 0, 0, 0.04); }
  .buttons .group .icon {
    flex: 0 0 24px;
    width: 24px;
    height: 24px;
    object-fit: contain;
    display: block;
  }
  .buttons .group .label {
    flex: 1;
    min-width: 0;
    font-size: 17px;
    line-height: 22px;
    font-weight: 500;
    color: var(--s-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

