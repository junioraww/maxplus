import { writable, get as getStoreValue, readable } from "svelte/store";
import API from "$lib/stores/api";
import { saveChats, getChat } from "$lib/stores/messages";
import { showAlert } from "$lib/utils/alert";
import { openScreen, openDrawer, openSheet, openDialog, openViewer, dismissLayer } from "$lib/services/layerManager";

const data = writable({
  activeChat: null,
  openedChats: [],
  loaded: false,
});

export default data;

export function set(key, value) {
  data.update((current) => ({ ...current, [key]: value }));
}

export function get(key) {
  const current = getStoreValue(data);
  return current[key];
}

export const now = readable(Date.now(), (setVal) => {
  const interval = setInterval(() => {
    setVal(Date.now());
  }, 1000);

  return () => clearInterval(interval);
});

export async function openChat(rawChatId) {
  if (rawChatId == null) return;
  const chatId = typeof rawChatId === "object" && rawChatId !== null ? rawChatId.id : rawChatId;
  if (chatId == null) return;

  const currentData = getStoreValue(data) || {};
  const openedChats = Array.isArray(currentData.openedChats) ? currentData.openedChats : [];

  const chatEntry = getChat(chatId);
  let updatedChat = null;
  chatEntry.chatInfo.update((current) => {
    if (!current) return current;
    if (current.hasReaction || current.unreadReactions || current.lastReaction) {
      updatedChat = {
        ...current,
        hasReaction: false,
        unreadReactions: 0,
        lastReaction: null,
      };
      return updatedChat;
    }
    return current;
  });
  if (updatedChat) {
    saveChats([updatedChat]).catch(() => {});
  }

  if (openedChats.findIndex(id => String(id) === String(chatId)) === -1) {
    let chat = chatEntry.getInfo();

    if (!chat) {
      const response = await getStoreValue(API).getChat(chatId);

      if (!response || !response.chats || !response.chats.length) {
        return showAlert("Не удалось получить информацию о чате.\nВозможно, чат закрыт.");
      }

      const info = response.chats[0];
      chatEntry.chatInfo.set(info);
      await saveChats([ info ]);
    }

    data.update(s => ({
      ...s,
      openedChats: [ ...openedChats, chatId ]
    }));
  }
}

export function closeChat(chatId) {
  return data.update(session => {
    const idx = session.openedChats.findIndex(id => String(id) === String(chatId));
    if (idx !== -1) session.openedChats.splice(idx, 1);
    return session;
  });
}

export function closeAllChats() {
  data.update((current) => ({
    ...current,
    openedChats: [],
    activeChat: null,
  }));
}

const SETTINGS_LOADERS = {
  profile: () => import("../../routes/settings/profile/+page.svelte"),
  notifications: () => import("../../routes/settings/notifications/+page.svelte"),
  folders: () => import("../../routes/settings/folders/+page.svelte"),
  privacy: () => import("../../routes/settings/privacy/+page.svelte"),
  lock: () => import("../../routes/settings/lock/+page.svelte"),
  two_factor: () => import("../../routes/settings/two_factor/+page.svelte"),
  dictionary: () => import("../../routes/settings/e2e/dictionary/+page.svelte"),
  logs: () => import("../../routes/settings/logs/+page.svelte"),
  about: () => import("../../routes/settings/about/+page.svelte"),
  sessions: () => import("../../routes/settings/sessions/+page.svelte"),
  plugins: () => import("../../routes/settings/plugins/+page.svelte"),
  advanced: () => import("../../routes/settings/advanced/+page.svelte"),
  proxy: () => import("../../routes/settings/proxy/+page.svelte"),
};

let activeSettingsLayerId = null;

export async function openSettingsPage(pageId) {
  if (!SETTINGS_LOADERS[pageId]) return null;
  const mod = await SETTINGS_LOADERS[pageId]();
  const component = mod.default || mod;
  let layerId = null;
  const res = openScreen(
    component,
    {
      isTab: false,
      from: "/?card=settings",
      onClose: () => {
        if (layerId) dismissLayer(layerId);
      },
      close: () => {
        if (layerId) dismissLayer(layerId);
      }
    },
    {
      onClose: () => {
        activeSettingsLayerId = null;
      }
    }
  );
  layerId = res.id;
  activeSettingsLayerId = res.id;
  return res;
}

export function closeSettingsPage() {
  if (activeSettingsLayerId) {
    const id = activeSettingsLayerId;
    activeSettingsLayerId = null;
    dismissLayer(id);
  }
}

let activeProfileLayerId = null;

export async function openProfile(config = {}) {
  const mod = await import("$components/ProfileModal.svelte");
  if (activeProfileLayerId) {
    dismissLayer(activeProfileLayerId);
    activeProfileLayerId = null;
  }
  const res = openDrawer(mod.default || mod, config, {
    onClose: () => {
      activeProfileLayerId = null;
    }
  });
  activeProfileLayerId = res.id;
  return res;
}

export const openProfileModal = openProfile;

