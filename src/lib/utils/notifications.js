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

const NOTIFICATIONS_STORAGE_KEY = 'maxplus_client_notifications_enabled';
const PREVIEW_STORAGE_KEY = 'maxplus_client_preview_enabled';
const SOUND_STORAGE_KEY = 'maxplus_client_sound_enabled';
const CALLS_STORAGE_KEY = 'maxplus_client_calls_enabled';
const NEW_CONTACTS_STORAGE_KEY = 'maxplus_client_new_contacts_enabled';

const initialEnabled = typeof localStorage !== 'undefined'
  ? localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) !== 'false'
  : true;

const initialPreview = typeof localStorage !== 'undefined'
  ? localStorage.getItem(PREVIEW_STORAGE_KEY) !== 'false'
  : true;

const initialSound = typeof localStorage !== 'undefined'
  ? localStorage.getItem(SOUND_STORAGE_KEY) !== 'false'
  : true;

const initialCalls = typeof localStorage !== 'undefined'
  ? localStorage.getItem(CALLS_STORAGE_KEY) !== 'false'
  : true;

const initialNewContacts = typeof localStorage !== 'undefined'
  ? localStorage.getItem(NEW_CONTACTS_STORAGE_KEY) === 'true'
  : false;

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
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, enabled ? 'true' : 'false');
  }
}

export function toggleClientNotifications() {
  const current = isClientNotificationsEnabled();
  setAllNotificationsServer(!current);
  return !current;
}

export function applyUserConfig(userConfig) {
  if (!userConfig || typeof userConfig !== 'object') return;

  if (userConfig.CHATS_PUSH_NOTIFICATION !== undefined) {
    const on = userConfig.CHATS_PUSH_NOTIFICATION === 'ON';
    clientNotificationsEnabled.set(on);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, on ? 'true' : 'false');
    }
  }
  if (userConfig.PUSH_DETAILS !== undefined) {
    const preview = Boolean(userConfig.PUSH_DETAILS);
    messagePreviewEnabled.set(preview);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PREVIEW_STORAGE_KEY, preview ? 'true' : 'false');
    }
  }
  if (userConfig.PUSH_SOUND !== undefined || userConfig.CHATS_PUSH_SOUND !== undefined) {
    const snd = Boolean(userConfig.PUSH_SOUND || userConfig.CHATS_PUSH_SOUND);
    notificationSoundEnabled.set(snd);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SOUND_STORAGE_KEY, snd ? 'true' : 'false');
    }
  }
  if (userConfig.M_CALL_PUSH_NOTIFICATION !== undefined) {
    const calls = userConfig.M_CALL_PUSH_NOTIFICATION === 'ON';
    callNotificationsEnabled.set(calls);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CALLS_STORAGE_KEY, calls ? 'true' : 'false');
    }
  }
  if (userConfig.PUSH_NEW_CONTACTS !== undefined) {
    const nc = Boolean(userConfig.PUSH_NEW_CONTACTS);
    newContactsNotificationsEnabled.set(nc);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NEW_CONTACTS_STORAGE_KEY, nc ? 'true' : 'false');
    }
  }
}

export async function setAllNotificationsServer(enabled) {
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
  messagePreviewEnabled.set(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PREVIEW_STORAGE_KEY, enabled ? 'true' : 'false');
  }
  try {
    await get(API).updateUserSettings({
      PUSH_DETAILS: enabled,
    });
  } catch (e) {
    console.error(e);
  }
}

export async function setNotificationSoundServer(enabled) {
  notificationSoundEnabled.set(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
  }
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
  callNotificationsEnabled.set(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CALLS_STORAGE_KEY, enabled ? 'true' : 'false');
  }
  try {
    await get(API).updateUserSettings({
      M_CALL_PUSH_NOTIFICATION: enabled ? 'ON' : 'OFF',
    });
  } catch (e) {
    console.error(e);
  }
}

export async function setNewContactsServer(enabled) {
  newContactsNotificationsEnabled.set(enabled);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(NEW_CONTACTS_STORAGE_KEY, enabled ? 'true' : 'false');
  }
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
    const found = get(currentSessionChats)?.find(c => c.id === id);
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
      await invoke("show_notification", {
        chatId: Number(chatId),
        title,
        text: bodyText,
        senderId,
        account,
        senderName
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
