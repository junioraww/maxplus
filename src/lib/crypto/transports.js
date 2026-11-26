import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import API, { currentRealChats, currentUser } from "$lib/stores/api";
import { getChat, saveChats } from "$lib/stores/messages";
import { generateRandomStegoMedia } from "$lib/crypto/stegoMedia";
import { verifyHandshakePacket } from "$lib/crypto/asymmetric";
import { markStegoMessageScanned } from "$lib/crypto/stegoScanner";
import { sendMessage } from "$components/ChatWindow/actions";
import { CallService } from "$lib/services/CallService";

const decodedStoresByChat = new Map();
const outgoingStegoDtos = new Map();
const pendingCallHandshakes = new Map();

export function queueCallHandshake(detail) {
  if (!detail?.packetBase64) return;
  const key = detail.chatId != null ? `c:${detail.chatId}` : `p:${detail.peerId}`;
  pendingCallHandshakes.set(key, detail);
}

export function consumeCallHandshake(chatId, peerId) {
  const byChat = chatId != null ? pendingCallHandshakes.get(`c:${chatId}`) : null;
  if (byChat) {
    pendingCallHandshakes.delete(`c:${chatId}`);
    return byChat;
  }
  const byPeer = peerId != null ? pendingCallHandshakes.get(`p:${peerId}`) : null;
  if (byPeer) {
    pendingCallHandshakes.delete(`p:${peerId}`);
    return byPeer;
  }
  return null;
}

