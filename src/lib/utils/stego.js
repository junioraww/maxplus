const MAGIC_MARKER = 0xfa01;
const BLOCK_SIZE = 8;
const DELTA = 14;

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

function adjustBlockLuma(data, width, height, block, delta) {
  for (let by = 0; by < BLOCK_SIZE; by++) {
    for (let bx = 0; bx < BLOCK_SIZE; bx++) {
      const px = block.x + bx;
      const py = block.y + by;
      if (px >= width || py >= height) continue;
      const idx = (py * width + px) * 4;
      data[idx] = Math.min(255, Math.max(0, Math.round(data[idx] + delta)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.round(data[idx + 1] + delta)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.round(data[idx + 2] + delta)));
    }
  }
}

export function encodeStegoPayload(imageData, targetId, avatarUid) {
  const { width, height, data } = imageData;
  const pairs = getCornerMacroBlockPairs(width, height);
  if (pairs.length < 112) return false;

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
  const offset = numTarget % pairs.length;

  for (let i = 0; i < bits.length; i++) {
    const pairIndex = (offset + i) % pairs.length;
    const pair = pairs[pairIndex];
    const bit = bits[i];

    const lumaA = getBlockAverageLuma(data, width, height, pair.a);
    const lumaB = getBlockAverageLuma(data, width, height, pair.b);

    if (bit === 1) {
      if (lumaA > lumaB + DELTA) continue;
      const needed = (lumaB + DELTA) - lumaA;
      const half = needed / 2;
      const canIncA = 255 - lumaA;
      const canDecB = lumaB;

      let incA = Math.min(canIncA, half);
      let decB = Math.min(canDecB, needed - incA);
      if (incA + decB < needed && canIncA > incA) {
        incA = Math.min(canIncA, needed - decB);
      }
      adjustBlockLuma(data, width, height, pair.a, incA);
      adjustBlockLuma(data, width, height, pair.b, -decB);
    } else {
      if (lumaB > lumaA + DELTA) continue;
      const needed = (lumaA + DELTA) - lumaB;
      const half = needed / 2;
      const canIncB = 255 - lumaB;
      const canDecA = lumaA;

      let incB = Math.min(canIncB, half);
      let decA = Math.min(canDecA, needed - incB);
      if (incB + decA < needed && canIncB > incB) {
        incB = Math.min(canIncB, needed - decA);
      }
      adjustBlockLuma(data, width, height, pair.b, incB);
      adjustBlockLuma(data, width, height, pair.a, -decA);
    }
  }

  return true;
}

export function decodeStegoPayload(imageData, targetId) {
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
  return chars || null;
}
