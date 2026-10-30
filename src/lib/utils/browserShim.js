const globalScope = typeof window !== "undefined" ? window : globalThis;
if (typeof window === "undefined") {
  globalScope.window = globalScope;
}

const memoryStore = new Map();

if (typeof globalScope.localStorage === "undefined") {
  globalScope.localStorage = {
    getItem: (key) => memoryStore.get(key) ?? null,
    setItem: (key, val) => memoryStore.set(key, String(val)),
    removeItem: (key) => memoryStore.delete(key),
    clear: () => memoryStore.clear(),
  };
}

function getStoreItem(key, fallback = null) {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }
    return memoryStore.has(key) ? memoryStore.get(key) : fallback;
  } catch {
    return fallback;
  }
}

function setStoreItem(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(value));
    } else {
      memoryStore.set(key, value);
    }
  } catch {}
}

const DEFAULT_ACCOUNT = {
  id: 10001,
  phone: "+79991234567",
  device: "browser",
  contact: {
    id: 10001,
    names: [{ name: "Synthetic User", firstName: "Synthetic", lastName: "User" }],
    avatar: null,
  },
};

const DEFAULT_CHATS = [
  {
    id: 50001,
    type: "DIALOG",
    title: "Synthetic Dialog",
    participants: { 10001: 1700000000000, 20002: 1700000005000 },
    otherReadTime: 1700000005000,
    newMessages: 0,
    lastMessage: {
      id: 90050,
      chatId: 50001,
      sender: 20002,
      text: "Synthetic test message 50",
      time: 1700000050000,
      status: 1,
    },
  },
  {
    id: 50002,
    type: "CHAT",
    title: "Synthetic Group Chat",
    participants: { 10001: 1700000000000, 20002: 1700000002000 },
    otherReadTime: 1700000002000,
    newMessages: 2,
    lastMessage: {
      id: 90080,
      chatId: 50002,
      sender: 20002,
      text: "Group message update",
      time: 1700000080000,
      status: 1,
    },
  },
];

export function isTauri() {
  return typeof globalScope.window !== "undefined" && Boolean(globalScope.window.__TAURI_INTERNALS__ && !globalScope.window.__TAURI_INTERNALS__.isMock);
}

export function isBrowserMode() {
  return !isTauri();
}

