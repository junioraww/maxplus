<script>
  import { onMount, onDestroy } from "svelte";
  import QRCode from "qrcode";
  import { invoke } from "@tauri-apps/api/core";
  import Avatar from "$components/main/Avatar.svelte";
  import { currentUserDetails } from "$lib/stores/api";
  import { showAlert } from "$lib/utils/alert";

  export let onClose = null;
  export let close = null;

  let qrCanvas;

  $: user = $currentUserDetails || {};
  $: fullName = user?.names?.[0]
    ? [user.names[0].firstName, user.names[0].lastName].filter(Boolean).join(" ")
    : "Профиль";
  $: profileLink = (() => {
    const rawLink = user?.link;
    if (rawLink) {
      if (rawLink.startsWith("http")) return rawLink;
      return `https://max.ru/${rawLink.replace(/^@/, "")}`;
    }
    if (user?.id) return `https://max.ru/u/${user.id}`;
    return "https://max.ru";
  })();

  function isFinderArea(r, c, size) {
    const inTopLeft = r < 7 && c < 7;
    const inTopRight = r < 7 && c >= size - 7;
    const inBottomLeft = r >= size - 7 && c < 7;
    return inTopLeft || inTopRight || inBottomLeft;
  }

  function isCenterLogoArea(r, c, size) {
    const half = size / 2;
    const radius = size * 0.16;
    return Math.abs(r + 0.5 - half) < radius && Math.abs(c + 0.5 - half) < radius;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawFinderPattern(ctx, x, y, cell) {
    const outer = cell * 7;
    const mid = cell * 5;
    const inner = cell * 3;
    ctx.save();
    drawRoundedRect(ctx, x, y, outer, outer, cell * 2.1);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    drawRoundedRect(ctx, x + cell, y + cell, mid, mid, cell * 1.4);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    drawRoundedRect(ctx, x + cell * 2, y + cell * 2, inner, inner, cell * 0.9);
    ctx.fill();
    ctx.restore();
  }

  function drawModule(ctx, modules, r, c, size, cell) {
    const x = c * cell;
    const y = r * cell;
    const w = cell + 0.35;
    const h = cell + 0.35;
    const hasTop = r > 0 && modules.get(r - 1, c) && !isFinderArea(r - 1, c, size) && !isCenterLogoArea(r - 1, c, size);
    const hasBottom = r < size - 1 && modules.get(r + 1, c) && !isFinderArea(r + 1, c, size) && !isCenterLogoArea(r + 1, c, size);
    const hasLeft = c > 0 && modules.get(r, c - 1) && !isFinderArea(r, c - 1, size) && !isCenterLogoArea(r, c - 1, size);
    const hasRight = c < size - 1 && modules.get(r, c + 1) && !isFinderArea(r, c + 1, size) && !isCenterLogoArea(r, c + 1, size);

    const rad = cell * 0.44;
    const rTL = !hasTop && !hasLeft ? rad : 0;
    const rTR = !hasTop && !hasRight ? rad : 0;
    const rBR = !hasBottom && !hasRight ? rad : 0;
    const rBL = !hasBottom && !hasLeft ? rad : 0;

    ctx.beginPath();
    ctx.moveTo(x + rTL, y);
    ctx.lineTo(x + w - rTR, y);
    if (rTR) ctx.quadraticCurveTo(x + w, y, x + w, y + rTR);
    ctx.lineTo(x + w, y + h - rBR);
    if (rBR) ctx.quadraticCurveTo(x + w, y + h, x + w - rBR, y + h);
    ctx.lineTo(x + rBL, y + h);
    if (rBL) ctx.quadraticCurveTo(x, y + h, x, y + h - rBL);
    ctx.lineTo(x, y + rTL);
    if (rTL) ctx.quadraticCurveTo(x, y, x + rTL, y);
    ctx.closePath();
    ctx.fill();
  }

  function renderQr(canvas, url) {
    if (!canvas || !url) return;
    try {
      const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
      const modules = qr.modules;
      const size = modules.size;
      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 3) : 2;
      const cssSize = 228;
      canvas.width = cssSize * dpr;
      canvas.height = cssSize * dpr;

      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const cell = cssSize / size;
      const grad = ctx.createLinearGradient(0, cssSize, cssSize, 0);
      grad.addColorStop(0, "#00b8ff");
      grad.addColorStop(0.45, "#248bfe");
      grad.addColorStop(0.78, "#7b4cd6");
      grad.addColorStop(1, "#b210db");

      ctx.fillStyle = grad;

      drawFinderPattern(ctx, 0, 0, cell);
      drawFinderPattern(ctx, (size - 7) * cell, 0, cell);
      drawFinderPattern(ctx, 0, (size - 7) * cell, cell);

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          if (!modules.get(r, c)) continue;
          if (isFinderArea(r, c, size)) continue;
          if (isCenterLogoArea(r, c, size)) continue;
          drawModule(ctx, modules, r, c, size, cell);
        }
      }

      const logoSize = cssSize * 0.27;
      const lx = (cssSize - logoSize) / 2;
      const ly = (cssSize - logoSize) / 2;
      ctx.fillStyle = "#ffffff";
      drawRoundedRect(ctx, lx - 3, ly - 3, logoSize + 6, logoSize + 6, 14);
      ctx.fill();

      const logoGrad = ctx.createLinearGradient(lx, ly + logoSize, lx + logoSize, ly);
      logoGrad.addColorStop(0, "#00b8ff");
      logoGrad.addColorStop(0.5, "#3b7df8");
      logoGrad.addColorStop(1, "#9b2ce6");

      ctx.save();
      ctx.translate(lx, ly);
      const scale = logoSize / 108;
      ctx.scale(scale, scale);

      const ringPath = new Path2D("M54,28.7733C68.1126,28.7733 79.5,40.1581 79.5,54.1365C79.5,68.115 68.1126,79.4998 54,79.4998C39.8874,79.4998 28.5,68.115 28.5,54.1365C28.5,40.1581 39.8874,28.7733 54,28.7733Z");
      const leftEarPath = new Path2D("M22.3915,55.3724C22.3915,55.3724 22.2564,47.3297 25.3431,39.0233C28.4297,30.717 27.7587,23.2017 29.3691,21.6194C30.9795,20.0372 38.9522,21.5956 42.7906,25.0474L22.3915,55.3724Z");
      const rightEarPath = new Path2D("M85.691,56.0431C85.691,56.0431 85.825,47.8434 82.7643,39.375C79.7036,30.9066 80.369,23.2446 78.7721,21.6315C77.1752,20.0184 69.2695,21.6072 65.4633,25.1264L85.691,56.0431Z");

      ctx.strokeStyle = logoGrad;
      ctx.fillStyle = logoGrad;
      ctx.lineWidth = 17;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.stroke(ringPath);
      ctx.fill(leftEarPath);
      ctx.fill(rightEarPath);
      ctx.restore();
    } catch (e) {
      console.error("Failed to render QR:", e);
    }
  }

  $: if (qrCanvas && profileLink) {
    renderQr(qrCanvas, profileLink);
  }

  function setBrightness(value) {
    try {
      invoke("set_screen_brightness", { brightness: value }).catch(() => {});
    } catch {
    }
  }

  onMount(() => {
    setBrightness(1.0);
  });

  onDestroy(() => {
    setBrightness(-1.0);
  });

  async function handleShare() {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: fullName,
          text: profileLink,
          url: profileLink,
        });
        return;
      }
    } catch (e) {
      if (e?.name === "AbortError") return;
    }

    try {
      await navigator.clipboard.writeText(profileLink);
      showAlert("Ссылка на профиль скопирована");
    } catch {
      showAlert(profileLink);
    }
  }

  function handleDismiss() {
    if (onClose) onClose();
    else if (close) close();
  }
