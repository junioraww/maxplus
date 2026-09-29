import { writable } from "svelte/store";

export const forwardDraft = writable(null);

export function setForwardDraft(messages, sourceChatId = null) {
  if (!messages || !messages.length) {
    forwardDraft.set(null);
    return;
  }
  const resolvedChatId = sourceChatId ?? messages[0]?.chatId ?? messages[0]?.chat_id ?? null;
  forwardDraft.set({
    sourceChatId: resolvedChatId,
    messages: messages.map(m => ({
      ...m,
      chatId: m.chatId ?? resolvedChatId,
    })),
  });
}

export function clearForwardDraft() {
  forwardDraft.set(null);
}
