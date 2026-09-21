import * as fflate from "fflate";
import { dict, decode, encode } from "$lib/crypto/text-codec";

/* не используется */
class Obfuscator {
  constructor(name) {
    this.name = name;
  }

  detect(marker) {
    for (const ch of marker) {
      if (ch.charCodeAt(0) % 2 !== 0) return false; // индекс нечётный -> не наш признак
    }

    return true;
  }

  obfuscate(text) {
    const marker = makeMarker(en, 5);
    return marker + text;
  }

  deobfuscate(text) {
    return text.slice(5);
  }
}

const en = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/';

const zh = Array.from({ length: 2048 }, (_, i) => String.fromCharCode(0x4E00 + i));
const zhArray = Array.from(zh);
const zhMap = new Map(zhArray.map((c, i) => [c, i]));

class Chinese extends Obfuscator {
  constructor() {
    super("Zh");
  }

  detect(text) {
    if (!text || typeof text !== "string" || text.length < 5) return false;

    for (const ch of text.slice(0, 5)) {
      const idx = zhMap.get(ch);
      if (idx === undefined) return false;
      if ((idx & 1) !== 0) return false;
    }

    return true;
  }

  obfuscate(bytes) {
    const payload = encodeBitPacked(bytes, zh);
    return makeMarker(zh, 5) + payload;
  }

  deobfuscate(text) {
    const payloadString = Array.from(text).slice(5).join("");
    return decodeBitPacked(payloadString, zh);
  }
}

class Words extends Obfuscator {
  constructor() {
    super("Tol");
  }

  async getDictionary() {
    if (this.lock) await this.lock;
    if (this.cache !== undefined) return this.cache;
    this.lock = new Promise(r => this.unlock = r);

    const cache = await dict.getDictionary();
    if (cache?.dict16) {
      this.cache = cache;
      this.dict16Map = new Map(cache.dict16.map((w, i) => [w, i]));
      this.dict8Map = new Map(cache.dict8.map((w, i) => [w, i]));// it's so fucking awful
      this.miniHash = parseInt(cache.dict_sha256.slice(0, 1), 16) & 0xF;
    } else {
      this.cache = null;
    }

    this.unlock();
    this.lock = null;
    return cache;
  }

  async updateDictionary() {
    const cache = await dict.getDictionary();
    if (cache) {
      this.cache = cache;
      this.dict16Map = new Map(cache.dict16.map((w, i) => [w, i]));
      this.dict8Map = new Map(cache.dict8.map((w, i) => [w, i]));
      this.miniHash = parseInt(cache.dict_sha256.slice(0, 1), 16) & 0xF;
    }
  }

  async detect(text) {
    if (!text || typeof text !== "string") return false;
    if (text.indexOf('\n') !== -1) return false;
    if (text.indexOf(' ') === -1) return false;

    const DICT = await this.getDictionary();
    if (!DICT || !this.dict8Map) return false;

    const idx = text.indexOf(' ');
    const word = clean(text.slice(0, idx)).toLowerCase();

    const prefixIdx = this.dict8Map.get(word);
    if (prefixIdx === undefined) return false;

    const hash = prefixIdx & 0xF;
    return hash === this.miniHash;
  }

  async obfuscate(bytes) {
    const DICT = await this.getDictionary();
    if (!DICT) {
      alert("Словарь не загружен!\nПожалуйста, загрузите в настройках.");
      return null;
    }
    return await encode(bytes, DICT, true);
  }

  async deobfuscate(text) {
    const DICT = await this.getDictionary();
    if (!DICT) return;
    return await decode(text, DICT, this.dict8Map, this.dict16Map);
  }
}

const clean = (s) => s?.replace(/[.,!?:-]/g, "")?.trim();

const obfuscators = {
  //basic: new Obfuscator(), // just adds marker
  zh: new Chinese(),         // maps to chinese letters
  words: new Words(),        // maps to book words
}

export async function detectObfuscation(text) {
  if (!text || typeof text !== "string") return null;
  for (const name in obfuscators) {
    const obfuscator = obfuscators[name];
    if (!obfuscator) continue;
    if (await obfuscator.detect(text)) return obfuscator;
  }

  return null;
}

export async function obfuscate(text, obfuscatorName) {
  return await obfuscators[obfuscatorName].obfuscate(text);
}

// Bit-packed encoder (uses floor(log2(base)) bits per symbol). Uses BigInt for safety.
function encodeBitPacked(bytes) {
  const base = zhArray.length;
  const bitsPer = Math.floor(Math.log2(base));
  if (bitsPer <= 0) throw new Error("Alphabet too small");

  let bitBuffer = 0n;
  let bitCount = 0;
  let out = "";

  for (const b of bytes) {
    bitBuffer = (bitBuffer << 8n) | BigInt(b);
    bitCount += 8;
    while (bitCount >= bitsPer) {
      bitCount -= bitsPer;
      const idx = Number(
        (bitBuffer >> BigInt(bitCount)) & ((1n << BigInt(bitsPer)) - 1n),
      );
      out += zhArray[idx];
      // keep remainder in buffer:
      bitBuffer &= (1n << BigInt(bitCount)) - 1n;
    }
  }

  if (bitCount > 0) {
    const idx = Number(
      (bitBuffer << BigInt(bitsPer - bitCount)) &
        ((1n << BigInt(bitsPer)) - 1n),
    );
    out += zhArray[idx];
  }

  return out;
}

function decodeBitPacked(str, alphabet) {
  const base = zhArray.length;
  const bitsPer = Math.floor(Math.log2(base));
  if (bitsPer <= 0) throw new Error("Alphabet too small");

  let bitBuffer = 0n;
  let bitCount = 0;
  const out = [];

  for (const ch of Array.from(str)) {
    if (!zhMap.has(ch)) continue; // игнор неизвестных символов
    bitBuffer = (bitBuffer << BigInt(bitsPer)) | BigInt(zhMap.get(ch));
    bitCount += bitsPer;
    while (bitCount >= 8) {
      bitCount -= 8;
      const byte = Number((bitBuffer >> BigInt(bitCount)) & 0xffn);
      out.push(byte);
    }
    bitBuffer &= (1n << BigInt(bitCount)) - 1n;
  }

  return new Uint8Array(out);
}

function makeMarker(alphabet) {
  const maxEven = Math.floor((zhArray.length - 1) / 2);
  if (maxEven < 0) throw new Error("Alphabet too small for marker");
  let marker = "";
  for (let i = 0; i < 5; i++) {
    const r = Math.floor(Math.random() * (maxEven + 1)); // 0..maxEven
    const idx = r * 2; // чётный индекс
    marker += zhArray[idx];
  }
  return marker;
}

export function deflate(text) {
  const bytes = fflate.strToU8(text);
  return fflate.deflateSync(bytes, { level: 9 });
}

export function inflate(bytes) {
  const decompressed = fflate.inflateSync(bytes);
  return fflate.strFromU8(decompressed);
}
