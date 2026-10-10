export class CallEncryptionSession {
  #mode = 'plain';
  #fingerprint = null;
  #isOriginator = true;

  #audioEncKey = null;
  #audioDecKey = null;
  #videoEncKey = null;
  #videoDecKey = null;

  #audioSendKeyRaw = null;
  #audioRecvKeyRaw = null;
  #videoSendKeyRaw = null;
  #videoRecvKeyRaw = null;

  #audioSendSalt = null;
  #audioRecvSalt = null;
  #videoSendSalt = null;
  #videoRecvSalt = null;

  #audioFrameCounter = 0;
  #videoFrameCounter = 0;

  #workers = new Set();

  get mode() { return this.#mode; }
  get fingerprint() { return this.#fingerprint; }

  getExportedKeys() {
    if (this.#mode === 'plain') return { mode: 'plain' };
    return {
      audioSendKey: this.#audioSendKeyRaw ? Array.from(this.#audioSendKeyRaw) : null,
      audioRecvKey: this.#audioRecvKeyRaw ? Array.from(this.#audioRecvKeyRaw) : null,
      audioSendSalt: this.#audioSendSalt ? Array.from(this.#audioSendSalt) : null,
      audioRecvSalt: this.#audioRecvSalt ? Array.from(this.#audioRecvSalt) : null,
      videoSendKey: this.#videoSendKeyRaw ? Array.from(this.#videoSendKeyRaw) : null,
      videoRecvKey: this.#videoRecvKeyRaw ? Array.from(this.#videoRecvKeyRaw) : null,
      videoSendSalt: this.#videoSendSalt ? Array.from(this.#videoSendSalt) : null,
      videoRecvSalt: this.#videoRecvSalt ? Array.from(this.#videoRecvSalt) : null,
    };
  }

  async initPlain() {
    this.#mode = 'plain';
    this.#fingerprint = null;
    this.#audioEncKey = null;
    this.#audioDecKey = null;
    this.#videoEncKey = null;
    this.#videoDecKey = null;
    this.#audioSendKeyRaw = null;
    this.#audioRecvKeyRaw = null;
    this.#videoSendKeyRaw = null;
    this.#videoRecvKeyRaw = null;
    this.#audioSendSalt = null;
    this.#audioRecvSalt = null;
    this.#videoSendSalt = null;
    this.#videoRecvSalt = null;
    this.#audioFrameCounter = 0;
    this.#videoFrameCounter = 0;
  }

  async initFromChatSecret(chatSecret, conversationId, isOriginator = true) {
    let raw;
    if (typeof chatSecret === 'string') {
      if (/^[0-9a-fA-F]{64}$/.test(chatSecret)) {
        raw = hexToBytes(chatSecret);
      } else {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chatSecret));
        raw = new Uint8Array(hash);
      }
    } else {
      raw = chatSecret;
    }
    const convStr = String(conversationId || 'default');
    const saltBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('maxplus-call-salt-v2-' + convStr)
    );
    const salt = new Uint8Array(saltBuffer);
    await this.#deriveSessionKeys(raw, salt, isOriginator);
  }

  async initSecure(sharedSecret, isOriginator = true) {
    const raw = typeof sharedSecret === 'string' ? hexToBytes(sharedSecret) : sharedSecret;
    const salt = new TextEncoder().encode('maxplus-call-media-salt-v2-32b');
    await this.#deriveSessionKeys(raw, salt, isOriginator);
  }

  async #deriveSessionKeys(rawKeyMaterial, salt, isOriginator) {
    this.#mode = 'secure';
    this.#isOriginator = isOriginator;

    const baseKey = await crypto.subtle.importKey(
      'raw',
      rawKeyMaterial,
      { name: 'HKDF' },
      false,
      ['deriveKey', 'deriveBits']
    );

    const audioSendInfo = isOriginator ? 'maxplus-v2-audio-orig-to-resp' : 'maxplus-v2-audio-resp-to-orig';
    const audioRecvInfo = isOriginator ? 'maxplus-v2-audio-resp-to-orig' : 'maxplus-v2-audio-orig-to-resp';
    const videoSendInfo = isOriginator ? 'maxplus-v2-video-orig-to-resp' : 'maxplus-v2-video-resp-to-orig';
    const videoRecvInfo = isOriginator ? 'maxplus-v2-video-resp-to-orig' : 'maxplus-v2-video-orig-to-resp';

    const [audioSendBits, audioRecvBits, videoSendBits, videoRecvBits] = await Promise.all([
      crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(audioSendInfo) }, baseKey, 192),
      crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(audioRecvInfo) }, baseKey, 192),
      crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(videoSendInfo) }, baseKey, 192),
      crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(videoRecvInfo) }, baseKey, 192),
    ]);

    this.#audioSendKeyRaw = new Uint8Array(audioSendBits.slice(0, 16));
    this.#audioSendSalt = new Uint8Array(audioSendBits.slice(16, 24));
    this.#audioRecvKeyRaw = new Uint8Array(audioRecvBits.slice(0, 16));
    this.#audioRecvSalt = new Uint8Array(audioRecvBits.slice(16, 24));

    this.#videoSendKeyRaw = new Uint8Array(videoSendBits.slice(0, 16));
    this.#videoSendSalt = new Uint8Array(videoSendBits.slice(16, 24));
    this.#videoRecvKeyRaw = new Uint8Array(videoRecvBits.slice(0, 16));
    this.#videoRecvSalt = new Uint8Array(videoRecvBits.slice(16, 24));

    const [audioEnc, audioDec, videoEnc, videoDec] = await Promise.all([
      crypto.subtle.importKey('raw', this.#audioSendKeyRaw, { name: 'AES-GCM' }, false, ['encrypt']),
      crypto.subtle.importKey('raw', this.#audioRecvKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']),
      crypto.subtle.importKey('raw', this.#videoSendKeyRaw, { name: 'AES-GCM' }, false, ['encrypt']),
      crypto.subtle.importKey('raw', this.#videoRecvKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']),
    ]);

    this.#audioEncKey = audioEnc;
    this.#audioDecKey = audioDec;
    this.#videoEncKey = videoEnc;
    this.#videoDecKey = videoDec;

    const fpBits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('maxplus-fingerprint-v2') },
      baseKey,
      64
    );
    this.#fingerprint = bytesToHex(new Uint8Array(fpBits)).toUpperCase().match(/.{4}/g).join('-');

    this.#broadcastKeysToWorkers();
  }

  #broadcastKeysToWorkers() {
    for (const entry of this.#workers) {
      this.#sendWorkerKeys(entry.worker, entry.kind, entry.op);
    }
  }

  #sendWorkerKeys(worker, kind, op) {
    if (this.#mode === 'plain') return;
    const isVideo = kind === 'video';
    const keyRaw = op === 'encrypt'
      ? (isVideo ? this.#videoSendKeyRaw : this.#audioSendKeyRaw)
      : (isVideo ? this.#videoRecvKeyRaw : this.#audioRecvKeyRaw);
    const salt = op === 'encrypt'
      ? (isVideo ? this.#videoSendSalt : this.#audioSendSalt)
      : (isVideo ? this.#videoRecvSalt : this.#audioRecvSalt);

    if (keyRaw && salt) {
      worker.postMessage({
        type: 'setKeys',
        kind,
        op,
        keyRaw,
        salt,
      });
    }
  }

  async encryptFrame(data, kind = 'audio') {
    if (this.#mode === 'plain') return data;
    const encKey = kind === 'video' ? this.#videoEncKey : this.#audioEncKey;
    const salt = kind === 'video' ? this.#videoSendSalt : this.#audioSendSalt;
    if (!encKey || !salt) return data;

    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const unencryptedBytes = kind === 'video' ? ((raw.length > 0 && (raw[0] & 0x01) === 0) ? 10 : 3) : 1;
    if (raw.length <= unencryptedBytes) return data;

    const payload = raw.subarray(unencryptedBytes);
    const counter = kind === 'video' ? this.#videoFrameCounter++ : this.#audioFrameCounter++;
    const iv = new Uint8Array(12);
    iv.set(salt.subarray(0, Math.min(8, salt.length)), 0);
    new DataView(iv.buffer).setUint32(8, counter >>> 0, false);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      encKey,
      payload
    );
    const cipherBytes = new Uint8Array(ciphertext);

    const result = new Uint8Array(unencryptedBytes + cipherBytes.length + 14);
    result.set(raw.subarray(0, unencryptedBytes), 0);
    result.set(cipherBytes, unencryptedBytes);
    result.set(iv, unencryptedBytes + cipherBytes.length);
    result[result.length - 2] = 0x0c;
    result[result.length - 1] = 0x00;
    return result;
  }

  async decryptFrame(data, kind = 'audio') {
    if (this.#mode === 'plain') return data;
    const decKey = kind === 'video' ? this.#videoDecKey : this.#audioDecKey;
    if (!decKey) return data;

    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const unencryptedBytes = kind === 'video' ? ((raw.length > 0 && (raw[0] & 0x01) === 0) ? 10 : 3) : 1;
    if (raw.length < unencryptedBytes + 30) return data;
    if (raw[raw.length - 2] !== 0x0c) return data;

    const iv = raw.subarray(raw.length - 14, raw.length - 2);
    const ciphertext = raw.subarray(unencryptedBytes, raw.length - 14);

    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        decKey,
        ciphertext
      );
      const plainBytes = new Uint8Array(plain);
      const result = new Uint8Array(unencryptedBytes + plainBytes.length);
      result.set(raw.subarray(0, unencryptedBytes), 0);
      result.set(plainBytes, unencryptedBytes);
      return result;
    } catch {
      return null;
    }
  }

  applyToSender(sender, kind = 'audio') {
    if (!sender || sender._hasEncryptionTransform || this.#mode === 'plain') return;
    sender._hasEncryptionTransform = true;
    if (typeof RTCRtpScriptTransform !== 'undefined') {
      try {
        const worker = new Worker(new URL('./callEncryptionWorker.js', import.meta.url), { type: 'module' });
        this.#workers.add({ worker, kind, op: 'encrypt' });
        this.#sendWorkerKeys(worker, kind, 'encrypt');
        sender.transform = new RTCRtpScriptTransform(worker, { op: 'encrypt', kind });
        return;
      } catch {}
    }
    if (typeof sender?.createEncodedStreams === 'function') {
      try {
        const { readable, writable } = sender.createEncodedStreams();
        const transformStream = new TransformStream({
          transform: async (frame, controller) => {
            const enc = await this.encryptFrame(frame.data, kind);
            frame.data = enc.buffer || enc;
            controller.enqueue(frame);
          }
        });
        readable.pipeThrough(transformStream).pipeTo(writable).catch(() => {});
      } catch {}
    }
  }

  applyToReceiver(receiver, kind = 'audio') {
    if (!receiver || receiver._hasEncryptionTransform || this.#mode === 'plain') return;
    receiver._hasEncryptionTransform = true;
    if (typeof RTCRtpScriptTransform !== 'undefined') {
      try {
        const worker = new Worker(new URL('./callEncryptionWorker.js', import.meta.url), { type: 'module' });
        this.#workers.add({ worker, kind, op: 'decrypt' });
        this.#sendWorkerKeys(worker, kind, 'decrypt');
        receiver.transform = new RTCRtpScriptTransform(worker, { op: 'decrypt', kind });
        return;
      } catch {}
    }
    if (typeof receiver?.createEncodedStreams === 'function') {
      try {
        const { readable, writable } = receiver.createEncodedStreams();
        const transformStream = new TransformStream({
          transform: async (frame, controller) => {
            const dec = await this.decryptFrame(frame.data, kind);
            if (dec) {
              frame.data = dec.buffer || dec;
              controller.enqueue(frame);
            }
          }
        });
        readable.pipeThrough(transformStream).pipeTo(writable).catch(() => {});
      } catch {}
    }
  }
}

export function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export function bytesToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function concatBytes(...arrays) {
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
