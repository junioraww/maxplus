import API, {
  currentUser,
  currentSessionChats,
  currentRealChats,
} from "$lib/stores/api";
import {
  getChat,
  saveChats,
} from "$lib/stores/messages";
import { xorEncrypt } from "$lib/crypto/symmetric";
import { deflate, obfuscate, detectObfuscation } from "$lib/crypto/messages";
import { buildHeader, parseHeader } from "$components/ChatWindow/e2e";
import { get } from "svelte/store";

export async function sendMessage(
  chat,
  chatSettings,
  messages,
  newMessage,
  replyTo,
  attaches,
  elements,
  forceObfuscation = false
) {
  if (!newMessage.trim()) return;
  let text = newMessage;

  const keys = get(chatSettings).keys;

  const ass = !!keys?.current;
  const sym = get(chatSettings).password;
  const obf = get(chatSettings).obfs;

  const debug = true;

  // TODO Fix [!] Вес сообщения возрастает в 3 раза при ass + sym одновременно

  if (forceObfuscation || sym || ass) {
    if (debug) console.log('Original', text);

    let bytes = new TextEncoder().encode(text);
    if (debug) console.log('2', bytes);

    if (ass) bytes = await encryptAss(chat, chatSettings, bytes);
    if (debug) console.log('3', bytes);

    if (sym) bytes = await xorEncrypt(bytes, sym);
    if (debug) console.log('4', bytes);

    const out = new Uint8Array(1 + bytes.length);
    out[0] = buildHeader(0, !!sym, !!ass, 0);
    out.set(bytes, 1);

    text = await obfuscate(out, obf || "zh"); // obfuscation should hide header
  }
  else if (obf) {
    const bytes = new TextEncoder().encode(text);

    text = await obfuscate(
      Uint8Array.of(buildHeader(0, 0, 0, 0), ...bytes), obf
    );
  }

  if (debug) console.log('Final', text);

  const chatId = chat.id;
  const id = Date.now();

  const displayMessageEarlyEntry = {
    id,
    text,
    sender: get(currentUser),
    reactionInfo: {},
    attaches,
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
  chatCache.updateMessages([displayMessageEarlyEntry]);

  const params = {
    notify: true,
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
        target.status = "failed";
      }
      return [...msgs];
    });
  }
  else {
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
      const idx = msgs.findIndex(m => String(m.id) === String(id) || String(m.id) === String(fullMsg.id));
      if (idx !== -1) {
        msgs[idx] = fullMsg;
        return [...msgs];
      }
      return [...msgs, fullMsg];
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

    if (ass) {
      const entry = keys.messages.find(
        (entry) => entry.key === keys.current,
      );
      if (!entry)
        keys.messages.push({
          from: msgId,
          to: msgId,
          key: keys.current,
        });
      else {
        entry.to = msgId;
      }
    }
  }
}

export async function handleReaction(chat, msg, emoji) {
  const reactionInfo = msg.reactionInfo;

  if (reactionInfo?.counters) {
    const your = reactionInfo.yourReaction;
    if (your) {
      if (your === emoji) {
        get(API)
          .react(chat.id, msg.id)
          .then(console.warn);
        if (reactionInfo.totalCount === 1) msg.reactionInfo = {};
        else {
          reactionInfo.totalCount -= 1;
          reactionInfo.yourReaction = undefined;
          const entry = reactionInfo.counters.find((x) => x.reaction === emoji);
          if (entry) entry.count -= 1;
        }
      } else {
        const counters = reactionInfo.counters;
        const prev = counters.findIndex((x) => x.reaction === your);
        if (counters[prev].count === 1) counters.splice(prev, 1);
        else counters[prev].count -= 1;
        reactionInfo.yourReaction = emoji;
        get(API)
          .react(chat.id, msg.id, emoji)
          .then(console.warn);
        const entry = counters.find((x) => x.reaction === emoji);
        if (entry) entry.count += 1;
        else counters.push({ count: 1, reaction: emoji });
      }
    } else {
      get(API)
        .react(chat.id, msg.id, emoji)
        .then(console.warn);
      reactionInfo.yourReaction = emoji;
      const entry = reactionInfo.counters.find((x) => x.reaction === emoji);
      if (entry) entry.count += 1;
      else reactionInfo.counters.push({ count: 1, reaction: emoji });
    }
  } else {
    get(API)
      .react(chat.id, msg.id, emoji)
      .then(console.warn);
    msg.reactionInfo = {
      counters: [{ count: 1, reaction: emoji }],
      totalCount: 1,
      yourReaction: emoji,
    };
  }
}
