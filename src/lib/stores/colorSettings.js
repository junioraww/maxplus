import { writable } from "svelte/store";
import { saveStorageKey, getStorageKey } from "$lib/webapp/storage";

const DEFAULT_PRESETS = [
  "#FF5252", "#FF7A00", "#FFD600", "#4CAF50",
  "#00E5FF", "#2979FF", "#7C4DFF", "#E040FB",
  "#FF4081", "#FFFFFF", "#90A4AE", "#263238",
];

const BOT_ID = "client_settings";
const PRESETS_KEY = "palette_presets";
const LAST_COLOR_KEY = "last_color";

export const colorPresets = writable([...DEFAULT_PRESETS]);
export const lastUsedColor = writable("#FF5252");

let isInitialized = false;

async function saveKey(key, value, userId) {
  try {
    await saveStorageKey(userId, BOT_ID, true, key, value);
  } catch (e) {
    console.error(e);
  }
}

export async function initColorSettings(userId = "") {
  if (isInitialized) return;
  try {
    const rawPresets = await getStorageKey(userId, BOT_ID, true, PRESETS_KEY);
    if (rawPresets) {
      const parsed = JSON.parse(rawPresets);
      if (Array.isArray(parsed) && parsed.length > 0) colorPresets.set(parsed);
    }
    const rawLast = await getStorageKey(userId, BOT_ID, true, LAST_COLOR_KEY);
    if (rawLast) lastUsedColor.set(rawLast);
    isInitialized = true;
  } catch (e) {
    console.error(e);
  }
}

export async function saveColorPresets(presets, userId = "") {
  if (!Array.isArray(presets)) return;
  colorPresets.set(presets);
  await saveKey(PRESETS_KEY, JSON.stringify(presets), userId);
}

export async function saveLastUsedColor(color, userId = "") {
  if (!color) return;
  lastUsedColor.set(color);
  await saveKey(LAST_COLOR_KEY, color, userId);
}
