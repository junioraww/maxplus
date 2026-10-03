const HKDF_INFO = new TextEncoder().encode('maxplus-call-media-v1');
const FRAME_HEADER_SIZE = 10;

export class CallEncryptionSession {
  #keyMaterial = null;
  #encKey = null;
  #decKey = null;
  #frameCounter = 0;
  #mode = 'plain';
  #fingerprint = null;

  get mode() { return this.#mode; }
  get fingerprint() { return this.#fingerprint; }

  async initPlain() {
    this.#mode = 'plain';
    this.#keyMaterial = null;
    this.#encKey = null;
    this.#decKey = null;
    this.#fingerprint = null;
  }

  async initSecure(sharedSecret) {
    this.#mode = 'secure';
    const raw = typeof sharedSecret === 'string'
      ? hexToBytes(sharedSecret)
      : sharedSecret;

    const baseKey = await crypto.subtle.importKey(
      'raw', raw, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']
    );

    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);

    this.#encKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: concatBytes(HKDF_INFO, new TextEncoder().encode('-enc')) },
      baseKey,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt']
    );

    this.#decKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: concatBytes(HKDF_INFO, new TextEncoder().encode('-dec')) },
      baseKey,
      { name: 'AES-GCM', length: 128 },
      false,
      ['decrypt']
    );

    const fpBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('maxplus-fingerprint') },
      baseKey, 64
    );
    this.#fingerprint = bytesToHex(new Uint8Array(fpBits)).toUpperCase().match(/.{4}/g).join('-');
  }

  async encryptFrame(data) {
    if (this.#mode === 'plain' || !this.#encKey) return data;
    const iv = new Uint8Array(12);
    const counter = this.#frameCounter++;
    new DataView(iv.buffer).setUint32(8, counter, false);
    const plaintext = data instanceof Uint8Array ? data : new Uint8Array(data);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, this.#encKey, plaintext);
    const result = new Uint8Array(FRAME_HEADER_SIZE + ciphertext.byteLength);
    const dv = new DataView(result.buffer);
    dv.setUint8(0, 0x4d);
    dv.setUint8(1, 0x58);
    dv.setUint32(2, counter, false);
    result.set(iv, 6);
    result.set(new Uint8Array(ciphertext), FRAME_HEADER_SIZE);
    return result;
  }

  async decryptFrame(data) {
    if (this.#mode === 'plain' || !this.#decKey) return data;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.length < FRAME_HEADER_SIZE + 2) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    if (dv.getUint8(0) !== 0x4d || dv.getUint8(1) !== 0x58) return null;
    const iv = bytes.slice(6, 18);
    const ciphertext = bytes.slice(FRAME_HEADER_SIZE);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, this.#decKey, ciphertext);
      return new Uint8Array(plain);
    } catch {
      return null;
    }
  }

  applyToSender(sender) {
    if (this.#mode === 'plain') return;
    if (typeof RTCRtpScriptTransform !== 'undefined') {
      const worker = new Worker(new URL('./callEncryptionWorker.js', import.meta.url), { type: 'module' });
      sender.transform = new RTCRtpScriptTransform(worker, { op: 'encrypt' });
    }
  }

  applyToReceiver(receiver) {
    if (this.#mode === 'plain') return;
    if (typeof RTCRtpScriptTransform !== 'undefined') {
      const worker = new Worker(new URL('./callEncryptionWorker.js', import.meta.url), { type: 'module' });
      receiver.transform = new RTCRtpScriptTransform(worker, { op: 'decrypt' });
    }
  }
}

function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

function bytesToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

export async function generateCallKeyPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
}

export async function exportPublicKeyBytes(keypair) {
  const raw = await crypto.subtle.exportKey('raw', keypair.publicKey);
  return new Uint8Array(raw);
}

export async function deriveSharedSecret(myPrivateKey, peerPublicKeyBytes) {
  const peerKey = await crypto.subtle.importKey(
    'raw', peerPublicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, myPrivateKey, 256);
  return new Uint8Array(bits);
}
