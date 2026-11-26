const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/**
 * Encodes a Uint8Array into RFC 9285 Base45 (optimal for QR Alphanumeric mode).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function encodeBase45(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let val = (bytes[i] << 8) | bytes[i + 1];
      const e = val % 45;
      val = (val - e) / 45;
      const d = val % 45;
      const c = (val - d) / 45;
      out += CHARSET[e] + CHARSET[d] + CHARSET[c];
    } else {
      let val = bytes[i];
      const d = val % 45;
      const c = (val - d) / 45;
      out += CHARSET[d] + CHARSET[c];
    }
  }
  return out;
}

/**
 * Decodes an RFC 9285 Base45 string back into a Uint8Array.
 * @param {string} str
 * @returns {Uint8Array}
 */
export function decodeBase45(str) {
  const clean = String(str || "").trim();
  if (!clean.length) return new Uint8Array(0);
  const out = [];
  for (let i = 0; i < clean.length; i += 3) {
    const remaining = clean.length - i;
    if (remaining < 2) {
      throw new Error("Invalid Base45 length");
    }
    const a = CHARSET.indexOf(clean[i]);
    const b = CHARSET.indexOf(clean[i + 1]);
    if (a < 0 || b < 0) throw new Error("Invalid Base45 character");

    if (remaining >= 3) {
      const c = CHARSET.indexOf(clean[i + 2]);
      if (c < 0) throw new Error("Invalid Base45 character");
      const val = a + b * 45 + c * 2025;
      if (val > 0xffff) throw new Error("Base45 overflow");
      out.push((val >> 8) & 0xff, val & 0xff);
    } else {
      const val = a + b * 45;
      if (val > 0xff) throw new Error("Base45 overflow");
      out.push(val & 0xff);
    }
  }
  return new Uint8Array(out);
}
