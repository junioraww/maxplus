import { writable } from 'svelte/store';

import { error } from "../stores/logs.js";

export const alerts = writable([]);

export function showAlert(data, description, onClick, duration = 6000) {
  const id = crypto.randomUUID();

  const text = typeof data === "string"
    ? data
    : (data?.title || data?.message || data?.text || data?.error || (typeof data === "object" ? (data?.toString() === "[object Object]" ? JSON.stringify(data) : data.toString()) : String(data)));

  const err = new Error();
  const calledAt = err.stack ? err.stack.split('\n')[1] : "";

  const newAlert = { id, data: text, description, calledAt, onClick };

  alerts.update(all => [...all, newAlert]);
  error({ type: "alert", ...newAlert });

  setTimeout(() => {
    removeAlert(id);
  }, duration);
}

export function removeAlert(id) {
  alerts.update(all => all.filter((alert) => alert.id !== id));
}