</script>

<div class="qr-sheet">
  <div class="qr-sheet-pattern"></div>
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="qr-sheet-handle" on:click={handleDismiss}></div>

  <div class="qr-sheet-body">
    <div class="qr-card">
      <div class="qr-user-header">
        <Avatar size={56} isSelf={true} contactId={user?.id} />
        <div class="qr-user-name">{fullName}</div>
      </div>

      <canvas bind:this={qrCanvas} class="qr-canvas"></canvas>
    </div>
  </div>

  <div class="qr-sheet-footer">
    <button type="button" class="qr-share-btn" on:click={handleShare}>
      Поделиться
    </button>
  </div>
</div>

<style>
  .qr-sheet {
    position: relative;
    width: 100%;
    background-color: var(--bg-sheet, #1e1f24);
    color: var(--text-primary, #ffffff);
    border-top-left-radius: 20px;
    border-top-right-radius: 20px;
    padding: 8px 12px max(16px, calc(16px + var(--safe-bottom, 0px)));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    overflow: hidden;
    font-family: var(--settings-font-body, var(--font-family-base));
  }

  .qr-sheet-pattern {
    position: absolute;
    inset: 0;
    background-image: var(--bg-chat-pattern, url("/icons/chat-pattern.png"));
    background-size: 360px auto;
    background-repeat: repeat;
    opacity: 0.14;
    pointer-events: none;
  }

  .qr-sheet-handle {
    position: relative;
    z-index: 1;
    width: 36px;
    height: 4px;
    border-radius: 99px;
    background: var(--text-subtle, rgba(255, 255, 255, 0.35));
    cursor: pointer;
    margin-top: 2px;
  }

  .qr-sheet-body {
    position: relative;
    z-index: 1;
    width: 100%;
    display: flex;
    justify-content: center;
    padding: 6px 0 4px;
  }

  .qr-card {
    background: #ffffff;
    border-radius: 24px;
    padding: 20px 18px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  .qr-user-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }

  .qr-user-name {
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 17px;
    font-weight: 600;
    color: #0f0f12;
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qr-canvas {
    width: 228px;
    height: 228px;
    display: block;
  }

  .qr-sheet-footer {
    position: relative;
    z-index: 1;
    width: 100%;
  }

  .qr-share-btn {
    width: 100%;
    height: 52px;
    border: none;
    border-radius: 14px;
    background: var(--settings-accent, #007aff);
    color: #ffffff;
    font-family: var(--settings-font-title, var(--font-family-title));
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s, transform 0.1s;
  }

  .qr-share-btn:hover {
    background: var(--settings-accent-hover, #1a88ff);
  }

  .qr-share-btn:active {
    transform: scale(0.985);
  }
</style>
