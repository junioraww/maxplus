import {
  registerForPushNotifications,
  isPermissionGranted,
  requestPermission,
  onNotificationReceived,
  sendNotification as pluginSendNotification
} from '@choochmeque/tauri-plugin-notifications-api';
import { type } from '@tauri-apps/plugin-os';
import API from "$lib/stores/api.js";
import { get } from "svelte/store";

let granted = false;

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

  const currentOs = type();

  onNotificationReceived((notification) => {
    if (notification.source === 'push') {
      if (notification.title || notification.body) {
        return;
      }

      const chatId = notification.extra?.chat_id;

      pluginSendNotification({
        title: "Новое сообщение",
        body: notification.extra?.text || "Вам написали",
      });
    }
  });

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

export async function sendNotification(data) {
  if (!granted) return;

  pluginSendNotification(data);
}
