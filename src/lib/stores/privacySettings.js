import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import API from "$lib/stores/api";
import { getCurrentAccount } from "$lib/stores/accounts";
import { showAlert } from "$lib/utils/alert";

const defaultPrivacy = {
  phoneNumberPrivacy: "ALL",
  incomingCall: "CONTACTS",
  chatsInvite: "CONTACTS",
  searchByPhone: "ALL",
  hidden: false,
  showReadMark: true,
  contentLevelAccess: false,
  unsafeFiles: true,
  audioTranscriptionEnabled: true,
  stickersSuggest: "ON",
  inactiveTtl: "6M",
};

export const privacyConfig = writable({ ...defaultPrivacy });
export const blockedContacts = writable([]);
export const privacyLoading = writable(false);

let activeAccountId = null;

export function applyPrivacyConfig(userConfig, accountId) {
  if (!userConfig || typeof userConfig !== "object") return;
  if (accountId) activeAccountId = accountId;

  privacyConfig.update(curr => ({
    ...curr,
    phoneNumberPrivacy: userConfig.PHONE_NUMBER_PRIVACY ?? curr.phoneNumberPrivacy,
    incomingCall: userConfig.INCOMING_CALL ?? curr.incomingCall,
    chatsInvite: userConfig.CHATS_INVITE ?? curr.chatsInvite,
    searchByPhone: userConfig.SEARCH_BY_PHONE ?? curr.searchByPhone,
    hidden: userConfig.HIDDEN !== undefined ? Boolean(userConfig.HIDDEN) : curr.hidden,
    showReadMark: userConfig.SHOW_READ_MARK !== undefined ? Boolean(userConfig.SHOW_READ_MARK) : curr.showReadMark,
    contentLevelAccess: userConfig.CONTENT_LEVEL_ACCESS !== undefined ? Boolean(userConfig.CONTENT_LEVEL_ACCESS) : curr.contentLevelAccess,
    unsafeFiles: userConfig.UNSAFE_FILES !== undefined ? Boolean(userConfig.UNSAFE_FILES) : curr.unsafeFiles,
    audioTranscriptionEnabled: userConfig.AUDIO_TRANSCRIPTION_ENABLED !== undefined ? Boolean(userConfig.AUDIO_TRANSCRIPTION_ENABLED) : curr.audioTranscriptionEnabled,
    stickersSuggest: userConfig.STICKERS_SUGGEST ?? curr.stickersSuggest,
    inactiveTtl: userConfig.INACTIVE_TTL ?? curr.inactiveTtl,
  }));
}

export async function loadPrivacySettings(accountId = null) {
  try {
    let targetId = accountId || activeAccountId;
    if (!targetId) {
      const acc = await getCurrentAccount().catch(() => null);
      if (acc?.id) targetId = acc.id;
    }
    if (!targetId) return;
    activeAccountId = targetId;

    const saved = await invoke("get_user_settings", { accountId: Number(targetId) }).catch(() => null);
    if (saved && typeof saved === "object") {
      applyPrivacyConfig(saved, targetId);
    }
  } catch (e) {
    console.error("Failed to load local privacy settings:", e);
  }
}

export async function updatePrivacySetting(key, value) {
  const previous = { ...get(privacyConfig) };

  privacyConfig.update(c => {
    switch (key) {
      case "PHONE_NUMBER_PRIVACY": return { ...c, phoneNumberPrivacy: value };
      case "INCOMING_CALL": return { ...c, incomingCall: value };
      case "CHATS_INVITE": return { ...c, chatsInvite: value };
      case "SEARCH_BY_PHONE": return { ...c, searchByPhone: value };
      case "HIDDEN": return { ...c, hidden: Boolean(value) };
      case "SHOW_READ_MARK": return { ...c, showReadMark: Boolean(value) };
      case "CONTENT_LEVEL_ACCESS": return { ...c, contentLevelAccess: Boolean(value) };
      case "UNSAFE_FILES": return { ...c, unsafeFiles: Boolean(value) };
      case "AUDIO_TRANSCRIPTION_ENABLED": return { ...c, audioTranscriptionEnabled: Boolean(value) };
      case "STICKERS_SUGGEST": return { ...c, stickersSuggest: value };
      case "INACTIVE_TTL": return { ...c, inactiveTtl: value };
      default: return c;
    }
  });

  try {
    const apiInstance = get(API);
    if (!apiInstance?.updateUserSettings) {
      throw new Error("API не инициализирован");
    }
    await apiInstance.updateUserSettings({ [key]: value });
  } catch (err) {
    privacyConfig.set(previous);
    showAlert("Не удалось сохранить настройку", err?.message || String(err));
    throw err;
  }
}

export async function fetchBlockedContacts() {
  privacyLoading.set(true);
  try {
    const res = await invoke("get_blacklist", { from: 0, count: 100 });
    const list = res?.contacts || res?.payload?.contacts || (Array.isArray(res) ? res : []);
    blockedContacts.set(list);
    return list;
  } catch (e) {
    console.error("Failed to fetch blocked contacts:", e);
    showAlert("Ошибка загрузки чёрного списка", e?.message || String(e));
    return [];
  } finally {
    privacyLoading.set(false);
  }
}

export async function toggleBlockContact(contactId, block) {
  try {
    if (block) {
      await invoke("add_to_blacklist", {
        contactId: Number(contactId),
      });
      await fetchBlockedContacts();
    } else {
      await invoke("remove_from_blacklist", {
        contactId: Number(contactId),
      });
      blockedContacts.update(list => list.filter(c => String(c.id || c.contactId) !== String(contactId)));
    }
  } catch (e) {
    showAlert(block ? "Не удалось заблокировать" : "Не удалось разблокировать", e?.message || String(e));
    throw e;
  }
}
