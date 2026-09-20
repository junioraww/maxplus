import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export const transcriptions = writable({});

export function getTranscriptionState(messageId) {
  const all = get(transcriptions);
  return all[String(messageId)] || null;
}

export async function requestAudioTranscription(chatId, messageId, mediaId) {
  const mId = String(messageId);
  const current = get(transcriptions)[mId];
  if (current && current.status === 'done') {
    transcriptions.update((map) => ({
      ...map,
      [mId]: { ...current, expanded: !current.expanded },
    }));
    return;
  }

  transcriptions.update((map) => ({
    ...map,
    [mId]: { status: 'loading', text: '', expanded: true },
  }));

  try {
    const res = await invoke('request_transcription', {
      chatId: Number(chatId),
      messageId: String(messageId),
      mediaId: String(mediaId || messageId),
    });

    const status = res?.transcriptionStatus;
    const text = res?.transcription;

    if (status === 1 && text) {
      transcriptions.update((map) => ({
        ...map,
        [mId]: { status: 'done', text, expanded: true },
      }));
    } else if (status === 1 && !text) {
      transcriptions.update((map) => ({
        ...map,
        [mId]: { status: 'done', text: 'Не удалось распознать текст', expanded: true },
      }));
    } else if (status === -1) {
      transcriptions.update((map) => ({
        ...map,
        [mId]: { status: 'error', text: 'Ошибка транскрибации', expanded: true },
      }));
    }
  } catch (err) {
    transcriptions.update((map) => ({
      ...map,
      [mId]: { status: 'error', text: 'Ошибка транскрибации', expanded: true },
    }));
  }
}

export function handleTranscriptionPush(payload) {
  if (!payload) return;
  const source = payload.message || payload;
  const messageId = String(source.messageId || source.msgId || '');
  if (!messageId) return;

  const status = source.transcriptionStatus != null ? Number(source.transcriptionStatus) : 1;
  const rawText = source.transcription || '';

  if (status === 1) {
    const text = rawText.trim() ? rawText : 'Не удалось распознать текст';
    transcriptions.update((map) => ({
      ...map,
      [messageId]: { status: 'done', text, expanded: true },
    }));
  } else if (status === -1) {
    transcriptions.update((map) => ({
      ...map,
      [messageId]: { status: 'error', text: 'Ошибка транскрибации', expanded: true },
    }));
  }
}

export function toggleTranscriptionExpanded(messageId) {
  const mId = String(messageId);
  transcriptions.update((map) => {
    const entry = map[mId];
    if (!entry) return map;
    return {
      ...map,
      [mId]: { ...entry, expanded: !entry.expanded },
    };
  });
}
