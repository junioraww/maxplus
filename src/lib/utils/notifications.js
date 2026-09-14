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
import API from "$lib/stores/api";

export const MESSAGES_CHANNEL_ID = 'MESSAGES_CHANNEL_ID';

const NOTIFICATIONS_STORAGE_KEY = 'maxplus_client_notifications_enabled';

const initialEnabled = typeof localStorage !== 'undefined'
  ? localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) !== 'false'
  : true;

export const clientNotificationsEnabled = writable(initialEnabled);

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
  setClientNotificationsEnabled(!current);
  return !current;
}

export function isChatMuted(chat) {
  if (!chat) return false;
  const ddu = chat.dontDisturbUntil;
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
  if (isChatMuted(chat)) return;
  if (get(Session).openedChats?.some(idx => idx === chatId)) return;

  let avatarLocalPath = null;
  const chatInfo = chat?.getInfo ? chat.getInfo() : (chat || {});
  const title = chatInfo.title || contact?.names?.[0]?.name || "Новое сообщение";

  const avatarUrl = chat?.baseUrl || contact?.avatar;
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
    body: typeof message === 'string' ? message : (message?.text || "Новое сообщение"),
    icon: avatarLocalPath,
    largeIcon: avatarLocalPath,
  };

  if (!currentOs) currentOs = type();

  if (currentOs === 'android') {
    await ensureMessagesChannel();
    await sendNotification({
      ...entry,
      channelId: MESSAGES_CHANNEL_ID
    });
  } else {
    await sendNotification(entry);
  }
}

export async function sendNotification(data) {
  if (!isClientNotificationsEnabled()) return;
  if (!granted) return;
  try {
    await pluginSendNotification(data);
  } catch (e) {
    console.error("Failed to display notification:", e);
  }
}
