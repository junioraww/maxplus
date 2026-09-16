import { writable } from "svelte/store";

const STORAGE_KEY = "chat_scroll_positions";

function loadPositions() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistPositions(data) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
  }
}

export const chatScrollStore = writable(loadPositions());

export function getChatScroll(chatId) {
  if (chatId === undefined || chatId === null) return null;
  const all = loadPositions();
  return all[String(chatId)] || null;
}

export function saveChatScroll(chatId, info) {
  if (chatId === undefined || chatId === null) return;
  const stringId = String(chatId);
  chatScrollStore.update((all) => {
    const next = { ...all, [stringId]: info };
    persistPositions(next);
    return next;
  });
}

export function clearChatScroll(chatId) {
  if (chatId === undefined || chatId === null) return;
  const stringId = String(chatId);
  chatScrollStore.update((all) => {
    const next = { ...all };
    delete next[stringId];
    persistPositions(next);
    return next;
  });
}
