import { test, expect } from '@playwright/test';
import { getAttachText } from '../src/lib/utils/attachs.js';
import { getMessagePreview, escapeHtml } from '../src/lib/utils/text.js';
import {
  SYNTHETIC_CURRENT_USER,
  SYNTHETIC_PEER_USER,
  syntheticMessages,
  syntheticChats,
  syntheticContacts,
} from './fixtures/synthetic.js';

test.describe('Message previews and attachment labels', () => {
  test('formats photo attachments', () => {
    expect(getAttachText(syntheticMessages.photoMessage)).toBe('Изображение');
    expect(getMessagePreview(syntheticMessages.photoMessage)).toBe('Изображение');

    expect(getAttachText(syntheticMessages.multiPhotoMessage)).toBe('Изображения');
    expect(getMessagePreview(syntheticMessages.multiPhotoMessage)).toBe('Изображения, Look at pictures');
  });

  test('formats video attachments', () => {
    expect(getAttachText(syntheticMessages.videoMessage)).toBe('Видео');
    expect(getMessagePreview(syntheticMessages.videoMessage)).toBe('Видео');
  });

  test('formats file attachments with filename', () => {
    expect(getAttachText(syntheticMessages.fileMessage)).toBe('Файл: synthetic_doc.pdf');
    expect(getMessagePreview(syntheticMessages.fileMessage)).toBe('Файл: synthetic_doc.pdf');
  });

  test('formats standard text messages', () => {
    expect(getAttachText(syntheticMessages.textMessage)).toBeNull();
    expect(getMessagePreview(syntheticMessages.textMessage)).toBe('Synthetic message content');
  });

  test('escapes html entities correctly', () => {
    expect(escapeHtml('<script>alert("test")&</script>')).toBe(
      '&lt;script&gt;alert(&quot;test&quot;)&amp;&lt;/script&gt;'
    );
  });
});

test.describe('Read receipt calculations', () => {
  test('identifies read status from otherReadTime', () => {
    const chat = syntheticChats[0];
    const otherReadTime = chat.otherReadTime;

    const isPending = syntheticMessages.outgoingPendingMessage.status === 0;
    expect(isPending).toBe(true);

    const isSent = syntheticMessages.outgoingSentMessage.time > otherReadTime;
    expect(isSent).toBe(true);

    const isRead = syntheticMessages.outgoingReadMessage.time <= otherReadTime;
    expect(isRead).toBe(true);
  });

  test('correctly identifies outgoing messages', () => {
    const isOutgoing = syntheticMessages.outgoingSentMessage.sender === SYNTHETIC_CURRENT_USER;
    expect(isOutgoing).toBe(true);

    const isIncoming = syntheticMessages.textMessage.sender === SYNTHETIC_PEER_USER;
    expect(isIncoming).toBe(true);
  });
});

test.describe('Chat scroll store logic', () => {
  test('persists and retrieves scroll information correctly', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    };

    const { getChatScroll, saveChatScroll, clearChatScroll } = await import(
      '../src/lib/stores/chatScroll.js'
    );

    saveChatScroll(99901, {
      wasAtBottom: false,
      bottomMessageId: 102,
      bottomMessageTime: 1700000000,
      offset: 35,
    });

    const restored = getChatScroll(99901);
    expect(restored).toEqual({
      wasAtBottom: false,
      bottomMessageId: 102,
      bottomMessageTime: 1700000000,
      offset: 35,
    });

    clearChatScroll(99901);
    expect(getChatScroll(99901)).toBeNull();
  });
});
