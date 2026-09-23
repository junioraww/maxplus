import { invoke } from "@tauri-apps/api/core";
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

  for (const msg of messages) {
    const msgId = String(msg.id);
    if (rustDecrypted[msgId]) continue;

    const pluginMatch = CryptoPluginRegistry.findObfuscator(msg.text);
    if (pluginMatch) {
      try {
        const text = await pluginMatch.handler.deobfuscate(msg.text);
        rustDecrypted[msgId] = {
          text,
          obf: pluginMatch.name,
          is_encrypted: true,
          media: null,
          is_handshake_request: false,
          is_handshake_accept: false,
          handshake_data: null,
          error: null,
        };
      } catch (e) {
        rustDecrypted[msgId] = {
          text: String(msg.text),
          obf: pluginMatch.name,
          is_encrypted: true,
          media: null,
          is_handshake_request: false,
          is_handshake_accept: false,
          handshake_data: null,
          error: String(e),
        };
      }
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
