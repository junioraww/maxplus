import { verifyHandshakePacket } from "$lib/crypto/asymmetric";
import { getProxiedMediaUrl } from "$lib/utils/images";
import { savePersistentStegoDto } from "$lib/crypto/transports";

const scannedResults = new Map();
const scanQueue = [];
let worker = null;
let isBusy = false;
let jobSeq = 1;
const pendingJobs = new Map();

function getWorker() {
  if (!worker && typeof Worker !== "undefined") {
    worker = new Worker(new URL("./stegoMediaWorker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, bytes } = e.data || {};
      const resolver = pendingJobs.get(id);
      if (resolver) {
        pendingJobs.delete(id);
        resolver(bytes ? new Uint8Array(bytes) : null);
      }
    };
    worker.onerror = () => {
      for (const [, res] of pendingJobs) res(null);
      pendingJobs.clear();
    };
  }
  return worker;
}

function runWorkerJob(kind, chatId, payload, transferables = []) {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = jobSeq++;
  return new Promise((resolve) => {
    pendingJobs.set(id, resolve);
    w.postMessage({ id, kind, chatId, payload }, transferables);
  });
}

function resolveAttachmentUrl(att) {
  if (att?.localPath) {
    return getProxiedMediaUrl(att.localPath);
  }
  const type = att?._type || att?.type;
  if (type === "PHOTO") {
    return att?.baseUrl || att?.url || att?.src || null;
  }
  return att?.url || att?.mp4 || att?.src || null;
}

async function loadCorsSafeImage(url) {
  const tryLoad = (src, useCors) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  try {
    return await tryLoad(url, true);
  } catch {
    const proxied = getProxiedMediaUrl(url);
    if (proxied && proxied !== url) {
      return await tryLoad(proxied, true);
    }
    throw new Error("Failed to load image for stego scan");
  }
}

async function decodeMediaSourceForStego(att, chatId, explicitUrl = null) {
  const type = att?._type || att?.type;
  if (type !== "PHOTO") return null;
  const url = explicitUrl || resolveAttachmentUrl(att);
  if (!url) return null;

  const img = await loadCorsSafeImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const buf = imgData.data.buffer;
  return runWorkerJob("PHOTO", chatId, { rgbaBuffer: buf, width: canvas.width, height: canvas.height }, [buf]);
}

async function processNext() {
  if (isBusy || !scanQueue.length) return;
  isBusy = true;
  while (scanQueue.length) {
    const { msg, chatId, onDecoded } = scanQueue.shift();
    try {
      const attaches = msg?.attaches || [];
      for (const att of attaches) {
        const t = att?._type || att?.type;
        if (t !== "PHOTO") continue;
        const extractedBytes = await decodeMediaSourceForStego(att, chatId).catch(() => null);
        if (!extractedBytes) continue;
        const dto = await verifyHandshakePacket(extractedBytes, chatId).catch(() => null);
        if (dto && (dto.is_handshake_request || dto.is_handshake_accept)) {
          scannedResults.set(`${chatId}:${msg.id}`, dto);
          savePersistentStegoDto(chatId, msg.id, dto);
          await onDecoded(msg, dto);
          break;
        }
      }
    } catch {}
    if (scanQueue.length) {
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  isBusy = false;
}

export function markStegoMessageScanned(chatId, msgId, dto = null) {
  if (chatId == null || msgId == null) return;
  scannedResults.set(`${chatId}:${msgId}`, dto);
}

export function enqueueStegoScan(messagesList, chatId, onDecoded) {
  if (!Array.isArray(messagesList) || chatId == null) return;
  for (const msg of messagesList) {
    if (!msg?.id || msg.deleted || !msg?.attaches?.length) continue;
    const key = `${chatId}:${msg.id}`;
    if (scannedResults.has(key)) {
      const cachedDto = scannedResults.get(key);
      if (cachedDto && typeof onDecoded === "function") {
        Promise.resolve().then(() => onDecoded(msg, cachedDto));
      }
      continue;
    }
    const hasReadyMedia = msg.attaches.some((a) => {
      const t = a?._type || a?.type;
      if (t !== "PHOTO" && t !== "AUDIO" && t !== "VIDEO") return false;
      return Boolean(resolveAttachmentUrl(a));
    });
    if (!hasReadyMedia) continue;
    scannedResults.set(key, null);
    scanQueue.push({ msg, chatId: Number(chatId), onDecoded });
  }
  if (!isBusy && scanQueue.length) {
    setTimeout(processNext, 25);
  }
}

export async function scanResolvedMediaUrl(msg, url, attachType, chatId, onDecoded) {
  if (!msg?.id || !url || chatId == null) return null;
  const key = `${chatId}:${msg.id}`;
  if (scannedResults.has(key)) {
    const cachedDto = scannedResults.get(key);
    if (cachedDto && typeof onDecoded === "function") await onDecoded(msg, cachedDto);
    return cachedDto;
  }
  scannedResults.set(key, null);
  const extractedBytes = await decodeMediaSourceForStego(
    { _type: attachType },
    Number(chatId),
    url
  ).catch(() => null);
  if (!extractedBytes) return null;
  const dto = await verifyHandshakePacket(extractedBytes, Number(chatId)).catch(() => null);
  if (dto && (dto.is_handshake_request || dto.is_handshake_accept)) {
    scannedResults.set(key, dto);
    savePersistentStegoDto(chatId, msg.id, dto);
    if (typeof onDecoded === "function") await onDecoded(msg, dto);
    return dto;
  }
  return null;
}
