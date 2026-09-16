import { escapeHtml } from "$lib/utils/text";

export function getAttachText(chatOrMsg, maybeMsg) {
  const msg = maybeMsg !== undefined ? maybeMsg : chatOrMsg;
  const chat = maybeMsg !== undefined ? chatOrMsg : null;
  if (!msg) return null;

  const attaches = Array.isArray(msg.attaches) ? msg.attaches : [];

  const photos = attaches.filter((x) => x._type === "PHOTO");
  if (photos.length > 1) return "Изображения";
  if (photos.length === 1) return "Изображение";

  const video = attaches.find((x) => x._type === "VIDEO");
  if (video) {
    if (video.videoType === "ROUND" || video.isRound) return "Видео-сообщение";
    return "Видео";
  }

  const audio = attaches.find((x) => x._type === "AUDIO");
  if (audio) return "Голосовое сообщение";

  const file = attaches.find((x) => x._type === "FILE");
  if (file) {
    return file.name ? `Файл: ${file.name}` : "Файл";
  }

  const sticker = attaches.find((x) => x._type === "STICKER");
  if (sticker) return "Стикер";

  const share = attaches.find((x) => x._type === "SHARE");
  if (share) {
    return share.title ? `Ссылка: ${share.title}` : "Ссылка";
  }

  const poll = attaches.find((x) => x._type === "POLL");
  if (poll) {
    return poll.title ? `Опрос: ${poll.title}` : "Опрос";
  }

  const call = attaches.find((x) => x._type === "CALL");
  if (call) return "Звонок";

  const control = attaches.find((x) => x._type === "CONTROL");
  if (control) {
    return control.shortMessage || getSystemText(msg) || "Системное сообщение";
  }

  if (msg.link) {
    if (chat && msg.link.chatId === chat.id) return "Ответ";
    return "Пересланное сообщение";
  }

  return null;
}

export function getSystemText(msg) {
  const event = msg?.attaches?.[0]?.event;
  if (!event) return null;
  if (event === "botStarted") return "Вы запустили бота!";
  const first = msg.attaches?.[0];
  if (event === "new") return "Чат <b>" + escapeHtml(first.title) + "</b> создан!";
  if (event === "icon") return "Фото чата изменено";
  if (event === "joinByLink") return "Вы вступили по ссылке!";
  if (event === "system") return escapeHtml(first.message);
  if (event === "title")
    return `Настройки чата изменены!\n<b>${escapeHtml(first.title) || "Без названия"}</b>`;
  if (msg.text) return escapeHtml(msg.text);
  return escapeHtml(event);
}
