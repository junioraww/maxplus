import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { CryptoPluginRegistry } from "./plugins.js";

import { dict } from "./text-codec.js";

const ZH_BASE = 0x4E00;
const ZH_COUNT = 2048;

function isChineseMarker(text) {
  if (!text || typeof text !== "string" || text.length < 5) return false;
  for (let i = 0; i < 5; i++) {
    const cp = text.charCodeAt(i);
    if (cp < ZH_BASE || cp >= ZH_BASE + ZH_COUNT) return false;
    if (((cp - ZH_BASE) & 1) !== 0) return false;
  }
  return true;
}

export async function detectObfuscation(text) {
  if (!text || typeof text !== "string") return null;

  const pluginMatch = CryptoPluginRegistry.findObfuscator(text);
  if (pluginMatch) {
    return { name: pluginMatch.name, plugin: true };
  }

  if (isChineseMarker(text)) {
    return { name: "zh", plugin: false };
  }

  const dictionary = await dict.getDictionary().catch(() => null);
  if (dictionary?.dict8 && text.includes(" ") && !text.includes("\n")) {
    const words = text.trim().split(/\s+/);
    if (words.length >= 2) {
      const clean = (s) => s.replace(/[.,!?:—\-]/g, "").toLowerCase();
      const w0 = clean(words[0]);
      const w1 = clean(words[1]);
      const idx0 = dictionary.dict8.indexOf(w0);
      const idx1 = dictionary.dict8.indexOf(w1);
      if (idx0 !== -1 && idx1 !== -1 && dictionary.dict_sha256) {
        const miniHash = parseInt(dictionary.dict_sha256.slice(0, 1), 16) & 0x0F;
        const expected = (miniHash << 4) | (miniHash ^ 0x0A);
        const actual = ((idx0 & 0x0F) << 4) | (idx1 & 0x0F);
        if (actual === expected) {
          return { name: "words", plugin: false };
        }
      }
    }
  }

  return null;
}

export async function obfuscate(bytesOrText, obfuscatorName) {
  if (CryptoPluginRegistry.hasObfuscator(obfuscatorName)) {
    const handler = CryptoPluginRegistry.getObfuscator(obfuscatorName);
    return handler.obfuscate(bytesOrText);
  }
  return bytesOrText;
}

export async function batchDecrypt(account, chatId, messages, password = null) {
  if (!messages || !messages.length) return {};

  const payloadMessages = messages.map((m) => ({
    id: m.id,
    text: m.text,
    sender: m.sender,
    time: m.time || m.created_at || null,
  }));

  const rustDecrypted = await invoke("batch_decrypt_messages", {
    account: Number(account),
    chatId: Number(chatId),
    messages: payloadMessages,
    password: password || null,
  });

  for (const [id, dec] of Object.entries(rustDecrypted)) {
    if (dec?.media) {
      console.log("[E2E Decrypted Media]", {
        messageId: id,
        realFileName: dec.media.name,
        size: dec.media.size,
        mediaType: dec.media.media_type,
        color: dec.media.color,
        metaText: dec.text,
      });
    }
  }

  const pluginPromises = [];
  for (const msg of messages) {
    const msgId = String(msg.id);
    if (rustDecrypted[msgId]) continue;

    const pluginMatch = CryptoPluginRegistry.findObfuscator(msg.text);
    if (pluginMatch) {
      pluginPromises.push(
        (async () => {
          try {
            const text = await pluginMatch.handler.deobfuscate(msg.text);
            return [
              msgId,
              {
                text,
                obf: pluginMatch.name,
                is_encrypted: true,
                media: null,
                is_handshake_request: false,
                is_handshake_accept: false,
                handshake_data: null,
                error: null,
              },
            ];
          } catch (e) {
            return [
              msgId,
              {
                text: String(msg.text),
                obf: pluginMatch.name,
                is_encrypted: true,
                media: null,
                is_handshake_request: false,
                is_handshake_accept: false,
                handshake_data: null,
                error: String(e),
              },
            ];
          }
        })()
      );
    }
  }

  if (pluginPromises.length > 0) {
    const pluginResults = await Promise.all(pluginPromises);
    for (const [id, dto] of pluginResults) {
      rustDecrypted[id] = dto;
    }
  }

  return rustDecrypted;
}

