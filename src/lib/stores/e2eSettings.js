import { writable } from "svelte/store";

const STORAGE_KEY = "max_auto_download_encrypted_media";

function createAutoDownloadStore() {
  const initial = typeof localStorage !== "undefined"
    ? localStorage.getItem(STORAGE_KEY) !== "false"
    : true;

  const { subscribe, set } = writable(initial);

  return {
    subscribe,
    set: (value) => {
      const boolVal = Boolean(value);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, boolVal ? "true" : "false");
      }
      set(boolVal);
    },
    toggle: () => {
      let current = true;
      subscribe((v) => (current = v))();
      const next = !current;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      }
      set(next);
    }
  };
}

export const autoDownloadEncryptedMedia = createAutoDownloadStore();
