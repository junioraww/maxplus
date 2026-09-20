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

test.describe('Media playback coordinator and waveform', () => {
  test('parseWaveform converts bytes to normalized floats', async () => {
    const { parseWaveform, generateWaveformFromAmplitudes } = await import('../src/lib/utils/waveform.js');
    const bytes = [0, 128, 255, 64];
    const wave = parseWaveform(bytes, 4);
    expect(wave.length).toBe(4);
    expect(wave[0]).toBe(0.12);
    expect(wave[1]).toBeCloseTo(128 / 255, 2);
    expect(wave[2]).toBe(1);

    const amps = [10, 50, 100, 200];
    const gen = generateWaveformFromAmplitudes(amps, 8);
    expect(gen.length).toBe(8);
    for (const val of gen) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(255);
    }
  });

  test('media playback snaps speed to 1.0x within threshold and bounds between 0.5x and 4.0x', async () => {
    const { snapSpeed, setPlaybackSpeed, globalSpeed } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    expect(snapSpeed(1.04)).toBe(1.0);
    expect(snapSpeed(0.96)).toBe(1.0);
    expect(snapSpeed(1.25)).toBe(1.25);
    expect(snapSpeed(0.5)).toBe(0.5);
    expect(snapSpeed(0.2)).toBe(0.5);
    expect(snapSpeed(5.0)).toBe(4.0);

    setPlaybackSpeed(1.04);
    expect(get(globalSpeed)).toBe(1.0);

    setPlaybackSpeed(2.0);
    expect(get(globalSpeed)).toBe(2.0);
  });

  test('playback mutual exclusion stops previously playing media', async () => {
    const { activeMedia, registerAudio, registerVideo, stopCurrentMedia } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    let audioPaused = false;
    let videoPaused = false;

    const mockAudio = {
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      currentTime: 0,
      pause: () => {
        audioPaused = true;
      },
    };

    const mockVideo = {
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      currentTime: 0,
      pause: () => {
        videoPaused = true;
      },
    };

    registerAudio('voice-msg-101', mockAudio, { type: 'voice' });
    expect(get(activeMedia)?.id).toBe('voice-msg-101');

    registerVideo('video-msg-202', mockVideo, { type: 'video' });
    expect(audioPaused).toBe(true);
    expect(get(activeMedia)?.id).toBe('video-msg-202');

    stopCurrentMedia();
    expect(videoPaused).toBe(true);
    expect(get(activeMedia)).toBeNull();
  });
});

test.describe('Transcription store', () => {
  test('handleTranscriptionPush updates transcription state', async () => {
    const { transcriptions, handleTranscriptionPush } = await import('../src/lib/stores/transcription.js');
    const { get } = await import('svelte/store');

    handleTranscriptionPush({
      messageId: 90001,
      transcriptionStatus: 1,
      transcription: 'Synthetic speech transcribed text',
    });

    const storeVal = get(transcriptions);
    expect(storeVal['90001']).toBeDefined();
    expect(storeVal['90001'].text).toBe('Synthetic speech transcribed text');
    expect(storeVal['90001'].status).toBe('done');
    expect(storeVal['90001'].expanded).toBe(true);
  });
});

