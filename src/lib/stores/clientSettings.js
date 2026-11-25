import { writable } from "svelte/store";
import { browser } from "$app/environment";
import { invoke } from "@tauri-apps/api/core";

const STORE_NAME = "client_settings";

const DEFAULTS = {
  sendByEnter: true,
  fontSize: 15,
  largeEmoji: true,
  autoDownloadPhotos: true,
  autoDownloadVideos: false,
  autoDownloadFiles: false,
  autoPlayGifs: true,
  autoPlayVideos: true,
  saveToGallery: false,
  animationsEnabled: true,
  stickersAutoPlay: true,
  reducedMotion: false,
  language: "ru",
};

export const clientSettings = writable({ ...DEFAULTS });

let loaded = false;

export async function initClientSettings() {
  if (!browser || loaded) return;
  loaded = true;
  try {
    const res = await invoke("common_store_load", { store: STORE_NAME });
    if (res && typeof res === "object") {
      clientSettings.set({ ...DEFAULTS, ...res });
    }
  } catch (e) {
    console.error("Failed to load client_settings:", e);
  }
}

export async function updateClientSetting(key, value) {
  let nextState;
  clientSettings.update((cur) => {
    nextState = { ...cur, [key]: value };
    return nextState;
  });
  if (!browser || !nextState) return;
  try {
    await invoke("common_store_save", { store: STORE_NAME, data: nextState });
  } catch (e) {
    console.error("Failed to save client_settings:", e);
  }
}
