import { invoke } from "@tauri-apps/api/core";
import {
  registerForPushNotifications,
  isPermissionGranted,
  requestPermission,
  sendNotification as pluginSendNotification,
  createChannel,
  channels,
  Importance,
  Visibility
} from '@choochmeque/tauri-plugin-notifications-api';
import { type } from '@tauri-apps/plugin-os';
import { writable, get } from "svelte/store";

import {
  getLocalFilePath,
  getFallbackAvatarLocalPath
} from "$lib/utils/images";
import Session from "$lib/stores/session";
import API, { currentSessionChats, currentUser } from "$lib/stores/api";
import { getCurrentAccount } from "$lib/stores/accounts";
import { getContactDirect } from "$lib/stores/contacts";
import { getMessagePreview } from "$lib/utils/text";

export const MESSAGES_CHANNEL_ID = 'MESSAGES_CHANNEL_ID';

export async function clearChatNotification(chatId) {
  if (!currentOs) currentOs = type();
  if (currentOs === 'android') {
    try {
      await invoke("cancel_notification", { chatId: Number(chatId) });
    } catch (e) {}
  }
}

const NOTIFICATIONS_KEY = 'client_notifications_enabled';
const PREVIEW_KEY = 'client_preview_enabled';
const SOUND_KEY = 'client_sound_enabled';
const CALLS_KEY = 'client_calls_enabled';
const NEW_CONTACTS_KEY = 'client_new_contacts_enabled';

let _activeAccountId = null;

function storageKey(key, accountId) {
  const id = accountId ?? _activeAccountId;
  return id ? `maxplus_${id}_${key}` : `maxplus_${key}`;
}

function lsGet(key, accountId) {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(storageKey(key, accountId));
}

function lsSet(key, value, accountId) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey(key, accountId), value);
}

const initialEnabled = lsGet(NOTIFICATIONS_KEY) !== 'false';
const initialPreview = lsGet(PREVIEW_KEY) !== 'false';
const initialSound = lsGet(SOUND_KEY) !== 'false';
const initialCalls = lsGet(CALLS_KEY) !== 'false';
const initialNewContacts = lsGet(NEW_CONTACTS_KEY) === 'true';

export const clientNotificationsEnabled = writable(initialEnabled);
export const messagePreviewEnabled = writable(initialPreview);
export const notificationSoundEnabled = writable(initialSound);
export const callNotificationsEnabled = writable(initialCalls);
export const newContactsNotificationsEnabled = writable(initialNewContacts);

export function isClientNotificationsEnabled() {
  return get(clientNotificationsEnabled);
}

export function setClientNotificationsEnabled(enabled) {
  clientNotificationsEnabled.set(enabled);
  lsSet(NOTIFICATIONS_KEY, enabled ? 'true' : 'false');
}

export function toggleClientNotifications() {
  const current = isClientNotificationsEnabled();
  setAllNotificationsServer(!current);
  return !current;
}

export function applyUserConfig(userConfig, accountId) {
  if (!userConfig || typeof userConfig !== 'object') return;
  if (accountId) _activeAccountId = accountId;

  if (userConfig.CHATS_PUSH_NOTIFICATION !== undefined) {
    const on = userConfig.CHATS_PUSH_NOTIFICATION === 'ON';
    clientNotificationsEnabled.set(on);
    lsSet(NOTIFICATIONS_KEY, on ? 'true' : 'false', accountId);
  }
  if (userConfig.PUSH_DETAILS !== undefined) {
    const preview = Boolean(userConfig.PUSH_DETAILS);
    messagePreviewEnabled.set(preview);
    lsSet(PREVIEW_KEY, preview ? 'true' : 'false', accountId);
  }
  if (userConfig.PUSH_SOUND !== undefined || userConfig.CHATS_PUSH_SOUND !== undefined) {
    const snd = Boolean(userConfig.PUSH_SOUND || userConfig.CHATS_PUSH_SOUND);
    notificationSoundEnabled.set(snd);
    lsSet(SOUND_KEY, snd ? 'true' : 'false', accountId);
  }
  if (userConfig.M_CALL_PUSH_NOTIFICATION !== undefined) {
    const calls = userConfig.M_CALL_PUSH_NOTIFICATION === 'ON';
    callNotificationsEnabled.set(calls);
    lsSet(CALLS_KEY, calls ? 'true' : 'false', accountId);
  }
  if (userConfig.PUSH_NEW_CONTACTS !== undefined) {
    const nc = Boolean(userConfig.PUSH_NEW_CONTACTS);
    newContactsNotificationsEnabled.set(nc);
    lsSet(NEW_CONTACTS_KEY, nc ? 'true' : 'false', accountId);
  }
}

