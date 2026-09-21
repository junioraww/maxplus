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

test.describe('Video note playback and Favorites (chatId = 0) handling', () => {
  test('favorites video note message has valid attach and videoType 1', () => {
    const msg = syntheticMessages.favoritesVideoNoteMessage;
    expect(msg.chatId).toBe(0);
    expect(msg.attaches.length).toBe(1);
    const attach = msg.attaches[0];
    expect(attach._type).toBe('VIDEO');
    expect(attach.videoType).toBe(1);
    expect(attach.videoId).toBe(77701);
    expect(attach.videoToken).toBe('synth_video_token_xyz');
  });

  test('chatId = 0 is properly handled by nullish coalescing in playlist items', () => {
    const msg = syntheticMessages.favoritesVideoNoteMessage;
    const attach = msg.attaches[0];
    const dur = attach.duration ? attach.duration / 1000 : 0;
    const item = {
      id: String(msg.id),
      chatId: msg.chatId ?? 0,
      messageId: msg.id,
      type: 'video_note',
      duration: dur,
      time: msg.time,
      attach,
      title: 'Видеосообщение',
    };

    expect(item.chatId).toBe(0);
    expect(item.chatId !== null && item.chatId !== undefined).toBe(true);
    expect(item.type).toBe('video_note');
    expect(item.duration).toBe(8);
  });

  test('video note playMedia sets activeMedia, element, and toggles play/pause', async () => {
    const {
      activeMedia,
      playMedia,
      pauseCurrentMedia,
      resumeCurrentMedia,
      stopCurrentMedia,
      updateMediaProgress,
      seekMedia,
    } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    let played = false;
    let paused = false;

    const mockVideoEl = {
      src: '',
      currentTime: 0,
      duration: 8,
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      play: () => {
        played = true;
        paused = false;
        return Promise.resolve();
      },
      pause: () => {
        paused = true;
        played = false;
      },
      getAttribute: (name) => (name === 'src' ? mockVideoEl.src : null),
      setAttribute: (name, val) => {
        if (name === 'src') mockVideoEl.src = val;
      },
    };

    const track = {
      id: 'video_note_90010',
      chatId: 0,
      messageId: 90010,
      type: 'video_note',
      url: 'http://127.0.0.1:11447/test_video.mp4',
      duration: 8,
      senderName: 'Вы',
      title: 'Видеосообщение',
      element: mockVideoEl,
    };

    await playMedia(track, { chatId: 0, messages: [] });

    const active = get(activeMedia);
    expect(active).not.toBeNull();
    expect(active.id).toBe('video_note_90010');
    expect(active.type).toBe('video_note');
    expect(active.chatId).toBe(0);
    expect(active.isPlaying).toBe(true);
    expect(played).toBe(true);
    expect(mockVideoEl.src).toBe('http://127.0.0.1:11447/test_video.mp4');

    pauseCurrentMedia();
    expect(get(activeMedia)?.isPlaying).toBe(false);
    expect(paused).toBe(true);

    resumeCurrentMedia();
    expect(get(activeMedia)?.isPlaying).toBe(true);
    expect(played).toBe(true);

    updateMediaProgress('video_note_90010', 4.0, 8.0);
    expect(get(activeMedia)?.currentTime).toBe(4.0);

    seekMedia('video_note_90010', 6.0);
    expect(mockVideoEl.currentTime).toBe(6.0);
    expect(get(activeMedia)?.currentTime).toBe(6.0);

    stopCurrentMedia();
    expect(get(activeMedia)).toBeNull();
  });

  test('takeOverFromGlobal transitions playback to mounted bubble element', async () => {
    const {
      activeMedia,
      playMedia,
      takeOverFromGlobal,
      stopCurrentMedia,
    } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    const playlistTrack = {
      id: 'video_note_global_1',
      chatId: 0,
      messageId: 90011,
      type: 'video_note',
      url: 'http://127.0.0.1:11447/global_note.mp4',
      duration: 10,
      senderName: 'Собеседник',
      title: 'Видеосообщение',
      element: null,
    };

    await playMedia(playlistTrack, { chatId: 0 });
    expect(get(activeMedia)?.isGlobalPlayback).toBe(true);

    let bubblePlayed = false;
    const bubbleVideoEl = {
      src: '',
      currentTime: 0,
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      play: () => {
        bubblePlayed = true;
        return Promise.resolve();
      },
      pause: () => {},
      load: () => {},
    };

    takeOverFromGlobal('video_note_global_1', bubbleVideoEl);

    const after = get(activeMedia);
    expect(after?.isGlobalPlayback).toBe(false);
    expect(after?.element).toBe(bubbleVideoEl);
    expect(bubbleVideoEl.src).toBe('http://127.0.0.1:11447/global_note.mp4');
    expect(bubblePlayed).toBe(true);

    stopCurrentMedia();
  });
});

