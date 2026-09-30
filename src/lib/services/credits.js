import { invoke } from "@tauri-apps/api/core";

export const HARDCODED_CREDITS = [
  ["contributor", "JuniorAww", "Создано", 5],
  ["contributor", "hu553in", "Адаптировано", 5],
  ["contributor", "megazoll", "Улучшено", 1]
];

let cachedCredits = null;
let fetchPromise = null;
let diskLoadPromise = null;

async function loadFromDisk() {
  if (diskLoadPromise) return diskLoadPromise;
  diskLoadPromise = (async () => {
    try {
      if (typeof window !== "undefined" && (window.__TAURI_INTERNALS__ || window.__TAURI__)) {
        const disk = await invoke("load_cached_credits");
        if (Array.isArray(disk) && disk.length > 0) {
          if (!cachedCredits) cachedCredits = disk;
          return disk;
        }
      }
    } catch {}
    return null;
  })();
  return diskLoadPromise;
}

if (typeof window !== "undefined") {
  loadFromDisk();
}

export function formatCreditLine(item) {
  if (!item) return "";
  if (Array.isArray(item)) {
    const name = item[1] || "";
    const text = item[2] || "";
    return text && name ? `${text} ${name}` : (name || text || "");
  }
  return item.text && item.name ? `${item.text} ${item.name}` : (item.name || item.text || "");
}

export function getRandomCreditString() {
  const list = cachedCredits && cachedCredits.length > 0 ? cachedCredits : HARDCODED_CREDITS;
  if (!list || list.length === 0) return "";
  
  let totalWeight = 0;
  for (const item of list) {
    const p = Math.max(1, Number(Array.isArray(item) ? item[3] : item.p) || 1);
    totalWeight += p;
  }
  
  let random = Math.random() * totalWeight;
  for (const item of list) {
    const p = Math.max(1, Number(Array.isArray(item) ? item[3] : item.p) || 1);
    if (random < p) {
      return formatCreditLine(item);
    }
    random -= p;
  }
  
  return formatCreditLine(list[list.length - 1]);
}

async function fetchRemoteCredits() {
  try {
    if (typeof window !== "undefined" && (window.__TAURI_INTERNALS__ || window.__TAURI__)) {
      const rawText = await invoke("fetch_url_text", { url: "https://maxplus.dev/api/credits" });
      if (rawText) {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cachedCredits = parsed;
          await invoke("save_cached_credits", { credits: parsed }).catch(() => {});
          return parsed;
        }
      }
    }
  } catch {}

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("https://maxplus.dev/api/credits", {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        cachedCredits = data;
        if (typeof window !== "undefined" && (window.__TAURI_INTERNALS__ || window.__TAURI__)) {
          await invoke("save_cached_credits", { credits: data }).catch(() => {});
        }
        return data;
      }
    }
  } catch {}

  return null;
}

export async function loadCredits(forceRefresh = false) {
  if (forceRefresh) {
    const fresh = await fetchRemoteCredits();
    if (fresh) return fresh;
    if (cachedCredits) return cachedCredits;
    const disk = await loadFromDisk();
    if (Array.isArray(disk) && disk.length > 0) return disk;
    return [...HARDCODED_CREDITS];
  }

  if (cachedCredits) {
    fetchRemoteCredits().catch(() => {});
    return cachedCredits;
  }

  const remote = await fetchRemoteCredits();
  if (remote) return remote;

  const disk = await loadFromDisk();
  if (Array.isArray(disk) && disk.length > 0) {
    cachedCredits = disk;
    return cachedCredits;
  }

  cachedCredits = [...HARDCODED_CREDITS];
  return cachedCredits;
}

export async function getCreditsGrouped(forceRefresh = false) {
  const all = await loadCredits(forceRefresh);
  const groups = {
    contributor: [],
    supporter: [],
    tester: []
  };

  for (const item of all) {
    const cat = Array.isArray(item) ? item[0] : (item.category || "contributor");
    const name = Array.isArray(item) ? item[1] : (item.name || "");
    const text = Array.isArray(item) ? item[2] : (item.text || "");
    const p = Array.isArray(item) ? (item[3] || 0) : (item.p || 0);

    if (!groups[cat]) {
      groups[cat] = [];
    }
    groups[cat].push({ name, text, p });
  }

  for (const cat in groups) {
    groups[cat].sort((a, b) => (b.p || 0) - (a.p || 0));
  }

  return groups;
}
