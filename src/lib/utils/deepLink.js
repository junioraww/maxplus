import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import { goto } from "$app/navigation";
import { processMaxLink } from "$lib/utils/maxLink.js";
import Session, { openChat } from "$lib/stores/session.js";
import API, { currentUser } from "$lib/stores/api.js";
import { openMiniApp } from "$lib/stores/webapp.js";

let pendingUrls = [];
let sessionUnsub = null;

function normalizeUrl(raw) {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw.href) return raw.href;
  return String(raw);
}

export async function handleDeepLinkUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return false;

  const session = get(Session);
  const userId = get(currentUser);
  const api = get(API);

  if (!session?.loaded || !userId) {
    if (!pendingUrls.includes(url)) {
      pendingUrls.push(url);
    }
    if (!sessionUnsub) {
      sessionUnsub = Session.subscribe((s) => {
        const uId = get(currentUser);
        if (s?.loaded && uId && pendingUrls.length > 0) {
          const queue = [...pendingUrls];
          pendingUrls = [];
          if (sessionUnsub) {
            sessionUnsub();
            sessionUnsub = null;
          }
          for (const queued of queue) {
            handleDeepLinkUrl(queued);
          }
        }
      });
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