export function closeProfile() {
  if (activeProfileLayerId) {
    const id = activeProfileLayerId;
    activeProfileLayerId = null;
    dismissLayer(id);
  }
}

export const closeProfileModal = closeProfile;

let devSettingsLayerId = null;
export async function openDevSettings() {
  const mod = await import("$components/main/dev/Settings.svelte");
  const res = openScreen(mod.default || mod, {}, {
    transparent: true,
    noAnimation: true,
    closeDelay: 150,
    onClose: () => {
      devSettingsLayerId = null;
    }
  });
  devSettingsLayerId = res.id;
  return res;
}

export function closeDevSettings() {
  if (devSettingsLayerId) {
    const id = devSettingsLayerId;
    devSettingsLayerId = null;
    dismissLayer(id);
  }
}

let devicesLayerId = null;
export async function openDevicesSettings() {
  const mod = await import("$components/main/devices/Settings.svelte");
  const res = openScreen(mod.default || mod, {}, {
    transparent: true,
    noAnimation: true,
    closeDelay: 150,
    onClose: () => {
      devicesLayerId = null;
    }
  });
  devicesLayerId = res.id;
  return res;
}

export function closeDevicesSettings() {
  if (devicesLayerId) {
    const id = devicesLayerId;
    devicesLayerId = null;
    dismissLayer(id);
  }
}

let activeAvatarGalleryLayerId = null;

export async function openAvatarGallery(config = {}) {
  const mod = await import("$components/main/AvatarGalleryModal.svelte");
  if (activeAvatarGalleryLayerId) {
    dismissLayer(activeAvatarGalleryLayerId);
    activeAvatarGalleryLayerId = null;
  }
  const res = openViewer(mod.default || mod, config, {
    onClose: () => {
      activeAvatarGalleryLayerId = null;
    }
  });
  activeAvatarGalleryLayerId = res.id;
  return res;
}

export function closeAvatarGallery() {
  if (activeAvatarGalleryLayerId) {
    const id = activeAvatarGalleryLayerId;
    activeAvatarGalleryLayerId = null;
    dismissLayer(id);
  }
}

export async function openStartConversation() {
  const mod = await import("$components/main/StartConversationScreen.svelte");
  return openScreen(mod.default || mod);
}

let contactsLayerId = null;
export async function openContactsModal() {
  const mod = await import("$components/main/ContactsModal.svelte");
  const res = openSheet(mod.default || mod, {}, {
    dim: true,
    dimOpacity: 0.65,
    canSwipe: true,
    closeDelay: 200,
    onClose: () => {
      contactsLayerId = null;
    }
  });
  contactsLayerId = res.id;
  return res;
}

export function closeContactsModal() {
  if (contactsLayerId) {
    const id = contactsLayerId;
    contactsLayerId = null;
    dismissLayer(id);
  }
}

let contactModalLayerId = null;
export async function openContactAdd() {
  const mod = await import("$components/main/ContactAddBottomSheet.svelte");
  const res = openSheet(mod.default || mod, {}, {
    onClose: () => {
      contactModalLayerId = null;
    }
  });
  contactModalLayerId = res.id;
  return res;
}

export function closeContactAdd() {
  if (contactModalLayerId) {
    const id = contactModalLayerId;
    contactModalLayerId = null;
    dismissLayer(id);
  }
}

let safeAvatarPickerLayerId = null;
export async function openSafeAvatarPicker(config = {}) {
  const mod = await import("$components/main/SafeAvatarPickerModal.svelte");
  const res = openDialog(mod.default || mod, config, {
    dim: true,
    dimOpacity: 0.65,
    closeDelay: 200,
    onClose: () => {
      safeAvatarPickerLayerId = null;
    }
  });
  safeAvatarPickerLayerId = res.id;
  return res;
}

export function closeSafeAvatarPicker() {
  if (safeAvatarPickerLayerId) {
    const id = safeAvatarPickerLayerId;
    safeAvatarPickerLayerId = null;
    dismissLayer(id);
  }
}

let qrScannerLayerId = null;
export async function openQrScanner(config = {}) {
  const mod = await import("$components/main/QRScannerModal.svelte");
  const res = openDialog(mod.default || mod, config, {
    dim: false,
    closeDelay: 200,
    onClose: () => {
      qrScannerLayerId = null;
    }
  });
  qrScannerLayerId = res.id;
  return res;
}

export function closeQrScanner() {
  if (qrScannerLayerId) {
    const id = qrScannerLayerId;
    qrScannerLayerId = null;
    dismissLayer(id);
  }
}

export async function openFolderEdit(folder = { isNew: true }) {
  const mod = await import("$components/chats/FolderEditModal.svelte");
  return openScreen(mod.default || mod, { folder });
}

export async function openConfirmModal(config) {
  const mod = await import("$components/main/ConfirmModal.svelte");
  return openDialog(mod.default || mod, config);
}

export async function showConfirm(options) {
  const mod = await import("$components/main/ConfirmModal.svelte");
  return openDialog(mod.default || mod, options);
}
