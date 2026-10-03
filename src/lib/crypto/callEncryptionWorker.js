const FRAME_HEADER_SIZE = 10;
let encKey = null;
let decKey = null;
let counter = 0;

self.onrtctransform = async (event) => {
  const { readable, writable, options } = event.transformer;
  const reader = readable.getReader();
  const writer = writable.getWriter();
  while (true) {
    const { value: frame, done } = await reader.read();
    if (done) break;
    try {
      if (options.op === 'encrypt' && encKey) {
        const iv = new Uint8Array(12);
        new DataView(iv.buffer).setUint32(8, counter++, false);
        const plain = new Uint8Array(frame.data);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, encKey, plain);
        const out = new Uint8Array(FRAME_HEADER_SIZE + encrypted.byteLength);
        const dv = new DataView(out.buffer);
        dv.setUint8(0, 0x4d); dv.setUint8(1, 0x58);
        dv.setUint32(2, counter - 1, false);
        out.set(iv, 6);
        out.set(new Uint8Array(encrypted), FRAME_HEADER_SIZE);
        frame.data = out.buffer;
      } else if (options.op === 'decrypt' && decKey) {
        const bytes = new Uint8Array(frame.data);
        if (bytes[0] === 0x4d && bytes[1] === 0x58 && bytes.length > FRAME_HEADER_SIZE) {
          const iv = bytes.slice(6, 18);
          const cipher = bytes.slice(FRAME_HEADER_SIZE);
          const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, decKey, cipher);
          frame.data = plain;
        }
      }
    } catch (e) {
    }
    await writer.write(frame);
  }
};

self.addEventListener('message', async (e) => {
  if (e.data.type === 'setKeys') {
    encKey = e.data.encKey;
    decKey = e.data.decKey;
  }
});
