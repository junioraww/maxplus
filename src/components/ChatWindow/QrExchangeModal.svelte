<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import QRCode from "qrcode";
  import { encodeBase45, decodeBase45 } from "$lib/crypto/base45";
  import {
    initHandshake,
    acceptHandshake,
    processAccept,
    verifyHandshakePacket,
  } from "$lib/crypto/asymmetric";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { openSheet } from "$lib/services/layerManager";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { showAlert } from "$lib/utils/alert";
  import { parseApiError } from "$lib/utils/errors";
  import QRScannerModal from "$components/main/QRScannerModal.svelte";

  export let chat;
  export let chatSettings;
  export let close = null;
  export let onActivated = null;

  const dispatch = createEventDispatcher();

  let step = "init";
  let qrDataUrl = "";
  let fingerprint = "";
  let busy = false;
  let errorText = "";
  let fullscreenQr = false;
  let unregisterBack = null;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function renderQrFromPacketBytes(packetBytes) {
    const b45 = "MXPQ:" + encodeBase45(packetBytes);
    qrDataUrl = await QRCode.toDataURL(b45, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "L",
      color: { dark: "#0f0f12", light: "#ffffff" },
    });
  }

  async function startInitQr() {
    if (!chat?.id) return;
    busy = true;
    errorText = "";
    try {
      const account = await getCurrentAccount();
      const accId = Number(account?.id || 0);
      const b64 = await initHandshake(accId, chat.id, "raw");
      await renderQrFromPacketBytes(b64ToBytes(b64));
      step = "init";
    } catch (e) {
      errorText = parseApiError(e);
    } finally {
      busy = false;
    }
  }

  function setBrightness(value) {
    try {
      invoke("set_screen_brightness", { brightness: value }).catch(() => {});
    } catch {}
  }

  function portalToBody(node) {
    if (typeof document !== "undefined" && document.body) {
      document.body.appendChild(node);
    }
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  onMount(() => {
    setBrightness(1.0);
    startInitQr();
    unregisterBack = registerBackHandler(() => {
      if (fullscreenQr) {
        fullscreenQr = false;
        return true;
      }
      if (close) {
        close(false);
        return true;
      }
      return false;
    });
  });

  onDestroy(() => {
    setBrightness(-1.0);
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
  });

  function openScanner() {
    openSheet(QRScannerModal, {
      onScan: (raw) => handleScanned(raw),
    });
  }

  async function handleScanned(rawText) {
    if (!rawText || !chat?.id) return;
    busy = true;
    errorText = "";
    try {
      const clean = String(rawText).trim();
      if (!clean.startsWith("MXPQ:")) {
        throw new Error("Неверный формат QR-кода Max+ E2E");
      }
      const packetBytes = decodeBase45(clean.slice(5));
      const dto = await verifyHandshakePacket(packetBytes, chat.id);
      const account = await getCurrentAccount();
      const accId = Number(account?.id || 0);

      if (dto.is_handshake_request && dto.handshake_data) {
        const acceptB64 = await acceptHandshake(accId, chat.id, dto.handshake_data, "raw");
        await renderQrFromPacketBytes(b64ToBytes(acceptB64));
        const fresh = await invoke("get_chat_settings", {
          account: accId,
          chatId: Number(chat.id),
        });
        if (fresh) {
          chatSettings.set(fresh);
          fingerprint = fresh?.session?.fingerprint || "";
        }
        step = "accept_qr";
      } else if (dto.is_handshake_accept && dto.handshake_data) {
        const fp = await processAccept(accId, chat.id, dto.handshake_data);
        fingerprint = fp || "";
        const fresh = await invoke("get_chat_settings", {
          account: accId,
          chatId: Number(chat.id),
        });
        if (fresh) chatSettings.set(fresh);
        step = "ready";
      } else {
        throw new Error("QR-код не содержит корректного рукопожатия");
      }
    } catch (e) {
      errorText = parseApiError(e);
      showAlert(errorText);
    } finally {
      busy = false;
    }
  }

  function activate() {
    if (typeof onActivated === "function") onActivated(fingerprint);
    dispatch("activated", { fingerprint });
    if (close) close(true);
  }
</script>

<div class="qr-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="qr-sheet-title">
  <div class="sheet-drag-handle" aria-hidden="true"></div>

  <div class="qr-header">
    <div>
      <h3 id="qr-sheet-title" class="qr-title">Обмен ключами по QR</h3>
      <p class="qr-sub">
        {#if step === "init"}
          Покажите этот QR собеседнику или отсканируйте его QR
        {:else if step === "accept_qr"}
          Теперь покажите этот новый QR собеседнику, затем нажмите «Активировать»
        {:else}
          Ключи подтверждены! Нажмите «Активировать»
        {/if}
      </p>
    </div>
  </div>

  {#if errorText}
    <div class="qr-error">{errorText}</div>
  {/if}

  {#if step !== "ready"}
    <button
      type="button"
      class="qr-card-box"
      disabled={!qrDataUrl}
      on:click={() => { if (qrDataUrl) fullscreenQr = true; }}
      title="Открыть QR на весь экран"
    >
      {#if qrDataUrl}
        <img class="qr-img" src={qrDataUrl} alt="QR-код рукопожатия" />
      {:else}
        <div class="qr-loading">Генерация PQ-ключа...</div>
      {/if}
    </button>
  {/if}

  {#if fullscreenQr && qrDataUrl}
    <div
      use:portalToBody
      class="qr-fullscreen-overlay"
      role="dialog"
      aria-modal="true"
      on:click={() => { fullscreenQr = false; }}
      on:keydown={(e) => { if (e.key === "Escape") fullscreenQr = false; }}
      tabindex="-1"
    >
      <div class="qr-fullscreen-card">
        <img class="qr-fullscreen-img" src={qrDataUrl} alt="QR-код во весь экран" />
      </div>
      <span class="qr-fullscreen-hint">Нажмите для закрытия</span>
    </div>
  {/if}

  {#if fingerprint}
    <div class="qr-fp-box">
      <span class="qr-fp-label">Отпечаток сессии</span>
      <span class="qr-fp-emojis">{fingerprint}</span>
    </div>
  {/if}

  <div class="qr-actions">
    {#if step === "init"}
      <button type="button" class="qr-btn primary" disabled={busy} on:click={openScanner}>
        Сканировать QR собеседника
      </button>
      <button type="button" class="qr-btn secondary" disabled={busy} on:click={startInitQr}>
        Обновить QR
      </button>
    {:else}
      <button type="button" class="qr-btn primary" disabled={busy} on:click={activate}>
        Активировать
      </button>
    {/if}
  </div>
</div>

<style>
  .qr-sheet-panel {
    width: 100%;
    background: var(--settings-surface, #17181c);
    color: var(--settings-text-primary, #fff);
    border-radius: 24px 24px 0 0;
    padding: 10px 20px calc(20px + env(safe-area-inset-bottom, 0px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-sizing: border-box;
  }

  .sheet-drag-handle {
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    margin: 0 auto 4px;
    flex-shrink: 0;
  }

  .qr-header {
    text-align: center;
  }

  .qr-title {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .qr-sub {
    margin: 6px 0 0;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.65);
    line-height: 1.35;
  }

  .qr-card-box {
    background: #fff;
    border: none;
    border-radius: 16px;
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: center;
    min-width: 240px;
    min-height: 240px;
    cursor: pointer;
  }

  .qr-img {
    width: 228px;
    height: 228px;
    display: block;
    border-radius: 6px;
    image-rendering: pixelated;
  }

  .qr-fullscreen-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    z-index: 99999;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    cursor: pointer;
  }

  .qr-fullscreen-card {
    background: #ffffff;
    padding: 0;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .qr-fullscreen-img {
    width: min(96vw, 96vh);
    height: min(96vw, 96vh);
    object-fit: contain;
    image-rendering: pixelated;
    display: block;
  }

  .qr-fullscreen-hint {
    display: none;
  }

  .qr-loading {
    color: #222;
    font-size: 14px;
  }

  .qr-fp-box {
    background: var(--settings-card-bg, #25262d);
    border-radius: 14px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
  }

  .qr-fp-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }

  .qr-fp-emojis {
    font-size: 20px;
    letter-spacing: 3px;
  }

  .qr-error {
    background: rgba(239, 68, 68, 0.16);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #fca5a5;
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13px;
  }

  .qr-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .qr-btn {
    border: none;
    border-radius: 12px;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }

  .qr-btn.primary {
    background: var(--accent-primary, #248bfe);
    color: #fff;
  }

  .qr-btn.secondary {
    background: var(--settings-card-bg, #25262d);
    color: #fff;
  }

  .qr-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
