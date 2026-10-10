import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import API, { currentUser } from "$lib/stores/api";
import { getCurrentAccount } from "$lib/stores/accounts";
import {
  initHandshake,
  acceptHandshake,
  processAccept,
  getEncryptionInfo,
} from "$lib/crypto/asymmetric.js";
import { sendMessage } from "$components/ChatWindow/actions.js";
import { CallService } from "$lib/services/CallService.js";

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
  if (Array.isArray(settings?.declined_handshakes)) {
    for (const hs of settings.declined_handshakes) {
      set.add(String(hs));
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
    currentSettings?.session?.shared_secret ||
    currentSettings?.session?.fingerprint ||
    currentSettings?.keys?.current
  );
  const establishedAt = Number(currentSettings?.session?.established_at || 0);
  const rejectedSet = getRejectedSet(chat.id, currentSettings);

  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);
  const myIds = new Set([
    Number(currentUid),
    Number(account?.id),
    Number(account?.contact?.id),
  ].filter((n) => !isNaN(n) && n > 0));

  const recipientMessages = newMessages
    .filter((msg) => {
      const senderId = Number(msg.sender?.id || msg.sender);
      return !myIds.has(senderId) || isSavedMessagesChat;
    })
    .sort((a, b) => Number(a.time || a.created_at || 0) - Number(b.time || b.created_at || 0));
  const candidateMessages = recipientMessages.slice(-3);
  const candidateIds = new Set(candidateMessages.map((m) => String(m.id)));

  let detectedRequest = null;

  for (const msg of newMessages) {
    const msgIdStr = String(msg.id);
    if (rejectedSet.has(msgIdStr) || dismissedRequests.has(msgIdStr)) {
      continue;
    }

    const dec = decryptedBatch[msgIdStr];
    if (!dec) continue;

    if (dec.handshake_data && rejectedSet.has(String(dec.handshake_data))) {
      continue;
    }

    const senderId = Number(msg.sender?.id || msg.sender);
    const isFromMe = myIds.has(senderId);

    if (dec.is_handshake_request && dec.handshake_data) {
      if (!candidateIds.has(msgIdStr)) {
        continue;
      }

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
        CallService.handleIncomingChatHandshake(detectedRequest);
      }
    } else if (dec.is_handshake_accept && dec.handshake_data) {
      const hasPending = Boolean(currentSettings?.pending?.x_sk || currentSettings?.pending === true || (currentSettings?.pending && typeof currentSettings.pending === 'object'));
      if (hasPending && !currentSettings?.session?.fingerprint && (!isFromMe || isSavedMessagesChat)) {
        try {
          const fingerprint = await processAccept(
            accId,
            chat.id,
            dec.handshake_data
          );
          CallService.handleIncomingChatAccept(fingerprint, dec.handshake_data, chat.id);
          const freshSettings = await invoke("get_chat_settings", {
            account: accId,
            chatId: Number(chat.id),
          });
          if (freshSettings) {
            chatSettings.set(freshSettings);
          } else {
            chatSettings.update((old) => ({
              ...old,
              pending: false,
              session: {
                ...(old?.session || {}),
                fingerprint,
                established_at: Date.now(),
              },
              keys: {
                ...(old?.keys || {}),
                current: 1,
              },
            }));
          }
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

      const freshSettings = await invoke("get_chat_settings", {
        account: accId,
        chatId: Number(chat.id),
      });

      const msgId = req?.messageId ? String(req.messageId) : null;
      const hsData = req?.handshakeData ? String(req.handshakeData) : null;
      if (msgId) {
        const set = getRejectedSet(chat.id, get(chatSettings));
        set.add(msgId);
      }
      if (hsData) {
        const set = getRejectedSet(chat.id, get(chatSettings));
        set.add(hsData);
      }

      if (freshSettings) {
        chatSettings.set({
          ...freshSettings,
          pending: false,
          handled_handshakes: Array.from(
            new Set([...(freshSettings?.handled_handshakes || []), ...(msgId ? [msgId] : [])])
          ),
          rejected_handshakes: Array.from(
            new Set([...(freshSettings?.rejected_handshakes || []), ...(msgId ? [msgId] : [])])
          ),
          declined_handshakes: Array.from(
            new Set([...(freshSettings?.declined_handshakes || []), ...(hsData ? [hsData] : [])])
          ),
        });
      } else {
        const info = await getEncryptionInfo(accId, chat.id);
        const oldSettings = get(chatSettings);
        let existingKeys = Array.isArray(oldSettings?.keys?.keys) ? [...oldSettings.keys.keys] : [];
        if (oldSettings?.session?.shared_secret) {
          existingKeys.push({
            shared_secret: oldSettings.session.shared_secret,
            fingerprint: oldSettings.session.fingerprint,
            message_from: oldSettings.session.established_at || 0,
            message_until: Date.now(),
          });
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
          declined_handshakes: Array.from(
            new Set([...(old?.declined_handshakes || []), ...(hsData ? [hsData] : [])])
          ),
          session: {
            ...(old?.session || {}),
            fingerprint: info?.fingerprint,
            established_at: Date.now(),
          },
          keys: {
            ...(old?.keys || {}),
            keys: existingKeys,
            current: 1,
          },
        }));
      }

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
    } catch (e) {
      console.error(e);
      alert(String(e));
    }
  } else if (action === "deny") {
    const msgId = req?.messageId ? String(req.messageId) : null;
    const hsData = req?.handshakeData ? String(req.handshakeData) : null;
    if (msgId) {
      dismissedRequests.add(msgId);
      const set = getRejectedSet(chat.id, get(chatSettings));
      set.add(msgId);
    }
    if (hsData) {
      const set = getRejectedSet(chat.id, get(chatSettings));
      set.add(hsData);
    }
    chatSettings.update((old) => {
      const next = { ...old };
      delete next.e2e_declined;
      next.rejected_handshakes = Array.from(
        new Set([...(old?.rejected_handshakes || []), ...(msgId ? [msgId] : [])])
      );
      next.declined_handshakes = Array.from(
        new Set([...(old?.declined_handshakes || []), ...(hsData ? [hsData] : [])])
      );
      return next;
    });
    pendingRequests.delete(Number(chat.id));
    invoke("set_chat_settings", {
      account: accId,
      chatId: Number(chat.id),
      data: get(chatSettings),
    }).catch(() => {});
  } else if (action === "block") {
    const msgId = req?.messageId ? String(req.messageId) : null;
    const hsData = req?.handshakeData ? String(req.handshakeData) : null;
    if (msgId) {
      dismissedRequests.add(msgId);
      const set = getRejectedSet(chat.id, get(chatSettings));
      set.add(msgId);
    }
    if (hsData) {
      const set = getRejectedSet(chat.id, get(chatSettings));
      set.add(hsData);
    }
    chatSettings.update((old) => {
      const next = { ...old };
      delete next.e2e_declined;
      next.rejected_handshakes = Array.from(
        new Set([...(old?.rejected_handshakes || []), ...(msgId ? [msgId] : [])])
      );
      next.declined_handshakes = Array.from(
        new Set([...(old?.declined_handshakes || []), ...(hsData ? [hsData] : [])])
      );
      return next;
    });
    blockedRequests.set(Number(chat.id), Date.now() + 5 * 60 * 1000);
    pendingRequests.delete(Number(chat.id));
    invoke("set_chat_settings", {
      account: accId,
      chatId: Number(chat.id),
      data: get(chatSettings),
    }).catch(() => {});
  }
}

