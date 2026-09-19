import { writable, derived, get } from "svelte/store";
import API from "./api.js";

export const activeWebApps = writable([]);

export const minimizedWebApps = derived(activeWebApps, ($apps) =>
  $apps.filter((a) => a.state === "minimized")
);

export const visibleWebApps = derived(activeWebApps, ($apps) =>
  $apps.filter((a) => a.state !== "minimized")
);

let instanceCounter = 0;

export async function openMiniApp({
  botId,
  title = "Мини-приложение",
  url = null,
  startParam = null,
  chatId = null,
  entryPoint = "web_app",
  termsUrl = null,
}) {
  const currentApps = get(activeWebApps);
  const existing = currentApps.find((a) => Number(a.botId) === Number(botId));

  if (existing) {
    activeWebApps.update((apps) =>
      apps.map((a) =>
        a.id === existing.id
          ? { ...a, state: a.state === "minimized" ? "sheet" : a.state, dragOffsetY: 0 }
          : a
      )
    );
    return existing.id;
  }

  instanceCounter += 1;
  const appId = `app_${botId}_${Date.now()}_${instanceCounter}`;

  const newApp = {
    id: appId,
    botId: Number(botId),
    title,
    url: url || null,
    queryId: null,
    startParam,
    chatId,
    entryPoint,
    termsUrl,
    state: "sheet",
    dragOffsetY: 0,
    customBackButton: false,
    needConfirmation: false,
    loading: !url,
    error: null,
    reloadKey: 0,
  };

  activeWebApps.update((apps) => [...apps, newApp]);

  if (!url) {
    try {
      const apiInstance = get(API);
      const launch = await apiInstance.launchWebApp(botId, { startParam, chatId });
      activeWebApps.update((apps) =>
        apps.map((a) =>
          a.id === appId
            ? { ...a, url: launch.url, queryId: launch.queryId, loading: false, error: null }
            : a
        )
      );
    } catch (err) {
      activeWebApps.update((apps) =>
        apps.map((a) =>
          a.id === appId
            ? { ...a, loading: false, error: err?.message || "Ошибка загрузки" }
            : a
        )
      );
    }
  }

  return appId;
}

export function minimizeMiniApp(id) {
  activeWebApps.update((apps) =>
    apps.map((a) => (a.id === id ? { ...a, state: "minimized", dragOffsetY: 0 } : a))
  );
}

export function expandMiniApp(id) {
  activeWebApps.update((apps) =>
    apps.map((a) => (a.id === id ? { ...a, state: "expanded", dragOffsetY: 0 } : a))
  );
}

export function collapseMiniApp(id) {
  activeWebApps.update((apps) =>
    apps.map((a) => (a.id === id ? { ...a, state: "sheet", dragOffsetY: 0 } : a))
  );
}

export function restoreMiniApp(id) {
  activeWebApps.update((apps) =>
    apps.map((a) => (a.id === id ? { ...a, state: "sheet", dragOffsetY: 0 } : a))
  );
}

export function closeMiniApp(id) {
  activeWebApps.update((apps) => apps.filter((a) => a.id !== id));
}

export function reloadMiniApp(id) {
  activeWebApps.update((apps) =>
    apps.map((a) =>
      a.id === id ? { ...a, reloadKey: a.reloadKey + 1, error: null } : a
    )
  );
}

export function setAppDragOffset(id, dragOffsetY) {
  activeWebApps.update((apps) =>
    apps.map((a) => (a.id === id ? { ...a, dragOffsetY } : a))
  );
}

export function updateAppMeta(id, fields) {
  activeWebApps.update((apps) =>
    apps.map((a) => (a.id === id ? { ...a, ...fields } : a))
  );
}

export async function openSferumApp() {
  const apiInstance = get(API);
  const launch = await apiInstance.launchSferum();
  return openMiniApp({
    botId: launch.botId,
    title: "Сферум",
    url: launch.url,
    entryPoint: "settings",
  });
}

export async function openDigitalIdApp() {
  const apiInstance = get(API);
  const launch = await apiInstance.launchDigitalId();
  return openMiniApp({
    botId: launch.botId,
    title: "Цифровой ID",
    url: launch.url,
    entryPoint: "settings",
  });
}

export function resolveWebAppUrl(url) {
  if (!url || typeof url !== "string") return url;
  if (!url.startsWith("https://") && !url.startsWith("http://")) return url;
  if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return url;
  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  return `http://127.0.0.1:11448/proxy?url=${encodeURIComponent(base)}${hash}`;
}