export async function encryptMessage({
  account,
  chatId,
  text = "",
  media = null,
  password = null,
  useSession = false,
  obf = null,
}) {
  return invoke("encrypt_message", {
    account: Number(account),
    chatId: Number(chatId),
    text,
    media: media || null,
    password: password || null,
    useSession: Boolean(useSession),
    obf: obf || null,
  });
}

const DECOY_BASENAMES = [
  "document_scan",
  "report_draft",
  "financial_statement",
  "project_overview",
  "presentation_summary",
  "meeting_notes",
  "invoice_archive",
  "specs_v2",
  "contract_agreement",
  "lecture_summary",
  "research_data",
  "quarterly_review",
  "system_log",
  "backup_archive",
  "budget_overview"
];

const DECOY_FORMATS = {
  pdf: { ext: "pdf", mime: "application/pdf" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  ogg: { ext: "ogg", mime: "audio/ogg" }
};

export async function extractDominantColor(filePath) {
  if (!filePath) return "#3a506b";
  const cleanPath = String(filePath).replace(/^file:\/\//, "");

  if (typeof document !== "undefined") {
    try {
      const hex = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 1200);
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          clearTimeout(timer);
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) { resolve(null); return; }
            ctx.drawImage(img, 0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            const res = "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
            resolve(res);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        img.src = typeof convertFileSrc === "function" ? convertFileSrc(cleanPath) : cleanPath;
      });
      if (hex) return hex;
    } catch (_) {}
  }

  let hash = 0;
  for (let i = 0; i < cleanPath.length; i++) {
    hash = ((hash << 5) - hash) + cleanPath.charCodeAt(i);
    hash |= 0;
  }
  const fallbackColors = [
    "#3a506b", "#5bc0be", "#1c2541", "#4a4e69",
    "#2b2d42", "#8d99ae", "#386641", "#6a4c93",
    "#197278", "#c44900", "#5c4d7d", "#283618"
  ];
  return fallbackColors[Math.abs(hash) % fallbackColors.length];
}

export async function encryptMediaAttachment({
  account,
  chatId,
  attach,
  password = null,
}) {
  const origType = attach._type || attach.type || "FILE";
  const origName = attach.name || (
    origType === "PHOTO" ? "photo.jpg" :
    origType === "AUDIO" ? "audio.ogg" :
    origType === "VIDEO" ? "video.mp4" : "file"
  );
  const origMime = attach.mime || (
    origType === "PHOTO" ? "image/jpeg" :
    origType === "AUDIO" ? "audio/ogg" :
    origType === "VIDEO" ? "video/mp4" : "application/octet-stream"
  );

  let possibleTypes = ["pdf", "docx", "xlsx"];
  if (origType === "AUDIO") {
    possibleTypes = ["mp3", "ogg"];
  } else if (origType === "VIDEO") {
    possibleTypes = ["docx", "pdf", "xlsx"];
  }
  const dummyType = possibleTypes[Math.floor(Math.random() * possibleTypes.length)];
  const formatInfo = DECOY_FORMATS[dummyType] || DECOY_FORMATS.pdf;
  const baseName = DECOY_BASENAMES[Math.floor(Math.random() * DECOY_BASENAMES.length)];
  const decoyName = `${baseName}.${formatInfo.ext}`;
  const decoyMime = formatInfo.mime;

  const targetPath = attach.path || attach.localPath;

  let color = null;
  if (origType === "PHOTO") {
    color = await extractDominantColor(targetPath);
  }

  const encPath = await invoke("encrypt_media_file", {
    account: Number(account),
    chatId: Number(chatId),
    filePath: targetPath,
    dummyType,
    password: password || null,
  });

  const mediaDescriptor = {
    attach_index: 0,
    name: origName,
    mime: origMime,
    media_type: origType,
    size: Number(attach.size || 0),
    width: attach.width ? Number(attach.width) : null,
    height: attach.height ? Number(attach.height) : null,
    duration: attach.duration ? Number(attach.duration) : null,
    wave: Array.isArray(attach.wave) ? attach.wave : null,
    video_type: attach.videoType != null ? Number(attach.videoType) : (attach.video_type != null ? Number(attach.video_type) : null),
    color: color || null,
  };

  console.log("[E2E Encrypted Media]", {
    realFileName: origName,
    size: mediaDescriptor.size,
    mediaType: origType,
    color,
    targetPath,
    decoyName,
    dummyType,
  });

  const uploadAttach = {
    type: "FILE",
    path: encPath,
    name: decoyName,
    mime: decoyMime,
  };

  return { uploadAttach, mediaDescriptor };
}
