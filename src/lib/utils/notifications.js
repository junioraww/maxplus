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

import {
  getLocalFilePath,
  getFallbackAvatarLocalPath
} from "$lib/utils/images";
import Session from "$lib/stores/session";
import API from "$lib/stores/api";
import { get } from "svelte/store";

export const MESSAGES_CHANNEL_ID = 'MESSAGES_CHANNEL_ID';

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
    console.error("Push: Ошибка создания канала уведомлений:", e);
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
      console.log('Push: получен FCM токен:', fcmToken);

      if (fcmToken) {
        await get(API).call(22, {
          pushToken: fcmToken,
          pushOptions: 0
        });
        console.log('Push: токен успешно зарегистрирован на сервере');
      }
    } catch (error) {
      console.error("Push: Ошибка регистрации пуш-уведомлений:", error);
    }
  } else {
    console.log(`Push: Регистрация FCM пропущена. Текущая ОС: ${currentOs}`);
  }
}

export async function newMessage(chatId, chat, contact, message) {
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
  if (!granted) return;
  try {
    await pluginSendNotification(data);
  } catch (e) {
    console.error("Failed to display notification:", e);
  }
}
