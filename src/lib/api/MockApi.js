import BaseAPI from "./BaseApi";
import {
  currentUser,
  currentUserDetails,
  currentRealChats,
  currentRealContacts,
  currentFolders,
  currentPresence,
  serverConfig,
} from "$lib/stores/api";
import { set as sessionSet } from "$lib/stores/session";
import { getChat, saveChats } from "$lib/stores/messages";
import { updateContact } from "$lib/stores/contacts";

const DEFAULT_USER_ID = 10001;
const PEER_USER_ID = 20002;

export default class MockApi extends BaseAPI {
  resolve_sync = null;
  synchronized = new Promise((resolve) => (this.resolve_sync = resolve));

  constructor() {
    super("mock_token");

    this.currentUserId = DEFAULT_USER_ID;
    this.currentUserContact = {
      id: DEFAULT_USER_ID,
      names: [{ name: "Synthetic User", firstName: "Synthetic", lastName: "User" }],
      avatar: null,
      options: [],
    };

    this.contacts = [
      {
        id: PEER_USER_ID,
        names: [{ name: "Synthetic Contact", firstName: "Synthetic", lastName: "Contact" }],
        avatar: null,
        options: [],
      },
      {
        id: 30003,
        names: [{ name: "Synthetic Bot", firstName: "Synthetic", lastName: "Bot" }],
        avatar: null,
        options: ["BOT"],
      },
    ];

    this.folders = [
      { id: "all", title: "Все чаты", order: 0 },
      { id: "dialogs", title: "Личные", order: 1 },
      { id: "groups", title: "Группы", order: 2 },
    ];

    this.chats = [
      {
        id: 50001,
        type: "DIALOG",
        title: "Synthetic Dialog",
        participants: { [DEFAULT_USER_ID]: 1700000000000, [PEER_USER_ID]: 1700000005000 },
        otherReadTime: 1700000005000,
        newMessages: 0,
      },
      {
        id: 50002,
        type: "CHAT",
        title: "Synthetic Group Chat",
        participants: { [DEFAULT_USER_ID]: 1700000000000, [PEER_USER_ID]: 1700000002000 },
        otherReadTime: 1700000002000,
        newMessages: 2,
      },
    ];

    this.messages = {};
    this.generateMockMessages(50002, 40, Date.now() - 3600 * 1000);
    this.generateMockMessages(50001, 80, Date.now() - 1200 * 1000);
  }

  createMockMessage(chatId, i, msgTime) {
    const isMe = i % 2 === 0;
    const msgId = chatId * 1000 + i;
    const variant = i % 9;

    let text = "";
    let elements = [];
    let attaches = [];

    switch (variant) {
      case 0:
        text = `Привет! Запустил тесты, проверка сообщения #${i} прошла успешно.`;
        break;
      case 1: {
        const code = `function calculateOffset(items, index) {\n  const target = items[index];\n  return target ? target.height * index : 0;\n}`;
        text = `Обновил вычисление смещения для скролла:\n${code}`;
        elements = [{ type: "MONOSPACED", from: text.indexOf(code), length: code.length }];
        break;
      }
      case 2: {
        const boldPart = "Новый релиз Maxplus:";
        const italicPart = "производительность интерфейса выросла вдвое!";
        text = `${boldPart} ${italicPart}`;
        elements = [
          { type: "STRONG", from: 0, length: boldPart.length },
          { type: "EMPHASIZED", from: boldPart.length + 1, length: italicPart.length },
        ];
        break;
      }
      case 3: {
        const quote = "«Качество всегда важнее количества кода.»";
        text = `${quote}\nАбсолютно согласен, провел рефакторинг компонентов.`;
        elements = [{ type: "QUOTE", from: 0, length: quote.length }];
        break;
      }
      case 4: {
        const snippet = "bun dev --port 5173";
        text = `Для запуска браузерной версии используйте команду ${snippet}.`;
        elements = [{ type: "MONOSPACED", from: text.indexOf(snippet), length: snippet.length }];
        break;
      }
      case 5:
        text = `Макет интерфейса чатов и профилей #${i}`;
        attaches = [
          {
            _type: "PHOTO",
            photoId: msgId,
            width: 640,
            height: 480,
          },
        ];
        break;
      case 6:
        text = `Демонстрация плавного скролла 60 FPS #${i}`;
        attaches = [
          {
            _type: "VIDEO",
            videoId: msgId,
            duration: 25,
            width: 1280,
            height: 720,
          },
        ];
        break;
      case 7:
        text = `Техническая спецификация проекта #${i}`;
        attaches = [
          {
            _type: "FILE",
            name: `architecture_spec_v${i}.pdf`,
            size: 1048576 + i * 8192,
          },
        ];
        break;
      default:
        text = `План разработки на следующую итерацию #${i}:\n1. Оптимизация виртуализации списков\n2. Улучшение стилей моноблоков кода\n3. Анализ тестового покрытия`;
        break;
    }

    return {
      id: msgId,
      chatId,
      sender: isMe ? this.currentUserId : PEER_USER_ID,
      text,
      elements,
      attaches,
      time: msgTime,
      status: 1,
      history: [],
    };
  }

