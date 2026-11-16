import { writable, get as getStoreValue, readable } from "svelte/store";
import API from "$lib/stores/api";
import { saveChats, getChat } from "$lib/stores/messages";
import { showAlert } from "$lib/utils/alert";

const data = writable({
  activeChat: null,
  openedChats: [],
  profile: null,
  avatarGallery: null,
  contactsModal: false,
  safeAvatarPicker: null,
  qrScanner: null,
  folderEdit: null,
  confirmModal: null,
  contactModal: false,
  loginModal: false,
  devSettings: false,
  devicesPage: false,
  settingsPage: null,
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

export async function openChat(chatId) {
  const currentData = getStoreValue(data) || {};
  const openedChats = Array.isArray(currentData.openedChats) ? currentData.openedChats : [];
  const profile = currentData.profile;

  if (openedChats.findIndex(id => String(id) === String(chatId)) === -1) {
    const chatEntry = getChat(chatId);
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
      profile: null,
      openedChats: [ ...openedChats, chatId ]
    }));
  } else if (profile) {
    data.update(s => ({
      ...s,
      profile: null
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

export function openSettingsPage(pageId) {
  data.update(current => {
    if (current.settingsPage === pageId) {
      return current;
    }
    return {
      ...current,
      settingsPage: pageId
    };
  });
}

export function closeSettingsPage() {
  data.update(current => ({ ...current, settingsPage: null }));
}

export function openAvatarGallery(config) {
  data.update(current => ({ ...current, avatarGallery: config }));
}

export function closeAvatarGallery() {
  data.update(current => ({ ...current, avatarGallery: null }));
}

export function openContactsModal() {
  data.update(current => ({ ...current, contactsModal: true }));
}

export function closeContactsModal() {
  data.update(current => ({ ...current, contactsModal: false }));
}

export function openSafeAvatarPicker(config = {}) {
  data.update(current => ({ ...current, safeAvatarPicker: config }));
}

export function closeSafeAvatarPicker() {
  data.update(current => ({ ...current, safeAvatarPicker: null }));
}

export function openQrScanner(config = {}) {
  data.update(current => ({ ...current, qrScanner: config }));
}

export function closeQrScanner() {
  data.update(current => ({ ...current, qrScanner: null }));
}

export function openFolderEdit(folder = { isNew: true }) {
  data.update(current => ({ ...current, folderEdit: { folder } }));
}

export function closeFolderEdit() {
  data.update(current => ({ ...current, folderEdit: null }));
}

export function openConfirmModal(config) {
  data.update(current => ({ ...current, confirmModal: config }));
}

export function closeConfirmModal() {
  data.update(current => ({ ...current, confirmModal: null }));
}

export function showConfirm(options) {
  return new Promise((resolve) => {
    openConfirmModal({
      ...options,
      onConfirm: () => {
        closeConfirmModal();
        resolve(true);
      },
      onCancel: () => {
        closeConfirmModal();
        resolve(false);
      }
    });
  });
}
