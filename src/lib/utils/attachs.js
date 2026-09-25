import { escapeHtml } from "$lib/utils/text";
import { getContact } from "$lib/utils/caching";
import { get } from "svelte/store";
import { currentUser } from "$lib/stores/api";

function getUserName(userId) {
  if (!userId) return "Пользователь";
  const myId = get(currentUser);
  if (myId && Number(userId) === Number(myId)) return "Вы";
  try {
    const c = get(getContact(Number(userId)));
    if (c?.names?.[0]?.name) return c.names[0].name;
    if (c?.name) return c.name;
    if (c?.names?.[0]?.firstName) {
      const n = c.names[0];
      return [n.firstName, n.lastName].filter(Boolean).join(" ");
    }
  } catch (e) {}
  return "Пользователь";
}

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
    return null;
  }

  if (msg.link) {
    if (chat && msg.link.chatId === chat.id) return "Ответ";
    return "Пересланное сообщение";
  }

  return null;
}

export function getSystemText(msg, html = true) {
  if (!msg) return null;
  const attaches = Array.isArray(msg.attaches) ? msg.attaches : [];
  const control = attaches.find((x) => x._type === "CONTROL") || attaches[0];

  const wrap = (val) => (html ? `<b>${escapeHtml(val)}</b>` : val);
  const esc = (val) => (html ? escapeHtml(val) : val);

  if (!control) {
    return msg.text ? esc(msg.text) : null;
  }

  const event = control.event;
  const senderId = msg.sender || msg.from;
  const isMe = senderId && Number(senderId) === Number(get(currentUser));
  const senderName = getUserName(senderId);

  const getTargetNames = () => {
    let ids = [];
    if (Array.isArray(control.userIds)) {
      ids = control.userIds;
    } else if (control.userId) {
      ids = [control.userId];
    }
    if (!ids.length) return "";
    return ids.map((id) => getUserName(id)).join(", ");
  };

  switch (event) {
    case "add": {
      const targets = getTargetNames();
      if (targets) {
        return isMe
          ? `Вы добавили ${wrap(targets)}`
          : `${wrap(senderName)} добавил(а) ${wrap(targets)}`;
      }
      return isMe
        ? "Вы добавили нового участника"
        : `${wrap(senderName)} добавил(а) нового участника`;
    }
    case "remove":
    case "kick": {
      const targets = getTargetNames();
      if (targets) {
        return isMe
          ? `Вы исключили ${wrap(targets)}`
          : `${wrap(senderName)} исключил(а) ${wrap(targets)}`;
      }
      return isMe
        ? "Вы исключили участника"
        : `${wrap(senderName)} исключил(а) участника`;
    }
    case "leave": {
      return isMe
        ? "Вы покинули чат"
        : `${wrap(senderName)} покинул(а) чат`;
    }
    case "joinByLink": {
      return isMe
        ? "Вы присоединились к чату по ссылке"
        : `${wrap(senderName)} присоединился(-ась) к чату по ссылке`;
    }
    case "pin": {
      return isMe
        ? "Вы закрепили сообщение"
        : `${wrap(senderName)} закрепил(а) сообщение`;
    }
    case "botStarted": {
      return isMe
        ? "Вы запустили бота"
        : `${wrap(senderName)} запустил(а) бота`;
    }
    case "new": {
      const title = control.title ? ` ${wrap(control.title)}` : "";
      return isMe
        ? `Вы создали чат${title}`
        : `${wrap(senderName)} создал(а) чат${title}`;
    }
    case "icon": {
      return isMe
        ? "Вы обновили фото чата"
        : `${wrap(senderName)} обновил(а) фото чата`;
    }
    case "title": {
      const title = control.title ? ` на ${wrap(control.title)}` : "";
      return isMe
        ? `Вы изменили название чата${title}`
        : `${wrap(senderName)} изменил(а) название чата${title}`;
    }
    case "system": {
      if (control.message) return esc(control.message);
      if (control.title) return esc(control.title);
      if (msg.text) return esc(msg.text);
      return "Системное сообщение";
    }
    default: {
      if (control.title) return esc(control.title);
      if (control.shortMessage) return esc(control.shortMessage);
      if (control.message) return esc(control.message);
      if (msg.text) return esc(msg.text);
      if (event) return esc(event);
      return null;
    }
  }
}
