import { writable } from "svelte/store";
import { clearAllSafeAvatarCaches } from "$lib/services/AvatarSyncManager";

const STORAGE_KEY = "max_disable_maxplus_avatars";

function createDisableAvatarsStore() {
  const initial = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "true";
  const { subscribe, set, update } = writable(initial);

  return {
    subscribe,
    set: (val) => {
      const bool = Boolean(val);
      if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, String(bool));
      set(bool);
      if (bool) clearAllSafeAvatarCaches().catch(() => {});
    },
    toggle: () => update((v) => {
      const next = !v;
      if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, String(next));
      if (next) clearAllSafeAvatarCaches().catch(() => {});
      return next;
    })
  };
}

export const disableMaxPlusAvatars = createDisableAvatarsStore();
