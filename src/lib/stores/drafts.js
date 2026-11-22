import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";

export const chatDrafts = writable(new Map());

let isInitialized = false;
let persistTimeout = null;

export async function initDrafts() {
  try {
    const raw = await invoke("common_store_load", { store: "chat_drafts" });
    if (raw && typeof raw === "object") {
      const map = new Map();
      const entries = Array.isArray(raw) ? raw : Object.entries(raw);
      for (const [k, v] of entries) {
        if (v && typeof v === "object" && v.text) {
          map.set(String(k), v);
          if (!isNaN(Number(k))) map.set(Number(k), v);
        } else if (typeof v === "string" && v) {
          map.set(String(k), { text: v, time: Date.now() });
          if (!isNaN(Number(k))) map.set(Number(k), { text: v, time: Date.now() });
        }
      }
      chatDrafts.set(map);
    }
    isInitialized = true;
  } catch (e) {
    console.error("Failed to load drafts from rust store:", e);
  }
}

function persistDrafts(draftsMap) {
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(async () => {
    try {
      const data = {};
      for (const [k, v] of draftsMap.entries()) {
        const idStr = String(k);
        if (!data[idStr] && v?.text) {
          data[idStr] = v;
        }
      }
      await invoke("common_store_save", { store: "chat_drafts", data });
    } catch (e) {
      console.error("Failed to persist drafts to rust store:", e);
    }
  }, 150);
}

export function setChatDraft(chatId, text) {
  if (chatId == null) return;
  chatDrafts.update((map) => {
    const next = new Map(map);
    const trimmed = typeof text === "string" ? text.trim() : "";
    const idStr = String(chatId);
    const idNum = Number(chatId);
    if (!trimmed) {
      next.delete(chatId);
      next.delete(idStr);
      if (!isNaN(idNum)) next.delete(idNum);
    } else {
      const entry = { text, time: Date.now() };
      next.set(chatId, entry);
      next.set(idStr, entry);
      if (!isNaN(idNum)) next.set(idNum, entry);
    }
    persistDrafts(next);
    return next;
  });
}

export function getChatDraft(chatId) {
  if (chatId == null) return "";
  const map = get(chatDrafts);
  const found = map.get(chatId) || map.get(String(chatId)) || (!isNaN(Number(chatId)) ? map.get(Number(chatId)) : null);
  return found?.text || "";
}

export function clearChatDraft(chatId) {
  setChatDraft(chatId, "");
}
