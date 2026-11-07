import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import { goto } from "$app/navigation";
import { processMaxLink } from "$lib/utils/maxLink";
import Session, { openChat } from "$lib/stores/session";
import API, { currentUser } from "$lib/stores/api";
import { openMiniApp } from "$lib/stores/webapp";
import { lockScreenState } from "$lib/stores/lockScreen";

let pendingUrls = [];
let queueWatcherInitialized = false;

function normalizeUrl(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw.href) return raw.href;
  return String(raw);
}

function tryFlushPending() {
  const session = get(Session);
  const userId = get(currentUser);
  const isLocked = Boolean(get(lockScreenState));

  if (!session?.loaded || !userId || isLocked) {
    return;
  }

  if (pendingUrls.length === 0) {
    return;
  }

  const queue = [...pendingUrls];
  pendingUrls = [];
  for (const item of queue) {
    handleDeepLinkUrl(item);
  }
}

function ensureQueueWatchers() {
  if (queueWatcherInitialized) return;
  queueWatcherInitialized = true;

  Session.subscribe(() => {
    tryFlushPending();
  });

  lockScreenState.subscribe(() => {
    tryFlushPending();
  });
}

export async function handleDeepLinkUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return false;

  ensureQueueWatchers();

  const session = get(Session);
  const userId = get(currentUser);
  const isLocked = Boolean(get(lockScreenState));
  const api = get(API);

  if (!session?.loaded || !userId || isLocked) {
    if (!pendingUrls.includes(url)) {
      pendingUrls.push(url);
    }
    return false;
  }

  return await processMaxLink(url, {
    currentUserId: userId,
    api,
    onOpenChat: async (chatId) => {
      await openChat(chatId);
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        goto("/");
      }
    },
    onLaunchApp: (appData) => {
      openMiniApp(appData);
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        goto("/");
      }
    },
  });
}

export async function initDeepLink() {
  let unlisten = null;

  try {
    unlisten = await listen("deep-link://new-url", (event) => {
      const payload = event.payload;
      if (Array.isArray(payload)) {
        for (const item of payload) {
          if (item) handleDeepLinkUrl(item);
        }
      } else if (payload) {
        handleDeepLinkUrl(payload);
      }
    });
  } catch (e) {
    console.error(e);
  }

  try {
    const initial = await invoke("plugin:deep-link|get_current");
    if (Array.isArray(initial)) {
      for (const item of initial) {
        if (item) handleDeepLinkUrl(item);
      }
    } else if (initial) {
      handleDeepLinkUrl(initial);
    }
  } catch (e) {
    console.error(e);
  }

  return () => {
    if (unlisten) unlisten();
    if (sessionUnsub) {
      sessionUnsub();
      sessionUnsub = null;
    }
  };
}
