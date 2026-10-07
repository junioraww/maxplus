const FRAME_HEADER_SIZE = 7;
let encKey = null;
let decKey = null;
let salt = null;
let counter = 0;

self.addEventListener('message', async (e) => {
  if (e.data?.type === 'setKeys') {
    const { op, keyRaw, salt: s } = e.data;
    salt = s instanceof Uint8Array ? s : new Uint8Array(s);
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

  while (true) {
    const { value: frame, done } = await reader.read();
    if (done) break;

    try {
      if (op === 'encrypt' && encKey && salt) {
        const iv = new Uint8Array(12);
        iv.set(salt, 0);
        new DataView(iv.buffer).setUint32(8, counter++, false);

        const plain = new Uint8Array(frame.data);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, encKey, plain);

        const out = new Uint8Array(FRAME_HEADER_SIZE + encrypted.byteLength);
        const dv = new DataView(out.buffer);
        dv.setUint8(0, 0x4d);
        dv.setUint8(1, 0x58);
        dv.setUint8(2, 0x01);
        dv.setUint32(3, counter - 1, false);
        out.set(new Uint8Array(encrypted), FRAME_HEADER_SIZE);

        frame.data = out.buffer;
      } else if (op === 'decrypt' && decKey && salt) {
        const bytes = new Uint8Array(frame.data);
        if (bytes.length >= FRAME_HEADER_SIZE + 16 && bytes[0] === 0x4d && bytes[1] === 0x58) {
          const type = bytes[2];
          if (type === 0x01) {
            const pktCounter = new DataView(bytes.buffer, bytes.byteOffset).getUint32(3, false);
            const iv = new Uint8Array(12);
            iv.set(salt, 0);
            new DataView(iv.buffer).setUint32(8, pktCounter, false);

            const cipher = bytes.slice(FRAME_HEADER_SIZE);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, decKey, cipher);
            frame.data = plain;
          } else if (type === 0x02 || type === 0x03) {
            const payload = bytes.slice(FRAME_HEADER_SIZE);
            self.postMessage({ type: 'inbandHandshake', handshakeType: type, pubkey: Array.from(payload) });
            frame.data = new ArrayBuffer(0);
          }
        }
      }
    } catch {}

    await writer.write(frame);
  }
};
