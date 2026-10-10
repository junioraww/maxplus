let encKey = null;
let decKey = null;
let salt = null;
let counter = 0;

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
        const raw = new Uint8Array(frame.data);
        const unencryptedBytes = kind === 'video' ? (frame.type === 'key' ? 10 : 3) : 1;

        if (raw.length > unencryptedBytes) {
          const payload = raw.subarray(unencryptedBytes);
          const iv = new Uint8Array(12);
          iv.set(salt.subarray(0, Math.min(8, salt.length)), 0);
          new DataView(iv.buffer).setUint32(8, (counter++) >>> 0, false);

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
      } else if (op === 'decrypt' && decKey) {
        const raw = new Uint8Array(frame.data);
        const unencryptedBytes = kind === 'video' ? (frame.type === 'key' ? 10 : 3) : 1;

        if (raw.length >= unencryptedBytes + 30 && raw[raw.length - 2] === 0x0c) {
          const iv = raw.subarray(raw.length - 14, raw.length - 2);
          const cipherWithTag = raw.subarray(unencryptedBytes, raw.length - 14);

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
        }
      }
    } catch {}

    await writer.write(frame);
  }
};
