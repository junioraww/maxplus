const MAGIC_MARKER = 0xfa01;
const BLOCK_SIZE = 8;
const DCT_THRESHOLD = 20;
const U1 = 2, V1 = 1;
const U2 = 1, V2 = 2;

const C = [];
for (let i = 0; i < 8; i++) {
  C[i] = [];
  for (let j = 0; j < 8; j++) {
    const a = i === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8);
    C[i][j] = a * Math.cos(((2 * j + 1) * i * Math.PI) / 16);
  }
}

function fdct8x8(b) {
  const temp = Array(8).fill(0).map(() => Array(8).fill(0));
  const out = Array(8).fill(0).map(() => Array(8).fill(0));
  for (let u = 0; u < 8; u++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) sum += b[x][y] * C[u][x];
      temp[u][y] = sum;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < 8; y++) sum += temp[u][y] * C[v][y];
      out[u][v] = sum;
    }
  }
  return out;
}

function idct8x8(b) {
  const temp = Array(8).fill(0).map(() => Array(8).fill(0));
  const out = Array(8).fill(0).map(() => Array(8).fill(0));
  for (let x = 0; x < 8; x++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) sum += b[u][v] * C[u][x];
      temp[x][v] = sum;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) sum += temp[x][v] * C[v][y];
      out[x][y] = Math.min(255, Math.max(0, Math.round(sum)));
    }
  }
  return out;
}

function computeCrc16(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

export function getCornerMacroBlocks(width, height) {
  const blocks = [];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;
  const minSafeDist = radius + 4;

  const cols = Math.floor(width / BLOCK_SIZE);
  const rows = Math.floor(height / BLOCK_SIZE);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centerX = c * BLOCK_SIZE + BLOCK_SIZE / 2;
      const centerY = r * BLOCK_SIZE + BLOCK_SIZE / 2;
      const dx = centerX - cx;
      const dy = centerY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= minSafeDist) {
        blocks.push({
          x: c * BLOCK_SIZE,
          y: r * BLOCK_SIZE,
          w: BLOCK_SIZE,
          h: BLOCK_SIZE
        });
      }
    }
  }
  return blocks;
}


function embedDctBit(data, width, height, block, bit) {
  const luma = Array(8).fill(0).map(() => Array(8).fill(0));
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const idx = ((block.y + by) * width + (block.x + bx)) * 4;
      luma[bx][by] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }
  const d = fdct8x8(luma);
  const diff = d[U1][V1] - d[U2][V2];
  if (bit === 1) {
    if (diff < DCT_THRESHOLD) {
      const step = (DCT_THRESHOLD - diff) / 2;
      d[U1][V1] += step;
      d[U2][V2] -= step;
    }
  } else {
    if (-diff < DCT_THRESHOLD) {
      const step = (DCT_THRESHOLD + diff) / 2;
      d[U1][V1] -= step;
      d[U2][V2] += step;
    }
  }
  const modLuma = idct8x8(d);
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const idx = ((block.y + by) * width + (block.x + bx)) * 4;
      const dY = modLuma[bx][by] - luma[bx][by];
      data[idx] = Math.min(255, Math.max(0, Math.round(data[idx] + dY)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(data[idx + 1] + dY)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(data[idx + 2] + dY)));
    }
  }
}

function extractDctBit(data, width, height, block) {
  const luma = Array(8).fill(0).map(() => Array(8).fill(0));
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const idx = ((block.y + by) * width + (block.x + bx)) * 4;
      luma[bx][by] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }
  const d = fdct8x8(luma);
  const diff = d[U1][V1] - d[U2][V2];
  return {
    bit: diff > 0 ? 1 : 0,
    confidence: Math.abs(diff)
  };
}

export function encodeStegoPayload(imageData, targetId, avatarUid) {
  const { width, height, data } = imageData;
  const blocks = getCornerMacroBlocks(width, height);
  if (blocks.length < 112) return false;

  const uidClean = String(avatarUid || "").trim().slice(0, 10).padEnd(10, "_");
  const uidBytes = [];
  for (let i = 0; i < uidClean.length; i++) {
    uidBytes.push(uidClean.charCodeAt(i) & 0xff);
  }

  const crc = computeCrc16(uidBytes);

  const bits = [];
  for (let i = 15; i >= 0; i--) {
    bits.push((MAGIC_MARKER >> i) & 1);
  }
  for (let i = 0; i < uidBytes.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((uidBytes[i] >> b) & 1);
    }
  }
  for (let i = 15; i >= 0; i--) {
    bits.push((crc >> i) & 1);
  }

  const numTarget = Math.abs(Number(targetId || 0));
  const offset = numTarget % blocks.length;

  for (let i = 0; i < bits.length; i++) {
    const blockIndex = (offset + i) % blocks.length;
    embedDctBit(data, width, height, blocks[blockIndex], bits[i]);
  }

  return true;
}

