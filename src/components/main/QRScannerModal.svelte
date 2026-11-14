<script>
  import { onMount, onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";

  export let onScan = null;
  export let onClose = null;

  const dispatch = createEventDispatcher();

  let videoEl;
  let canvasEl;
  let stream = null;
  let scanning = false;
  let scanTimer = null;
  let scanTimeout = null;
  let isProcessingFrame = false;
  let errorMsg = null;
  let unregisterBack = null;
  let fileInputEl;
  let hasScanned = false;
  let detectorInstance = null;
  let jsQRInstance = null;

  async function getJsQR() {
    if (!jsQRInstance) {
      const mod = await import("jsqr");
      jsQRInstance = mod.default || mod;
    }
    return jsQRInstance;
  }

  function getBarcodeDetector() {
    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      if (!detectorInstance) {
        try {
          detectorInstance = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch (_) {
          detectorInstance = null;
        }
      }
      return detectorInstance;
    }
    return null;
  }

  function close() {
    stopCamera();
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
    if (onClose) onClose();
    dispatch("close");
  }

  function handleScan(content) {
    if (!content || hasScanned) return;
    hasScanned = true;
    stopCamera();
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
    if (onScan) onScan(content);
    dispatch("scan", content);
    dispatch("close");
  }

  async function startCamera() {
    errorMsg = null;
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        errorMsg = "Камера недоступна";
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
        scanning = true;
        startScanLoop();
      }
    } catch (e) {
      errorMsg = "Не удалось запустить камеру";
    }
  }

  function stopCamera() {
    scanning = false;
    isProcessingFrame = false;
    if (scanTimer) {
      cancelAnimationFrame(scanTimer);
      scanTimer = null;
    }
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
  }

  async function decodeFrame() {
    if (!scanning || isProcessingFrame || hasScanned) return;
    isProcessingFrame = true;

    try {
      if (!videoEl || videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (!vw || !vh) {
        return;
      }

      const detector = getBarcodeDetector();
      if (detector) {
        try {
          const barcodes = await detector.detect(videoEl);
          if (barcodes?.length > 0 && barcodes[0].rawValue) {
            handleScan(barcodes[0].rawValue);
            return;
          }
        } catch (_) {}
      }

      if (!canvasEl) {
        canvasEl = document.createElement("canvas");
      }
      canvasEl.width = Math.min(vw, 640);
      canvasEl.height = Math.round((canvasEl.width / vw) * vh);
      const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        try {
          const jsQR = await getJsQR();
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });
          if (code?.data) {
            handleScan(code.data);
            return;
          }
        } catch (_) {}
      }
    } finally {
      isProcessingFrame = false;
      if (scanning && !hasScanned) {
        scanTimeout = setTimeout(() => {
          if (scanning && !hasScanned) {
            scanTimer = requestAnimationFrame(decodeFrame);
          }
        }, 150);
      }
    }
  }

  function startScanLoop() {
    scanTimer = requestAnimationFrame(decodeFrame);
  }

  async function decodeImageBlob(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);

      const detector = getBarcodeDetector();
      if (detector) {
        try {
          const barcodes = await detector.detect(canvas);
          if (barcodes?.length > 0 && barcodes[0].rawValue) {
            return barcodes[0].rawValue;
          }
        } catch (_) {}
      }

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const jsQR = await getJsQR();
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      return code?.data || null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function pickFromFile() {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Изображения", extensions: ["png", "jpeg", "jpg", "webp"] }],
      });
      if (!selected) return;

      let blob;
      try {
        const bytes = await invoke("read_file", { path: selected });
        blob = new Blob([new Uint8Array(bytes)]);
      } catch (_) {
        const res = await fetch(selected);
        blob = await res.blob();
      }

      const result = await decodeImageBlob(blob);
      if (result) {
        handleScan(result);
      } else {
        errorMsg = "QR-код на изображении не найден";
      }
    } catch (_) {
      fileInputEl?.click();
    }
  }

  async function handleFileInput(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await decodeImageBlob(file);
    if (result) {
      handleScan(result);
    } else {
      errorMsg = "QR-код на изображении не найден";
    }
  }

  onMount(() => {
    unregisterBack = registerBackHandler(() => {
      close();
    });
    startCamera();
  });

  onDestroy(() => {
    stopCamera();
    if (unregisterBack) {
      unregisterBack();
      unregisterBack = null;
    }
  });
</script>

<div class="scanner-backdrop" transition:fade={{ duration: 180 }} on:click={close}>
  <div class="scanner-container" transition:fly={{ y: 25, duration: 220 }} on:click|stopPropagation>
    <div class="header">
      <h3>Сканирование QR-кода</h3>
      <button type="button" class="close-btn" on:click={close}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="camera-viewport">
      <video bind:this={videoEl} playsinline muted></video>
      <div class="overlay">
        <div class="reticle">
          <span class="corner tl"></span>
          <span class="corner tr"></span>
          <span class="corner bl"></span>
          <span class="corner br"></span>
          <div class="scan-laser"></div>
        </div>
      </div>

      {#if errorMsg}
        <div class="error-banner">
          <p>{errorMsg}</p>
        </div>
      {/if}
    </div>

    <div class="actions">
      <input type="file" accept="image/*" bind:this={fileInputEl} on:change={handleFileInput} style="display: none;" />
      <button type="button" class="action-btn" on:click={pickFromFile}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>Выбрать из файлов</span>
      </button>
    </div>
  </div>
</div>

<style>
  .scanner-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .scanner-container {
    width: 100%;
    max-width: 420px;
    background: #18181b;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #f4f4f5;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #a1a1aa;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    transition: color 0.15s, background 0.15s;
  }

  .close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .camera-viewport {
    position: relative;
    width: 100%;
    height: 340px;
    background: #09090b;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .reticle {
    width: 220px;
    height: 220px;
    position: relative;
  }

  .corner {
    position: absolute;
    width: 24px;
    height: 24px;
    border-color: #38bdf8;
    border-style: solid;
  }

  .corner.tl {
    top: 0;
    left: 0;
    border-width: 3px 0 0 3px;
    border-top-left-radius: 12px;
  }

  .corner.tr {
    top: 0;
    right: 0;
    border-width: 3px 3px 0 0;
    border-top-right-radius: 12px;
  }

  .corner.bl {
    bottom: 0;
    left: 0;
    border-width: 0 0 3px 3px;
    border-bottom-left-radius: 12px;
  }

  .corner.br {
    bottom: 0;
    right: 0;
    border-width: 0 3px 3px 0;
    border-bottom-right-radius: 12px;
  }

  .scan-laser {
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    background: linear-gradient(90deg, transparent, #38bdf8, transparent);
    animation: laserScan 2s infinite ease-in-out;
  }

  @keyframes laserScan {
    0% { top: 8px; opacity: 0.3; }
    50% { top: 210px; opacity: 1; }
    100% { top: 8px; opacity: 0.3; }
  }

  .error-banner {
    position: absolute;
    bottom: 16px;
    left: 16px;
    right: 16px;
    background: rgba(239, 68, 68, 0.9);
    color: #fff;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    text-align: center;
  }

  .error-banner p {
    margin: 0;
  }

  .actions {
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #18181b;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: 10px;
    background: #27272a;
    color: #e4e4e7;
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .action-btn:hover {
    background: #3f3f46;
    color: #fff;
  }
</style>