async function ensureActiveAccountId() {
  if (!_activeAccountId) {
    try {
      const acc = await getCurrentAccount();
      if (acc?.id) _activeAccountId = acc.id;
    } catch (_) {}
  }
  return _activeAccountId;
}

export function loadAccountNotificationSettings(accountId) {
  _activeAccountId = accountId;
  clientNotificationsEnabled.set(lsGet(NOTIFICATIONS_KEY, accountId) !== 'false');
  messagePreviewEnabled.set(lsGet(PREVIEW_KEY, accountId) !== 'false');
  notificationSoundEnabled.set(lsGet(SOUND_KEY, accountId) !== 'false');
  callNotificationsEnabled.set(lsGet(CALLS_KEY, accountId) !== 'false');
  newContactsNotificationsEnabled.set(lsGet(NEW_CONTACTS_KEY, accountId) === 'true');
}

export async function setAllNotificationsServer(enabled) {
  await ensureActiveAccountId();
  setClientNotificationsEnabled(enabled);
  try {
    await get(API).updateUserSettings({
      CHATS_PUSH_NOTIFICATION: enabled ? 'ON' : 'OFF',
    });
  } catch (e) {
    console.error(e);
  }
}

export async function setMessagePreviewServer(enabled) {
  await ensureActiveAccountId();
  messagePreviewEnabled.set(enabled);
  lsSet(PREVIEW_KEY, enabled ? 'true' : 'false');
  try {
    await get(API).updateUserSettings({
      PUSH_DETAILS: enabled,
    });
  } catch (e) {
    console.error(e);
  }
}

export async function setNotificationSoundServer(enabled) {
  await ensureActiveAccountId();
  notificationSoundEnabled.set(enabled);
  lsSet(SOUND_KEY, enabled ? 'true' : 'false');
  const sound = enabled ? 'oki.aiff' : '';
  try {
    await get(API).updateUserSettings({
      PUSH_SOUND: sound,
      CHATS_PUSH_SOUND: sound,
    });
  } catch (e) {
    console.error(e);
  }
}

export async function setCallNotificationsServer(enabled) {
  await ensureActiveAccountId();
  callNotificationsEnabled.set(enabled);
  lsSet(CALLS_KEY, enabled ? 'true' : 'false');
  try {
    await get(API).updateUserSettings({
      M_CALL_PUSH_NOTIFICATION: enabled ? 'ON' : 'OFF',
    });
  } catch (e) {
    console.error(e);
  }
}

export async function setNewContactsServer(enabled) {
  await ensureActiveAccountId();
  newContactsNotificationsEnabled.set(enabled);
  lsSet(NEW_CONTACTS_KEY, enabled ? 'true' : 'false');
  try {
    await get(API).updateUserSettings({
      PUSH_NEW_CONTACTS: enabled,
    });
  } catch (e) {
    console.error(e);
  }
}

export function isChatMuted(chat) {
  if (!chat) return false;
  let chatObj = typeof chat === "object" && chat !== null && typeof chat.getInfo === "function" ? chat.getInfo() : chat;
  const id = typeof chat === "number" || typeof chat === "string" ? Number(chat) : Number(chatObj?.id);
  if (!isNaN(id)) {
    const found = get(currentSessionChats)?.find(c => String(c.id) === String(id));
    if (found) chatObj = found;
  }
  if (!chatObj) return false;
  const ddu = chatObj.dontDisturbUntil;
  if (ddu === undefined || ddu === null || ddu === 0) return false;
  if (ddu === -1) return true;
  return Number(ddu) > Date.now();
}

let granted = false;
let currentOs = null;

export async function suggestNotifications() {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }

  granted = permissionGranted;
  return granted;
}

