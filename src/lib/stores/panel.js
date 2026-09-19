import { writable } from "svelte/store";

export const CATALOG = {
  digital_id: {
    id: "digital_id",
    name: "Цифровой ID",
    icon: "digital_id",
    required: false,
  },
  calls: {
    id: "calls",
    name: "Звонки",
    icon: "calls",
    required: false,
  },
  chats: {
    id: "chats",
    name: "Чаты",
    icon: "chats",
    required: false,
  },
  settings: {
    id: "settings",
    name: "Настройки",
    icon: "settings",
    required: true,
  },
  contacts: {
    id: "contacts",
    name: "Контакты",
    icon: "contacts",
    required: false,
  },
  sferum: {
    id: "sferum",
    name: "Сферум",
    icon: "book",
    required: false,
  },
  logs: {
    id: "logs",
    name: "Сетевые логи",
    icon: "logs",
    required: false,
  },
  notifications: {
    id: "notifications",
    name: "Уведомления",
    icon: "bell",
    required: false,
  },
};

const DEFAULT_ITEMS = ["digital_id", "calls", "chats", "settings"];
const DEFAULT_MAIN = "chats";
const STORAGE_KEY = "max_panel_config";

function loadInitialConfig() {
  if (typeof localStorage === "undefined") {
    return { items: DEFAULT_ITEMS, defaultItem: DEFAULT_MAIN };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: DEFAULT_ITEMS, defaultItem: DEFAULT_MAIN };
    const parsed = JSON.parse(raw);
    let items = Array.isArray(parsed.items)
      ? parsed.items.filter((id) => CATALOG[id])
      : DEFAULT_ITEMS;
    if (!items.includes("settings")) {
      items.push("settings");
    }
    if (items.length === 0) {
      items = DEFAULT_ITEMS;
    }
    let defaultItem = parsed.defaultItem;
    if (!defaultItem || !items.includes(defaultItem)) {
      defaultItem = items.includes("chats") ? "chats" : items[0];
    }
    return { items, defaultItem };
  } catch {
    return { items: DEFAULT_ITEMS, defaultItem: DEFAULT_MAIN };
  }
}

function createPanelStore() {
  const { subscribe, set, update } = writable(loadInitialConfig());

  function save(state) {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {}
    }
  }

  return {
    subscribe,
    set: (val) => {
      save(val);
      set(val);
    },
    reorder: (newItems) => {
      update((state) => {
        const next = { ...state, items: newItems };
        save(next);
        return next;
      });
    },
    addItem: (id) => {
      if (!CATALOG[id]) return;
      update((state) => {
        if (state.items.includes(id)) return state;
        const next = { ...state, items: [...state.items, id] };
        save(next);
        return next;
      });
    },
    removeItem: (id) => {
      if (id === "settings") return;
      update((state) => {
        if (!state.items.includes(id) || state.items.length <= 1) return state;
        const nextItems = state.items.filter((x) => x !== id);
        let nextDefault = state.defaultItem;
        if (nextDefault === id) {
          nextDefault = nextItems.includes("chats") ? "chats" : nextItems[0];
        }
        const next = { items: nextItems, defaultItem: nextDefault };
        save(next);
        return next;
      });
    },
    setDefaultItem: (id) => {
      update((state) => {
        if (!state.items.includes(id)) return state;
        const next = { ...state, defaultItem: id };
        save(next);
        return next;
      });
    },
    reset: () => {
      const def = { items: DEFAULT_ITEMS, defaultItem: DEFAULT_MAIN };
      save(def);
      set(def);
    },
  };
}

export const panelConfig = createPanelStore();
