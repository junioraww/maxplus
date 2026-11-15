import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { clearAllSafeAvatarCaches } from "$lib/services/AvatarSyncManager";

const STORE_KEY = "avatar_settings";

function createDisableAvatarsStore() {
  const { subscribe, set, update } = writable(false);

  if (typeof window !== "undefined") {
    invoke("common_store_load", { store: STORE_KEY })
      .then((data) => {
        if (data && typeof data.disableMaxPlusAvatars === "boolean") {
          set(data.disableMaxPlusAvatars);
        }
      })
      .catch(() => {});
  }

  const persist = (bool) => {
    invoke("common_store_save", { store: STORE_KEY, data: { disableMaxPlusAvatars: bool } }).catch(() => {});
  };

  return {
    subscribe,
    set: (val) => {
      const bool = Boolean(val);
      set(bool);
      persist(bool);
      if (bool) clearAllSafeAvatarCaches().catch(() => {});
    },
    toggle: () => update((v) => {
      const next = !v;
      persist(next);
      if (next) clearAllSafeAvatarCaches().catch(() => {});
      return next;
    })
  };
}

export const disableMaxPlusAvatars = createDisableAvatarsStore();
