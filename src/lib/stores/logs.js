import { writable, get as getStoreValue } from "svelte/store";
import { listen } from "@tauri-apps/api/event";

export const logs = writable([]);
export const total = writable(0);

let logCounter = 0;

function _add(data, type, preview) {
  logs.update((current) => {
    const newLog = {
      id: logCounter++,
      timestamp: new Date().toLocaleTimeString(),
      data,
      type,
      preview,
    };

    const next = [newLog, ...current];
    return next.slice(0, 100);
  });

  total.update((x) => x + 1);
}

export const add = data => {
  const type = data.request ? "request" : "response";
  _add(data, type, JSON.stringify(data).slice(0, 200));
}

export function error(data) {
  _add(data, "error", data.type + " " + data.text);
}

export function clear() {
  logs.set([]);
  total.set(0);
}

export const get = () => getStoreValue(logs);

export default logs;
