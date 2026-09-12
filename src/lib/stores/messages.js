import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";

import {
  getCurrentAccount
} from "$lib/stores/accounts";

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

  const chatInfo = writable(undefined);

  const receivedMessage = writable(null);

  const entry = {
    chatInfo,
    receivedMessage,
    updateMessages: async messages => {
      const account = await getCurrentAccount();
      return invoke("update_messages", { account: Number(account.id), chatId: Number(chatId), messages });
    },
    loadMessages: async (time, amount) => {
      const account = await getCurrentAccount();
      return invoke("load_messages", { account: Number(account.id), chatId: Number(chatId), time, amount });
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
