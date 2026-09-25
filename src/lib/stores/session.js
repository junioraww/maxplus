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

export async function openChat(chatId) {
  const currentData = getStoreValue(data) || {};
  const openedChats = Array.isArray(currentData.openedChats) ? currentData.openedChats : [];
  const profile = currentData.profile;

  if (openedChats.findIndex(id => String(id) === String(chatId)) === -1) {
    const rawChats = getStoreValue(currentSessionChats);
    let chat = Array.isArray(rawChats) ? rawChats.find(x => String(x.id) === String(chatId)) : null;

    if (!chat) {
      const response = await getStoreValue(API).getChat(chatId);

      if (!response || !response.chats || !response.chats.length) {
        return alert("Не удалось получить информацию о чате.\nВозможно, чат закрыт.");
      }

      const info = response.chats[0];

      currentSessionChats.update(chats => {
        const list = Array.isArray(chats) ? [...chats] : [];
        const idx = list.findIndex(x => x.id === info.id);
        if (idx !== -1) list.splice(idx, 1);
        list.push(info);
        return list;
      });

      await saveChats([ info ]);
    }

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
    const idx = session.openedChats.findIndex(id => String(id) === String(chatId));
    if (idx !== -1) session.openedChats.splice(idx, 1);
    return session;
  });
}

export function openSettingsPage(pageId) {
  data.update(current => ({ ...current, settingsPage: pageId }));
}

export function closeSettingsPage() {
  data.update(current => ({ ...current, settingsPage: null }));
}
