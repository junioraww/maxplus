import { invoke } from "@tauri-apps/api/core";

const RESERVED_SLUGS = new Set([
  "login",
  "ps",
  "tos",
  "privacy",
  "about",
  "help",
  "settings",
]);

const VALID_IDENTIFIER_REGEX = /^[A-Za-z0-9_]+$/;

export function extractMaxUrlInfo(rawInput) {
  if (!rawInput || typeof rawInput !== "string") return null;

  let value = rawInput.trim();
  if (!value) return null;

  if (value.startsWith("max://")) {
    const withoutScheme = value.slice(6);
    value = withoutScheme.startsWith("max.ru")
      ? `https://${withoutScheme}`
      : `https://max.ru/${withoutScheme.replace(/^\/+/, "")}`;
  } else if (!value.includes("://")) {
    if (!/^(?:www\.)?max\.ru(?:\/|$)/i.test(value)) return null;
    value = `https://${value}`;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "max.ru" && hostname !== "www.max.ru") return null;

  if (parsed.searchParams.get("externalCallback") === "1" || value.includes("externalCallback=1")) {
    return {
      isMax: true,
      kind: "external_callback",
      canonicalUrl: value,
      startPayload: null,
      startAppParam: null,
      targetName: null,
    };
  }

  const segments = parsed.pathname
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  const startParam = parsed.searchParams.get("start");
  const startPayload = startParam !== null ? startParam.trim() : null;

  const startAppParam =
    parsed.searchParams.get("startapp") ||
    parsed.searchParams.get("startApp") ||
    null;

  if (segments.length === 0) {
    return {
      isMax: true,
      kind: "root",
      canonicalUrl: "https://max.ru",
      startPayload: null,
      startAppParam: null,
      targetName: null,
    };
  }

  const firstSegment = segments[0];
  const cleanName = firstSegment.startsWith("@")
    ? firstSegment.slice(1)
    : firstSegment;

  if (cleanName.startsWith(":")) {
    return {
      isMax: true,
      kind: "route",
      targetName: cleanName,
      canonicalUrl: value,
      startPayload,
      startAppParam,
    };
  }

  if (RESERVED_SLUGS.has(cleanName.toLowerCase())) return null;
  if (!VALID_IDENTIFIER_REGEX.test(cleanName)) return null;

  const fullPath = [cleanName, ...segments.slice(1)].join("/");

  return {
    isMax: true,
    kind: startAppParam ? "app" : "entity",
    targetName: cleanName,
    canonicalUrl: `https://max.ru/${fullPath}`,
    startPayload,
    startAppParam,
  };
}

export async function processMaxLink(targetUrl, { currentUserId, api, onOpenChat, onLaunchApp } = {}) {
  const info = extractMaxUrlInfo(targetUrl);
  if (!info || !info.isMax) return false;

  let chatOpener = onOpenChat;
  if (!chatOpener) {
    try {
      const session = await import("../stores/session.js");
      chatOpener = session.openChat;
    } catch {}
  }

  let appOpener = onLaunchApp;
  if (!appOpener) {
    try {
      const webapp = await import("../stores/webapp.js");
      appOpener = webapp.openMiniApp;
    } catch {}
  }

  if (info.kind === "external_callback") {
    if (api && typeof api.processExternalCallback === "function") {
      try {
        const launch = await api.processExternalCallback(info.canonicalUrl || targetUrl);
        if (launch && typeof appOpener === "function") {
          await appOpener({
            botId: launch.botId,
            title: launch.botId === 8250447 ? "Цифровой ID" : "Мини-приложение",
            url: launch.url,
            startParam: launch.startParam,
            entryPoint: "link",
          });
          return true;
        }
      } catch (err) {
        console.error(err);
      }
    }
    return false;
  }

  if (info.kind === "app") {
    let resolved = null;
    try {
      if (api && typeof api.resolveLink === "function") {
        resolved = await api.resolveLink(info.canonicalUrl);
      } else {
        resolved = await invoke("resolve_link", { link: info.canonicalUrl });
      }
    } catch (err) {
      console.error(err);
    }

    const botId =
      resolved?.user?.contact?.id ||
      resolved?.user?.id ||
      resolved?.chat?.id ||
      null;

    if (botId && typeof appOpener === "function") {
      appOpener({
        botId,
        title: resolved?.chat?.title || resolved?.user?.contact?.names?.[0]?.name || info.targetName,
        startParam: info.startAppParam,
        entryPoint: "link",
      });
      return true;
    }
  }

  if (info.kind === "entity") {
    let resolved = null;
    try {
      if (api && typeof api.resolveLink === "function") {
        resolved = await api.resolveLink(info.canonicalUrl);
      } else {
        resolved = await invoke("resolve_link", { link: info.canonicalUrl });
      }
    } catch (err) {
      console.error(err);
    }

    let targetChatId = null;

    if (resolved?.chat?.id) {
      targetChatId = resolved.chat.id;
    } else if (resolved?.user) {
      const contactId = resolved.user.contact?.id || resolved.user.id;
      if (contactId && currentUserId) {
        targetChatId = Number(BigInt(currentUserId) ^ BigInt(contactId));
      }
    }

    if (targetChatId) {
      if (info.startPayload !== null && api && typeof api.sendBotStart === "function") {
        try {
          const res = await api.sendBotStart(targetChatId, info.startPayload);
          const msg = res?.message;
          if (msg) {
            msg.status = 1;
            try {
              const { getChat } = await import("../stores/messages.js");
              const c = getChat(targetChatId);
              if (c) {
                c.receivedMessage?.set(msg);
                c.updateMessages?.([msg]);
              }
            } catch {}
          }
        } catch (err) {
          console.error(err);
        }
      }

      if (typeof chatOpener === "function") {
        await chatOpener(targetChatId);
      }
      return true;
    }
  }

  return false;
}
