import { writable } from "svelte/store";

export const lockScreenState = writable(null);

export function openLockScreen(options = {}) {
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
  lockScreenState.set(null);
}
