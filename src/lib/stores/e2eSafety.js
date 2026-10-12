import { writable } from "svelte/store";

export const safetyLockouts = writable({});

export function triggerSafetyLockout(chatId, durationMs = 5000) {
  if (!chatId) return;
  const targetId = String(chatId);
  const expiry = Date.now() + durationMs;

  safetyLockouts.update((current) => ({
    ...current,
    [targetId]: expiry,
  }));

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("e2e_safety_lockout", {
        detail: { chatId: targetId, durationMs },
      })
    );
  }

  setTimeout(() => {
    safetyLockouts.update((current) => {
      const next = { ...current };
      if (next[targetId] && next[targetId] <= Date.now()) {
        delete next[targetId];
      }
      return next;
    });
  }, durationMs + 100);
}

export function isChatSafetyLocked(chatId, lockouts) {
  if (!chatId || !lockouts) return false;
  const targetId = String(chatId);
  const expiry = lockouts[targetId];
  return Boolean(expiry && expiry > Date.now());
}