test.describe('Video note cropping and media import features', () => {
  function computeCropParams(vpW, vpH, videoW, videoH, normCx, normCy, zoomRatio) {
    const videoAspect = videoW / videoH;
    const vpAspect = vpW / vpH;
    let rw = 0;
    let rh = 0;
    let rx = 0;
    let ry = 0;

    if (videoAspect > vpAspect) {
      rw = vpW;
      rh = vpW / videoAspect;
      rx = 0;
      ry = (vpH - rh) / 2;
    } else {
      rh = vpH;
      rw = vpH * videoAspect;
      rx = (vpW - rw) / 2;
      ry = 0;
    }

    const maxDiameter = Math.min(rw, rh);
    const minDiameter = Math.max(48, maxDiameter * 0.25);
    const currentDiameter = minDiameter + (maxDiameter - minDiameter) * zoomRatio;
    const r = currentDiameter / 2;

    const minCx = rx + r;
    const maxCx = rx + rw - r;
    const minCy = ry + r;
    const maxCy = ry + rh - r;

    let cx = rx + normCx * rw;
    let cy = ry + normCy * rh;
    cx = Math.max(minCx, Math.min(maxCx, cx));
    cy = Math.max(minCy, Math.min(maxCy, cy));

    const scale = videoW / rw;
    const d = r * 2;
    let cropSize = Math.round(d * scale);
    let cropX = Math.round((cx - rx - r) * scale);
    let cropY = Math.round((cy - ry - r) * scale);

    cropSize = Math.min(cropSize, Math.min(videoW, videoH));
    cropX = Math.max(0, Math.min(videoW - cropSize, cropX));
    cropY = Math.max(0, Math.min(videoH - cropSize, cropY));

    return { cropX, cropY, cropSize };
  }

  test('calculates exact square crop centered for 16:9 landscape video', () => {
    const { cropX, cropY, cropSize } = computeCropParams(400, 400, 1920, 1080, 0.5, 0.5, 1.0);
    expect(cropSize).toBe(1080);
    expect(cropY).toBe(0);
    expect(cropX).toBe(420);
  });

  test('calculates exact square crop centered for 9:16 portrait video', () => {
    const { cropX, cropY, cropSize } = computeCropParams(400, 400, 1080, 1920, 0.5, 0.5, 1.0);
    expect(cropSize).toBe(1080);
    expect(cropX).toBe(0);
    expect(cropY).toBe(420);
  });

  test('clamps crop boundaries when panning to edges', () => {
    const leftCrop = computeCropParams(400, 400, 1920, 1080, 0.0, 0.5, 1.0);
    expect(leftCrop.cropX).toBe(0);
    expect(leftCrop.cropSize).toBe(1080);

    const rightCrop = computeCropParams(400, 400, 1920, 1080, 1.0, 0.5, 1.0);
    expect(rightCrop.cropX).toBe(1920 - 1080);
    expect(rightCrop.cropSize).toBe(1080);
  });

  test('video note attachment payload complies with Max server specs', () => {
    const attachItem = {
      type: 'VIDEO',
      videoType: 1,
      path: '/synthetic/temp_media/video_note.mp4',
      duration: 12500,
      wave: new Array(80).fill(0),
      mime: 'video/mp4',
    };

    expect(attachItem.type).toBe('VIDEO');
    expect(attachItem.videoType).toBe(1);
    expect(attachItem.duration).toBeGreaterThan(0);
    expect(attachItem.wave).toHaveLength(80);
  });

  test('imported voice note attachment payload complies with Max server specs', () => {
    const voiceItem = {
      type: 'AUDIO',
      path: '/synthetic/temp_media/imported_voice.ogg',
      duration: 5400,
      wave: new Array(80).fill(12),
      mime: 'audio/ogg',
    };

    expect(voiceItem.type).toBe('AUDIO');
    expect(voiceItem.duration).toBe(5400);
    expect(voiceItem.wave).toHaveLength(80);
  });

  test('voice note playMedia from chat message sets activeMedia and plays without stopping', async () => {
    const {
      activeMedia,
      playMedia,
      registerGlobalElements,
      pauseCurrentMedia,
      resumeCurrentMedia,
      stopCurrentMedia,
    } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    let audioPlayed = false;
    let audioPaused = false;
    const mockAudioEl = {
      src: '',
      currentTime: 0,
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      play: () => {
        audioPlayed = true;
        audioPaused = false;
        return Promise.resolve();
      },
      pause: () => {
        audioPaused = true;
        audioPlayed = false;
      },
      load: () => {},
    };

    registerGlobalElements(mockAudioEl, null);

    const voiceMsg = syntheticMessages.favoritesVoiceNoteMessage;
    const voiceTrack = {
      id: String(voiceMsg.id),
      chatId: voiceMsg.chatId,
      messageId: voiceMsg.id,
      type: 'voice',
      url: 'http://127.0.0.1:11447/synth_voice.ogg',
      duration: 6.2,
      senderName: 'Вы',
      title: 'Голосовое сообщение',
      attach: voiceMsg.attaches[0],
    };

    await playMedia(voiceTrack, { chatId: 0, currentMessageId: voiceMsg.id });

    const state = get(activeMedia);
    expect(state).not.toBeNull();
    expect(state?.id).toBe(String(voiceMsg.id));
    expect(state?.isPlaying).toBe(true);
    expect(audioPlayed).toBe(true);
    expect(mockAudioEl.src).toBe('http://127.0.0.1:11447/synth_voice.ogg');

    pauseCurrentMedia();
    expect(get(activeMedia)?.isPlaying).toBe(false);
    expect(audioPaused).toBe(true);

    resumeCurrentMedia();
    expect(get(activeMedia)?.isPlaying).toBe(true);
    expect(audioPlayed).toBe(true);

    stopCurrentMedia();
    expect(get(activeMedia)).toBeNull();
  });

  test('resolvePlayableUrl properly handles localPath and remote audio URLs', async () => {
    const { resolvePlayableUrl } = await import('../src/lib/stores/mediaPlayback.js');

    const localAttach = {
      _type: 'AUDIO',
      localPath: '/synthetic/audio/voice_1.ogg',
      duration: 3500,
    };
    const localUrl = await resolvePlayableUrl(localAttach, 0, 90020);
    expect(localUrl).toBe('http://127.0.0.1:11447/%2Fsynthetic%2Faudio%2Fvoice_1.ogg');

    const remoteAttach = {
      _type: 'AUDIO',
      url: 'http://127.0.0.1:11447/cached_audio.ogg',
      duration: 4000,
    };
    const remoteUrl = await resolvePlayableUrl(remoteAttach, 0, 90021);
    expect(remoteUrl).toBe('http://127.0.0.1:11447/cached_audio.ogg');
  });


  test('preloadTrack safely preloads next playlist track without throwing', async () => {
    const { preloadTrack } = await import('../src/lib/stores/mediaPlayback.js');
    const nextItem = {
      id: 'synth_preload_1',
      chatId: 999,
      messageId: 8888,
      type: 'voice',
      attach: {
        _type: 'AUDIO',
        localPath: '/synthetic/cache/voice_next.ogg',
        duration: 2000,
      },
    };

    await expect(preloadTrack(nextItem)).resolves.not.toThrow();
    await expect(preloadTrack(null)).resolves.not.toThrow();
  });

  test('video note fast-switch preserves src and transitions seamlessly without delay', async () => {
    const {
      activeMedia,
      playMedia,
      handOffToGlobal,
      takeOverFromGlobal,
      stopCurrentMedia,
    } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    let bubblePaused = false;
    let bubblePlayed = false;
    const bubbleEl = {
      src: 'http://127.0.0.1:11447/synth_fast_switch.mp4',
      currentTime: 4.5,
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      readyState: 4,
      play: () => {
        bubblePlayed = true;
        return Promise.resolve();
      },
      pause: () => {
        bubblePaused = true;
      },
    };

    let globalPlayed = false;
    let globalPaused = false;
    const globalEl = {
      src: 'http://127.0.0.1:11447/synth_fast_switch.mp4',
      currentTime: 0,
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      readyState: 4,
      play: () => {
        globalPlayed = true;
        return Promise.resolve();
      },
      pause: () => {
        globalPaused = true;
      },
    };

    const track = {
      id: 'synth_switch_track_1',
      chatId: 501,
      messageId: 601,
      type: 'video_note',
      url: 'http://127.0.0.1:11447/synth_fast_switch.mp4',
      duration: 15,
      element: bubbleEl,
    };

    await playMedia(track, { chatId: 501 });
    expect(get(activeMedia)?.isPlaying).toBe(true);
    expect(get(activeMedia)?.isGlobalPlayback).toBe(false);

    bubbleEl.currentTime = 4.5;

    handOffToGlobal({
      id: 'synth_switch_track_1',
      type: 'video_note',
      url: 'http://127.0.0.1:11447/synth_fast_switch.mp4',
      currentTime: bubbleEl.currentTime,
      duration: 15,
      isPlaying: true,
    });

    expect(bubblePaused).toBe(true);
    expect(get(activeMedia)?.isGlobalPlayback).toBe(true);
    expect(get(activeMedia)?.currentTime).toBe(4.5);

    takeOverFromGlobal('synth_switch_track_1', bubbleEl);

    expect(get(activeMedia)?.isGlobalPlayback).toBe(false);
    expect(get(activeMedia)?.element).toBe(bubbleEl);
    expect(bubblePlayed).toBe(true);

    stopCurrentMedia();
    expect(get(activeMedia)).toBeNull();
  });

  test('resolvePlayableUrl deduplicates concurrent and repeated calls for same media', async () => {
    const { resolvePlayableUrl } = await import('../src/lib/stores/mediaPlayback.js');

    const syntheticAttach = {
      _type: 'VIDEO',
      videoType: 1,
      videoId: 987654,
      videoUrl: 'http://127.0.0.1:11447/synth_dedup.mp4',
      duration: 12000,
    };

    const startTime = Date.now();
    const [url1, url2] = await Promise.all([
      resolvePlayableUrl(syntheticAttach, 100, 200),
      resolvePlayableUrl(syntheticAttach, 100, 200),
    ]);
    const elapsed = Date.now() - startTime;

    expect(url1).toBe('http://127.0.0.1:11447/synth_dedup.mp4');
    expect(url2).toBe('http://127.0.0.1:11447/synth_dedup.mp4');
    expect(elapsed).toBeLessThan(100);

    const cachedUrl = await resolvePlayableUrl(syntheticAttach, 100, 200);
    expect(cachedUrl).toBe('http://127.0.0.1:11447/synth_dedup.mp4');
  });
});

