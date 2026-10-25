import { decodeStegoPayload } from "./stego.js";

self.onmessage = async (e) => {
  const { bitmap, targetEntityId, key } = e.data || {};
  if (!bitmap || !targetEntityId) return;

  try {
    const sw = bitmap.width;
    const sh = bitmap.height;
    if (sw < 64 || sh < 64) {
      if (typeof bitmap.close === "function") bitmap.close();
      self.postMessage({ foundUid: null, targetEntityId, key });
      return;
    }

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (typeof bitmap.close === "function") bitmap.close();
      self.postMessage({ foundUid: null, targetEntityId, key });
      return;
    }

    ctx.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === "function") bitmap.close();

    const imgData = ctx.getImageData(0, 0, sw, sh);
    if (!imgData) {
      self.postMessage({ foundUid: null, targetEntityId, key });
      return;
    }

    const foundUid = decodeStegoPayload(imgData, targetEntityId);
    self.postMessage({ foundUid: foundUid || null, targetEntityId, key });
  } catch {
    self.postMessage({ foundUid: null, targetEntityId, key });
  }
};
