import API, {
  currentUser,
  currentSessionChats,
  currentRealChats,
} from "$lib/stores/api";
import {
  getChat,
  saveChats,
} from "$lib/stores/messages";
import { getCurrentAccount } from "$lib/stores/accounts";
import { encryptMessage } from "$lib/crypto/messages";
import { get } from "svelte/store";

export async function sendMessage(
  chat,
  chatSettings,
  messages,
  newMessage,
  replyTo,
  attaches,
  elements,
  forceObfuscation = false,
  mediaDescriptor = null,
  decodedMessagesStore = null
) {
  if (!newMessage?.trim() && (!attaches || !attaches.length)) return;
  const originalPlaintext = newMessage ? newMessage.trim() : "";
  let text = originalPlaintext;

  const settings = get(chatSettings) || {};
  const hasSession = Boolean(settings?.keys?.current || settings?.session);
  const password = settings?.password;
  const obf = settings?.obfs || (hasSession || password ? "zh" : null);

  let effectiveMedia = mediaDescriptor;
  if (!effectiveMedia && attaches?.length && (hasSession || password || obf)) {
    const firstAttach = attaches[0];
    effectiveMedia = {
      attach_index: 0,
      name: firstAttach.name || "attachment",
      mime: firstAttach.mime || "application/octet-stream",
      media_type: firstAttach._type || firstAttach.type || "FILE",
      size: Number(firstAttach.size || 0),
      width: firstAttach.width ? Number(firstAttach.width) : null,
      height: firstAttach.height ? Number(firstAttach.height) : null,
      duration: firstAttach.duration ? Number(firstAttach.duration) : null,
      wave: Array.isArray(firstAttach.wave) ? firstAttach.wave : null,
      video_type: firstAttach.videoType != null ? Number(firstAttach.videoType) : null,
    };
  }

  if (!forceObfuscation && (hasSession || password || obf)) {
    const account = await getCurrentAccount();
    text = await encryptMessage({
      account: Number(account?.id || 0),
      chatId: Number(chat.id),
      text,
      media: effectiveMedia,
      password,
      useSession: hasSession,
      obf,
    });
  }
  const chatId = chat.id;
  const id = Date.now();
  const cid = -id;

  const plainEntry = (hasSession || password || obf) ? {
    text: originalPlaintext,
    media: effectiveMedia,
    is_encrypted: true,
    obf,
    error: null,
  } : null;

  if (decodedMessagesStore && plainEntry) {
    decodedMessagesStore.update((curr) => ({
      ...curr,
      [String(id)]: plainEntry,
      [String(cid)]: plainEntry,
    }));
  }

  const displayMessageEarlyEntry = {
    id,
    cid,
    text,
    sender: get(currentUser),
    reactionInfo: {},
    attaches: (attaches || []).map((a, idx) => {
      if (effectiveMedia && idx === (effectiveMedia.attach_index ?? 0)) {
        return {
          ...a,
          localPath: a.path || a.localPath,
        };
      }
      return a;
    }),
    elements,
    type: "USER",
    time: Date.now(),
    ...(replyTo && { link: { type: "REPLY", messageId: replyTo } }),
    status: 0,
    sending: true,
  };

  messages.update((msgs) => [...msgs, displayMessageEarlyEntry]);
  const chatCache = getChat(chat.id);
  chatCache.receivedMessage.set(displayMessageEarlyEntry);

  const params = {
    notify: true,
    cid,
    replyTo,
    attaches,
    elements,
  };

  let response;
  try {
    response = await get(API).sendMessage(text, chatId, params);
  } catch (err) {
    console.error(err);
    messages.update((msgs) => {
      const target = msgs.find((x) => x.id === id);
      if (target) {
        target.sending = false;
        target.deleted = true;
        target.status = "failed";
      }
      return [...msgs];
    });
    throw err;
  }

  const message = response?.message;

  if (!message) {
    messages.update((msgs) => {
      const target = msgs.find((x) => x.id === id);
      if (target) {
        target.sending = false;
        target.deleted = true;
        target.status = "failed";
      }
      return [...msgs];
    });
  }
  else {
    if (decodedMessagesStore && plainEntry && message.id) {
      decodedMessagesStore.update((curr) => ({
        ...curr,
        [String(message.id)]: plainEntry,
      }));
    }

    const fullMsg = {
      ...displayMessageEarlyEntry,
      ...message,
      id: message.id || id,
      text: message.text || text,
      sender: message.sender || get(currentUser),
      chatId: chat.id,
      time: message.time || Date.now(),
      status: 1,
      sending: false,
    };

    chatCache.receivedMessage.set(fullMsg);
    chatCache.updateMessages([fullMsg]);

    messages.update(msgs => {
      const withoutOptimistic = msgs.filter(m => String(m.id) !== String(id));
      const existingIdx = withoutOptimistic.findIndex(m => String(m.id) === String(fullMsg.id));
      if (existingIdx !== -1) {
        withoutOptimistic[existingIdx] = fullMsg;
        return withoutOptimistic;
      }
      return [...withoutOptimistic, fullMsg];
    });

    currentSessionChats.update((chats) => {
      if (!chats) return chats;
      const index = chats.findIndex((c) => String(c.id) === String(chat.id));
      const now = fullMsg.time || Date.now();
      if (index === -1) {
        const newChat = {
          ...chat,
          id: chat.id,
          lastMessage: fullMsg,
          lastEventTime: now,
          newMessages: 0,
        };
        return [newChat, ...chats];
      }
      const updatedChat = {
        ...chats[index],
        lastMessage: fullMsg,
        lastEventTime: now,
      };
      const next = [...chats];
      next.splice(index, 1);
      return [updatedChat, ...next];
    });

    currentRealChats.update((ids) => {
      return ids?.some(id => String(id) === String(chat.id)) ? ids : [chat.id, ...(ids || [])];
    });

    saveChats([
      {
        ...chat,
        id: chat.id,
        lastMessage: fullMsg,
        lastEventTime: fullMsg.time || Date.now(),
      }
    ]).catch(() => {});
  }
}