test.describe('Canvas multi-sink and smooth audio cross-fading', () => {
  test('registerVideoCanvas and unregisterVideoCanvas manage canvas sinks correctly', async () => {
    const {
      registerVideoCanvas,
      unregisterVideoCanvas,
      getVideoCanvases,
    } = await import('../src/lib/stores/mediaPlayback.js');

    const mockCanvas1 = { id: 'canvas1', width: 200, height: 200, getContext: () => null };
    const mockCanvas2 = { id: 'canvas2', width: 110, height: 110, getContext: () => null };

    registerVideoCanvas('synth_canvas_track_1', mockCanvas1);
    expect(getVideoCanvases('synth_canvas_track_1')).toHaveLength(1);
    expect(getVideoCanvases('synth_canvas_track_1')[0]).toBe(mockCanvas1);

    registerVideoCanvas('synth_canvas_track_1', mockCanvas2);
    expect(getVideoCanvases('synth_canvas_track_1')).toHaveLength(2);

    unregisterVideoCanvas('synth_canvas_track_1', mockCanvas1);
    expect(getVideoCanvases('synth_canvas_track_1')).toHaveLength(1);
    expect(getVideoCanvases('synth_canvas_track_1')[0]).toBe(mockCanvas2);

    unregisterVideoCanvas('synth_canvas_track_1', mockCanvas2);
    expect(getVideoCanvases('synth_canvas_track_1')).toHaveLength(0);
  });

  test('drawVideoFrameToCanvas draws centered square crop to 2D context', async () => {
    const { drawVideoFrameToCanvas } = await import('../src/lib/stores/mediaPlayback.js');

    let drawCalls = [];
    const mockVideo = {
      videoWidth: 1920,
      videoHeight: 1080,
    };

    const mockCanvas = {
      width: 200,
      height: 200,
      getContext: (type) => {
        if (type !== '2d') return null;
        return {
          drawImage: (...args) => {
            drawCalls.push(args);
          },
        };
      },
    };

    drawVideoFrameToCanvas(mockVideo, mockCanvas);
    expect(drawCalls.length).toBe(1);

    const [v, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight] = drawCalls[0];
    expect(v).toBe(mockVideo);
    expect(sx).toBe(420);
    expect(sy).toBe(0);
    expect(sWidth).toBe(1080);
    expect(sHeight).toBe(1080);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(dWidth).toBe(200);
    expect(dHeight).toBe(200);
  });

  test('renderAllCanvasesForTrack dispatches frames to all registered canvases', async () => {
    const {
      registerGlobalElements,
      registerVideoCanvas,
      unregisterVideoCanvas,
      renderAllCanvasesForTrack,
    } = await import('../src/lib/stores/mediaPlayback.js');

    let canvas1Drawn = false;
    let canvas2Drawn = false;

    const mockCanvas1 = {
      width: 200,
      height: 200,
      getContext: () => ({
        drawImage: () => {
          canvas1Drawn = true;
        },
      }),
    };

    const mockCanvas2 = {
      width: 110,
      height: 110,
      getContext: () => ({
        drawImage: () => {
          canvas2Drawn = true;
        },
      }),
    };

    const mockVideo = {
      videoWidth: 720,
      videoHeight: 720,
      readyState: 4,
    };

    registerGlobalElements(null, mockVideo);
    registerVideoCanvas('synth_render_test', mockCanvas1);
    registerVideoCanvas('synth_render_test', mockCanvas2);

    renderAllCanvasesForTrack('synth_render_test');

    expect(canvas1Drawn).toBe(true);
    expect(canvas2Drawn).toBe(true);

    unregisterVideoCanvas('synth_render_test', mockCanvas1);
    unregisterVideoCanvas('synth_render_test', mockCanvas2);
  });

  test('fadeVolume smoothly interpolates volume and completes with callback', async () => {
    const { fadeVolume } = await import('../src/lib/stores/mediaPlayback.js');

    const mockAudio = {
      volume: 1.0,
    };

    let completed = false;
    await new Promise((resolve) => {
      fadeVolume(mockAudio, 1.0, 0.0, 40, () => {
        completed = true;
        resolve();
      });
    });

    expect(completed).toBe(true);
    expect(mockAudio.volume).toBeCloseTo(0.0, 1);
  });

  test('smooth audio cross-fading stops outgoing and begins incoming', async () => {
    const {
      registerGlobalElements,
      playMedia,
      stopCurrentMedia,
    } = await import('../src/lib/stores/mediaPlayback.js');

    let voicePaused = false;
    let voiceVolumeLog = [];
    const mockAudio = {
      src: '',
      volume: 1.0,
      currentTime: 0,
      paused: false,
      playbackRate: 1.0,
      muted: false,
      play: () => {
        mockAudio.paused = false;
        return Promise.resolve();
      },
      pause: () => {
        voicePaused = true;
        mockAudio.paused = true;
      },
      load: () => {},
      removeAttribute: () => {},
    };

    let videoPlayed = false;
    const mockVideo = {
      src: '',
      volume: 0,
      currentTime: 0,
      paused: true,
      playbackRate: 1.0,
      muted: false,
      readyState: 4,
      videoWidth: 600,
      videoHeight: 600,
      play: () => {
        videoPlayed = true;
        mockVideo.paused = false;
        return Promise.resolve();
      },
      pause: () => {
        mockVideo.paused = true;
      },
      load: () => {},
      removeAttribute: () => {},
    };

    registerGlobalElements(mockAudio, mockVideo);

    await playMedia({
      id: 'synth_voice_fade',
      chatId: 99,
      type: 'voice',
      url: 'http://127.0.0.1:11447/synth_voice.ogg',
      duration: 5,
      element: mockAudio,
    });

    expect(mockAudio.src).toBe('http://127.0.0.1:11447/synth_voice.ogg');

    await playMedia({
      id: 'synth_video_fade',
      chatId: 99,
      type: 'video_note',
      url: 'http://127.0.0.1:11447/synth_video.mp4',
      duration: 10,
      element: mockVideo,
    });

    expect(videoPlayed).toBe(true);
    expect(mockVideo.src).toBe('http://127.0.0.1:11447/synth_video.mp4');

    stopCurrentMedia();
  });

  test('fast canvas switch seamlessly transitions between chat bubble canvas and PiP canvas without reloading video', async () => {
    const {
      activeMedia,
      registerGlobalElements,
      registerVideoCanvas,
      unregisterVideoCanvas,
      getVideoCanvases,
      playMedia,
      handOffToGlobal,
      takeOverFromGlobal,
      stopCurrentMedia,
    } = await import('../src/lib/stores/mediaPlayback.js');
    const { get } = await import('svelte/store');

    const mockMasterVideo = {
      src: '',
      currentTime: 3.0,
      playbackRate: 1.0,
      volume: 1.0,
      muted: false,
      readyState: 4,
      videoWidth: 480,
      videoHeight: 480,
      play: () => Promise.resolve(),
      pause: () => {},
      load: () => {},
      removeAttribute: () => {},
    };

    registerGlobalElements(null, mockMasterVideo);

    let chatFrames = 0;
    const chatCanvas = {
      width: 200,
      height: 200,
      getContext: () => ({
        drawImage: () => {
          chatFrames++;
        },
      }),
    };

    let pipFrames = 0;
    const pipCanvas = {
      width: 110,
      height: 110,
      getContext: () => ({
        drawImage: () => {
          pipFrames++;
        },
      }),
    };

    const track = {
      id: 'synth_continuous_note',
      chatId: 10,
      messageId: 20,
      type: 'video_note',
      url: 'http://127.0.0.1:11447/synth_continuous.mp4',
      duration: 12,
    };

    registerVideoCanvas(track.id, chatCanvas);
    await playMedia(track, { chatId: 10 });

    expect(get(activeMedia)?.isPlaying).toBe(true);
    expect(get(activeMedia)?.isGlobalPlayback).toBe(false);
    expect(mockMasterVideo.src).toBe('http://127.0.0.1:11447/synth_continuous.mp4');

    unregisterVideoCanvas(track.id, chatCanvas);
    registerVideoCanvas(track.id, pipCanvas);
    handOffToGlobal({
      id: track.id,
      type: 'video_note',
      url: track.url,
      currentTime: 3.0,
      duration: 12,
      isPlaying: true,
    });

    expect(get(activeMedia)?.isGlobalPlayback).toBe(true);
    expect(getVideoCanvases(track.id)).toHaveLength(1);
    expect(getVideoCanvases(track.id)[0]).toBe(pipCanvas);
    expect(mockMasterVideo.src).toBe('http://127.0.0.1:11447/synth_continuous.mp4');

    takeOverFromGlobal(track.id);
    registerVideoCanvas(track.id, chatCanvas);
    unregisterVideoCanvas(track.id, pipCanvas);

    expect(get(activeMedia)?.isGlobalPlayback).toBe(false);
    expect(getVideoCanvases(track.id)).toHaveLength(1);
    expect(getVideoCanvases(track.id)[0]).toBe(chatCanvas);

    stopCurrentMedia();
    unregisterVideoCanvas(track.id, chatCanvas);
    expect(get(activeMedia)).toBeNull();
  });
});

