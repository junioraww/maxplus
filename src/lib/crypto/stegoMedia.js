import {
  decodeStegoPayloadBits,
  deriveStegoSeed,
  encodeStegoPayloadBits,
  estimateStegoBitsNeeded,
  samplePermutedIndices,
} from "./stegoCodec.js";

function weightedChoice(items) {
  let total = 0;
  for (const item of items) total += item.weight;
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

const PHOTO_PRESETS = [
  { width: 960, height: 1280, weight: 35 },
  { width: 1280, height: 960, weight: 25 },
  { width: 720, height: 1280, weight: 15 },
  { width: 1280, height: 720, weight: 10 },
  { width: 1080, height: 1080, weight: 8 },
  { width: 1080, height: 1350, weight: 7 },
];

function randomPhotoDimensions() {
  const p = weightedChoice(PHOTO_PRESETS);
  return [p.width, p.height];
}

const BLOCK_SIZE = 8;
const DCT_PAIRS = [
  [2, 1, 1, 2],
  [3, 1, 1, 3],
  [2, 3, 3, 2],
  [4, 1, 1, 4],
];
const DCT_THRESHOLD = 36;

function randomStegoFilename(ext) {
  const useRu = Math.random() < 0.5;
  const withDigits = Math.random() < 0.45;
  const letters = useRu
    ? "абвгдежзийклмнопрстуфхцчшщъыьэюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
    : "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pool = withDigits ? letters + "0123456789" : letters;
  const len = 1 + Math.floor(Math.random() * 16);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += pool[Math.floor(Math.random() * pool.length)];
  }
  return `${out}.${ext}`;
}

const COS_TABLE = Array.from({ length: 8 }, (_, u) => {
  const a = u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8);
  return Array.from({ length: 8 }, (__, x) => a * Math.cos(((2 * x + 1) * u * Math.PI) / 16));
});

function fdct8x8(b) {
  const temp = Array.from({ length: 8 }, () => new Float64Array(8));
  const out = Array.from({ length: 8 }, () => new Float64Array(8));
  for (let u = 0; u < 8; u++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += b[x][y] * COS_TABLE[u][x];
      temp[u][y] = sum;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += temp[u][y] * COS_TABLE[v][y];
      out[u][v] = sum;
    }
  }
  return out;
}

function idct8x8(d) {
  const temp = Array.from({ length: 8 }, () => new Float64Array(8));
  const out = Array.from({ length: 8 }, () => new Uint8ClampedArray(8));
  for (let x = 0; x < 8; x++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += d[u][v] * COS_TABLE[u][x];
      temp[x][v] = sum;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += temp[x][v] * COS_TABLE[v][y];
      out[x][y] = Math.min(255, Math.max(0, Math.round(sum)));
    }
  }
  return out;
}

function embedDctBit(rgba, width, bx, by, bit, threshold = DCT_THRESHOLD, pairIdx = 0) {
  const [u1, v1, u2, v2] = DCT_PAIRS[pairIdx & 3];
  const luma = Array.from({ length: 8 }, () => new Float64Array(8));
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = ((by + y) * width + (bx + x)) * 4;
      luma[x][y] = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
    }
  }
  const d = fdct8x8(luma);
  const diff = d[u1][v1] - d[u2][v2];
  if (bit === 1 && diff < threshold) {
    const step = (threshold - diff) / 2;
    d[u1][v1] += step;
    d[u2][v2] -= step;
  } else if (bit === 0 && -diff < threshold) {
    const step = (threshold + diff) / 2;
    d[u1][v1] -= step;
    d[u2][v2] += step;
  }
  const mod = idct8x8(d);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = ((by + y) * width + (bx + x)) * 4;
      const delta = mod[x][y] - luma[x][y];
      rgba[idx] = Math.min(255, Math.max(0, Math.round(rgba[idx] + delta)));
      rgba[idx + 1] = Math.min(255, Math.max(0, Math.round(rgba[idx + 1] + delta)));
      rgba[idx + 2] = Math.min(255, Math.max(0, Math.round(rgba[idx + 2] + delta)));
    }
  }
}