async function ensureMessagesChannel() {
  if (currentOs !== 'android') return;

  try {
    const channelList = await channels();
    if (!channelList.some(c => c.id === MESSAGES_CHANNEL_ID)) {
      await createChannel({
        id: MESSAGES_CHANNEL_ID,
        name: "Сообщения",
        description: "Входящие сообщения чатов",
        importance: Importance.High,
        visibility: Visibility.Private,
        vibration: true
      });
    }
  } catch (e) {
    console.error("Push error:", e);
  }
}

export async function setupPushNotifications() {
  if (!isClientNotificationsEnabled()) return;
  if (!currentOs) currentOs = type();

  if (!granted) await suggestNotifications();
  if (!granted) return;

  if (currentOs === 'android') {
    await ensureMessagesChannel();

    try {
      const fcmToken = await registerForPushNotifications();

      if (fcmToken) {
        await get(API).call(22, {
          pushToken: fcmToken,
          pushOptions: 0
        });
      }
    } catch (error) {
      console.error("Push error:", error);
    }
  }
}

export async function newMessage(chatId, chat, contact, message) {
  if (!isClientNotificationsEnabled()) return;
  const resolvedChat = typeof chat?.getInfo === "function" ? chat.getInfo() : chat;
  if (isChatMuted(resolvedChat || chatId)) return;
  if (get(Session).openedChats?.some(idx => String(idx) === String(chatId))) return;

  const chatInfo = resolvedChat || {};
  let contactObj = contact;
  if (contactObj && typeof contactObj.subscribe === "function") {
    contactObj = get(contactObj);
  }

  const myId = Number(get(currentUser));
  let peerId = null;
  if (chatInfo.type === "DIALOG") {
    if (chatInfo.participants && Object.keys(chatInfo.participants).length > 0) {
      const other = Object.keys(chatInfo.participants).find(id => String(id) !== String(myId));
      if (other) peerId = Number(other);
    }
    if (!peerId && myId && chatId) {
      try {
        peerId = Number(BigInt(chatId) ^ BigInt(myId));
      } catch (_) {}
    }
  }

  if (!contactObj && (peerId || message?.sender)) {
    try {
      contactObj = await getContactDirect(peerId || message.sender);
    } catch (_) {}
  }

  const senderContactName = contactObj?.names?.[0]?.name;
  let title = chatInfo.title || senderContactName || "Новое сообщение";
  let senderName = senderContactName || title;

  if (chatInfo.type === "DIALOG") {
    title = senderContactName || chatInfo.title || "Новое сообщение";
    senderName = title;
  }

  const previewAllowed = get(messagePreviewEnabled);
  const rawBody = typeof message === "string" ? message : (getMessagePreview(message) || message?.text || "Новое сообщение");
  const bodyText = previewAllowed ? rawBody : "Новое сообщение";

  if (!currentOs) currentOs = type();

  if (currentOs === "android") {
    try {
      const senderId = message?.sender ? String(message.sender) : (peerId ? String(peerId) : (contactObj?.id ? String(contactObj.id) : ""));
      let account = 0;
      try {
        const acc = await getCurrentAccount();
        if (acc?.id) account = Number(acc.id);
      } catch (_) {}
      const isGroup = chatInfo.type ? chatInfo.type !== "DIALOG" : (Number(chatId) < 0);
      await invoke("show_notification", {
        chatId: Number(chatId),
        title,
        text: bodyText,
        senderId,
        account,
        senderName,
        isGroup
      });
      return;
    } catch (e) {
      console.error(e);
    }
  }

  let avatarLocalPath = null;
  const avatarUrl = chatInfo.baseUrl || chatInfo.baseIconUrl || chatInfo.avatar || contact?.avatar;
  if (avatarUrl) {
    avatarLocalPath = await getLocalFilePath(avatarUrl);
  } else {
    avatarLocalPath = await getFallbackAvatarLocalPath(
      chatInfo.id || contact?.id || chatId,
      title
    );
  }

  const notificationId = Number(BigInt(chatId) & 0x7fffffffn);

  const entry = {
    id: notificationId,
    title: title,
    body: bodyText,
    icon: avatarLocalPath,
    largeIcon: avatarLocalPath,
  };

  await sendNotification(entry);
}

export async function sendNotification(data) {
  if (!isClientNotificationsEnabled()) return;
  if (!granted) {
    await suggestNotifications();
  }
  if (!granted) return;
  try {
    await pluginSendNotification(data);
  } catch (e) {
    console.error("Failed to display notification:", e);
  }
}
