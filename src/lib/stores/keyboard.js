import { writable, get } from "svelte/store";

const STORAGE_KEY = "max_keyboard_height";

function getInitialHeight() {
  if (typeof window === "undefined") return 290;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? parseInt(saved, 10) : 0;
    if (parsed >= 100 && parsed <= 600) return parsed;
  } catch {}
  return 290;
}

export const keyboardOpen = writable(false);
export const keyboardHeight = writable(getInitialHeight());

let initialized = false;

export function initKeyboardTracker() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const initH = get(keyboardHeight);
  document.documentElement.style.setProperty("--keyboard-height", `${initH}px`);

  window.addEventListener("native-keyboard", (e) => {
    const { isOpen, height } = e.detail || {};
    keyboardOpen.set(!!isOpen);
    if (typeof height === "number" && height > 0) {
      keyboardHeight.set(height);
      try {
        localStorage.setItem(STORAGE_KEY, String(height));
      } catch {}
      document.documentElement.style.setProperty("--keyboard-height", `${height}px`);
    }
  });

  const isIOS = typeof navigator !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );

  if (isIOS && window.visualViewport) {
    const onVvResize = () => {
      const diff = Math.max(0, window.innerHeight - window.visualViewport.height);
      const isOpen = diff > 100;
      keyboardOpen.set(isOpen);
      if (isOpen) {
        const h = Math.round(diff);
        keyboardHeight.set(h);
        try {
          localStorage.setItem(STORAGE_KEY, String(h));
        } catch {}
        document.documentElement.style.setProperty("--keyboard-height", `${h}px`);
        document.documentElement.style.setProperty("--keyboard-inset", `${h}px`);
      } else {
        document.documentElement.style.setProperty("--keyboard-inset", "0px");
      }
    };
    window.visualViewport.addEventListener("resize", onVvResize);
  }
}
