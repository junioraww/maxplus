import { get } from "svelte/store";
import API, { currentUser } from "$lib/stores/api";
import { getCurrentAccount } from "$lib/stores/accounts";
import {
  initHandshake,
  acceptHandshake,
  processAccept,
  getEncryptionInfo,
} from "$lib/crypto/asymmetric.js";
import { sendMessage } from "$components/ChatWindow/actions.js";

const pendingRequests = new Map();
const blockedRequests = new Map();
const rejectedRequests = new Map();
const dismissedRequests = new Set();

function getRejectedSet(chatId, settings) {
  let set = rejectedRequests.get(Number(chatId));
  if (!set) {
    set = new Set();
    rejectedRequests.set(Number(chatId), set);
  }
  if (Array.isArray(settings?.rejected_handshakes)) {
    for (const id of settings.rejected_handshakes) {
      set.add(String(id));
    }
  }
  if (Array.isArray(settings?.handled_handshakes)) {
    for (const id of settings.handled_handshakes) {
      set.add(String(id));
    }
  }
  return set;
}

export function dismissRequest(chatId, messageId) {
  if (messageId) {
    dismissedRequests.add(String(messageId));
  }
  pendingRequests.delete(Number(chatId));
}

export const pendingRequestStore = {
  get(chatId) {
    return pendingRequests.get(Number(chatId));
  },
  set(chatId, req) {
    pendingRequests.set(Number(chatId), req);
  },
  delete(chatId) {
    pendingRequests.delete(Number(chatId));
  },
};

export async function checkForEncryptionRequest(
  chat,
  chatSettings,
  decryptedBatch,
  newMessages = []
) {
  if (!chat || !decryptedBatch || chat.type === "CHAT") return null;

  const currentUid = get(currentUser);
  const isSavedMessagesChat = Number(chat.id) === 0 || Number(chat.id) === Number(currentUid);
  const blockedUntil = blockedRequests.get(Number(chat.id));
  if (blockedUntil && blockedUntil > Date.now()) {
    return null;
  }

  const currentSettings = get(chatSettings);
  const isSessionActive = Boolean(
    currentSettings?.keys?.current ||
    currentSettings?.session?.shared_secret ||
    currentSettings?.session?.fingerprint
  );
  const establishedAt = Number(currentSettings?.session?.established_at || 0);
  const rejectedSet = getRejectedSet(chat.id, currentSettings);

  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);

  let detectedRequest = null;

  for (const msg of newMessages) {
    const msgIdStr = String(msg.id);
    if (rejectedSet.has(msgIdStr) || dismissedRequests.has(msgIdStr)) {
      continue;
    }

    const dec = decryptedBatch[msgIdStr];
    if (!dec) continue;

    const isFromMe = Number(msg.sender) === Number(currentUid);

    if (dec.is_handshake_request && dec.handshake_data) {
      if (isSessionActive) {
        const msgTime = Number(msg.time || msg.created_at || 0);
        if (!msgTime || !establishedAt || msgTime <= establishedAt) {
          continue;
        }
      }

      if (!isFromMe || isSavedMessagesChat) {
        detectedRequest = {
          chatId: chat.id,
          messageId: msg.id,
          handshakeData: dec.handshake_data,
        };
        pendingRequests.set(Number(chat.id), detectedRequest);
      }
    } else if (dec.is_handshake_accept && dec.handshake_data) {
      if (currentSettings?.pending && !currentSettings?.session?.fingerprint && (!isFromMe || isSavedMessagesChat)) {
        try {
          const fingerprint = await processAccept(
            accId,
            chat.id,
            dec.handshake_data
          );
          chatSettings.update((old) => ({
            ...old,
            pending: false,
            session: {
              ...(old.session || {}),
              fingerprint,
            },
            keys: {
              ...(old.keys || {}),
              current: 1,
            },
          }));
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  return detectedRequest;
}

export async function handleEnc(chat, chatSettings, messages, action) {
  const req = pendingRequests.get(Number(chat.id));
  if (!req) return;

  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);

  if (action === "agree") {
    try {
      const obf = get(chatSettings)?.obfs || "zh";
      const replyPacket = await acceptHandshake(
        accId,
        chat.id,
        req.handshakeData,
        obf
      );

      pendingRequests.delete(Number(chat.id));

      await sendMessage(
        chat,
        chatSettings,
        messages,
        replyPacket,
        undefined,
        undefined,
        undefined,
        true
      );

      const info = await getEncryptionInfo(accId, chat.id);
      const msgId = req?.messageId ? String(req.messageId) : null;
      if (msgId) {
        const set = getRejectedSet(chat.id, get(chatSettings));
        set.add(msgId);
      }
      chatSettings.update((old) => ({
        ...old,
        pending: false,
        handled_handshakes: Array.from(
          new Set([...(old?.handled_handshakes || []), ...(msgId ? [msgId] : [])])
        ),
        rejected_handshakes: Array.from(
          new Set([...(old?.rejected_handshakes || []), ...(msgId ? [msgId] : [])])
        ),
        session: {
          ...(old?.session || {}),
          fingerprint: info?.fingerprint,
          established_at: Date.now(),
        },
        keys: {
          ...(old?.keys || {}),
          current: 1,
        },
      }));
    } catch (e) {
      console.error(e);
      alert(String(e));
    }
  } else if (action === "deny") {
    const msgId = req?.messageId ? String(req.messageId) : null;
    if (msgId) {
      const set = getRejectedSet(chat.id, get(chatSettings));
      set.add(msgId);
      chatSettings.update((old) => ({
        ...old,
        rejected_handshakes: Array.from(
          new Set([...(old?.rejected_handshakes || []), msgId])
        ),
      }));
    }
    pendingRequests.delete(Number(chat.id));
  } else if (action === "block") {
    const msgId = req?.messageId ? String(req.messageId) : null;
    if (msgId) {
      const set = getRejectedSet(chat.id, get(chatSettings));
      set.add(msgId);
    }
    blockedRequests.set(Number(chat.id), Date.now() + 5 * 60 * 1000);
    pendingRequests.delete(Number(chat.id));
  }
}

export async function switchEnc(chat, chatSettings, messages) {
  if (!chat || chat.type === "CHAT") return;
  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);
  const settings = get(chatSettings);
  const isSessionActive = Boolean(settings?.keys?.current || settings?.session);

  if (!isSessionActive) {
    try {
      const obf = settings?.obfs || "zh";
      const initPacket = await initHandshake(accId, chat.id, obf);

      chatSettings.update((old) => ({
        ...old,
        pending: true,
      }));

      await sendMessage(
        chat,
        chatSettings,
        messages,
        initPacket,
        undefined,
        undefined,
        undefined,
        true
      );
    } catch (e) {
      console.error(e);
      alert(String(e));
    }
  } else {
    chatSettings.update((old) => {
      const next = { ...old };
      delete next.session;
      delete next.pending;
      next.keys = {
        ...(next.keys || {}),
        current: null,
      };
      return next;
    });
  }
}

export async function fetchChatEncryptionInfo(chatId) {
  const account = await getCurrentAccount();
  if (!account?.id) return { active: false, fingerprint: null };
  return getEncryptionInfo(account.id, chatId);
}