export async function handleReaction(chat, msg, emoji) {
  if (!chat?.id || !msg?.id || !emoji) return msg;

  const currentInfo = msg.reactionInfo || {};
  const currentCounters = Array.isArray(currentInfo.counters)
    ? currentInfo.counters.map(c => ({ ...c }))
    : [];
  const currentTotal = Number(currentInfo.totalCount || 0);
  const yourPrev = currentInfo.yourReaction;

  let newYour = yourPrev;
  let newCounters = [...currentCounters];
  let newTotal = currentTotal;

  if (yourPrev === emoji) {
    newYour = undefined;
    newTotal = Math.max(0, currentTotal - 1);
    const idx = newCounters.findIndex(c => c.reaction === emoji);
    if (idx !== -1) {
      if (newCounters[idx].count <= 1) {
        newCounters.splice(idx, 1);
      } else {
        newCounters[idx].count -= 1;
      }
    }
    get(API)
      .react(chat.id, msg.id)
      .catch(console.error);
  } else {
    if (yourPrev) {
      const prevIdx = newCounters.findIndex(c => c.reaction === yourPrev);
      if (prevIdx !== -1) {
        if (newCounters[prevIdx].count <= 1) {
          newCounters.splice(prevIdx, 1);
        } else {
          newCounters[prevIdx].count -= 1;
        }
      }
    } else {
      newTotal += 1;
    }

    newYour = emoji;
    const targetIdx = newCounters.findIndex(c => c.reaction === emoji);
    if (targetIdx !== -1) {
      newCounters[targetIdx].count += 1;
    } else {
      newCounters.push({ reaction: emoji, count: 1 });
    }

    get(API)
      .react(chat.id, msg.id, emoji)
      .catch(console.error);
  }

  const updatedReactionInfo = newTotal > 0
    ? {
        counters: newCounters,
        totalCount: newTotal,
        yourReaction: newYour,
      }
    : {};

  msg.reactionInfo = updatedReactionInfo;
  return {
    ...msg,
    reactionInfo: updatedReactionInfo,
  };
}

export async function copyMessageText(msg, decoded) {
  const text = decoded?.text ?? msg?.text ?? "";
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn("navigator.clipboard failed:", err);
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.focus();
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    return true;
  } catch (e) {
    console.error("execCommand copy failed:", e);
    return false;
  }
}

export async function forwardMessages(targetChatId, messagesToForward, optionalText = "", messagesStore = null) {
  if (targetChatId == null || !messagesToForward?.length) return false;
  const api = get(API);
  const targetIdNum = Number(targetChatId);

  for (let i = 0; i < messagesToForward.length; i++) {
    const m = messagesToForward[i];
    const sourceChatId = m.chatId ?? m.chat_id ?? m.sourceChatId;
    const msgIdStr = m.id != null ? String(m.id) : null;
    if (sourceChatId == null || !msgIdStr) continue;
    const sourceChat = get(currentSessionChats)?.find((c) => String(c.id) === String(sourceChatId));
    const channelName = m.link?.chatName || (sourceChat?.type === "CHANNEL" ? sourceChat.title : null);
    const channelIcon = m.link?.chatIconUrl || (sourceChat?.type === "CHANNEL" ? (sourceChat.avatar || sourceChat.baseIconUrl || sourceChat.iconUrl) : null);
    const link = {
      type: "FORWARD",
      chatId: Number(sourceChatId),
      messageId: msgIdStr,
    };
    const params = {
      notify: true,
      cid: -(Date.now() + i),
      link,
      elements: [],
      attaches: [],
    };
    const textToSend = i === 0 ? (optionalText || "") : "";
    try {
      const resp = await api.sendMessage(textToSend, targetIdNum, params);
      const sentMsg = resp?.message || resp?.payload?.message;
      if (sentMsg) {
        const originalMsg = m.link?.message ? { ...m.link.message } : {
          id: msgIdStr,
          sender: m.sender,
          time: m.time,
          text: m.text || "",
          attaches: m.attaches || [],
          elements: m.elements || [],
          type: m.type || (sourceChat?.type === "CHANNEL" ? "CHANNEL" : "USER"),
        };
        const displayMsg = {
          ...sentMsg,
          chatId: targetIdNum,
          id: sentMsg?.id ? String(sentMsg.id) : String(Date.now() + i),
          sender: get(currentUser),
          text: textToSend || "",
          time: sentMsg?.time || Date.now(),
          link: {
            type: "FORWARD",
            chatId: Number(sourceChatId),
            messageId: msgIdStr,
            message: originalMsg,
            ...(channelName && { chatName: channelName }),
            ...(channelIcon && { chatIconUrl: channelIcon }),
          },
        };
        if (messagesStore) {
          messagesStore.update((msgs) => [...msgs, displayMsg]);
        }
        const chatCache = getChat(targetIdNum);
        if (chatCache?.receivedMessage) {
          chatCache.receivedMessage.set(displayMsg);
        }
        if (chatCache?.updateMessages) {
          chatCache.updateMessages([displayMsg]);
        }
      }
    } catch (e) {
      console.error("Failed to forward message:", m.id, e);
      return false;
    }
  }
  return true;
}
