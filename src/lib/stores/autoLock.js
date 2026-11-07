import { writable, get } from "svelte/store";
import { getCurrentAccount, setAccountMeta } from "$lib/stores/accounts";
import { openLockScreen, lockScreenState } from "$lib/stores/lockScreen";

export const AUTO_LOCK_OPTIONS = [
  { value: -1, label: "Отключено" },
  { value: 0, label: "Сразу" },
  { value: 30, label: "30 секунд" },
  { value: 60, label: "1 минута" },
  { value: 300, label: "5 минут" },
  { value: 600, label: "10 минут" },
];

const STORAGE_KEY = "maxplus_autolock_timer";

function getInitialValue() {
  if (typeof window === "undefined") return -1;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    const parsed = parseInt(saved, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return -1;
}

export const autoLockTimer = writable(getInitialValue());

export async function setAutoLockTimer(seconds, accountId) {
  autoLockTimer.set(seconds);
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, String(seconds));
  }
  if (accountId) {
    await setAccountMeta(accountId, "auto_lock_timer", seconds).catch(() => {});
  }
}

export async function loadAccountAutoLockTimer(account) {
  if (!account) return;
  if (account.meta?.auto_lock_timer !== undefined) {
    const val = Number(account.meta.auto_lock_timer);
    autoLockTimer.set(val);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(val));
    }
  }
}

let lastActivityTime = Date.now();
let hiddenAt = null;
let watcherActive = false;
let isLocking = false;

export function resetAutoLockActivity() {
  lastActivityTime = Date.now();
  hiddenAt = null;
}

async function triggerLock() {
  if (typeof window === "undefined") return;
  if (isLocking) return;
  if (window.location.pathname.startsWith("/auth")) return;
  if (get(lockScreenState)) return;

  isLocking = true;
  try {
    const account = await getCurrentAccount().catch(() => null);
    if (!account || !account.encryption) return;

    openLockScreen({ mode: "decrypt" });
  } finally {
    isLocking = false;
  }
}

export function initAutoLockWatcher() {
  if (typeof window === "undefined" || watcherActive) return () => {};
  watcherActive = true;
  lastActivityTime = Date.now();

  getCurrentAccount().then((acc) => {
    if (acc) loadAccountAutoLockTimer(acc);
  }).catch(() => {});

  const updateActivity = () => {
    lastActivityTime = Date.now();
  };

  const activityEvents = ["pointerdown", "keydown", "touchstart", "scroll"];
  activityEvents.forEach((ev) => window.addEventListener(ev, updateActivity, { passive: true }));

  const checkElapsedAndLock = () => {
    if (get(lockScreenState)) return;
    const timer = get(autoLockTimer);
    if (timer < 0) return;

    if (hiddenAt !== null) {
      const elapsed = (Date.now() - hiddenAt) / 1000;
      hiddenAt = null;
      if (timer === 0 || (timer > 0 && elapsed >= timer)) {
        triggerLock();
        return;
      }
    }
    lastActivityTime = Date.now();
  };

  const handleVisibilityChange = () => {
    if (get(lockScreenState)) return;
    const timer = get(autoLockTimer);
    if (timer < 0) return;

    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      if (timer === 0) {
        triggerLock();
      }
    } else if (document.visibilityState === "visible") {
      checkElapsedAndLock();
    }
  };

  const handleBlur = () => {
    if (get(lockScreenState)) return;
    const timer = get(autoLockTimer);
    if (timer < 0) return;
    hiddenAt = Date.now();
    if (timer === 0) {
      triggerLock();
    }
  };

  const handleFocus = () => {
    checkElapsedAndLock();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("blur", handleBlur);
  window.addEventListener("focus", handleFocus);

  let unlistenWindowFocus = null;
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    win.onFocusChanged(({ payload: focused }) => {
      if (get(lockScreenState)) return;
      const timer = get(autoLockTimer);
      if (timer < 0) return;

      if (!focused) {
        hiddenAt = Date.now();
        if (timer === 0) {
          triggerLock();
        }
      } else {
        checkElapsedAndLock();
      }
    }).then((unlisten) => {
      unlistenWindowFocus = unlisten;
    }).catch(() => {});
  }).catch(() => {});

  const intervalId = setInterval(() => {
    if (get(lockScreenState)) return;
    const timer = get(autoLockTimer);
    if (timer <= 0) return;

    const idleSeconds = (Date.now() - lastActivityTime) / 1000;
    if (idleSeconds >= timer) {
      triggerLock();
    }
  }, 1000);

  return () => {
    watcherActive = false;
    clearInterval(intervalId);
    activityEvents.forEach((ev) => window.removeEventListener(ev, updateActivity));
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("focus", handleFocus);
    if (unlistenWindowFocus) {
      unlistenWindowFocus();
    }
  };
}
