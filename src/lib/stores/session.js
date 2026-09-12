import { writable, get as getStoreValue, readable } from "svelte/store";
import { goto } from "$app/navigation";

import API, { currentSessionChats } from "$lib/stores/api";
import {
  saveChats,
} from "$lib/stores/messages";

const data = writable({
  openedChats: [],
});

export default data;

export function set(key, value) {
  data.update((current) => ({ ...current, [key]: value }));
}

export function get(key) {
  const current = getStoreValue(data);
  return current[key];
}

export const now = readable(Date.now(), (set) => {
  const interval = setInterval(() => {
    set(Date.now());
  }, 1000);

  return () => clearInterval(interval);
});

export async function openChat(chatId/*,  messageId */) { // TODO
  const { openedChats, profile } = getStoreValue(data);

  if (openedChats.findIndex(id => id === chatId) === -1) {
    let chat = getStoreValue(currentSessionChats).find(x => x.id === chatId);

    if (!chat) {
      console.log("Chat not cached, requesting:", chatId);

      const response = await getStoreValue(API).getChat(chatId);

      if (!response.chats.length) {
        return alert("Не удалось получить информацию о чате.\nВозможно, чат закрыт.");
      }

      const info = response.chats[0];

       // TODO Optimize
      currentSessionChats.update(chats => {
        const idx = chats.findIndex(x => x.id === info.id);
        if (idx !== -1) chats.splice(idx, 1);
        chats.push(info);
      });

      await saveChats([ info ]);
    }

    console.log('Opening chat', chatId);

    data.update(s => ({
      ...s,
      profile: null,
      openedChats: [ ...openedChats, chatId ]
    }));
  }
  else if (profile) {
    data.update(s => ({
      ...s,
      profile: null
    }));
  }
}

export function closeChat(chatId) {
  console.log('Closing', chatId)

  return data.update(session => {
    const idx = session.openedChats.indexOf(chatId);
    if (idx !== -1) session.openedChats.splice(idx, 1);
    return session;
  });
}
