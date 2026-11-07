import { writable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentAccount } from "$lib/stores/accounts";

export const lockScreenState = writable(null);

export function openLockScreen(options = {}) {
  invoke("set_app_locked", { locked: true }).catch(() => {});
  lockScreenState.set({
    mode: options.mode || "decrypt",
    lockType: options.lockType || null,
    from: options.from || null,
    account: options.account || null,
    onSuccess: options.onSuccess || null,
    onClose: options.onClose || null,
  });
}

export function closeLockScreen() {
  invoke("set_app_locked", { locked: false }).catch(() => {});
  getCurrentAccount().then((acc) => {
    if (acc?.id) {
      invoke("reset_locked_notification_counter", { account: Number(acc.id) }).catch(() => {});
    }
  }).catch(() => {});
  lockScreenState.set(null);
}
