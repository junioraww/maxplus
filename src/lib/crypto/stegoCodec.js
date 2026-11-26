// Reed-Solomon RS(255, 223) over GF(2^8) + HMAC-SHA256("stego-v1") coordinate permutation.
// Zero static magic bytes in the carrier: frame/block order is keyed per chat_id and media dims.

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfDiv(a, b) {
  if (b === 0) throw new Error("GF division by zero");
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] + 255 - GF_LOG[b]) % 255];
}

function gfPolyMul(p, q) {
  const res = new Uint8Array(p.length + q.length - 1);
  for (let j = 0; j < q.length; j++) {
    for (let i = 0; i < p.length; i++) {
      res[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return res;
}

function gfPolyEval(poly, x) {
  let y = poly[0];
  for (let i = 1; i < poly.length; i++) {
    y = gfMul(y, x) ^ poly[i];
  }
  return y;
}

const RS_NSYM = 32; // corrects up to 16 corrupted bytes per 255-byte block
const RS_DATA = 255 - RS_NSYM; // 223
const RS_GEN = (() => {
  let g = new Uint8Array([1]);
  for (let i = 0; i < RS_NSYM; i++) {
    g = gfPolyMul(g, new Uint8Array([1, GF_EXP[i]]));
  }
  return g;
})();

export function rsEncodeBlock(data) {
  if (data.length > RS_DATA) throw new Error("RS block too large");
  const padded = new Uint8Array(255);
  padded.set(data, 0);
  const rem = new Uint8Array(padded);
  for (let i = 0; i < RS_DATA; i++) {
    const coef = rem[i];
    if (coef !== 0) {
      for (let j = 1; j < RS_GEN.length; j++) {
        rem[i + j] ^= gfMul(RS_GEN[j], coef);
      }
    }
  }
  const out = new Uint8Array(data.length + RS_NSYM);
  out.set(data, 0);
  out.set(rem.subarray(RS_DATA, 255), data.length);
  return out;
}

export function rsDecodeBlock(msg) {
  const n = msg.length;
  if (n <= RS_NSYM || n > 255) return null;
  const msgIn = new Uint8Array(255);
  const padLen = RS_DATA - (n - RS_NSYM);
  msgIn.set(msg.subarray(0, n - RS_NSYM), 0);
  msgIn.set(msg.subarray(n - RS_NSYM), RS_DATA);

  const synd = new Uint8Array(RS_NSYM);
  let hasError = false;
  for (let i = 0; i < RS_NSYM; i++) {
    synd[i] = gfPolyEval(msgIn, GF_EXP[i]);
    if (synd[i] !== 0) hasError = true;
  }
  if (!hasError) return msg.slice(0, n - RS_NSYM);

  // Berlekamp-Massey
  let errLoc = new Uint8Array([1]);
  let oldLoc = new Uint8Array([1]);
  for (let i = 0; i < RS_NSYM; i++) {
    let delta = synd[i];
    for (let j = 1; j < errLoc.length; j++) {
      delta ^= gfMul(errLoc[errLoc.length - 1 - j], synd[i - j]);
    }
    const nextOld = new Uint8Array(oldLoc.length + 1);
    nextOld.set(oldLoc, 0);
    oldLoc = nextOld;

    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = new Uint8Array(oldLoc.length);
        for (let k = 0; k < oldLoc.length; k++) newLoc[k] = gfMul(oldLoc[k], delta);
        const invDelta = gfDiv(1, delta);
        const scaledErr = new Uint8Array(errLoc.length);
        for (let k = 0; k < errLoc.length; k++) scaledErr[k] = gfMul(errLoc[k], invDelta);
        oldLoc = scaledErr;
        errLoc = newLoc;
      }
      const lenDiff = errLoc.length - oldLoc.length;
      for (let k = 0; k < oldLoc.length; k++) {
        errLoc[k + lenDiff] ^= gfMul(delta, oldLoc[k]);
      }
    }
  }

  const numErrors = errLoc.length - 1;
  if (numErrors * 2 > RS_NSYM) return null;

  // Chien search
  const errPos = [];
  const revLoc = new Uint8Array(errLoc).reverse();
  for (let i = 0; i < 255; i++) {
    if (gfPolyEval(revLoc, GF_EXP[i]) === 0) {
      errPos.push(254 - i);
    }
  }
  if (errPos.length !== numErrors) return null;

  // Forney error evaluator
  const syndRev = new Uint8Array(RS_NSYM);
  for (let i = 0; i < RS_NSYM; i++) syndRev[i] = synd[RS_NSYM - 1 - i];
  const prod = gfPolyMul(syndRev, errLoc);
  const errEval = prod.subarray(prod.length - RS_NSYM);

  const corrected = new Uint8Array(msgIn);
  for (const pos of errPos) {
    if (pos >= n - RS_NSYM && pos < RS_DATA) {
      if (padLen > 0) return null;
    }
    const xInv = GF_EXP[pos];
    const x = gfDiv(1, xInv);
    let errLocPrime = 0;
    for (let j = 1; j < errLoc.length; j += 2) {
      // Derivative in GF(2^m): odd powers only
      const coef = errLoc[errLoc.length - 1 - j];
      let pow = 1;
      for (let p = 0; p < j - 1; p++) pow = gfMul(pow, xInv);
      errLocPrime ^= gfMul(coef, pow);
    }
    if (errLocPrime === 0) return null;
    const y = gfPolyEval(errEval, xInv);
    const mag = gfDiv(gfMul(x, y), errLocPrime);
    corrected[254 - pos] ^= mag;
  }

  // Re-verify syndromes
  for (let i = 0; i < RS_NSYM; i++) {
    if (gfPolyEval(corrected, GF_EXP[i]) !== 0) return null;
  }
  return corrected.slice(0, n - RS_NSYM);
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function deriveStegoSeed(chatId, metaStr = "") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("stego-v1"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${Number(chatId)}:${metaStr}`));
  return new Uint8Array(sig);
}

/**
 * Deterministic Xorshift32 PRNG seeded from 32-byte seed.
 */
export function createPrng(seedBytes) {
  let s0 = ((seedBytes[0] << 24) | (seedBytes[1] << 16) | (seedBytes[2] << 8) | seedBytes[3]) >>> 0 || 0x9e3779b9;
  let s1 = ((seedBytes[4] << 24) | (seedBytes[5] << 16) | (seedBytes[6] << 8) | seedBytes[7]) >>> 0 || 0x85ebca6b;
  return () => {
    s0 ^= s0 << 13;
    s0 ^= s0 >>> 17;
    s0 ^= s0 << 5;
    s1 = (s1 + 0x9e3779b9) >>> 0;
    return (s0 ^ s1) >>> 0;
  };
}

export function samplePermutedIndices(totalCount, count, seedBytes) {
  const n = Math.min(totalCount, Math.max(0, count | 0));
  const out = new Uint32Array(n);
  if (n === 0) return out;
  const swapped = new Map();
  const nextRand = createPrng(seedBytes);
  for (let i = 0; i < n; i++) {
    const j = i + (nextRand() % (totalCount - i));
    const valI = swapped.has(i) ? swapped.get(i) : i;
    const valJ = swapped.has(j) ? swapped.get(j) : j;
    if (j !== i) swapped.set(j, valI);
    out[i] = valJ;
  }
  return out;
}

/**
 * Encodes payload into an RS-protected + whitened bit array.
 * Header: [len_hi, len_lo, crc32(4B)] + payload, split into RS(255, 223) blocks.
 */
export function encodeStegoPayloadBits(payloadBytes, seedBytes) {
  const len = payloadBytes.length;
  const crc = crc32(payloadBytes);
  const frame = new Uint8Array(6 + len);
  frame[0] = (len >>> 8) & 0xff;
  frame[1] = len & 0xff;
  frame[2] = (crc >>> 24) & 0xff;
  frame[3] = (crc >>> 16) & 0xff;
  frame[4] = (crc >>> 8) & 0xff;
  frame[5] = crc & 0xff;
  frame.set(payloadBytes, 6);

  const rsChunks = [];
  for (let off = 0; off < frame.length; off += RS_DATA) {
    const slice = frame.subarray(off, Math.min(off + RS_DATA, frame.length));
    rsChunks.push(rsEncodeBlock(slice));
  }

  let totalBytes = 0;
  for (const c of rsChunks) totalBytes += c.length;
  const encoded = new Uint8Array(2 + totalBytes);
  encoded[0] = (frame.length >>> 8) & 0xff;
  encoded[1] = frame.length & 0xff;
  let pos = 2;
  for (const c of rsChunks) {
    encoded.set(c, pos);
    pos += c.length;
  }

  // Repeat 2-byte frame length 3x with majority vote for ultra-safe header recovery
  const full = new Uint8Array(6 + totalBytes);
  full[0] = encoded[0];
  full[1] = encoded[1];
  full[2] = encoded[0];
  full[3] = encoded[1];
  full[4] = encoded[0];
  full[5] = encoded[1];
  full.set(encoded.subarray(2), 6);

  // Whiten with PRNG stream so carrier statistics stay uniform
  const nextRand = createPrng(seedBytes);
  for (let i = 0; i < full.length; i++) {
    full[i] ^= nextRand() & 0xff;
  }

  const bits = new Uint8Array(full.length * 8);
  for (let i = 0; i < full.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits[i * 8 + (7 - b)] = (full[i] >> b) & 1;
    }
  }
  return bits;
}

export function estimateStegoBitsNeeded(first48Bits, seedBytes) {
  if (!first48Bits || first48Bits.length < 48) return null;
  const header = new Uint8Array(6);
  const nextRand = createPrng(seedBytes);
  for (let i = 0; i < 6; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | (first48Bits[i * 8 + b] & 1);
    }
    header[i] = val ^ (nextRand() & 0xff);
  }
  const l0 = (header[0] << 8) | header[1];
  const l1 = (header[2] << 8) | header[3];
  const l2 = (header[4] << 8) | header[5];
  if (l0 !== l1 && l0 !== l2 && l1 !== l2) return null;
  const frameLen = l0 === l1 || l0 === l2 ? l0 : l1;
  if (frameLen < 64 || frameLen > 4096) return null;
  const numBlocks = Math.ceil(frameLen / RS_DATA);
  return (6 + frameLen + numBlocks * RS_NSYM) * 8;
}

export function decodeStegoPayloadBits(bits, seedBytes) {
  if (!bits || bits.length < 48) return null;
  const byteLen = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteLen);
  const nextRand = createPrng(seedBytes);
  for (let i = 0; i < byteLen; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | (bits[i * 8 + b] & 1);
    }
    bytes[i] = val ^ (nextRand() & 0xff);
  }

  // Majority vote on 2-byte frame length
  const l0 = (bytes[0] << 8) | bytes[1];
  const l1 = (bytes[2] << 8) | bytes[3];
  const l2 = (bytes[4] << 8) | bytes[5];
  const frameLen = l0 === l1 || l0 === l2 ? l0 : l1 === l2 ? l1 : l0;
  if (frameLen < 8 || frameLen > 8192) return null;

  const numBlocks = Math.ceil(frameLen / RS_DATA);
  const expectedRsBytes = frameLen + numBlocks * RS_NSYM;
  if (bytes.length < 6 + expectedRsBytes) return null;

  const frame = new Uint8Array(frameLen);
  let srcOff = 6;
  let dstOff = 0;
  for (let b = 0; b < numBlocks; b++) {
    const dataCount = Math.min(RS_DATA, frameLen - dstOff);
    const blockLen = dataCount + RS_NSYM;
    const decoded = rsDecodeBlock(bytes.subarray(srcOff, srcOff + blockLen));
    if (!decoded) return null;
    frame.set(decoded, dstOff);
    srcOff += blockLen;
    dstOff += dataCount;
  }

  const payloadLen = (frame[0] << 8) | frame[1];
  if (payloadLen + 6 !== frameLen) return null;
  const expectedCrc = ((frame[2] << 24) | (frame[3] << 16) | (frame[4] << 8) | frame[5]) >>> 0;
  const payload = frame.slice(6, 6 + payloadLen);
  if (crc32(payload) !== expectedCrc) return null;
  return payload;
}