export async function switchEnc(chat, chatSettings, messages) {
  if (!chat || chat.type === "CHAT") return;
  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);
  const settings = get(chatSettings);
  const isSessionActive = Boolean(
    settings?.session?.shared_secret ||
    settings?.session?.fingerprint ||
    settings?.keys?.current
  );

  if (!isSessionActive) {
    try {
      const obf = settings?.obfs || "zh";
      const initPacket = await initHandshake(accId, chat.id, obf);

      const freshSettings = await invoke("get_chat_settings", {
        account: accId,
        chatId: Number(chat.id),
      });
      if (freshSettings) {
        delete freshSettings.e2e_declined;
        chatSettings.set(freshSettings);
      } else {
        chatSettings.update((old) => {
          const next = { ...old, pending: true };
          delete next.e2e_declined;
          return next;
        });
      }

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
      if (next.session?.shared_secret) {
        const fromTs = next.session.established_at || 0;
        const untilTs = Date.now();
        const existingKeys = Array.isArray(next.keys?.keys) ? [...next.keys.keys] : [];
        const found = existingKeys.find((k) => k.shared_secret === next.session.shared_secret);
        if (found) {
          found.message_until = untilTs;
        } else {
          existingKeys.push({
            shared_secret: next.session.shared_secret,
            fingerprint: next.session.fingerprint,
            message_from: fromTs,
            message_until: untilTs,
          });
        }
        next.keys = {
          ...(next.keys || {}),
          keys: existingKeys,
          current: null,
        };
      }
      delete next.session;
      delete next.pending;
      delete next.e2e_declined;
      return next;
    });
    const fresh = get(chatSettings);
    invoke("set_chat_settings", {
      account: accId,
      chatId: Number(chat.id),
      data: fresh,
    }).catch(() => {});
  }
}

export async function fetchChatEncryptionInfo(chatId) {
  const account = await getCurrentAccount();
  if (!account?.id) return { active: false, fingerprint: null };
  return getEncryptionInfo(account.id, chatId);
}
