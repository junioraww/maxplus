import { writable, get } from "svelte/store";

export const chatTypingStore = writable(new Map());

// Map of `${chatId}_${userId}` -> timeout
const typingTimers = new Map();
// Internal Map of chatId -> Map of userId -> { userName, action, timestamp }
const chatTypingUsers = new Map();

function formatTypingText(users) {
  if (!users || users.length === 0) return "";
  if (users.length === 1) {
    const u = users[0];
    let actionText = "печатает...";
    if (u.action === "photo") actionText = "отправляет фото...";
    else if (u.action === "video") actionText = "отправляет видео...";
    else if (u.action === "audio") actionText = "записывает голосовое...";
    else if (u.action === "sticker") actionText = "выбирает стикер...";
    else if (u.action === "file") actionText = "отправляет файл...";
    else if (u.action === "video_msg") actionText = "записывает видеосообщение...";

    if (u.userName && u.userName.trim()) {
      return `${u.userName.trim()} ${actionText}`;
    }
    return actionText;
  }

  if (users.length === 2) {
    const name1 = users[0].userName?.trim() || "Собеседник";
    const name2 = users[1].userName?.trim() || "Собеседник";
    return `${name1}, ${name2} печатают...`;
  }

  // 3 or more users: matching moj.r(..., R.plurals.tt_chat_subtitle_count, listC.size())
  const count = users.length;
  const mod10 = count % 10;
  const mod100 = count % 100;
  let word = "человек";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    word = "человека";
  }
  return `${count} ${word} печатают...`;
}

export function setChatTyping(chatId, userId, userName = "", action = "typing") {
  if (chatId == null) return;
  const timerKey = `${chatId}_${userId ?? "unknown"}`;

  if (typingTimers.has(timerKey)) {
    clearTimeout(typingTimers.get(timerKey));
  }

  let usersMap = chatTypingUsers.get(chatId);
  if (!usersMap) {
    usersMap = new Map();
    chatTypingUsers.set(chatId, usersMap);
  }

  usersMap.set(userId ?? "unknown", {
    userId,
    userName,
    action,
    timestamp: Date.now(),
  });

  const usersList = Array.from(usersMap.values());
  const text = formatTypingText(usersList);

  chatTypingStore.update((map) => {
    const next = new Map(map);
    next.set(chatId, {
      users: usersList,
      text,
      timestamp: Date.now(),
    });
    return next;
  });

  // 6 seconds TTL matching official Max
  const timer = setTimeout(() => {
    clearChatTyping(chatId, userId);
  }, 6000);

  typingTimers.set(timerKey, timer);
}

export function clearChatTyping(chatId, userId) {
  if (chatId == null) return;
  const timerKey = `${chatId}_${userId ?? "unknown"}`;

  if (typingTimers.has(timerKey)) {
    clearTimeout(typingTimers.get(timerKey));
    typingTimers.delete(timerKey);
  }

  const usersMap = chatTypingUsers.get(chatId);
  if (usersMap) {
    if (userId != null) {
      usersMap.delete(userId);
      usersMap.delete(String(userId));
      if (!isNaN(Number(userId))) usersMap.delete(Number(userId));
    } else {
      usersMap.clear();
    }

    if (usersMap.size === 0) {
      chatTypingUsers.delete(chatId);
      chatTypingStore.update((map) => {
        if (!map.has(chatId)) return map;
        const next = new Map(map);
        next.delete(chatId);
        return next;
      });
      return;
    }

    const usersList = Array.from(usersMap.values());
    const text = formatTypingText(usersList);
    chatTypingStore.update((map) => {
      const next = new Map(map);
      next.set(chatId, {
        users: usersList,
        text,
        timestamp: Date.now(),
      });
      return next;
    });
  }
}