function extractDctBit(rgba, width, bx, by, pairIdx = 0) {
  const [u1, v1, u2, v2] = DCT_PAIRS[pairIdx & 3];
  const luma = Array.from({ length: 8 }, () => new Float64Array(8));
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const idx = ((by + y) * width + (bx + x)) * 4;
      luma[x][y] = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
    }
  }
  const d = fdct8x8(luma);
  return d[u1][v1] - d[u2][v2] > 0 ? 1 : 0;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomColorHsl() {
  const h = Math.floor(Math.random() * 360);
  const s = 45 + Math.floor(Math.random() * 40);
  const l = 20 + Math.floor(Math.random() * 45);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function paintOrganicFrame(ctx, width, height, phase = 0, palette = null) {
  const cols = palette || [randomColorHsl(), randomColorHsl(), randomColorHsl()];
  const angle = phase * 0.4 + Math.random() * 0.02;
  const gx = Math.cos(angle) * width * 0.6;
  const gy = Math.sin(angle) * height * 0.6;
  const grad = ctx.createLinearGradient(
    width / 2 - gx,
    height / 2 - gy,
    width / 2 + gx,
    height / 2 + gy
  );
  grad.addColorStop(0, cols[0]);
  grad.addColorStop(0.5, cols[1]);
  grad.addColorStop(1, cols[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Soft natural bokeh blobs
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 6; i++) {
    const cx = (0.15 + 0.7 * ((Math.sin(phase * 0.7 + i * 1.9) + 1) / 2)) * width;
    const cy = (0.15 + 0.7 * ((Math.cos(phase * 0.5 + i * 2.3) + 1) / 2)) * height;
    const r = Math.min(width, height) * (0.2 + 0.18 * ((i % 3) / 2));
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    rg.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function addSubtleFilmGrain(rgba) {
  for (let i = 0; i < rgba.length; i += 4) {
    const grain = ((Math.random() + Math.random() - 1) * 9) | 0;
    rgba[i] = Math.min(255, Math.max(0, rgba[i] + grain));
    rgba[i + 1] = Math.min(255, Math.max(0, rgba[i + 1] + grain));
    rgba[i + 2] = Math.min(255, Math.max(0, rgba[i + 2] + grain));
  }
}

export async function generateAndEmbedPhoto(packetBytes, chatId) {
  const [width, height] = randomPhotoDimensions();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  paintOrganicFrame(ctx, width, height, Math.random() * Math.PI * 2);

  const imgData = ctx.getImageData(0, 0, width, height);
  addSubtleFilmGrain(imgData.data);

  const cols = Math.floor(width / BLOCK_SIZE);
  const rows = Math.floor(height / BLOCK_SIZE);
  const totalBlocks = cols * rows;

  const seed = await deriveStegoSeed(chatId, "photo");
  const bits = encodeStegoPayloadBits(packetBytes, seed);
  if (bits.length > totalBlocks) {
    throw new Error("Photo carrier too small for payload");
  }
  const perm = samplePermutedIndices(totalBlocks, bits.length, seed);
  for (let i = 0; i < bits.length; i++) {
    const bIdx = perm[i];
    const bx = (bIdx % cols) * BLOCK_SIZE;
    const by = Math.floor(bIdx / cols) * BLOCK_SIZE;
    const pairIdx = (bIdx ^ seed[bIdx % seed.length]) & 3;
    embedDctBit(imgData.data, width, bx, by, bits[i], DCT_THRESHOLD, pairIdx);
  }
  ctx.putImageData(imgData, 0, 0);

  const jpegQuality = 0.85 + Math.random() * 0.09;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", jpegQuality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    type: "PHOTO",
    mime: "image/jpeg",
    ext: "jpg",
    name: randomStegoFilename("jpg"),
    bytes,
    width,
    height,
  };
}

function extractWithEarlyBailout(totalSlots, seed, readBitAtSlot) {
  if (totalSlots < 48) return null;
  const headerPerm = samplePermutedIndices(totalSlots, 48, seed);
  const headerBits = new Uint8Array(48);
  for (let i = 0; i < 48; i++) {
    headerBits[i] = readBitAtSlot(headerPerm[i]);
  }
  const bitsNeeded = estimateStegoBitsNeeded(headerBits, seed);
  if (!bitsNeeded || bitsNeeded > totalSlots) return null;

  const perm = samplePermutedIndices(totalSlots, bitsNeeded, seed);
  const bits = new Uint8Array(bitsNeeded);
  bits.set(headerBits, 0);
  for (let i = 48; i < bitsNeeded; i++) {
    bits[i] = readBitAtSlot(perm[i]);
  }
  return decodeStegoPayloadBits(bits, seed);
}

export async function extractStegoFromImageData(rgba, width, height, chatId) {
  const cols = Math.floor(width / BLOCK_SIZE);
  const rows = Math.floor(height / BLOCK_SIZE);
  const totalBlocks = cols * rows;
  if (totalBlocks < 128) return null;

  const seed = await deriveStegoSeed(chatId, "photo");
  return extractWithEarlyBailout(totalBlocks, seed, (bIdx) => {
    const bx = (bIdx % cols) * BLOCK_SIZE;
    const by = Math.floor(bIdx / cols) * BLOCK_SIZE;
    const pairIdx = (bIdx ^ seed[bIdx % seed.length]) & 3;
    return extractDctBit(rgba, width, bx, by, pairIdx);
  });
}

export async function generateRandomStegoMedia(packetBytes, chatId) {
  return generateAndEmbedPhoto(packetBytes, chatId);
}