export function initBrowserShim() {
  if (globalScope.window.__TAURI_INTERNALS__ && !globalScope.window.__TAURI_INTERNALS__.isMock) {
    return;
  }

  const callbacks = new Map();
  const eventListeners = new Map();
  let nextCallbackId = 1;

  function transformCallback(callback, once = false) {
    const id = nextCallbackId++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      if (typeof callback === "function") callback(data);
    });
    return id;
  }

  function unregisterCallback(id) {
    callbacks.delete(id);
  }

  function runCallback(id, data) {
    const cb = callbacks.get(id);
    if (cb) cb(data);
  }

  function handleEventPlugin(cmd, args = {}) {
    if (cmd === "plugin:event|listen") {
      const { event, handler } = args;
      if (!eventListeners.has(event)) eventListeners.set(event, []);
      eventListeners.get(event).push(handler);
      return handler;
    }
    if (cmd === "plugin:event|emit" || cmd === "plugin:event|emit_to") {
      const { event, payload } = args;
      const list = eventListeners.get(event) || [];
      for (const hId of list) {
        runCallback(hId, { event, payload, id: hId });
      }
      return null;
    }
    if (cmd === "plugin:event|unlisten") {
      const { event, eventId } = args;
      const list = eventListeners.get(event);
      if (list) {
        const idx = list.indexOf(eventId);
        if (idx !== -1) list.splice(idx, 1);
      }
      return null;
    }
    return null;
  }

  async function invoke(cmd, args = {}) {
    if (cmd.startsWith("plugin:event|")) {
      return handleEventPlugin(cmd, args);
    }

    if (cmd.startsWith("plugin:os|")) {
      const sub = cmd.split("|")[1];
      if (sub === "type" || sub === "platform") return "web";
      if (sub === "version") return "1.0.0";
      if (sub === "family") return "unix";
      if (sub === "arch") return "wasm";
      if (sub === "locale") return "ru-RU";
      return "web";
    }

    if (cmd.startsWith("plugin:opener|")) {
      if (args.url && typeof globalScope.window.open === "function") {
        globalScope.window.open(args.url, "_blank");
      }
      return null;
    }

    if (cmd.startsWith("plugin:dialog|")) {
      return null;
    }

    if (cmd.startsWith("plugin:safe-area-insets-css|")) {
      return 0;
    }

    switch (cmd) {
      case "accounts_get": {
        const accs = getStoreItem("accounts", [DEFAULT_ACCOUNT]);
        return accs;
      }
      case "accounts_init":
        return true;
      case "current_get": {
        const current = getStoreItem("current_account_id", DEFAULT_ACCOUNT.id);
        return current;
      }
      case "current_set": {
        setStoreItem("current_account_id", args.id);
        return true;
      }
      case "current_account_meta": {
        const accs = getStoreItem("accounts", [DEFAULT_ACCOUNT]);
        const curId = getStoreItem("current_account_id", DEFAULT_ACCOUNT.id);
        return accs.find((a) => a.id === curId) || accs[0] || DEFAULT_ACCOUNT;
      }
      case "account_get": {
        const accs = getStoreItem("accounts", [DEFAULT_ACCOUNT]);
        return accs.find((a) => a.id === args.id) || DEFAULT_ACCOUNT;
      }
      case "account_contact": {
        if (args.data) {
          const accs = getStoreItem("accounts", [DEFAULT_ACCOUNT]);
          const found = accs.find((a) => a.id === args.id);
          if (found) {
            found.contact = args.data;
            setStoreItem("accounts", accs);
          }
          return args.data;
        }
        const acc = getStoreItem("accounts", [DEFAULT_ACCOUNT]).find((a) => a.id === args.id);
        return acc?.contact || DEFAULT_ACCOUNT.contact;
      }
      case "account_delete": {
        const accs = getStoreItem("accounts", [DEFAULT_ACCOUNT]).filter((a) => a.id !== args.id);
        setStoreItem("accounts", accs);
        return true;
      }
      case "common_store_load": {
        return getStoreItem("store_" + args.store, null);
      }
      case "common_store_save": {
        setStoreItem("store_" + args.store, args.data);
        return true;
      }
      case "data_save": {
        setStoreItem("data_" + args.id + "_" + args.file, args.value);
        return true;
      }
      case "data_load": {
        return getStoreItem("data_" + args.id + "_" + args.file, null);
      }
      case "load_chats": {
        return getStoreItem("chats_" + args.account, DEFAULT_CHATS);
      }
      case "save_chats": {
        setStoreItem("chats_" + args.account, args.chats);
        return true;
      }
      case "get_chat_settings": {
        return getStoreItem("chat_settings_" + args.chatId, {});
      }
      case "set_chat_settings": {
        setStoreItem("chat_settings_" + args.chatId, args.data);
        return true;
      }
      case "load_messages": {
        const all = getStoreItem("messages_" + args.chatId, []);
        const targetTime = args.time || Date.now();
        const limit = args.amount || 40;
        return all.filter((m) => m.time <= targetTime).slice(-limit);
      }
      case "update_messages": {
        const existing = getStoreItem("messages_" + args.chatId, []);
        const map = new Map(existing.map((m) => [String(m.id), m]));
        for (const m of args.messages || []) {
          map.set(String(m.id), m);
        }
        const sorted = [...map.values()].sort((a, b) => a.time - b.time);
        setStoreItem("messages_" + args.chatId, sorted);
        return true;
      }
      case "proxy_config_get":
      case "get_proxy_config":
        return { enabled: false, host: "", port: 0 };
      case "check_pending_open_chat":
      case "check_pending_call_action":
      case "plugin:deep-link|get_current":
        return null;
      case "get_database_files_count":
        return 0;
      case "batch_decrypt_messages":
        return {};
      default:
        return null;
    }
  }

  function convertFileSrc(filePath) {
    return filePath || "";
  }

  globalScope.window.__TAURI_OS_PLUGIN_INTERNALS__ = {
    os_type: "web",
    platform: "web",
    version: "1.0.0",
    family: "unix",
    arch: "wasm",
    exe_extension: "",
    locale: "ru-RU",
    eol: "\n",
  };

  globalScope.window.__TAURI_INTERNALS__ = {
    isMock: true,
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    plugins: {
      path: { sep: "/", delimiter: ":" },
    },
  };

  globalScope.window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) {
      const list = eventListeners.get(event);
      if (list) {
        const idx = list.indexOf(id);
        if (idx !== -1) list.splice(idx, 1);
      }
      callbacks.delete(id);
    },
  };
}

initBrowserShim();
