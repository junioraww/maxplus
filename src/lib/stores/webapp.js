import { writable, derived, get } from "svelte/store";
import API from "./api.js";

export const activeWebApps = writable([]);

export const minimizedWebApps = derived(activeWebApps, ($apps) =>
  $apps.filter((a) => a.state === "minimized")
);

export const visibleWebApps = derived(activeWebApps, ($apps) =>
  $apps.filter((a) => a.state !== "minimized")
);

export const lastClosedMiniApp = writable(null);

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
  let launchUrl = url || null;
  let effectiveStartParam = startParam;
  let effectiveChatId = chatId;

  if (launchUrl && !launchUrl.includes("WebAppData=") && !launchUrl.includes("tgWebAppData=")) {
    try {
      const raw = launchUrl.startsWith("max://")
        ? launchUrl.replace(/^max:\/\//, "https://max.ru/")
        : launchUrl;
      const parsed = new URL(raw);
      effectiveStartParam =
        effectiveStartParam ||
        parsed.searchParams.get("startapp") ||
        parsed.searchParams.get("startApp") ||
        parsed.searchParams.get("WebAppStartParam") ||
        parsed.searchParams.get("start_param");
      const cid = parsed.searchParams.get("chat_id");
      if (cid && effectiveChatId == null) {
        const parsedCid = Number(cid);
        if (!Number.isNaN(parsedCid)) {
          effectiveChatId = parsedCid;
        }
      }
    } catch {}
    launchUrl = null;
  }

  const currentApps = get(activeWebApps);
  const existing = currentApps.find((a) => Number(a.botId) === Number(botId));

  if (existing) {
    if (launchUrl && existing.url !== launchUrl) {
      activeWebApps.update((apps) =>
        apps.map((a) =>
          a.id === existing.id
            ? {
                ...a,
                url: launchUrl,
                startParam: effectiveStartParam ?? a.startParam,
                chatId: effectiveChatId ?? a.chatId,
                state: "sheet",
                dragOffsetY: 0,
                reloadKey: a.reloadKey + 1,
                error: null,
                loading: false,
              }
            : a
        )
      );
      return existing.id;
    }

    const needsLaunch =
      !launchUrl &&
      (!existing.url ||
        existing.error ||
        (effectiveStartParam && effectiveStartParam !== existing.startParam) ||
        (effectiveChatId && effectiveChatId !== existing.chatId));

    if (needsLaunch) {
      activeWebApps.update((apps) =>
        apps.map((a) =>
          a.id === existing.id
            ? { ...a, state: "sheet", dragOffsetY: 0, loading: true, error: null }
            : a
        )
      );
      try {
        const apiInstance = get(API);
        const launch = await apiInstance.launchWebApp(botId, {
          startParam: effectiveStartParam,
          chatId: effectiveChatId,
        });
        activeWebApps.update((apps) =>
          apps.map((a) =>
            a.id === existing.id
              ? {
                  ...a,
                  url: launch.url,
                  queryId: launch.queryId,
                  startParam: effectiveStartParam,
                  chatId: effectiveChatId,
                  state: "sheet",
                  dragOffsetY: 0,
                  reloadKey: a.reloadKey + 1,
                  loading: false,
                  error: null,
                }
              : a
          )
        );
      } catch (err) {
        activeWebApps.update((apps) =>
          apps.map((a) =>
            a.id === existing.id
              ? { ...a, loading: false, error: err?.message || "Ошибка загрузки" }
              : a
          )
        );
      }
      return existing.id;
    }

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
    url: launchUrl || null,
    queryId: null,
    startParam: effectiveStartParam,
    chatId: effectiveChatId,
    entryPoint,
    termsUrl,
    state: "sheet",
    dragOffsetY: 0,
    customBackButton: false,
    needConfirmation: false,
    loading: !launchUrl,
    error: null,
    reloadKey: 0,
  };

  activeWebApps.update((apps) => [...apps, newApp]);

  if (!launchUrl) {
    try {
      const apiInstance = get(API);
      const launch = await apiInstance.launchWebApp(botId, {
        startParam: effectiveStartParam,
        chatId: effectiveChatId,
      });
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
  const current = get(activeWebApps);
  const found = current.find((a) => a.id === id);
  if (found) {
    lastClosedMiniApp.set({ ...found, closedAt: Date.now() });
  }
  activeWebApps.update((apps) => apps.filter((a) => a.id !== id));
}

export function reloadMiniApp(id) {
  const current = get(activeWebApps);
  const found = current.find((a) => a.id === id);
  if (!found) return;

  if (!found.url || found.error) {
    activeWebApps.update((apps) =>
      apps.map((a) => (a.id === id ? { ...a, loading: true, error: null } : a))
    );
    const apiInstance = get(API);
    apiInstance
      .launchWebApp(found.botId, {
        startParam: found.startParam,
        chatId: found.chatId,
      })
      .then((launch) => {
        activeWebApps.update((apps) =>
          apps.map((a) =>
            a.id === id
              ? {
                  ...a,
                  url: launch.url,
                  queryId: launch.queryId,
                  reloadKey: a.reloadKey + 1,
                  loading: false,
                  error: null,
                }
              : a
          )
        );
      })
      .catch((err) => {
        activeWebApps.update((apps) =>
          apps.map((a) =>
            a.id === id
              ? { ...a, loading: false, error: err?.message || "Ошибка загрузки" }
              : a
          )
        );
      });
    return;
  }

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

export { resolveWebAppUrl } from "$lib/utils/maxLink.js";