  generateMockMessages(chatId, count = 80, startTime = null) {
    const list = [];
    const baseTime = startTime != null ? startTime : (Date.now() - (count + 1200) * 1000);

    for (let i = 1; i <= count; i++) {
      const msgTime = baseTime + i * 1000;
      list.push(this.createMockMessage(chatId, i, msgTime));
    }

    this.messages[chatId] = list;

    const last = list[list.length - 1];
    const foundChat = this.chats.find((c) => c.id === chatId);
    if (foundChat && last) {
      foundChat.lastMessage = last;
      if (foundChat.newMessages === 0) {
        foundChat.participants[this.currentUserId] = last.time;
      } else {
        const peerMsgs = list.filter((m) => m.sender !== this.currentUserId);
        const unreadIdx = Math.max(0, peerMsgs.length - foundChat.newMessages - 1);
        if (peerMsgs[unreadIdx]) {
          foundChat.participants[this.currentUserId] = peerMsgs[unreadIdx].time;
        }
      }
    }

    return list;
  }

  async init() {
    currentUserDetails.set(this.currentUserContact);
    currentUser.set(this.currentUserId);
    currentRealChats.set(this.chats.map((c) => c.id));
    currentRealContacts.set(this.contacts.map((c) => c.id));
    currentFolders.set(this.folders);

    serverConfig.set({
      max_group_members: 200,
      max_attachment_size: 104857600,
    });

    for (const contact of this.contacts) {
      updateContact(contact);
    }
    updateContact(this.currentUserContact);

    for (const chat of this.chats) {
      const store = getChat(chat.id);
      if (store?.chatInfo) {
        store.chatInfo.set(chat);
      }
    }

    sessionSet("connected", true);
    sessionSet("sync", true);
    sessionSet("drift", 0);
    sessionSet("loaded", true);

    if (this.resolve_sync) {
      this.resolve_sync(true);
    }

    return true;
  }

  async sync() {
    return true;
  }

  async getFolders() {
    return this.folders;
  }

  ensureEarlierMessages(chatId, from_time, backward) {
    if (!this.messages[chatId]) {
      this.generateMockMessages(chatId, 60);
    }
    const all = this.messages[chatId];
    let older = all.filter((m) => m.time <= from_time);
    if (older.length < backward) {
      const needed = backward - older.length + 20;
      const oldestTime = all.length > 0 ? all[0].time : from_time;
      const earlier = [];
      for (let i = needed; i >= 1; i--) {
        const msgTime = oldestTime - i * 60 * 1000;
        const idx = all.length + earlier.length + 1;
        earlier.push(this.createMockMessage(chatId, idx, msgTime));
      }
      this.messages[chatId] = [...earlier, ...all];
    }
  }

  async getMessages(chatId, from_time = Date.now(), backward = 40, forward = 0) {
    if (!this.messages[chatId]) {
      this.generateMockMessages(chatId, 60);
    }

    if (backward > 0) {
      this.ensureEarlierMessages(chatId, from_time, backward);
    }

    const all = this.messages[chatId] || [];
    let older = all.filter((m) => m.time <= from_time);
    let newer = all.filter((m) => m.time > from_time);

    let result = [];
    if (backward > 0) {
      result = older.slice(-backward);
    }
    if (forward > 0) {
      result = result.concat(newer.slice(0, forward));
    }

    return { messages: result };
  }

  async getNewerMessages(chatId, from_time, forward = 40) {
    return this.getMessages(chatId, from_time, 0, forward);
  }

  async sendMessage(message, chatId) {
    if (!this.messages[chatId]) {
      this.messages[chatId] = [];
    }

    const newId = Date.now();
    const newMsg = {
      id: newId,
      chatId,
      sender: this.currentUserId,
      text: typeof message === "string" ? message : (message?.text || ""),
      time: Date.now(),
      status: 1,
      attaches: message?.attaches || [],
      history: [],
    };

    this.messages[chatId].push(newMsg);

    const targetChat = this.chats.find((c) => c.id === chatId);
    if (targetChat) {
      targetChat.lastMessage = newMsg;
      const store = getChat(chatId);
      if (store?.chatInfo) {
        store.chatInfo.set(targetChat);
      }
      if (store?.receivedMessage) {
        store.receivedMessage.set(newMsg);
      }
    }

    return { messageId: newId, status: "ok" };
  }

