import { extractStegoFromImageData } from "./stegoMedia.js";

self.onmessage = async (e) => {
  const { id, kind, chatId, payload } = e.data || {};
  try {
    let extracted = null;
    if (kind === "PHOTO") {
      extracted = await extractStegoFromImageData(
        new Uint8ClampedArray(payload.rgbaBuffer),
        payload.width,
        payload.height,
        chatId
      );
    }
    self.postMessage(
      { id, bytes: extracted ? extracted.buffer : null },
      extracted ? [extracted.buffer] : []
    );
  } catch (err) {
    self.postMessage({ id, bytes: null, error: String(err) });
  }
};
