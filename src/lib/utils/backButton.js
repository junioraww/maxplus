import { invoke } from "@tauri-apps/api/core";

let stack = [];
let panelNavigation = null;

export function registerBackHandler(handler) {
  if (typeof handler !== "function") return () => {};

  const entry = { handler };
  stack.push(entry);

  return () => {
    const idx = stack.indexOf(entry);
    if (idx !== -1) {
      stack.splice(idx);
    }
  };
}

export function setPanelNavigation(nav) {
  panelNavigation = nav;
  return () => {
    if (panelNavigation === nav) {
      panelNavigation = null;
    }
  };
}

export async function exitApp() {
  try {
    await invoke("exit_app");
    return;
  } catch {}

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
    return;
  } catch {}

  if (typeof window !== "undefined" && typeof window.close === "function") {
    window.close();
  }
}

export async function handleBackButton() {
  if (stack.length > 0) {
    const entry = stack[stack.length - 1];
    const res = await entry.handler();
    if (res !== false) {
      const idx = stack.indexOf(entry);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    }
    return true;
  }

  if (panelNavigation && typeof panelNavigation.isMain === "function" && !panelNavigation.isMain()) {
    if (typeof panelNavigation.goToMain === "function") {
      panelNavigation.goToMain();
      return true;
    }
  }

  await exitApp();
  return false;
}

export function getBackStackLength() {
  return stack.length;
}

export function clearBackStack() {
  stack = [];
}
