import { escapeHtml } from "$lib/utils/text";

// prettier-ignore
export function getAttachText(chat, msg) {
  return has(msg, "PHOTO") ? "Изображение" :
         has(msg, "VIDEO") ? "Видео" :
         has(msg, "FILE") ? "Файл" :
         has(msg, "INLINE_KEYBOARD") ? "Клавиатура" :
         has(msg, "CONTROL") ? msg?.attaches?.find(x => x._type === "CONTROL")?.shortMessage :
         msg?.link ? (
           msg.link.chatId === chat.id ? "Ответ" : "Пересланное сообщение"
         ) : null;
}

function has(msg, type) {
  return msg?.attaches?.find((x) => x._type === type);
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