function solvePayloadBits(rawBits, uncertainties) {
  function evaluate(candBits) {
    const bytes = [];
    for (let i = 0; i < 10; i++) {
      let b = 0;
      for (let k = 0; k < 8; k++) {
        b = (b << 1) | candBits[i * 8 + k];
      }
      bytes.push(b);
    }
    let crc = 0;
    for (let i = 0; i < 16; i++) {
      crc = (crc << 1) | candBits[80 + i];
    }
    if (computeCrc16(bytes) === crc) {
      return bytes;
    }
    return null;
  }

  let finalBytes = evaluate(rawBits);

  if (!finalBytes) {
    uncertainties.sort((a, b) => a.diff - b.diff);
    const weakIndices = uncertainties.slice(0, 8).map((u) => u.index);

    for (let i = 0; i < weakIndices.length; i++) {
      const cand = [...rawBits];
      cand[weakIndices[i]] ^= 1;
      finalBytes = evaluate(cand);
      if (finalBytes) break;
    }

    if (!finalBytes) {
      outer: for (let i = 0; i < weakIndices.length; i++) {
        for (let j = i + 1; j < weakIndices.length; j++) {
          const cand = [...rawBits];
          cand[weakIndices[i]] ^= 1;
          cand[weakIndices[j]] ^= 1;
          finalBytes = evaluate(cand);
          if (finalBytes) break outer;
        }
      }
    }
  }

  if (!finalBytes) {
    return null;
  }

  const chars = finalBytes.map((b) => String.fromCharCode(b)).join("").replace(/_+$/, "");
  if (!/^[a-zA-Z0-9_-]{4,10}$/.test(chars)) {
    return null;
  }
  return chars || null;
}

function countBitDiff(a, b) {
  let diff = a ^ b;
  let count = 0;
  while (diff > 0) {
    count += diff & 1;
    diff >>= 1;
  }
  return count;
}

function decodeDctPayload(imageData, targetId) {
  const { width, height, data } = imageData;
  const blocks = getCornerMacroBlocks(width, height);
  if (blocks.length < 112) return null;

  const numTarget = Math.abs(Number(targetId || 0));
  const offset = numTarget % blocks.length;

  let readMagic = 0;
  for (let i = 0; i < 16; i++) {
    const block = blocks[(offset + i) % blocks.length];
    const { bit } = extractDctBit(data, width, height, block);
    readMagic = (readMagic << 1) | bit;
  }

  if (countBitDiff(readMagic, MAGIC_MARKER) > 2) {
    return null;
  }

  const rawBits = [];
  const uncertainties = [];
  for (let i = 0; i < 96; i++) {
    const block = blocks[(offset + 16 + i) % blocks.length];
    const { bit, confidence } = extractDctBit(data, width, height, block);
    rawBits.push(bit);
    uncertainties.push({ diff: confidence, index: i });
  }

  return solvePayloadBits(rawBits, uncertainties);
}

export function getCornerMacroBlockPairs(width, height) {
  const blocks = [];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2;
  const minSafeDist = radius + 4;

  const cols = Math.floor(width / BLOCK_SIZE);
  const rows = Math.floor(height / BLOCK_SIZE);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const centerX = c * BLOCK_SIZE + BLOCK_SIZE / 2;
      const centerY = r * BLOCK_SIZE + BLOCK_SIZE / 2;
      const dx = centerX - cx;
      const dy = centerY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= minSafeDist) {
        blocks.push({ x: c * BLOCK_SIZE, y: r * BLOCK_SIZE });
      }
    }
  }

  const pairs = [];
  const pairCount = Math.floor(blocks.length / 2);
  for (let i = 0; i < pairCount; i++) {
    pairs.push({
      a: blocks[2 * i],
      b: blocks[2 * i + 1]
    });
  }
  return pairs;
}

function getBlockAverageLuma(data, width, height, block) {
  let sum = 0;
  let count = 0;
  for (let by = 0; by < BLOCK_SIZE; by++) {
    for (let bx = 0; bx < BLOCK_SIZE; bx++) {
      const px = block.x + bx;
      const py = block.y + by;
      if (px >= width || py >= height) continue;
      const idx = (py * width + px) * 4;
      const yVal = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      sum += yVal;
      count++;
    }
  }
  return count > 0 ? sum / count : 128;
}

function decodeSpatialPayload(imageData, targetId) {
  const { width, height, data } = imageData;
  const pairs = getCornerMacroBlockPairs(width, height);
  if (pairs.length < 112) return null;

  const numTarget = Math.abs(Number(targetId || 0));
  const offset = numTarget % pairs.length;

  const totalBits = 16 + 10 * 8 + 16;
  const bits = [];

  for (let i = 0; i < totalBits; i++) {
    const pairIndex = (offset + i) % pairs.length;
    const pair = pairs[pairIndex];
    const lumaA = getBlockAverageLuma(data, width, height, pair.a);
    const lumaB = getBlockAverageLuma(data, width, height, pair.b);
    bits.push(lumaA > lumaB ? 1 : 0);
  }

  let readMagic = 0;
  for (let i = 0; i < 16; i++) {
    readMagic = (readMagic << 1) | bits[i];
  }

  if (readMagic !== MAGIC_MARKER) {
    return null;
  }

  const uidBytes = [];
  let bitCursor = 16;
  for (let i = 0; i < 10; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) {
      b = (b << 1) | bits[bitCursor++];
    }
    uidBytes.push(b);
  }

  let readCrc = 0;
  for (let i = 0; i < 16; i++) {
    readCrc = (readCrc << 1) | bits[bitCursor++];
  }

  const expectedCrc = computeCrc16(uidBytes);
  if (readCrc !== expectedCrc) {
    return null;
  }

  const chars = uidBytes.map((b) => String.fromCharCode(b)).join("").replace(/_+$/, "");
  if (!/^[a-zA-Z0-9_-]{4,10}$/.test(chars)) {
    return null;
  }
  return chars || null;
}

export function decodeStegoPayload(imageData, targetId) {
  const ids = Array.isArray(targetId) ? targetId : [targetId];
  for (const tid of ids) {
    if (tid == null) continue;
    const dctRes = decodeDctPayload(imageData, tid);
    if (dctRes) return dctRes;
    const spatialRes = decodeSpatialPayload(imageData, tid);
    if (spatialRes) return spatialRes;
  }
  return null;
}