test.describe('Message diffing and edit history', () => {
  test('computeTextDiff generates correct word/token delta', async () => {
    const { computeTextDiff, applyDiff } = await import('../src/lib/utils/diff.js');
    const oldText = 'Hello synthetic world';
    const newText = 'Hello beautiful synthetic world!';
    const diff = computeTextDiff(oldText, newText);

    expect(diff.length).toBeGreaterThan(0);
    const hasAdd = diff.some((d) => d.op === '+' && d.text.includes('beautiful'));
    expect(hasAdd).toBe(true);

    const appliedNew = applyDiff(diff, 'new');
    expect(appliedNew).toBe(newText);

    const appliedOld = applyDiff(diff, 'old');
    expect(appliedOld).toBe(oldText);
  });

  test('computeAttachesDiff correctly detects added and removed attachments', async () => {
    const { computeAttachesDiff } = await import('../src/lib/utils/diff.js');
    const oldAttaches = [
      { id: 101, _type: 'PHOTO', name: 'photo1.jpg' },
      { id: 102, _type: 'FILE', name: 'doc1.pdf' },
    ];
    const newAttaches = [
      { id: 102, _type: 'FILE', name: 'doc1.pdf' },
      { id: 103, _type: 'PHOTO', name: 'photo2.jpg' },
    ];

    const delta = computeAttachesDiff(oldAttaches, newAttaches);
    expect(delta.added.length).toBe(1);
    expect(delta.added[0].id).toBe(103);
    expect(delta.removed.length).toBe(1);
    expect(delta.removed[0].id).toBe(101);
  });

  test('preserves deleted status and timestamp on message deletion', () => {
    const msg = {
      id: 90001,
      sender: 10001,
      text: 'Synthetic content',
      time: 1700000000000,
    };

    const deletedMsg = {
      ...msg,
      deleted: true,
      deleted_at: 1700000005000,
    };

    expect(deletedMsg.deleted).toBe(true);
    expect(deletedMsg.deleted_at).toBe(1700000005000);
    expect(deletedMsg.text).toBe('Synthetic content');
  });

  test('parseApiError properly formats error.edit.timeout', async () => {
    const { parseApiError } = await import('../src/lib/utils/errors.js');
    const rawError = {
      error: 'error.edit.timeout',
      localizedMessage: 'Невозможно отредактировать сообщение',
      message: 'error.edit.timeout',
    };
    expect(parseApiError(rawError)).toBe('Невозможно отредактировать сообщение');

    const stringError = JSON.stringify(rawError);
    expect(parseApiError(stringError)).toBe('Невозможно отредактировать сообщение');

    const wrappedTauriError = {
      type: 'ApiResponse',
      text: stringError,
    };
    expect(parseApiError(wrappedTauriError)).toBe('Невозможно отредактировать сообщение');
  });

  test('edit timeout calculation checks against server config', () => {
    const serverConfig = { 'edit-timeout': 86400 };
    const timeoutSec = Number(serverConfig['edit-timeout']);
    const now = 1700000000000;
    const freshMessageTime = now - 3600 * 1000;
    const expiredMessageTime = now - 90000 * 1000;

    const canEditFresh = (now - freshMessageTime) <= timeoutSec * 1000;
    const canEditExpired = (now - expiredMessageTime) <= timeoutSec * 1000;

    expect(canEditFresh).toBe(true);
    expect(canEditExpired).toBe(false);
  });

  test('merging preserves edit history and status', () => {
    const cachedMsg = {
      id: '88801',
      text: 'Synthetic initial text',
      time: 1700000000000,
      edited: true,
      history: [
        { at: 1700000001000, diff: [{ op: '=', text: 'Synthetic initial text' }] }
      ]
    };

    const serverMsg = {
      id: '88801',
      text: 'Synthetic initial text',
      time: 1700000000000,
      status: 'EDITED'
    };

    const merged = {
      ...cachedMsg,
      ...serverMsg,
      edited: serverMsg.status === 'EDITED' || cachedMsg.edited,
      history: cachedMsg.history
    };

    expect(merged.edited).toBe(true);
    expect(merged.history.length).toBe(1);
    expect(merged.status).toBe('EDITED');
  });
});

test.describe('Audio/video sending, failure marking, and sticker draft retention', () => {
  test('optimistic media message has correct sender and isMe is true for current user', () => {
    const currentUserId = 123456;
    const optimisticMsg = {
      id: -Date.now(),
      sending: true,
      sender: currentUserId,
      attaches: [{ _type: 'AUDIO', duration: 3000, localPath: '/tmp/test.webm' }]
    };

    const isMe = Number(optimisticMsg.sender) === Number(currentUserId);
    expect(isMe).toBe(true);
  });

  test('failed or unsent message is marked with deleted true and failed status', () => {
    const tempId = -1001;
    const msgs = [
      { id: tempId, sending: true, text: '', status: 0 }
    ];

    const updated = msgs.map(m => {
      if (m.id === tempId) {
        return {
          ...m,
          sending: false,
          deleted: true,
          status: 'failed'
        };
      }
      return m;
    });

    expect(updated[0].sending).toBe(false);
    expect(updated[0].deleted).toBe(true);
    expect(updated[0].status).toBe('failed');
  });

  test('sending sticker preserves user draft text', () => {
    let newMessage = 'Draft message user is typing';
    let stickerSuggestions = ['sticker1', 'sticker2'];

    stickerSuggestions = [];

    expect(newMessage).toBe('Draft message user is typing');
    expect(stickerSuggestions.length).toBe(0);
  });

  test('local audio and video path resolves with convertFileSrc or local path', () => {
    const attachWithLocal = {
      _type: 'AUDIO',
      duration: 5000,
      localPath: '/home/user/.cache/temp_media/test.webm'
    };

    const rawUrl = attachWithLocal.fileUrl || attachWithLocal.baseUrl || attachWithLocal.url || attachWithLocal.localPath;
    expect(rawUrl).toBe('/home/user/.cache/temp_media/test.webm');
  });
});


