import { writable } from 'svelte/store';

import { error } from "$lib/stores/logs.js";

export const alerts = writable([]);

export function showAlert(data, description, onClick, duration = 6000) {
  const id = crypto.randomUUID();

  const err = new Error();
  const calledAt = err.stack.split('\n')[1];

  const newAlert = { id, data, description, calledAt, onClick };

  alerts.update(all => [...all, newAlert]);
  error({ type: "alert", ...newAlert });

  setTimeout(() => {
    removeAlert(id);
  }, duration);
}

export function removeAlert(id) {
  alerts.update(all => all.filter((alert) => alert.id !== id));
}

//const match = callerLine.match(/(?:http|file):\/\/.+?:(\d+):(\d+)/);
