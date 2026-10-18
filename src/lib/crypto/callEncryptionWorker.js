let encKey = null;
let decKey = null;
let salt = null;
let counter = 0;
let bypassDecrypt = false;
let bypassEncrypt = false;

self.addEventListener('message', async (e) => {
  if (e.data?.type === 'setKeys') {
    const { op, keyRaw, salt: s } = e.data;
    if (s) {
      salt = s instanceof Uint8Array ? s : new Uint8Array(s);
    }
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
    counter = 0;
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
          const payload = raw.subarray(unencryptedBytes);
          const iv = crypto.getRandomValues(new Uint8Array(12));

          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, tagLength: 128 },
            encKey,
            payload
          );
          const encBytes = new Uint8Array(encrypted);

          const out = new Uint8Array(unencryptedBytes + encBytes.length + 14);
          out.set(raw.subarray(0, unencryptedBytes), 0);
          out.set(encBytes, unencryptedBytes);
          out.set(iv, unencryptedBytes + encBytes.length);
          out[out.length - 2] = 0x0c;
          out[out.length - 1] = 0x00;

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
          && raw[raw.length - 2] === 0x0c
          && raw[raw.length - 1] === 0x00;

        if (isEncrypted) {
          if (!decKey) {
            continue;
          }
          const iv = raw.subarray(raw.length - 14, raw.length - 2);
          const cipherWithTag = raw.subarray(unencryptedBytes, raw.length - 14);

          try {
            const decrypted = await crypto.subtle.decrypt(
              { name: 'AES-GCM', iv, tagLength: 128 },
              decKey,
              cipherWithTag
            );
            const decBytes = new Uint8Array(decrypted);

            const out = new Uint8Array(unencryptedBytes + decBytes.length);
            out.set(raw.subarray(0, unencryptedBytes), 0);
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
