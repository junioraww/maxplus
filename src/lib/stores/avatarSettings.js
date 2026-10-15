import { writable } from "svelte/store";

const STORAGE_KEY = "max_disable_maxplus_avatars";

function createDisableAvatarsStore() {
  const initial = typeof localStorage !== "undefined"
    ? localStorage.getItem(STORAGE_KEY) === "true"
    : false;

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
      let current = false;
      subscribe((v) => (current = v))();
      const next = !current;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      }
      set(next);
    }
  };
}

export const disableMaxPlusAvatars = createDisableAvatarsStore();
