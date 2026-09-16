<script>
  import { save } from "@tauri-apps/plugin-dialog";
  import { join, appDataDir } from '@tauri-apps/api/path';
  import { invoke } from "@tauri-apps/api/core";
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";

  import { set as sessionSet } from "$lib/stores/session";
  import { generateDevice } from "$lib/utils/device";
  import API from "$lib/stores/api";

  let glow = false;

  onMount(async () => {
    glow = true;
    const device = await getDevice();
    if (device) await update(device, false);
    else await rerollDevice();
    setTimeout(() => {
      glow = false;
    }, 2000);
  });

  const getDevice = () => invoke("get_device");
  const saveDevice = device => invoke("save_device", { device });
  const readFile = path => invoke("read_file", { path });
  const writeFile = (path, content) => invoke("write_file_string", { path, content });

  function update(device, animate = false) {
    console.log('Device', device);
    sessionSet("device", device);
    const { deviceId, mtInstance, userAgent } = device;
    setValue('deviceId', deviceId, animate);
    setValue('mtInstance', mtInstance, animate);
    Object.keys(userAgent).forEach(k => setValue(k, userAgent[k], animate));
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
  }

  const fields = [
    ["Тип устройства", "deviceType"],
    ["Версия приложения", "appVersion"],
    ["Версия OS", "osVersion"],
    ["Часовой пояс", "timezone"],
    ["Размер экрана", "screen"],
    ["Архитектура", "arch"],
    ["Язык", "locale"],
    ["Версия сборки", "buildNumber"],
    ["Название устройства", "deviceName"],
    ["Язык устройства", "deviceLocale"],
    ["Release", "release"],
    ["User-Agent", "headerUserAgent"],
    ["Тип уведомлений", "pushDeviceType"],
    ["deviceId", "deviceId"],
    ["mt_instanceid", "mtInstance"]
  ];

  async function exportDevice() {
    const device = await getDevice();

    if (!device.deviceId) return alert("Текущий конфиг сломан!");

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
    await writeFile(path, json);
  }

  async function importDevice() {
    const select = await invoke("pick", { type: "JSON" })

    if (!select) return;

    console.log('Reading file:', select);
    const data = await readFile(select.uri);
    const text = new TextDecoder("utf-8").decode(data);

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return alert("JSON-файл содержит ошибки!")
    }

    if (!json.version || json.type !== "device") return alert("Неверный файл - это не конфиг девайса!");

    if (json.version === 1) {
      const { version, type, ...cut } = json;
      sessionSet("device", cut);
      await saveDevice(cut);
      update(cut, true);
    } else {
      return alert("Это конфиг для более новой версии Max+!")
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
  in:fade={{ duration: 100 }}
  out:fade={{ duration: 100 }}
  on:click={e => { if (!e.target.closest(".modal")) close(); }}
>
  <div class="modal">
    <div class="header">
      <div class="title">Устройство</div>

      <div class="buttons">
        <button class="reroll" on:click={rerollDevice}>
          <img src="/icons/reload.svg">
        </button>
        <button class="export" on:click={exportDevice}>
          <img src="/icons/export.svg">
        </button>
        <button class="import" on:click={importDevice}>
          <img src="/icons/import.svg">
        </button>
        <button class="close" on:click={close}>
          ✕
        </button>
      </div>
    </div>

    <div class="list">
      {#each fields as [label, id]}
        <div class="row">
          <div class="label">{label}</div>

          <div
            id={id}
            class="value"
            class:glow={glow}
          ></div>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);

    display: flex;
    justify-content: center;
    align-items: center;

    z-index: 200;
  }

  .modal {
    width: min(420px, 100%);
    max-width: 95%;
    max-height: 80vh;
    overflow-y: auto;

    background: #1f1f23;
    border-radius: 14px 14px 0 0;

    margin-top: auto;
    padding: 0 20px 20px 20px;
    color: white;
  }

  @media(max-height: 600px) {
    .modal {
      max-height: 100vh;
      border-radius: 0;
    }
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    position: sticky;
    top: 0;
    padding: 14px 0;
    background: #1f1f23;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
  }

  .buttons {
    display: flex;
    gap: 5px;
    justify-content: center;
  }

  .buttons button {
    width: 32px;
    height: 32px;
    border: none;
    padding: 8px;

    background: transparent;
    color: #aaa;
    font-size: 20px;

    display: flex;
    align-items: center;
    justify-content: center;

    transition: color 0.1s;
  }

  .buttons img {
    height: 18px;
    opacity: 0.7;
    padding: 8px;
  }

  .buttons .import {
    position: relative;
    top: 1px;
  }

  .buttons *:active {
    color: white;
    opacity: 1;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;

    padding: 6px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .label {
    font-size: 13px;
    color: #9ca3af;
    flex: 1;
  }

  .value {
    flex: 2;
    text-align: right;

    min-width: 0;
    overflow-wrap: anywhere;

    background: transparent;
    border: none;
    outline: none;

    color: white;
    font-size: 13px;
    padding: 0;
    transition: color 0.5s;
  }

  .value.glow {
    color: #a5b4fc;
  }
</style>
