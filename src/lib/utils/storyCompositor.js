export const STORY_FILTERS = [
  { id: "none", name: "Обычный", css: "none" },
  { id: "warm", name: "Теплый", css: "sepia(0.3) saturate(1.4)" },
  { id: "cool", name: "Холодный", css: "hue-rotate(190deg) saturate(1.2)" },
  { id: "bw", name: "Ч/Б", css: "grayscale(1)" },
  { id: "cyber", name: "Кибер", css: "contrast(1.3) saturate(1.8) hue-rotate(90deg)" },
  { id: "vintage", name: "Винтаж", css: "sepia(0.5) contrast(1.1) brightness(0.95)" }
];

export function applyFilterToImageData(imageData, filterId) {
  if (!filterId || filterId === "none") return;
  const d = imageData.data;
  const len = d.length;

  if (filterId === "warm") {
    for (let i = 0; i < len; i += 4) {
      d[i] = Math.min(255, d[i] * 1.15 + 10);
      d[i + 1] = Math.min(255, d[i + 1] * 1.05);
      d[i + 2] = Math.max(0, d[i + 2] * 0.85 - 5);
    }
  } else if (filterId === "cool") {
    for (let i = 0; i < len; i += 4) {
      d[i] = Math.max(0, d[i] * 0.85);
      d[i + 1] = Math.min(255, d[i + 1] * 1.02);
      d[i + 2] = Math.min(255, d[i + 2] * 1.2 + 10);
    }
  } else if (filterId === "bw") {
    for (let i = 0; i < len; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
    }
  } else if (filterId === "cyber") {
    for (let i = 0; i < len; i += 4) {
      d[i] = Math.min(255, d[i] * 1.25);
      d[i + 1] = Math.min(255, d[i + 1] * 1.15);
      d[i + 2] = Math.min(255, d[i + 2] * 1.35 + 15);
    }
  } else if (filterId === "vintage") {
    for (let i = 0; i < len; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      d[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));
      d[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168));
      d[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131));
    }
  }
}

export async function renderStoryLayersToCanvas(ctx, layers, canvasWidth, canvasHeight, previewWidth = 360, doodleCanvas = null) {
  if (doodleCanvas && typeof doodleCanvas.hasContent === "function" && doodleCanvas.hasContent()) {
    const doodleEl = doodleCanvas.getCanvas();
    if (doodleEl) {
      ctx.drawImage(doodleEl, 0, 0, canvasWidth, canvasHeight);
    }
  }

  if (!Array.isArray(layers) || layers.length === 0) return;

  for (const layer of layers) {
    const lx = layer.x * canvasWidth;
    const ly = layer.y * canvasHeight;
    const lScale = layer.scale || 1;
    const lRot = ((layer.rotation || 0) * Math.PI) / 180;

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(lRot);
    ctx.scale(lScale, lScale);

    if (layer.type === "text") {
      ctx.font = `600 48px ${layer.fontFamily || "sans-serif"}`;
      const scaleFactor = 1080 / (previewWidth || 360);
      const targetBoxW = layer.boxWidth ? layer.boxWidth * scaleFactor : 580;
      const words = (layer.text || "").split(" ");
      const lines = [];
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = ctx.measureText(testLine).width;
        if (testWidth > targetBoxW - 64 && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      const lineHeight = 60;
      const paddingX = 40;
      const paddingY = 24;
      let maxLineWidth = 0;
      for (const l of lines) {
        maxLineWidth = Math.max(maxLineWidth, ctx.measureText(l).width);
      }
      const boxW = Math.max(targetBoxW, maxLineWidth + paddingX * 2);
      const boxH = lines.length * lineHeight + paddingY * 2;

      if (layer.bg && layer.bg !== "transparent") {
        ctx.fillStyle = layer.bg;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, 24);
        } else {
          ctx.rect(-boxW / 2, -boxH / 2, boxW, boxH);
        }
        ctx.fill();
      } else {
        ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
        ctx.shadowBlur = 10;
      }

      ctx.fillStyle = layer.color || "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const startY = -boxH / 2 + paddingY + lineHeight / 2;
      lines.forEach((lineText, idx) => {
        ctx.fillText(lineText, 0, startY + idx * lineHeight);
      });
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    } else if (layer.type === "sticker") {
      const stickerSrc = layer.sticker?.url || layer.sticker?.lottieUrl || layer.stickerUrl;
      if (stickerSrc) {
        const sImg = new Image();
        sImg.crossOrigin = "anonymous";
        sImg.src = stickerSrc;
        await new Promise((resolve) => {
          sImg.onload = resolve;
          sImg.onerror = resolve;
        });
        if (sImg.width && sImg.height) {
          const sw = 260;
          const sh = 260 * (sImg.height / sImg.width);
          ctx.drawImage(sImg, -sw / 2, -sh / 2, sw, sh);
        }
      } else if (layer.sticker?.emoji) {
        ctx.font = "160px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(layer.sticker.emoji, 0, 0);
      }
    } else if (layer.type === "emoji") {
      ctx.font = "160px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(layer.emoji, 0, 0);
    }
    ctx.restore();
  }
}
