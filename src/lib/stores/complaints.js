import { writable, get } from "svelte/store";
import API from "$lib/stores/api";

const STORAGE_KEY = "maxplus_complaint_reasons";

const FALLBACK_REASONS = [
  { id: 1, title: "Спам" },
  { id: 2, title: "Насилие и угрозы" },
  { id: 3, title: "Материалы для взрослых" },
  { id: 4, title: "Мошенничество" },
  { id: 5, title: "Оскорбления" },
  { id: 6, title: "Другое" },
];

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return FALLBACK_REASONS;
}

export const complaintReasons = writable(readCache());

let preloading = null;

export async function preloadComplaintReasons() {
  if (preloading) return preloading;
  preloading = (async () => {
    try {
      const api = get(API);
      if (!api?.getComplaintReasons) return;
      const resp = await api.getComplaintReasons();
      const list = [];
      const complains = resp?.complains;
      if (Array.isArray(complains)) {
        for (const item of complains) {
          if (Array.isArray(item?.reasons)) {
            for (const r of item.reasons) {
              const id = r.reasonId ?? r.id;
              const title = r.reasonTitle ?? r.title;
              if (id && title) {
                list.push({ id, title: String(title) });
              }
            }
          }
        }
      }
      if (list.length > 0) {
        const unique = [];
        const seen = new Set();
        for (const r of list) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            unique.push(r);
          }
        }
        complaintReasons.set(unique);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(unique));
        } catch {}
      }
    } catch (e) {
      console.warn("Failed to preload complaint reasons:", e);
    } finally {
      preloading = null;
    }
  })();
  return preloading;
}
