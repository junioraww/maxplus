import {
  registerForPushNotifications,
  isPermissionGranted,
  requestPermission,
  onNotificationReceived,
  sendNotification as pluginSendNotification,
  createChannel,
  channels,
  removeChannel,
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

let granted = false;
let currentOs;

export async function suggestNotifications() {
  let permissionGranted = await isPermissionGranted();

  if (!permissionGranted) {
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
  }

  granted = permissionGranted;
}

export async function setupPushNotifications() {
  if (!granted) await suggestNotifications();
  if (!granted) return;

  if (!currentOs) currentOs = type();

  if (currentOs === 'android') {
    try {
      const fcmToken = await registerForPushNotifications();
      console.log('Push: получен FCM токен:', fcmToken);

      await get(API).call(22, {
        pushToken: fcmToken,
        pushOptions: 0
      });
    } catch (error) {
      console.error("Push: Ошибка регистрации пуш-уведомлений:", error);
    }
  } else {
    console.log(`Push: Регистрация FCM пропущена. Текущая ОС: ${currentOs}`);
  }
}

export async function newMessage(chatId, chat, contact, message) {
  if (get(Session).openedChats.some(idx => idx === chatId)) return; // chat opened
  // TODO notification settings

  let avatarLocalPath = null;

  const avatarUrl = chat.baseUrl || contact?.avatar;
  if (avatarUrl) {
    avatarLocalPath = await getLocalFilePath(avatarUrl);
  } else {
    avatarLocalPath = await getFallbackAvatarLocalPath(
      chat.id || contact.id,
      chat.title || contact.names[0].name,
    );
  }

  const entry = {
    title: null,
    body: message,
    icon: avatarLocalPath,
    largeIcon: avatarLocalPath,
  };

  if (chat.title) entry.title = chat.title;
  else if (contact) entry.title = contact.names[0].name;

  console.log(entry);

  if (currentOs === 'android') {
    const channelList = await channels();

    console.log(channelList);

    if (!channels.some(c => c.id === chatId + "")) {
      await createChannel({
        id: chatId + "",
        name: title,
        description: "New message notifications",
        importance: Importance.High
      });
    }

    await sendNotification({
      ...entry,
      channelId: chatId + ""
    });
  } else {
    await sendNotification(entry);
  }
}

export async function sendNotification(data) {
  if (!granted) return;

  pluginSendNotification(data);
}
