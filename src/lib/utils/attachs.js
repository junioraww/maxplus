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

  const rawAttaches = msg.attaches || msg.attachments;
  const attaches = Array.isArray(rawAttaches) ? rawAttaches : [];
  const typeOf = (x) => (x?._type || x?.type || "").toUpperCase();

  const photos = attaches.filter((x) => typeOf(x) === "PHOTO");
  if (photos.length > 1) return "Изображения";
  if (photos.length === 1) return "Изображение";

  const video = attaches.find((x) => typeOf(x) === "VIDEO");
  if (video) {
    if (video.videoType === "ROUND" || video.videoType === 1 || video.isRound || video.isNote) return "Видео-сообщение";
    return "Видео";
  }

  const audio = attaches.find((x) => typeOf(x) === "AUDIO" || typeOf(x) === "VOICE");
  if (audio) return "Голосовое сообщение";

  const file = attaches.find((x) => typeOf(x) === "FILE");
  if (file) {
    return file.name ? `Файл: ${file.name}` : "Файл";
  }

  const sticker = attaches.find((x) => typeOf(x) === "STICKER");
  if (sticker) return "Стикер";

  const share = attaches.find((x) => typeOf(x) === "SHARE");
  if (share) {
    return share.title ? `Ссылка: ${share.title}` : "Ссылка";
  }

  const poll = attaches.find((x) => typeOf(x) === "POLL");
  if (poll) {
    return poll.title ? `Опрос: ${poll.title}` : "Опрос";
  }

  const location = attaches.find((x) => typeOf(x) === "LOCATION");
  if (location) {
    return "Геопозиция";
  }

  const contact = attaches.find((x) => typeOf(x) === "CONTACT");
  if (contact) {
    return "Контакт";
  }

  const call = attaches.find((x) => typeOf(x) === "CALL" || x.hangupType != null);
  if (call) {
    const hang = (call.hangupType || "").toUpperCase();
    if (hang === "MISSED" || hang === "CANCELED") return "Пропущенный звонок";
    return "Звонок";
  }

  const control = attaches.find((x) => typeOf(x) === "CONTROL");
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
  const control = attaches.find((x) => x._type === "CONTROL");
  if (!control) {
    if (msg.type === "SYSTEM" && msg.text) {
      return html ? escapeHtml(msg.text) : msg.text;
    }
    return null;
  }

  const wrapUser = (val, id) => (html ? `<b class="user-link" data-user-id="${id || ''}">${escapeHtml(val)}</b>` : val);
  const wrap = (val) => (html ? `<b>${escapeHtml(val)}</b>` : val);
  const esc = (val) => (html ? escapeHtml(val) : val);

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
    return ids.map((id) => wrapUser(getUserName(id), id)).join(", ");
  };

  switch (event) {
    case "add": {
      const targets = getTargetNames();
      if (targets) {
        return isMe
          ? `Вы добавили ${targets}`
          : `${wrapUser(senderName, senderId)} добавил(-а) ${targets}`;
      }
      return isMe
        ? "Вы добавили нового участника"
        : `${wrapUser(senderName, senderId)} добавил(-а) нового участника`;
    }
    case "remove":
    case "kick": {
      const targets = getTargetNames();
      if (targets) {
        return isMe
          ? `Вы исключили ${targets}`
          : `${wrapUser(senderName, senderId)} исключил(-а) ${targets}`;
      }
      return isMe
        ? "Вы исключили участника"
        : `${wrapUser(senderName, senderId)} исключил(-а) участника`;
    }
    case "leave": {
      return isMe
        ? "Вы покинули чат"
        : `${wrapUser(senderName, senderId)} покинул(-а) чат`;
    }
    case "joinByLink": {
      return isMe
        ? "Вы присоединились к чату по ссылке"
        : `${wrapUser(senderName, senderId)} присоединился(-ась) к чату по ссылке`;
    }
    case "pin": {
      return isMe
        ? "Вы закрепили сообщение"
        : `${wrapUser(senderName, senderId)} закрепил(-а) сообщение`;
    }
    case "botStarted": {
      return isMe
        ? "Вы запустили бота"
        : `${wrapUser(senderName, senderId)} запустил(-а) бота`;
    }
    case "new": {
      return isMe
        ? "Вы создали чат"
        : `${wrapUser(senderName, senderId)} создал(-а) чат`;
    }
    case "icon": {
      return isMe
        ? "Вы изменили фото чата"
        : `${wrapUser(senderName, senderId)} изменил(-а) фото чата`;
    }
    case "title": {
      const title = control.title ? ` на ${wrap(control.title)}` : "";
      return isMe
        ? `Вы изменили название чата${title}`
        : `${wrapUser(senderName, senderId)} изменил(-а) название чата${title}`;
    }
    case "hello": {
      return isMe
        ? "Вы поприветствовали участников"
        : `${wrapUser(senderName, senderId)} приветствует участников`;
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
