import { writable } from 'svelte/store';

import { error } from "../stores/logs";

export const alerts = writable([]);

const normalizeAlertText = (val) => String(val ?? "").replace(/^Ошибка API:\s*/i, "").trim();

export function showAlert(data, description, onClick, duration = 6000) {
  const id = crypto.randomUUID();

  const text = typeof data === "string"
    ? data
    : (data?.localizedMessage || data?.title || data?.message || data?.text || data?.error || (typeof data === "object" ? (data?.toString() === "[object Object]" ? JSON.stringify(data) : data.toString()) : String(data)));

  const err = new Error();
  const calledAt = err.stack ? err.stack.split('\n')[1] : "";

  const newAlert = { id, data: text, description, calledAt, onClick };
  const normalizedText = normalizeAlertText(text);

  let added = false;
  alerts.update(all => {
    if (normalizedText && all.some(a => normalizeAlertText(a.data) === normalizedText)) {
      return all;
    }
    added = true;
    return [...all, newAlert];
  });
  if (!added) return;

  error({ type: "alert", ...newAlert });

  setTimeout(() => {
    removeAlert(id);
  }, duration);
}

export function removeAlert(id) {
  alerts.update(all => all.filter((alert) => alert.id !== id));
}
