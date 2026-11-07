import { writable, derived } from "svelte/store";

const DEFAULT_HEIGHT = 290;

export const keyboardState = writable({
  isOpen: false,
  height: DEFAULT_HEIGHT,
});

export const isKeyboardOpen = derived(keyboardState, ($k) => $k.isOpen);
export const keyboardHeight = derived(keyboardState, ($k) => $k.height);

let isInitialized = false;
let baseHeight = 0;

export function initKeyboardTracker() {
  if (isInitialized || typeof window === "undefined") return;
  isInitialized = true;

  baseHeight = window.innerHeight;

  const update = () => {
    const vv = window.visualViewport;
    const activeEl = document.activeElement;
    const isInputFocused =
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.isContentEditable);

    const currentVvHeight = vv ? vv.height : window.innerHeight;

    if (!isInputFocused && currentVvHeight >= baseHeight) {
      baseHeight = currentVvHeight;
    }

    const diffFromBase = Math.max(0, baseHeight - currentVvHeight);
    const diffFromInner = Math.max(0, window.innerHeight - currentVvHeight);
    const diff = Math.max(diffFromBase, diffFromInner);

    if (diff > 120 && isInputFocused) {
      const h = Math.round(diff);
      keyboardState.set({
        isOpen: true,
        height: h,
      });
    } else {
      keyboardState.update((prev) => {
        if (!prev.isOpen) return prev;
        return {
          ...prev,
          isOpen: false,
        };
      });
    }
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", update);
    window.visualViewport.addEventListener("scroll", update);
  }

  window.addEventListener("resize", () => {
    const activeEl = document.activeElement;
    const isInputFocused =
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.isContentEditable);
    if (!isInputFocused) {
      baseHeight = window.innerHeight;
    }
    update();
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      baseHeight = window.innerHeight;
      update();
    }, 150);
  });

  document.addEventListener("focusin", () => {
    setTimeout(update, 50);
    setTimeout(update, 250);
  });

  document.addEventListener("focusout", () => {
    setTimeout(update, 50);
    setTimeout(update, 200);
  });
}
