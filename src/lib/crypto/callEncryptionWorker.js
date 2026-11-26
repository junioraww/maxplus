const SFRAME_MAGIC_BYTE = 0x0c;

let encKey = null;
let decKey = null;
let salt = null;
let keyId = 0;
let counter = 0n;
let bypassDecrypt = false;
let bypassEncrypt = false;

function buildCounterIv(baseSalt12, frameCounter) {
  const iv = new Uint8Array(12);
  iv.set(baseSalt12.subarray(0, 12), 0);
  const c = BigInt(frameCounter);
  for (let i = 0; i < 8; i++) {
    iv[11 - i] ^= Number((c >> BigInt(i * 8)) & 0xffn);
  }
  return iv;
}

function buildFrameAad(headerBytes, kid) {
  const aad = new Uint8Array(headerBytes.length + 2);
  aad.set(headerBytes, 0);
  aad[headerBytes.length] = SFRAME_MAGIC_BYTE;
  aad[headerBytes.length + 1] = kid & 0xff;
  return aad;
}

self.addEventListener('message', async (e) => {
  if (e.data?.type === 'setKeys') {
    const { op, keyRaw, salt: s, keyId: kid } = e.data;
    if (s) {
      salt = s instanceof Uint8Array ? s : new Uint8Array(s);
    }
    if (typeof kid === 'number') {
      keyId = kid & 0xff;
    }
    counter = 0n;
    if (op === 'encrypt' && keyRaw) {
      encKey = await crypto.subtle.importKey(
        'raw',
        keyRaw instanceof Uint8Array ? keyRaw : new Uint8Array(keyRaw),
        { name: 'AES-GCM' },
        false,
        ['encrypt']
      );
    } else if (op === 'decrypt' && keyRaw) {
      decKey = await crypto.subtle.importKey(
        'raw',
        keyRaw instanceof Uint8Array ? keyRaw : new Uint8Array(keyRaw),
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );
    }
  } else if (e.data?.type === 'clearKeys') {
    encKey = null;
    decKey = null;
    salt = null;
    keyId = 0;
    counter = 0n;
  } else if (e.data?.type === 'setBypassDecrypt') {
    bypassDecrypt = Boolean(e.data.bypass);
  } else if (e.data?.type === 'setBypassEncrypt') {
    bypassEncrypt = Boolean(e.data.bypass);
  }
});

self.onrtctransform = async (event) => {
  const { readable, writable, options } = event.transformer;
  const reader = readable.getReader();
  const writer = writable.getWriter();
  const op = options?.op;
  const kind = options?.kind || 'audio';

  while (true) {
    const { value: frame, done } = await reader.read();
    if (done) break;

    try {
      if (op === 'encrypt' && encKey && salt) {
        if (bypassEncrypt) {
          await writer.write(frame);
          continue;
        }
        const raw = new Uint8Array(frame.data);
        const isKey = (frame.type === 'key') || (raw.length > 0 && (raw[0] & 0x01) === 0);
        const unencryptedBytes = kind === 'video' ? (isKey ? 10 : 3) : 1;

        if (raw.length > unencryptedBytes) {
          const headerBytes = raw.subarray(0, unencryptedBytes);
          const payload = raw.subarray(unencryptedBytes);
          const iv = buildCounterIv(salt, counter++);
          const additionalData = buildFrameAad(headerBytes, keyId);

          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
            encKey,
            payload
          );
          const encBytes = new Uint8Array(encrypted);

          const out = new Uint8Array(unencryptedBytes + encBytes.length + 14);
          out.set(headerBytes, 0);
          out.set(encBytes, unencryptedBytes);
          out.set(iv, unencryptedBytes + encBytes.length);
          out[out.length - 2] = SFRAME_MAGIC_BYTE;
          out[out.length - 1] = keyId & 0xff;

          frame.data = out.buffer;
        }
        await writer.write(frame);
      } else if (op === 'decrypt') {
        if (bypassDecrypt) {
          await writer.write(frame);
          continue;
        }

        const raw = new Uint8Array(frame.data);
        const isKey = (frame.type === 'key') || (raw.length > 0 && (raw[0] & 0x01) === 0);
        const unencryptedBytes = kind === 'video' ? (isKey ? 10 : 3) : 1;
        const isEncrypted = raw.length >= unencryptedBytes + 30
          && raw[raw.length - 2] === SFRAME_MAGIC_BYTE;

        if (isEncrypted) {
          if (!decKey) {
            continue;
          }
          const headerBytes = raw.subarray(0, unencryptedBytes);
          const frameKeyId = raw[raw.length - 1];
          const iv = raw.subarray(raw.length - 14, raw.length - 2);
          const cipherWithTag = raw.subarray(unencryptedBytes, raw.length - 14);
          const additionalData = buildFrameAad(headerBytes, frameKeyId);

          try {
            const decrypted = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
              decKey,
              cipherWithTag
            );
            const decBytes = new Uint8Array(decrypted);

            const out = new Uint8Array(unencryptedBytes + decBytes.length);
            out.set(headerBytes, 0);
            out.set(decBytes, unencryptedBytes);

            frame.data = out.buffer;
            await writer.write(frame);
          } catch {}
          continue;
        }

        await writer.write(frame);
      } else {
        await writer.write(frame);
      }
    } catch {
      try {
        await writer.write(frame);
      } catch {}
    }
  }
};