  async readMessage(chatId, messageId, remainingCount) {
    const list = this.messages[chatId] || [];
    let readMsg = null;
    for (const m of list) {
      if (String(m.id) === String(messageId)) {
        readMsg = m;
        break;
      }
    }
    if (!readMsg) {
      readMsg = list.find((m) => Number(m.id) === Number(messageId));
    }
    const markTime = readMsg ? Number(readMsg.time) : Date.now();
    for (const m of list) {
      if (Number(m.time) <= markTime) {
        m.status = 2;
      }
    }

    const targetChat = this.chats.find((c) => String(c.id) === String(chatId));
    let remaining = remainingCount != null ? Number(remainingCount) : 0;
    if (targetChat) {
      targetChat.participants = {
        ...(targetChat.participants || {}),
        [this.currentUserId]: markTime,
      };
      if (remainingCount == null) {
        remaining = list.filter(
          (m) => Number(m.sender) !== this.currentUserId && !m.deleted && Number(m.time) > markTime
        ).length;
      }
      targetChat.newMessages = remaining;
      const store = getChat(chatId);
      if (store?.chatInfo) {
        store.chatInfo.set({ ...targetChat });
      }
      await saveChats([ targetChat ]).catch(() => {});
    }

    return { unread: remaining, mark: markTime };
  }

  addIncomingMessages(chatId, count = 1) {
    const targetChat = this.chats.find((c) => String(c.id) === String(chatId));
    if (!targetChat) return [];

    if (!this.messages[chatId]) {
      this.messages[chatId] = [];
    }

    const list = this.messages[chatId];
    const lastMsg = list.length > 0 ? list[list.length - 1] : null;
    const baseTime = lastMsg ? Number(lastMsg.time) : (Date.now() - (count + 1000) * 1000);
    const created = [];

    for (let i = 1; i <= count; i++) {
      const msgTime = baseTime + i * 100;
      const msgId = Number(chatId) * 1000 + list.length + 1;
      const msg = {
        id: msgId,
        chatId: Number(chatId),
        sender: PEER_USER_ID,
        text: `Synthetic incoming unread message #${i} of ${count}`,
        elements: [],
        attaches: [],
        time: msgTime,
        status: 1,
        history: [],
      };
      list.push(msg);
      created.push(msg);
    }

    targetChat.lastMessage = created[created.length - 1];
    targetChat.newMessages = (targetChat.newMessages || 0) + count;

    const store = getChat(chatId);
    if (store?.chatInfo) {
      store.chatInfo.set({ ...targetChat });
    }

    return created;
  }

  async pinMessage(chatId, messageId) {
    const chat = this.chats.find((c) => c.id === chatId);
    if (chat) chat.pinnedMessageId = messageId;
    return true;
  }

  async unpinMessage(chatId) {
    const chat = this.chats.find((c) => c.id === chatId);
    if (chat) chat.pinnedMessageId = null;
    return true;
  }

  async deleteMessage(chatId, messageId) {
    const list = this.messages[chatId] || [];
    const item = list.find((m) => m.id === messageId);
    if (item) item.deleted = true;
    return true;
  }

  async deleteMessages(chatId, messageIds) {
    const list = this.messages[chatId] || [];
    for (const m of list) {
      if (messageIds.includes(m.id)) m.deleted = true;
    }
    return true;
  }

  async reaction(chatId, messageId, code) {
    const list = this.messages[chatId] || [];
    const m = list.find((x) => x.id === messageId);
    if (m) {
      if (!m.reactions) m.reactions = [];
      const idx = m.reactions.findIndex((r) => r.code === code);
      if (idx !== -1) {
        m.reactions.splice(idx, 1);
      } else {
        m.reactions.push({ code, count: 1 });
      }
    }
    return true;
  }

  async getDetailedReactions() {
    return [];
  }

  async addContact(phone, firstName, lastName) {
    const newContact = {
      id: Date.now(),
      names: [{ name: `${firstName} ${lastName}`.trim(), firstName, lastName }],
      avatar: null,
      options: [],
    };
    this.contacts.push(newContact);
    updateContact(newContact.id, newContact);
    currentRealContacts.set(this.contacts.map((c) => c.id));
    return newContact;
  }

  async removeContact(id) {
    this.contacts = this.contacts.filter((c) => c.id !== id);
    currentRealContacts.set(this.contacts.map((c) => c.id));
    return true;
  }

  async searchPublic(query) {
    const q = (query || "").toLowerCase();
    const matched = this.contacts.filter((c) => {
      const name = c.names?.[0]?.name?.toLowerCase() || "";
      return name.includes(q);
    });
    return matched;
  }

  async searchMsg(query) {
    const q = (query || "").toLowerCase();
    const result = [];
    for (const chatId in this.messages) {
      for (const m of this.messages[chatId]) {
        if (m.text && m.text.toLowerCase().includes(q)) {
          result.push(m);
        }
      }
    }
    return { messages: result };
  }

  async setPresence(presence) {
    currentPresence.set(presence);
    return true;
  }

  async getCalls() {
    return [];
  }

  async updateProfile(data) {
    if (data?.firstName || data?.lastName) {
      const fn = data.firstName || "";
      const ln = data.lastName || "";
      this.currentUserContact.names = [{ name: `${fn} ${ln}`.trim(), firstName: fn, lastName: ln }];
      currentUserDetails.set(this.currentUserContact);
    }
    return true;
  }

  async reconnect() {
    return true;
  }
}