function readStegoStorageMap(chatId) {
  try {
    const raw = localStorage.getItem(`maxplus_stego_v1_${chatId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePersistentStegoDto(chatId, msgId, dto) {
  if (chatId == null || msgId == null || !dto) return;
  const cacheKey = `${chatId}:${msgId}`;
  if (outgoingStegoDtos.size > 200) {
    const oldestKey = outgoingStegoDtos.keys().next().value;
    outgoingStegoDtos.delete(oldestKey);
  }
  outgoingStegoDtos.set(cacheKey, dto);
  try {
    const map = readStegoStorageMap(chatId);
    map[String(msgId)] = dto;
    const keys = Object.keys(map);
    if (keys.length > 50) {
      delete map[keys[0]];
    }
    localStorage.setItem(`maxplus_stego_v1_${chatId}`, JSON.stringify(map));
  } catch {}
}

export function registerDecodedMessagesStore(chatId, store) {
  if (chatId == null || !store) return;
  decodedStoresByChat.set(String(chatId), store);
}

export function getOutgoingHandshakeDto(chatId, msgId) {
  if (chatId == null || msgId == null) return null;
  const mem = outgoingStegoDtos.get(`${chatId}:${msgId}`);
  if (mem) return mem;
  const stored = readStegoStorageMap(chatId)?.[String(msgId)] || null;
  if (stored) outgoingStegoDtos.set(`${chatId}:${msgId}`, stored);
  return stored;
}

export const HANDSHAKE_MODES = [
  { id: "stego", label: "Стеганография", hint: "Случайное фото, аудио или видео" },
  { id: "call_audio", label: "Аудиозвонок", hint: "Обмен через DataChannel звонка" },
  { id: "call_video", label: "Видеозвонок", hint: "Обмен через DataChannel видеозвонка" },
  { id: "chat", label: "Текст в чате", hint: "Обфускация выбранного типа" },
];

export function resolveHandshakeMode(settings) {
  return settings?.handshake_transport || "stego";
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sleepRandomTypingDelay() {
  const ms = 1000 + Math.floor(Math.random() * 2000);
  await new Promise((r) => setTimeout(r, ms));
}

async function sendViaStegoMedia(chat, packetBytes) {
  const api = get(API);
  if (!api?.uploadAttachment || !api?.sendMessage) {
    throw new Error("API upload недоступен");
  }

  const generated = await generateRandomStegoMedia(packetBytes, chat.id);
  await new Promise((r) => setTimeout(r, 500 + Math.floor(Math.random() * 1200)));
  const savedPath = await invoke("save_temp_media", {
    bytes: Array.from(generated.bytes),
    extension: generated.ext,
    isVideo: generated.type === "VIDEO",
  });

  const uploaded = await api.uploadAttachment({
    type: generated.type,
    path: savedPath,
    mime: generated.mime,
    name: generated.name,
    videoType: generated.videoType,
    duration: generated.duration,
    wave: generated.wave,
  });

  if (!uploaded) {
    throw new Error(`Не удалось загрузить ${generated.type} со стеганографией`);
  }

  const cid = -Date.now();
  const res = await api.sendMessage("", chat.id, {
    notify: true,
    cid,
    attaches: [uploaded],
    elements: [],
  });

  if (res?.error || !res?.message) {
    return res || { error: "Сервер не подтвердил отправку медиа" };
  }

  markStegoMessageScanned(chat.id, res.message.id);
  const dto = await verifyHandshakePacket(packetBytes, chat.id).catch(() => null);
  if (dto && (dto.is_handshake_request || dto.is_handshake_accept)) {
    savePersistentStegoDto(chat.id, res.message.id, dto);
    const store = decodedStoresByChat.get(String(chat.id));
    if (store) {
      store.update((old) => ({ ...old, [String(res.message.id)]: dto }));
    }
  }

  const fullMsg = {
    ...res.message,
    chatId: chat.id,
    attaches: Array.isArray(res.message.attaches)
      ? res.message.attaches.map((a, idx) => (idx === 0 ? { ...a, localPath: savedPath } : a))
      : res.message.attaches,
    sender: res.message.sender || get(currentUser),
    time: res.message.time || Date.now(),
    status: 1,
    sending: false,
  };
  const chatCache = getChat(chat.id);
  chatCache.receivedMessage.set(fullMsg);
  chatCache.updateMessages([fullMsg]);

  currentRealChats.update((ids) => {
    const idStr = String(chat.id);
    return [chat.id, ...(ids || []).filter((x) => String(x) !== idStr)];
  });
  saveChats([
    { ...chat, id: chat.id, lastMessage: fullMsg, lastEventTime: fullMsg.time },
  ]).catch(() => {});

  return res;
}

function resolveCallPeerId(chat) {
  if (chat?.peerId) return Number(chat.peerId);
  const myId = get(currentUser);
  if (chat?.participants && myId != null) {
    const other = Object.keys(chat.participants).find((id) => String(id) !== String(myId));
    if (other) return Number(other);
  }
  if (chat?.type === "DIALOG" && chat?.id != null && myId != null) {
    try {
      return Number(BigInt(chat.id) ^ BigInt(myId));
    } catch {}
  }
  return chat?.id ? Number(chat.id) : null;
}

async function sendViaCallChannel(chat, rawPacketBase64, isVideo) {
  const peerId = resolveCallPeerId(chat);
  if (!peerId) throw new Error("Не удалось определить собеседника для звонка");

  if (isVideo && typeof CallService.placeVideoCall === "function") {
    await CallService.placeVideoCall(peerId, chat?.title || "", null);
  } else if (typeof CallService.placeAudioCall === "function") {
    await CallService.placeAudioCall(peerId, chat?.title || "", null);
  } else {
    throw new Error("Сервис звонков недоступен");
  }

  try {
    const sent = await CallService.sendE2eHandshakePacket(rawPacketBase64, chat.id);
    if (!sent) {
      throw new Error("Собеседник не ответил на звонок для обмена ключами");
    }
    return { message: { id: Date.now(), time: Date.now() } };
  } finally {
    CallService.hangup?.().catch(() => {});
  }
}

export async function sendHandshakePacket({
  mode,
  chat,
  chatSettings,
  messages,
  rawPacketBase64 = null,
  textPacket = null,
}) {
  if (mode === "stego") {
    const bytes = base64ToBytes(rawPacketBase64);
    return sendViaStegoMedia(chat, bytes);
  }

  if (mode === "call_audio" || mode === "call_video") {
    return sendViaCallChannel(chat, rawPacketBase64, mode === "call_video");
  }

  // "chat" fallback: artificial 1-3s typing pause before sending obfuscated text
  await sleepRandomTypingDelay();
  return sendMessage(
    chat,
    chatSettings,
    messages,
    textPacket,
    undefined,
    undefined,
    undefined,
    true
  );
}
