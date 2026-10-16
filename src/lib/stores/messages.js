import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";

import {
  getCurrentAccount,
} from "$lib/stores/accounts";
import {
  currentRealChats,
} from "$lib/stores/api";
import {
  get as sessionGet,
} from "$lib/stores/session";

const settingsCache = {};
const chatsCache = {};

export const loadChats = async () => {
  const account = await getCurrentAccount();
  return invoke("load_chats", { account: account.id });
}

export const saveChats = async (chats) => {
  const account = await getCurrentAccount();
  return invoke("save_chats", { account: account.id, chats });
}

export const getChatSettings = chatId => {
  if (settingsCache[chatId])
    return settingsCache[chatId].store;

  const store = writable(undefined);

  const entry = {
    store,
    initialized: false
  };

  settingsCache[chatId] = entry;

  (async () => {
    const account = await getCurrentAccount();

    const data = await invoke(
      "get_chat_settings",
      {
        account: Number(account.id),
        chatId: Number(chatId)
      }
    );

    store.set(data);

    entry.unsubscribe = store.subscribe(async updated => {
      if (!entry.initialized) {
        entry.initialized = true;
        return;
      }

      const _account =  await getCurrentAccount();
      await invoke("set_chat_settings", { account: Number(_account.id), chatId: Number(chatId), data: updated });
    });
  })();

  return store;
};

export const getChat = chatId => {
  if (chatsCache[chatId])
    return chatsCache[chatId];

  const chatInfo = writable(null);
  const receivedMessage = writable(null);
  const readReceipt = writable(null);
  const deletedMessages = writable(null);

  const entry = {
    chatInfo,
    chatMeta: chatInfo,
    chatData: chatInfo,
    getInfo: () => get(chatInfo),
    receivedMessage,
    readReceipt,
    deletedMessages,
    updateMessages: async messages => {
      const account = await getCurrentAccount();
      return invoke("update_messages", { account: Number(account.id), chatId: Number(chatId), messages });
    },
    markMessageDeleted: async messageId => {
      const account = await getCurrentAccount();
      return invoke("mark_message_deleted", {
        account: Number(account.id),
        chatId: Number(chatId),
        messageId: String(messageId),
      });
    },
    markMessagesDeleted: async messageIds => {
      const account = await getCurrentAccount();
      return Promise.all(
        messageIds.map(id =>
          invoke("mark_message_deleted", {
            account: Number(account.id),
            chatId: Number(chatId),
            messageId: String(id),
          })
        )
      );
    },
    removeMessageFromStorage: async messageId => {
      const account = await getCurrentAccount();
      return invoke("remove_message_from_storage", {
        account: Number(account.id),
        chatId: Number(chatId),
        messageId: String(messageId),
      }).catch(() => {});
    },
    removeMessagesFromStorage: async messageIds => {
      const account = await getCurrentAccount();
      if (!account?.id) return;
      return Promise.all(
        messageIds.map(id =>
          invoke("remove_message_from_storage", {
            account: Number(account.id),
            chatId: Number(chatId),
            messageId: String(id),
          }).catch(() => {})
        )
      );
    },
    loadMessages: async (time, amount) => {
      const account = await getCurrentAccount();
      if (!account?.id) return [];
      return invoke("load_messages", { account: Number(account.id), chatId: Number(chatId), time, amount });
    },
    clearLocalMessages: async () => {
      const account = await getCurrentAccount();
      if (!account?.id) return;
      return invoke("clear_local_messages", { account: Number(account.id), chatId: Number(chatId) });
    }
  };

  chatsCache[chatId] = entry;
  return entry;
};

export const closeChatSettings = chatId => {
  const settings = settingsCache[chatId];
  if (!settings) return;
  if (settings.unsubscribe) settings.unsubscribe();
  delete settingsCache[chatId];
};

export const getChatInfo = chatId => getChat(chatId).chatInfo;
export const getChatMeta = chatId => getChat(chatId).chatInfo;
export const setChatInfo = (chatId, info) => getChat(chatId).chatInfo.set(info);

export const updateChatInfo = (chatId, updater) => {
  const { chatInfo } = getChat(chatId);
  if (typeof updater === "function") {
    chatInfo.update(updater);
  } else {
    chatInfo.update(prev => ({ ...(prev || {}), ...updater }));
  }
};

export const getAllChats = () => {
  const ids = get(currentRealChats) || [];
  return ids.map(id => getChat(id).getInfo()).filter(Boolean);
};
