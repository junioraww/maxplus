<script>
import { goto } from "$app/navigation";
  import {
    getContext,
    onMount,
    onDestroy
  } from "svelte";

  import {
    platform as getPlatform
  } from "@tauri-apps/plugin-os";
  /*import {
    readFile
  } from "@tauri-apps/plugin-fs";*/
  import { invoke } from "@tauri-apps/api/core";
  import {
    open
  } from "@tauri-apps/plugin-dialog";
  import jsQR from "jsqr";
  import {
    scan,
    Format,
    cancel,
    checkPermissions,
    requestPermissions,
    openAppSettings,
  } from "@tauri-apps/plugin-barcode-scanner";

  import { set as sessionSet } from "$lib/stores/session";
  import { currentUserDetails } from "$lib/stores/api";
  import Avatar from "$components/main/Avatar.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { clientNotificationsEnabled, toggleClientNotifications } from "$lib/utils/notifications";
  import { openDigitalIdApp, openSferumApp } from "$lib/stores/webapp.js";

  let platform;

  let contact;
  let phone;
  let name;

  // android qr scanner fix
  let closeScanner = null;

  const onBack = getContext("onBack");

  onBack["settings"] = () => {
    if (closeScanner) closeScanner();
    else {}
  }

  onDestroy(() => {
    delete onBack["settings"];
  })

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

  const buttons = [
    [
      {
        icon: "profile.svg",
        text: "Настроить профиль",
        action: () => goto("/settings/profile?from=/?card=settings"),
      },
      {
        icon: "bell.svg",
        text: "Уведомления",
        action: () => goto("/settings/notifications?from=/?card=settings"),
      },
      {
        icon: "crypto.svg",
        text: "Защита пин-кодом",
        action: () => goto("/settings/lock?from=/?card=settings"),
      },
      {
        icon: "book.svg",
        text: "Словарь шифрования",
        action: () => goto("/settings/e2e/dictionary?from=/?card=settings"),
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
        action: () => goto("/settings/logs?from=/?card=settings"),
      },
      {
        icon: "debug.svg",
        text: "Настройки отладки",
        action: () => sessionSet("devSettings", true),
      },
      {
        icon: "about.svg",
        text: "О приложении",
        action: () => goto("/settings/about?from=/?card=settings"),
      },
    ],
    [
      {
        icon: "devices.png",
        text: "Активные сессии",
        action: () => goto("/settings/sessions?from=/?card=settings"),
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

      closeScanner = cancel();
      const scanned = await scan({
        formats: [Format.QRCode]
      });

      try {
        if (!scanned.content) return;
        content = scanned.content;
      } catch (e) {
        console.error(e);
      }
    } else {
      // TODO для мобильных: возможность выбрать фото
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
      $API.call(1, { interactive: true }); // ping
      $API.call(96, {}); // get smth
      const response = await $API.call(290, { qrLink: content });
      if (response.error) alert(response.title);
    } else alert(content);
  }

  async function readQRCode(filePath) {
    console.log(filePath);
    const data = await invoke("read_file", { path: filePath });
    console.log(data);
    const blob = new Blob([new Uint8Array(data)], { type: "image/png" });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.src = url;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    return code?.data || null;
  }

  onMount(async () => {
    platform = await getPlatform();
  });
</script>

<div class="settings">
  <img on:click={scanner} src={"icons/qr.svg"} class="scanner-icon icon" />

  <div class="info">
    <Avatar size={85} contactId={contact?.id}/>
    <a class="name">{name}</a>
    <a class="phone">{phone}</a>
  </div>

  <div class="buttons">
    {#each buttons as group}
      <div class="group">
        {#each group as btn}
          <div on:click={btn.action} class="button">
            <img src={"icons/" + btn.icon} class="icon" />
            <a>{btn.text}</a>
            {#if btn.isToggle}
              <div class="toggle-track" class:active={$clientNotificationsEnabled}>
                <div class="toggle-thumb" class:active={$clientNotificationsEnabled}></div>
              </div>
            {:else}
              <svg
                width="40"
                height="20"
                viewBox="0 0 40 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <polyline
                  points="30,3 38,10 30,17"
                  stroke="#999"
                  fill="none"
                  stroke-width="3"
                />
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
    position: relative;
    width: 100vw;
    color: #bbb;
    overflow-y: auto;
    flex-grow: 1;
    min-height: 0;
  }

  .info {
    margin-top: 20px;
    top: 0;
    width: 100vw;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .info .name {
    margin-top: 15px;
    font-size: 20px;
    font-weight: 800;
    color: #bbb;
  }

  .info .phone {
    color: #3ff;
    font-size: 13px;
  }

  .buttons {
    margin: 20px 10px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    font-size: 14px;
  }

  .buttons .group {
    background-color: #26262e;
    border-radius: 15px;
  }

  .buttons .group .button {
    padding: 12px 15px;
    display: flex;
    flex-direction: row;
    cursor: pointer;
    align-items: center;
  }

  .buttons .group .icon {
    width: 24px;
    height: 24px;
    margin-right: 15px;
    object-fit: contain;
    display: block;
    flex-shrink: 0;
  }

  .buttons .group .button a {
    line-height: 1;
    letter-spacing: 0.5px;
  }

  .buttons .group .button svg {
    margin-left: auto;
  }

  .scanner-icon {
    position: absolute;
    width: 45px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.1s;
  }

  .scanner-icon:hover {
    opacity: 1;
  }

  .toggle-track {
    margin-left: auto;
    width: 44px;
    height: 24px;
    background: #3a3a3c;
    border-radius: 12px;
    position: relative;
    transition: background-color 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-track.active {
    background: #248bfe;
  }

  .toggle-thumb {
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toggle-thumb.active {
    transform: translateX(20px);
  }
</style>
