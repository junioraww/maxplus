import { get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import API, { currentUser } from "$lib/stores/api";
import { getCurrentAccount } from "$lib/stores/accounts";
import { activeCall, CALL_PHASE } from "$lib/stores/calls";
import {
  initHandshake,
  acceptHandshake,
  processAccept,
  getEncryptionInfo,
} from "$lib/crypto/asymmetric";
import { sendMessage } from "$components/ChatWindow/actions";
import { CallService } from "$lib/services/CallService";
import { triggerSafetyLockout } from "$lib/stores/e2eSafety";
import { showAlert } from "$lib/utils/alert";
import { parseApiError } from "$lib/utils/errors";
import { resolveHandshakeMode, sendHandshakePacket } from "$lib/crypto/transports";
import { syncChatSettingsLocal } from "$lib/stores/messages";

const pendingRequests = new Map();
const blockedRequests = new Map();
const rejectedRequests = new Map();
const dismissedRequests = new Set();
const handledDisables = new Set();

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

export function dismissRequest(chatId, messageId, handshakeData = null) {
  const msgId = messageId ? String(messageId) : null;
  const hsData = handshakeData ? String(handshakeData) : null;
  if (msgId) {
    dismissedRequests.add(msgId);
  }
  if (hsData) {
    dismissedRequests.add(hsData);
  }
  if (chatId != null) {
    const numChatId = Number(chatId);
    pendingRequests.delete(numChatId);
    const set = getRejectedSet(numChatId, null);
    if (msgId) set.add(msgId);
    if (hsData) set.add(hsData);

    getCurrentAccount().then((account) => {
      const accId = Number(account?.id || 0);
      if (!accId) return;
      invoke("get_chat_settings", {
        account: accId,
        chatId: numChatId,
      }).then((settings) => {
        const next = { ...settings };
        delete next.e2e_declined;
        if (msgId) {
          next.rejected_handshakes = Array.from(
            new Set([...(settings?.rejected_handshakes || []), msgId])
          );
        }
        if (hsData) {
          next.declined_handshakes = Array.from(
            new Set([...(settings?.declined_handshakes || []), hsData])
          );
        }
        invoke("set_chat_settings", {
          account: accId,
          chatId: numChatId,
          data: next,
        }).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});
  }
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
  newMessages = [],
  decodedMessagesStore = null,
  allMessages = []
) {
  if (!chat || !decryptedBatch || chat.type === "CHAT") return null;

  const call = get(activeCall);
  if (call && (call.phase === CALL_PHASE.ACTIVE || call.phase === CALL_PHASE.CONNECTING)) {
    const callPeerId = Number(call.peerId || 0);
    const chatIdNum = Number(chat.id || 0);
    const isCallWithThisPeer = callPeerId && (
      callPeerId === chatIdNum ||
      (chat.participants && Object.keys(chat.participants).some((id) => Number(id) === callPeerId))
    );
    if (isCallWithThisPeer) {
      return null;
    }
  }

  const currentUid = get(currentUser);
  const isSavedMessagesChat = Number(chat.id) === 0 || Number(chat.id) === Number(currentUid);
  const blockedUntil = blockedRequests.get(Number(chat.id));
  if (blockedUntil && blockedUntil > Date.now()) {
    return null;
  }

  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);

  let currentSettings = get(chatSettings);
  if (!currentSettings && accId) {
    currentSettings = await invoke("get_chat_settings", {
      account: accId,
      chatId: Number(chat.id),
    }).catch(() => null);
    if (currentSettings) {
      syncChatSettingsLocal(chat.id, currentSettings);
    }
  }
  const isSessionActive = Boolean(
    currentSettings?.session?.shared_secret ||
    currentSettings?.session?.fingerprint ||
    currentSettings?.keys?.current
  );
  const establishedAt = Number(currentSettings?.session?.established_at || 0);
  const rejectedSet = getRejectedSet(chat.id, currentSettings);
  const myIds = new Set([
    Number(currentUid),
    Number(account?.id),
    Number(account?.contact?.id),
  ].filter((n) => !isNaN(n) && n > 0));

  const dedupMap = new Map();
  for (const m of [...(Array.isArray(allMessages) ? allMessages : []), ...newMessages]) {
    if (m && m.id != null && !m.deleted) {
      dedupMap.set(String(m.id), m);
    }
  }
  const combinedMessages = Array.from(dedupMap.values());

  let latestMyMessageTime = 0;
  for (const m of combinedMessages) {
    const sId = Number(m.sender?.id || m.sender);
    if (myIds.has(sId)) {
      const t = Number(m.time || m.created_at || 0);
      if (t > latestMyMessageTime) latestMyMessageTime = t;
    }
  }
  if (chat?.lastMessage && !chat.lastMessage.deleted) {
    const lastSender = Number(chat.lastMessage.sender?.id || chat.lastMessage.sender);
    if (myIds.has(lastSender)) {
      const t = Number(chat.lastMessage.time || chat.lastMessage.created_at || 0);
      if (t > latestMyMessageTime) latestMyMessageTime = t;
    }
  }

  // Only consider requests that are among the newest 3 messages in the whole chat
  const tailMessages = combinedMessages
    .sort((a, b) => Number(a.time || a.created_at || 0) - Number(b.time || b.created_at || 0))
    .slice(-3);
  const candidateIds = new Set(
    tailMessages
      .filter((msg) => {
        const senderId = Number(msg.sender?.id || msg.sender);
        return !myIds.has(senderId) || isSavedMessagesChat;
      })
      .map((m) => String(m.id))
  );

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

    const isDisableSignal = dec.text && dec.text.includes('"e2e_control":"disable"');
    if (isDisableSignal) {
      let payloadTs = 0;
      try {
        const parsed = JSON.parse(dec.text);
        if (parsed && parsed.timestamp) {
          payloadTs = Number(parsed.timestamp);
        }
      } catch (_) {}
      const msgTime = Number(msg.time || msg.created_at || 0);
      const effectiveTime = payloadTs || msgTime;

      const noticeText = (!isFromMe || isSavedMessagesChat)
        ? "<b>Собеседник отключил сквозное шифрование</b>"
        : "<b>Вы отключили сквозное шифрование</b>";
      dec.text = noticeText;
      dec.is_encrypted = false;
      dec.obf = null;
      if (decodedMessagesStore?.update) {
        decodedMessagesStore.update((curr) => ({
          ...curr,
          [msgIdStr]: {
            ...curr[msgIdStr],
            text: noticeText,
            is_encrypted: false,
            obf: null,
          },
        }));
      }
      if (handledDisables.has(msgIdStr)) {
        continue;
      }
      if (isSessionActive && establishedAt && effectiveTime && effectiveTime <= establishedAt) {
        continue;
      }
      if ((!isFromMe || isSavedMessagesChat) && isSessionActive) {
        handledDisables.add(msgIdStr);
        await archiveAndClearLocalSession(chat, chatSettings, accId);
      }
      continue;
    }

    if (dec.is_handshake_request && dec.handshake_data) {
      if (!candidateIds.has(msgIdStr)) {
        continue;
      }

      const msgTime = Number(msg.time || msg.created_at || 0);
      if (!isSavedMessagesChat && latestMyMessageTime > 0 && (!msgTime || msgTime <= latestMyMessageTime)) {
        continue;
      }

      if (isSessionActive) {
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
      let hasPending = Boolean(currentSettings?.pending?.x_sk || currentSettings?.pending === true || (currentSettings?.pending && typeof currentSettings.pending === 'object'));
      if (!hasPending && accId) {
        const freshCheck = await invoke("get_chat_settings", {
          account: accId,
          chatId: Number(chat.id),
        }).catch(() => null);
        if (freshCheck) {
          currentSettings = freshCheck;
          syncChatSettingsLocal(chat.id, freshCheck);
          hasPending = Boolean(freshCheck?.pending?.x_sk || (freshCheck?.pending && typeof freshCheck.pending === 'object'));
        }
      }
      if (hasPending && (!isFromMe || isSavedMessagesChat)) {
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
            syncChatSettingsLocal(chat.id, freshSettings);
          }
        } catch (e) {
          console.error(e);
        }
      }
    }
  }

  return detectedRequest;
}

