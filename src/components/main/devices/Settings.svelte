<script>
  import { save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";

  import { set as sessionSet } from "$lib/stores/session";
  import { generateDevice } from "$lib/utils/device";
  import { getCurrentAccount, setAccountMeta } from "$lib/stores/accounts";
  import { activeThemeId } from "$lib/stores/theme";
  import API from "$lib/stores/api";

  let glow = false;
  let currentDev = null;
  let currentAccId = null;
  let telemetryMode = "fake";
  let isExporting = false;
  let isImporting = false;

  onMount(async () => {
    glow = true;
    const acc = await getCurrentAccount().catch(() => null);
    if (acc?.id) {
      currentAccId = acc.id;
      telemetryMode = acc.meta?.telemetry || (acc.meta?.sendTelemetry === false ? "disabled" : "fake");
    }
    const device = await getDevice();
    if (device) await update(device, false);
    else await rerollDevice();
    setTimeout(() => {
      glow = false;
    }, 2000);
  });

  const getDevice = () => invoke("common_store_load", { store: "device" });
  const saveDevice = device => invoke("common_store_save", { store: "device", data: device });
  const readFile = path => invoke("read_file", { path });
  const writeFile = (path, content) => invoke("write_file_string", { path, content });

  function update(device, animate = false) {
    currentDev = device;
    sessionSet("device", device);
    const { deviceId, mtInstance, userAgent } = device;
    setValue('deviceId', deviceId, animate);
    setValue('mtInstance', mtInstance, animate);
    Object.keys(userAgent).forEach(k => setValue(k, userAgent[k], animate));
  }

  async function toggleTelemetry() {
    telemetryMode = telemetryMode === "disabled" ? "fake" : "disabled";
    if (currentAccId) {
      await setAccountMeta(currentAccId, "telemetry", telemetryMode);
    }
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const setValue = async (key, value, animate) => {
    const element = document.getElementById(key);
    if (!element) return;

    if (!animate) {
      element.innerHTML = value;
      return;
    }

    const target = String(value ?? "");
    const current = String(element.innerHTML ?? "");

    for (let i = current.length; i >= 0; i--) {
      element.innerHTML = current.slice(0, i);
      await sleep(5);
    }

    await sleep(40);

    let out = "";
    for (let i = 0; i < target.length; i++) {
      out += target[i];
      element.innerHTML = out;
      await sleep(5);
    }
  };

  const systemFields = [
    ["Тип устройства", "deviceType"],
    ["Название устройства", "deviceName"],
    ["Версия приложения", "appVersion"],
    ["Версия сборки", "buildNumber"],
    ["Версия OS", "osVersion"],
    ["Архитектура", "arch"],
    ["Размер экрана", "screen"],
    ["Часовой пояс", "timezone"],
  ];

  const localeFields = [
    ["Язык", "locale"],
    ["Язык устройства", "deviceLocale"],
  ];

  const identifierFields = [
    ["deviceId", "deviceId"],
    ["mt_instanceid", "mtInstance"],
    ["Release", "release"],
    ["Тип уведомлений", "pushDeviceType"],
    ["User-Agent", "headerUserAgent"],
  ];

  async function exportDevice() {
    if (isExporting) return;
    isExporting = true;
    try {
      let device = currentDev || (await getDevice().catch(() => null)) || sessionGet("device");
      if (!device || !device.deviceId) {
        device = generateDevice();
        sessionSet("device", device);
        await saveDevice(device);
        update(device, false);
      }

      const dataToSave = {
        version: 1,
        type: "device",
        ...device
      };

      const path = await save({
        defaultPath: "device.json",
        filters: [
          {
            name: "Конфиг девайса (.json)",
            extensions: ["json"],
          },
        ],
      });

      if (!path) return;

      const json = JSON.stringify(dataToSave, null, 2);
      await invoke("write_file_string", { path, content: json });
    } catch (e) {
      console.error(e);
    } finally {
      isExporting = false;
    }
  }

  async function importDevice() {
    if (isImporting) return;
    isImporting = true;

    try {
      const select = await invoke("pick", { type: "JSON" }).catch(() => null);
      if (!select?.uri) return;

      const data = await invoke("read_file", { path: select.uri });
      const text = new TextDecoder().decode(new Uint8Array(data));

      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        return alert("JSON-файл содержит ошибки!");
      }

      if (!json.version || json.type !== "device") {
        return alert("Неверный файл — это не конфиг девайса!");
      }

      if (json.version === 1) {
        const { version, type, ...cut } = json;
        sessionSet("device", cut);
        await saveDevice(cut);
        if (currentAccId) {
          await setAccountMeta(currentAccId, "device", cut).catch(() => null);
        }
        update(cut, true);
      } else {
        return alert("Это конфиг для более новой версии Max+!");
      }
    } catch (e) {
      console.error(e);
    } finally {
      isImporting = false;
    }
  }

  async function rerollDevice() {
    const device = generateDevice();
    sessionSet("device", device);
    await saveDevice(device);
    update(device, true);
  }

  function close() {
    sessionSet("devicesPage", false);
  }
</script>

<div
  class="overlay"
  class:dark-theme={$activeThemeId === "dark"}
  in:fade={{ duration: 120 }}
  out:fade={{ duration: 120 }}
  on:click={e => { if (!e.target.closest(".modal")) close(); }}
>
  <div class="modal">
    <header class="modal-header">
      <div class="header-main">
        <h2 class="title">Устройство</h2>
        <button class="close-btn" on:click={close} aria-label="Закрыть">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div class="action-toolbar">
        <button class="action-btn" on:click={rerollDevice}>
          <img src="/icons/reload.svg" alt="" class="action-icon" />
          <span>Случайное</span>
        </button>

        <button class="action-btn" on:click={exportDevice}>
          <img src="/icons/export.svg" alt="" class="action-icon" />
          <span>Экспорт</span>
        </button>

        <button class="action-btn" on:click={importDevice}>
          <img src="/icons/import.svg" alt="" class="action-icon" />
          <span>Импорт</span>
        </button>
      </div>
    </header>

    <div class="modal-body">
      <div class="card-group">
        <div class="item-row clickable" on:click={toggleTelemetry}>
          <div class="label">Телеметрия</div>
          <div class="telemetry-wrapper">
            <span class="telemetry-badge" class:enabled={telemetryMode !== "disabled"}>
              {telemetryMode === "disabled" ? "Отключена" : telemetryMode === "fake" ? "Фейковая" : "Включена"}
            </span>
            <div class="toggle-track" class:active={telemetryMode !== "disabled"}>
              <div class="toggle-thumb" class:active={telemetryMode !== "disabled"}></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card-group">
        <div class="group-title">Параметры системы</div>
        {#each systemFields as [label, id]}
          <div class="item-row">
            <div class="label">{label}</div>
            <div id={id} class="value" class:glow={glow}></div>
          </div>
        {/each}
      </div>

      <div class="card-group">
        <div class="group-title">Локализация</div>
        {#each localeFields as [label, id]}
          <div class="item-row">
            <div class="label">{label}</div>
            <div id={id} class="value" class:glow={glow}></div>
          </div>
        {/each}
      </div>

      <div class="card-group">
        <div class="group-title">Идентификаторы</div>
        {#each identifierFields as [label, id]}
          <div class="item-row">
            <div class="label">{label}</div>
            <div id={id} class="value monospace" class:glow={glow}></div>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: center;
    align-items: flex-end;
    z-index: 1000;
  }

  .modal {
    width: min(440px, 100%);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: #f4f5f8;
    color: #000000;
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -4px 32px rgba(0, 0, 0, 0.16);
    overflow: hidden;
    box-sizing: border-box;
    padding-bottom: max(16px, var(--safe-bottom, 0px));
  }

  .modal-header {
    background: #ffffff;
    padding: 16px 20px 14px 20px;
    border-bottom: 1px solid #e5e5ea;
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex-shrink: 0;
  }

  .header-main {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title {
    margin: 0;
    font-size: 19px;
    font-weight: 700;
    color: #000000;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eff0f4;
    border: none;
    border-radius: 50%;
    color: #8e8e93;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .close-btn:hover {
    background: #e5e5ea;
    color: #000000;
  }

  .action-toolbar {
    display: flex;
    gap: 8px;
  }

  .action-btn {
    flex: 1;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: #eff0f4;
    border: none;
    border-radius: 10px;
    color: #000000;
    font-size: 13.5px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.15s ease, transform 0.1s ease;
  }

  .action-btn:active {
    transform: scale(0.97);
  }

  .action-btn:hover {
    background: #e5e5ea;
  }

  .action-icon {
    width: 16px;
    height: 16px;
    filter: brightness(0);
    opacity: 0.8;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 0;
  }

  .card-group {
    background: #ffffff;
    border-radius: 16px;
    padding: 2px 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .group-title {
    font-size: 12px;
    font-weight: 600;
    color: #8e8e93;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 10px 0 4px 0;
  }

  .item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 0;
    border-bottom: 1px solid #f0f1f4;
    gap: 12px;
  }

  .item-row:last-child {
    border-bottom: none;
  }

  .item-row.clickable {
    cursor: pointer;
    user-select: none;
  }

  .label {
    font-size: 14px;
    font-weight: 500;
    color: #8e8e93;
    flex-shrink: 0;
  }

  .value {
    flex: 1;
    text-align: right;
    font-size: 14px;
    font-weight: 500;
    color: #000000;
    overflow-wrap: anywhere;
    transition: color 0.4s ease;
  }

  .value.monospace {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12.5px;
    letter-spacing: -0.2px;
  }

  .value.glow {
    color: #007aff;
  }

  .telemetry-wrapper {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .telemetry-badge {
    font-size: 12.5px;
    font-weight: 600;
    color: #ff3b30;
  }

  .telemetry-badge.enabled {
    color: #34c759;
  }

  .toggle-track {
    width: 44px;
    height: 24px;
    background: #e5e5ea;
    border-radius: 12px;
    position: relative;
    transition: background-color 0.2s ease;
    flex-shrink: 0;
  }

  .toggle-track.active {
    background: #007aff;
  }

  .toggle-thumb {
    width: 20px;
    height: 20px;
    background: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toggle-thumb.active {
    transform: translateX(20px);
  }

  .overlay.dark-theme .modal {
    background: #17181c;
    color: #ffffff;
  }

  .overlay.dark-theme .modal-header {
    background: #1e1f24;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .overlay.dark-theme .title {
    color: #ffffff;
  }

  .overlay.dark-theme .close-btn {
    background: #26262e;
    color: #8b929e;
  }

  .overlay.dark-theme .close-btn:hover {
    background: #32323d;
    color: #ffffff;
  }

  .overlay.dark-theme .action-btn {
    background: #26262e;
    color: #ffffff;
  }

  .overlay.dark-theme .action-btn:hover {
    background: #32323d;
  }

  .overlay.dark-theme .action-icon {
    filter: none;
    opacity: 0.9;
  }

  .overlay.dark-theme .card-group {
    background: #1e1f24;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .overlay.dark-theme .item-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .overlay.dark-theme .label {
    color: #8b929e;
  }

  .overlay.dark-theme .value {
    color: #ffffff;
  }

  .overlay.dark-theme .toggle-track {
    background: #3a3a3c;
  }

  .overlay.dark-theme .toggle-track.active {
    background: #248bfe;
  }
</style>
