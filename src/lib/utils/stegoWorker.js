import { decodeStegoPayload } from "./stego.js";

self.onmessage = async (e) => {
  const { bitmap, targetEntityId } = e.data || {};
  if (!bitmap || !targetEntityId) return;

  try {
    const sw = bitmap.width;
    const sh = bitmap.height;
    if (sw < 64 || sh < 64) {
      if (typeof bitmap.close === "function") bitmap.close();
      return;
    }

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (typeof bitmap.close === "function") bitmap.close();
      return;
    }

    ctx.drawImage(bitmap, 0, 0);
    if (typeof bitmap.close === "function") bitmap.close();

    const imgData = ctx.getImageData(0, 0, sw, sh);
    if (!imgData) return;

    const foundUid = decodeStegoPayload(imgData, targetEntityId);
    if (foundUid) {
      self.postMessage({ foundUid, targetEntityId });
    }
  } catch {}
};