async function archiveAndClearLocalSession(chat, chatSettings, accId) {
  try {
    const fresh = await invoke("disable_e2e_session", {
      account: accId,
      chatId: Number(chat.id),
    });
    if (fresh) {
      syncChatSettingsLocal(chat.id, fresh);
    }
  } catch (e) {
    console.error(e);
  }
  triggerSafetyLockout(chat.id, 5000);
  CallService.disableSecureMode().catch(() => {});
}

export async function handleEnc(chat, chatSettings, messages, action) {
  const req = pendingRequests.get(Number(chat.id));
  if (!req) return;

  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);

  if (action === "agree") {
    try {
      const settings = get(chatSettings);
      const mode = resolveHandshakeMode(settings);
      const rawObf = settings?.obfs ?? settings?.obfuscation;
      const obf = rawObf && rawObf !== "none" ? rawObf : "ru";
      const replyPacket = await acceptHandshake(
        accId,
        chat.id,
        req.handshakeData,
        mode === "chat" ? obf : "raw"
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
      }

      await sendHandshakePacket({
        mode,
        chat,
        chatSettings,
        messages,
        rawPacketBase64: mode === "chat" ? null : replyPacket,
        textPacket: mode === "chat" ? replyPacket : null,
      });

      await CallService.syncChatSessionToActiveCall(chat.id);
    } catch (e) {
      console.error(e);
      showAlert(parseApiError(e));
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
  if (!chat || chat.type === "CHAT") return false;
  const account = await getCurrentAccount();
  const accId = Number(account?.id || 0);
  const settings = get(chatSettings);
  const isSessionActive = Boolean(
    settings?.session?.shared_secret ||
    settings?.session?.fingerprint ||
    settings?.keys?.current
  );

  if (!isSessionActive) {
    const prevSettings = settings ? JSON.parse(JSON.stringify(settings)) : {};
    const rollbackPending = () => {
      chatSettings.set(prevSettings);
      if (accId) {
        invoke("set_chat_settings", {
          account: accId,
          chatId: Number(chat.id),
          data: prevSettings,
        }).catch(() => {});
      }
    };

    try {
      const mode = resolveHandshakeMode(settings);
      const rawObf = settings?.obfs ?? settings?.obfuscation;
      const obf = rawObf && rawObf !== "none" ? rawObf : "ru";
      const packetOut = await initHandshake(accId, chat.id, mode === "chat" ? obf : "raw");

      const freshSettings = await invoke("get_chat_settings", {
        account: accId,
        chatId: Number(chat.id),
      });
      if (freshSettings) {
        delete freshSettings.e2e_declined;
        syncChatSettingsLocal(chat.id, freshSettings);
      }

      const sendRes = await sendHandshakePacket({
        mode,
        chat,
        chatSettings,
        messages,
        rawPacketBase64: mode === "chat" ? null : packetOut,
        textPacket: mode === "chat" ? packetOut : null,
      });
      const sentOk = Boolean(sendRes && !sendRes.error && sendRes.message && typeof sendRes.message === "object");
      if (!sentOk) {
        rollbackPending();
        return false;
      }
      return true;
    } catch (e) {
      console.error(e);
      rollbackPending();
      showAlert(parseApiError(e));
      return false;
    }
  } else {
    try {
      const disableSignal = JSON.stringify({ e2e_control: "disable", timestamp: Date.now() });
      await sendMessage(
        chat,
        chatSettings,
        messages,
        disableSignal,
        undefined,
        undefined,
        undefined,
        false
      );
    } catch (e) {
      console.error("Failed to send encrypted disable signal:", e);
      showAlert(parseApiError(e));
    }
    await archiveAndClearLocalSession(chat, chatSettings, accId);
    return true;
  }
}

export async function fetchChatEncryptionInfo(chatId) {
  const account = await getCurrentAccount();
  if (!account?.id) return { active: false, fingerprint: null };
  return getEncryptionInfo(account.id, chatId);
}
