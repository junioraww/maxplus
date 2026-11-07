import { writable, derived } from "svelte/store";
import { browser } from "$app/environment";
import { invoke } from "@tauri-apps/api/core";

const STORE_NAME = "theme";

export const themeMode = writable("light");
export const customTokens = writable({});
export const activeThemeId = writable("light");

async function persistTheme(mode) {
  if (!browser) return;
  try {
    await invoke("common_store_save", { store: STORE_NAME, data: { mode } });
  } catch {
    localStorage.setItem(STORE_NAME, mode);
  }
}

export async function setTheme(id) {
  if (id !== "light" && id !== "dark") return;
  activeThemeId.set(id);
  themeMode.set(id);
  await persistTheme(id);
}

export async function toggleTheme() {
  let cur = "light";
  activeThemeId.subscribe((v) => (cur = v))();
  const next = cur === "dark" ? "light" : "dark";
  await setTheme(next);
}

export async function initTheme() {
  if (!browser) return;

  let saved = null;
  try {
    const res = await invoke("common_store_load", { store: STORE_NAME });
    if (res?.mode) saved = res.mode;
  } catch {
    saved = localStorage.getItem(STORE_NAME);
  }

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  let targetId = "light";
  if (saved === "dark" || saved === "light") {
    targetId = saved;
  } else {
    targetId = systemDark ? "dark" : "light";
  }

  activeThemeId.set(targetId);
  themeMode.set(saved || "system");

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    let mode;
    themeMode.subscribe((v) => (mode = v))();
    if (!mode || mode === "system") {
      const nextId = e.matches ? "dark" : "light";
      activeThemeId.set(nextId);
    }
  });
}
