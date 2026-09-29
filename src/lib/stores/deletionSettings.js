import { writable } from "svelte/store";

const SAVE_OTHERS_KEY = "maxplus_save_others_deleted";
const HIDE_MINE_KEY = "maxplus_hide_my_deleted";

function createSetting(key, defaultValue) {
  let initial = defaultValue;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      initial = raw === "true";
    }
  } catch {}

  const store = writable(initial);

  return {
    subscribe: store.subscribe,
    set: (val) => {
      try {
        localStorage.setItem(key, String(val));
      } catch {}
      store.set(val);
    },
    toggle: () => {
      store.update((current) => {
        const next = !current;
        try {
          localStorage.setItem(key, String(next));
        } catch {}
        return next;
      });
    },
  };
}

export const saveOthersDeletedMessages = createSetting(SAVE_OTHERS_KEY, true);
export const hideMyDeletedMessages = createSetting(HIDE_MINE_KEY, true);
