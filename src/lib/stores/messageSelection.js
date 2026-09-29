import { writable, derived, get } from "svelte/store";

const initial = {
  active: false,
  chatId: null,
  selected: new Set(),
};

export const selectionState = writable(initial);

export const isSelecting = derived(selectionState, $s => $s.active);
export const selectedCount = derived(selectionState, $s => $s.selected.size);

export function startSelection(chatId, initialMessageId = null) {
  selectionState.set({
    active: true,
    chatId: String(chatId),
    selected: initialMessageId != null ? new Set([String(initialMessageId)]) : new Set(),
  });
}

export function toggleMessageSelection(messageId) {
  if (!messageId) return;
  selectionState.update(s => {
    const nextSet = new Set(s.selected);
    const key = String(messageId);
    if (nextSet.has(key)) {
      nextSet.delete(key);
    } else {
      nextSet.add(key);
    }
    return {
      ...s,
      active: nextSet.size > 0 ? true : false,
      selected: nextSet,
    };
  });
}

export function clearSelection() {
  selectionState.set({
    active: false,
    chatId: null,
    selected: new Set(),
  });
}

export function setSelectedMessages(chatId, messageIds) {
  const set = new Set((messageIds || []).map(String));
  selectionState.set({
    active: set.size > 0,
    chatId: String(chatId),
    selected: set,
  });
}

export function isMessageSelected(messageId) {
  const current = get(selectionState);
  return current.selected.has(String(messageId));
}

