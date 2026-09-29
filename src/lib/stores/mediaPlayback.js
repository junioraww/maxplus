import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { getProxiedMediaUrl } from '$lib/utils/images';
import { getContactDirect } from '$lib/stores/contacts';
import { getCurrentAccount } from '$lib/stores/accounts';

let currentUserStore = null;

if (typeof window !== 'undefined') {
  import('$lib/stores/api').then(mod => {
    if (mod?.currentUser) currentUserStore = mod.currentUser;
  }).catch(() => {});
}

export function setCurrentUserStore(store) {
  currentUserStore = store;
}

async function getApiInstance() {
  try {
    const mod = await import('$lib/stores/api');
    if (mod?.currentUser) currentUserStore = mod.currentUser;
    return mod.default ? get(mod.default) : null;
  } catch {
    return null;
  }
}

export function resolveSenderDisplayName(senderId, fallbackName = '') {
  if (senderId != null) {
    let myId = null;
    try {
      if (currentUserStore) myId = get(currentUserStore);
    } catch {}
    if (myId && Number(senderId) === Number(myId)) {
      return 'Вы';
    }
  }
  if (fallbackName && isNaN(Number(fallbackName)) && fallbackName !== '0') {
    return fallbackName;
  }
  return '';
}

export async function fetchSenderDisplayName(senderId, fallbackName = '') {
  const syncName = resolveSenderDisplayName(senderId, fallbackName);
  if (syncName) return syncName;
  if (!senderId || Number(senderId) <= 0) return fallbackName || 'Чат';
  try {
    const contact = await getContactDirect(senderId);
    if (contact?.names?.[0]) {
      const n = contact.names[0];
      const fullName = `${n.firstName || ''} ${n.lastName || ''}`.trim();
      return fullName || n.name || fallbackName || 'Собеседник';
    }
  } catch {}
  return fallbackName || 'Собеседник';
}

export function getMediaIdentifier(messageId, attach, fallbackType = 'voice') {
  if (messageId != null && messageId !== '') return String(messageId);
  if (!attach) return fallbackType;
  const rawId = attach.audioId ?? attach.videoId ?? attach.id ?? attach.video_id ?? attach.token ?? attach.videoToken ?? attach.localPath;
  return rawId ? String(rawId) : fallbackType;
}

export const activeMedia = writable(null);
export const globalSpeed = writable(1.0);
export const globalVolume = writable(1.0);
export const isMuted = writable(false);
export const trackSettings = writable({});
export const mediaPlaylist = writable({ chatId: null, items: [], currentIndex: -1 });
export const showPlaylistModal = writable(false);
export const activeChatMessages = writable([]);

let globalAudioElement = null;
let globalVideoElement = null;

const activeVideoCanvases = new Map();
let videoCallbackId = null;
let videoRafId = null;
let isAdvancing = false;

export function registerGlobalElements(audio, video) {
  globalAudioElement = audio;
  globalVideoElement = video;
}

export function getGlobalVideoElement() {
  return globalVideoElement;
}

export function drawVideoFrameToCanvas(video, canvas) {
  if (!video || !canvas) return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || vw <= 0 || vh <= 0) return;

  const cw = canvas.width || 200;
  const ch = canvas.height || 200;
  if (cw <= 0 || ch <= 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;

  try {
    ctx.drawImage(video, sx, sy, side, side, 0, 0, cw, ch);
  } catch {}
}

export function renderAllCanvasesForTrack(id) {
  if (!id || !globalVideoElement) return;
  const canvases = activeVideoCanvases.get(String(id));
  if (!canvases || canvases.size === 0) return;
  if (globalVideoElement.readyState < 2 && globalVideoElement.videoWidth <= 0) return;
  for (const canvas of canvases) {
    drawVideoFrameToCanvas(globalVideoElement, canvas);
  }
}

export function registerVideoCanvas(id, canvasEl) {
  if (!id || !canvasEl) return;
  const key = String(id);
  if (!activeVideoCanvases.has(key)) {
    activeVideoCanvases.set(key, new Set());
  }
  activeVideoCanvases.get(key).add(canvasEl);

  const cur = get(activeMedia);
  if (cur && (String(cur.id) === key || String(cur.messageId) === key) && globalVideoElement) {
    if (globalVideoElement.readyState >= 2 || globalVideoElement.videoWidth > 0) {
      drawVideoFrameToCanvas(globalVideoElement, canvasEl);
    }
    if (cur.isPlaying && cur.type === 'video_note' && !videoRafId && !videoCallbackId) {
      startVideoRenderLoop();
    }
  }
}

export function unregisterVideoCanvas(id, canvasEl) {
  if (!id || !canvasEl) return;
  const key = String(id);
  const set = activeVideoCanvases.get(key);
  if (set) {
    set.delete(canvasEl);
    if (set.size === 0) {
      activeVideoCanvases.delete(key);
    }
  }
}

export function getVideoCanvases(id) {
  if (!id) return [];
  const set = activeVideoCanvases.get(String(id));
  return set ? Array.from(set) : [];
}

export function stopVideoRenderLoop() {
  if (typeof cancelAnimationFrame === 'function' && videoRafId !== null) {
    try {
      cancelAnimationFrame(videoRafId);
    } catch {}
  }
  if (globalVideoElement && typeof globalVideoElement.cancelVideoFrameCallback === 'function' && videoCallbackId !== null) {
    try {
      globalVideoElement.cancelVideoFrameCallback(videoCallbackId);
    } catch {}
  }
  videoCallbackId = null;
  videoRafId = null;
}

export function startVideoRenderLoop() {
  stopVideoRenderLoop();
  if (!globalVideoElement) return;

  const onFrame = () => {
    const state = get(activeMedia);
    if (!state || !state.isPlaying || !globalVideoElement) {
      stopVideoRenderLoop();
      return;
    }
    const canvases = activeVideoCanvases.get(String(state.id));
    if (!canvases || canvases.size === 0) {
      stopVideoRenderLoop();
      return;
    }
    renderAllCanvasesForTrack(state.id);
    if (typeof requestAnimationFrame === 'function') {
      videoRafId = requestAnimationFrame(onFrame);
    } else if (typeof globalVideoElement.requestVideoFrameCallback === 'function') {
      videoCallbackId = globalVideoElement.requestVideoFrameCallback(onFrame);
    }
  };

  const curState = get(activeMedia);
  if (!curState || !curState.isPlaying) return;
  const currentCanvases = activeVideoCanvases.get(String(curState.id));
  if (!currentCanvases || currentCanvases.size === 0) return;

  if (typeof requestAnimationFrame === 'function') {
    videoRafId = requestAnimationFrame(onFrame);
  } else if (typeof globalVideoElement.requestVideoFrameCallback === 'function') {
    videoCallbackId = globalVideoElement.requestVideoFrameCallback(onFrame);
  }
}

export function getMasterMediaCurrentTime() {
  const state = get(activeMedia);
  if (!state) return 0;
  if (state.type === 'video_note' && globalVideoElement && typeof globalVideoElement.currentTime === 'number') {
    return globalVideoElement.currentTime;
  }
  if (state.type === 'voice' && globalAudioElement && typeof globalAudioElement.currentTime === 'number') {
    return globalAudioElement.currentTime;
  }
  return state.currentTime || 0;
}

export function snapSpeed(rawSpeed) {
  const clamped = Math.max(0.5, Math.min(4.0, rawSpeed));
  if (Math.abs(clamped - 1.0) <= 0.08) {
    return 1.0;
  }
  return Math.round(clamped * 20) / 20;
}

export function getTrackSpeed(id) {
  const settings = get(trackSettings);
  return settings[id]?.speed ?? get(globalSpeed) ?? 1.0;
}

export function getTrackVolume(id) {
  const settings = get(trackSettings);
  return settings[id]?.volume ?? get(globalVolume) ?? 1.0;
}

export function isTrackMuted(id) {
  const settings = get(trackSettings);
  return settings[id]?.muted ?? get(isMuted) ?? false;
}

export function setTrackSpeed(id, newSpeed) {
  const finalSpeed = snapSpeed(newSpeed);
  trackSettings.update(map => ({
    ...map,
    [id]: {
      ...map[id],
      speed: finalSpeed,
      volume: map[id]?.volume ?? 1.0,
      muted: map[id]?.muted ?? false,
    }
  }));
  globalSpeed.set(finalSpeed);

  const state = get(activeMedia);
  if (state && (state.id === id || !id)) {
    if (globalAudioElement) globalAudioElement.playbackRate = finalSpeed;
    if (globalVideoElement) globalVideoElement.playbackRate = finalSpeed;
    activeMedia.update(s => s ? { ...s, speed: finalSpeed } : null);
  }
  return finalSpeed;
}

export function cycleTrackSpeed(id) {
  const cur = getTrackSpeed(id);
  let next = 1.0;
  if (Math.abs(cur - 0.5) < 0.1) next = 1.0;
  else if (Math.abs(cur - 1.0) < 0.1) next = 1.5;
  else if (Math.abs(cur - 1.5) < 0.1) next = 2.0;
  else if (Math.abs(cur - 2.0) < 0.1) next = 0.5;
  else if (cur < 1.0) next = 1.0;
  else if (cur < 1.5) next = 1.5;
  else if (cur < 2.0) next = 2.0;
  else next = 1.0;

  return setTrackSpeed(id, next);
}

export function setTrackVolume(id, newVolume) {
  const clamped = Math.max(0.0, Math.min(1.0, newVolume));
  const muted = clamped === 0;
  trackSettings.update(map => ({
    ...map,
    [id]: {
      ...map[id],
      speed: map[id]?.speed ?? 1.0,
      volume: clamped,
      muted,
    }
  }));
  globalVolume.set(clamped);
  isMuted.set(muted);

  const state = get(activeMedia);
  if (state && (state.id === id || !id)) {
    if (globalAudioElement) {
      globalAudioElement.volume = clamped;
      globalAudioElement.muted = muted;
    }
    if (globalVideoElement) {
      globalVideoElement.volume = clamped;
      globalVideoElement.muted = muted;
    }
    activeMedia.update(s => s ? { ...s, volume: clamped, muted } : null);
  }
}

export function toggleTrackMute(id) {
  const settings = get(trackSettings);
  const currentMuted = settings[id]?.muted ?? get(isMuted) ?? false;
  const currentVol = settings[id]?.volume ?? get(globalVolume) ?? 1.0;

  if (currentMuted) {
    const restore = currentVol > 0 ? currentVol : 1.0;
    setTrackVolume(id, restore);
  } else {
    setTrackVolume(id, 0.0);
  }
}

export function setPlaybackSpeed(newSpeed) {
  return setTrackSpeed(get(activeMedia)?.id, newSpeed);
}

export function cyclePlaybackSpeed() {
  return cycleTrackSpeed(get(activeMedia)?.id);
}

export function setMediaVolume(newVolume) {
  setTrackVolume(get(activeMedia)?.id, newVolume);
}

export function toggleMediaMute() {
  toggleTrackMute(get(activeMedia)?.id);
}

export function stopCurrentMedia() {
  stopVideoRenderLoop();

  if (globalAudioElement) {
    try {
      globalAudioElement.pause();
      globalAudioElement.currentTime = 0;
      globalAudioElement.removeAttribute('src');
      globalAudioElement.load();
    } catch {}
  }
  if (globalVideoElement) {
    try {
      globalVideoElement.pause();
      globalVideoElement.currentTime = 0;
      globalVideoElement.removeAttribute('src');
      globalVideoElement.load();
    } catch {}
  }

  activeMedia.set(null);
}

export function pauseCurrentMedia() {
  stopVideoRenderLoop();
  if (globalAudioElement) {
    try { globalAudioElement.pause(); } catch {}
  }
  if (globalVideoElement) {
    try { globalVideoElement.pause(); } catch {}
  }
  activeMedia.update((s) => (s ? { ...s, isPlaying: false } : null));
}

export function resumeCurrentMedia() {
  const state = get(activeMedia);
  if (!state) return;

  const speed = getTrackSpeed(state.id);
  const muted = isTrackMuted(state.id);
  const vol = muted ? 0 : getTrackVolume(state.id);
  const target = state.type === 'video_note' ? globalVideoElement : globalAudioElement;

  if (target) {
    target.playbackRate = speed;
    target.volume = vol;
    target.muted = muted;
    const p = target.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        if (err && err.name !== 'AbortError') {
          updateMediaPlaybackState(state.id, false);
        }
      });
    }
    if (state.type === 'video_note') {
      startVideoRenderLoop();
    }
  }

  activeMedia.update((s) => (s ? { ...s, isPlaying: true } : null));
}

export function togglePlayPause() {
  const state = get(activeMedia);
  if (!state) return;
  if (state.isPlaying) {
    pauseCurrentMedia();
  } else {
    resumeCurrentMedia();
  }
}

export function registerAudio(id, element, metadata = {}) {
  const speed = getTrackSpeed(id);
  const muted = isTrackMuted(id);
  const vol = muted ? 0 : getTrackVolume(id);

  activeMedia.set({
    id,
    type: 'voice',
    isPlaying: true,
    currentTime: 0,
    duration: metadata.duration || 0,
    speed,
    volume: vol,
    muted,
    ...metadata,
  });
}

export function registerVideo(id, element, metadata = {}) {
  const speed = getTrackSpeed(id);
  const muted = isTrackMuted(id);
  const vol = muted ? 0 : getTrackVolume(id);

  activeMedia.set({
    id,
    type: metadata.isNote ? 'video_note' : 'video',
    isPlaying: true,
    currentTime: 0,
    duration: metadata.duration || 0,
    speed,
    volume: vol,
    muted,
    ...metadata,
  });
}

export function handOffToGlobal(data = {}) {
  activeMedia.update(s => s ? { ...s, isGlobalPlayback: true } : null);
}

export function takeOverFromGlobal(id, element) {
  activeMedia.update(s => s ? { ...s, isGlobalPlayback: false } : null);
}

export function updateMediaProgress(id, currentTime, duration) {
  activeMedia.update((state) => {
    if (!state || (state.id !== id && String(state.messageId) !== String(id))) return state;
    return {
      ...state,
      currentTime,
      duration: (duration && isFinite(duration) && duration > 0) ? duration : state.duration,
    };
  });
}

export function updateMediaPlaybackState(id, isPlaying) {
  activeMedia.update((state) => {
    if (!state || (state.id !== id && String(state.messageId) !== String(id))) return state;
    return {
      ...state,
      isPlaying,
    };
  });
}

export function seekMedia(id, targetTime) {
  const state = get(activeMedia);
  if (!state) return;
  const clampedTime = Math.max(0, targetTime);
  const target = state.type === 'video_note' ? globalVideoElement : globalAudioElement;

  if (target) {
    try {
      target.currentTime = clampedTime;
    } catch {}
  }
  if (state.type === 'video_note') {
    renderAllCanvasesForTrack(id);
  }

  activeMedia.update((s) => (s ? { ...s, currentTime: clampedTime } : null));
}

function toPlayableUrl(path) {
  if (!path) return null;
  return getProxiedMediaUrl(path);
}

const resolvedUrlCache = new Map();
const inFlightResolutions = new Map();

export async function resolvePlayableUrl(attach, chatId, messageId) {
  if (!attach) return null;
  if (attach.localPath) {
    return toPlayableUrl(attach.localPath);
  }

  if (attach.isEncryptedMedia) {
    const fid = attach.fileId || attach.encryptedAttach?.fileId || attach.id;
    if (fid) {
      const key = `enc_media_${fid}`;
      if (resolvedUrlCache.has(key)) {
        return resolvedUrlCache.get(key);
      }
      try {
        const account = await getCurrentAccount().catch(() => null);
        const accountId = Number(account?.id || 0);
        const cached = await invoke('get_cached_file', {
          account: accountId,
          src: key,
        }).catch(() => null);
        if (cached) {
          attach.localPath = cached;
          const playable = toPlayableUrl(cached);
          resolvedUrlCache.set(key, playable);
          return playable;
        }

        const api = await getApiInstance();
        const fileRes = await api.getFileById(chatId, messageId, fid);
        if (fileRes?.url) {
          const cachedPath = await invoke('cache_encrypted_media', {
            account: accountId,
            chatId: Number(chatId || 0),
            fileId: Number(fid),
            src: fileRes.url,
            password: null,
          });
          if (cachedPath) {
            attach.localPath = cachedPath;
            const playable = toPlayableUrl(cachedPath);
            resolvedUrlCache.set(key, playable);
            return playable;
          }
        }
      } catch {}
    }
    return null;
  }

  const directUrl = attach.url || attach.fileUrl || attach.baseUrl || attach.videoUrl;
  if (directUrl) {
    const playable = toPlayableUrl(directUrl);
    return playable;
  }

  const isVideoNote = (attach.videoType === 1 || attach.isNote || attach._type === 'VIDEO' || attach.type === 'VIDEO');
  const vId = attach.videoId ?? attach.audioId ?? attach.id ?? attach.video_id ?? 0;
  const token = attach.videoToken ?? attach.token ?? null;
  const mediaKey = `${isVideoNote ? 'video_note' : 'voice'}_${chatId ?? 0}_${messageId ?? 0}_${vId || '0'}`;

  if (resolvedUrlCache.has(mediaKey)) {
    return resolvedUrlCache.get(mediaKey);
  }

  if (inFlightResolutions.has(mediaKey)) {
    return await inFlightResolutions.get(mediaKey);
  }

  const resolvePromise = (async () => {
    const account = await getCurrentAccount().catch(() => null);
    const accountId = Number(account?.id || 0);

    try {
      const cached = await invoke('get_cached_file', {
        account: accountId,
        src: mediaKey,
      }).catch(() => null);
      if (cached) {
        attach.localPath = cached;
        const playable = toPlayableUrl(cached);
        resolvedUrlCache.set(mediaKey, playable);
        return playable;
      }
    } catch {}

    const mediaType = isVideoNote ? 'video_note' : 'voice';

    if ((vId || token) && chatId != null && messageId != null) {
      try {
        const api = await getApiInstance();
        const res = await api.getVideoById(chatId, messageId, vId, token);
        const qualityPriority = ['MP4_720', 'MP4_480', 'MP4_360', 'MP4_240', 'MP4_144', 'MP4_1080', 'OGG', 'MP3', 'AUDIO', 'EXTERNAL', 'url', 'baseUrl', 'fileUrl'];
        let picked = null;
        for (const q of qualityPriority) {
          if (res && res[q]) { picked = res[q]; break; }
        }
        if (!picked && res && res.HLS) picked = res.HLS;
        if (!picked && res && typeof res === 'object') {
          picked = Object.values(res).find(v => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://')) && !v.endsWith('.jpg') && !v.endsWith('.png') && !v.endsWith('.webp'));
        }
        if (picked) {
          if (picked.startsWith('http://') || picked.startsWith('https://')) {
            invoke('cache_url', {
              account: accountId,
              src: picked,
              chatId: chatId != null ? Number(chatId) : null,
              mediaType,
              key: mediaKey,
            }).then((cached) => {
              if (cached) {
                attach.localPath = cached;
                resolvedUrlCache.set(mediaKey, toPlayableUrl(cached));
              }
            }).catch(() => {});
          }
          const playable = toPlayableUrl(picked);
          resolvedUrlCache.set(mediaKey, playable);
          return playable;
        }
      } catch {}

      try {
        const api = await getApiInstance();
        if (api && api.getFileById) {
          const fileRes = await api.getFileById(chatId, messageId, vId);
          if (fileRes?.url) {
            const playable = toPlayableUrl(fileRes.url);
            resolvedUrlCache.set(mediaKey, playable);
            return playable;
          }
        }
      } catch {}
    }

    return null;
  })().finally(() => {
    inFlightResolutions.delete(mediaKey);
  });

  inFlightResolutions.set(mediaKey, resolvePromise);
  return await resolvePromise;
}

function parseMediaItems(messages, chatId) {
  if (!messages || !Array.isArray(messages)) return [];
  const items = [];
  for (const m of messages) {
    if (!m) continue;
    if (m.type === 'voice' || m.type === 'video_note') {
      items.push(m);
      continue;
    }
    const attaches = m.attaches || m.attachments || [];
    if (!Array.isArray(attaches)) continue;

    for (const attach of attaches) {
      const type = (attach._type || attach.type || '').toUpperCase();
      const vType = Number(attach.videoType ?? attach.video_type);
      const isVoice = type === 'AUDIO' || type === 'VOICE' || !!attach.audioId || !!attach.wave || !!attach.waveform || attach.mime?.startsWith('audio/') || attach.name?.endsWith('.ogg');
      const isVideoNote = (type === 'VIDEO' && (vType === 1 || attach.isNote || attach.videoType === 'VIDEO_NOTE' || attach.is_note)) || vType === 1 || !!attach.isNote;

      if (isVoice) {
        const dur = attach.duration ? (attach.duration > 1000 ? Math.round(attach.duration / 1000) : attach.duration) : 0;
        const id = getMediaIdentifier(m.id, attach, 'voice');
        const initialSender = resolveSenderDisplayName(m.sender, m.senderName) || (m.senderName && isNaN(Number(m.senderName)) ? m.senderName : 'Собеседник');
        const directUrl = attach.localPath || (!attach.isEncryptedMedia ? (attach.url || attach.fileUrl || attach.baseUrl) : null) || null;
        const item = {
          id,
          chatId: chatId ?? m.chatId,
          messageId: m.id,
          type: 'voice',
          url: directUrl ? toPlayableUrl(directUrl) : null,
          duration: dur,
          time: Number(m.time || m.created_at || 0),
          senderName: initialSender,
          senderId: m.sender,
          attach,
          title: 'Голосовое сообщение',
        };
        items.push(item);
        if (m.sender && (!initialSender || initialSender === 'Собеседник')) {
          fetchSenderDisplayName(m.sender, m.senderName).then(name => {
            if (name && item.senderName !== name) {
              item.senderName = name;
              activeMedia.update(s => (s && s.id === item.id ? { ...s, senderName: name } : s));
            }
          });
        }
      } else if (isVideoNote) {
        const dur = attach.duration ? (attach.duration > 1000 ? Math.round(attach.duration / 1000) : attach.duration) : 0;
        const id = getMediaIdentifier(m.id, attach, 'video_note');
        const initialSender = resolveSenderDisplayName(m.sender, m.senderName) || (m.senderName && isNaN(Number(m.senderName)) ? m.senderName : 'Собеседник');
        const directUrl = attach.localPath || (!attach.isEncryptedMedia ? (attach.videoUrl || attach.fileUrl || attach.url || attach.baseUrl) : null) || null;
        const item = {
          id,
          chatId: chatId ?? m.chatId,
          messageId: m.id,
          type: 'video_note',
          url: directUrl ? toPlayableUrl(directUrl) : null,
          duration: dur,
          time: Number(m.time || m.created_at || 0),
          senderName: initialSender,
          senderId: m.sender,
          attach,
          title: 'Видеосообщение',
        };
        items.push(item);
        if (m.sender && (!initialSender || initialSender === 'Собеседник')) {
          fetchSenderDisplayName(m.sender, m.senderName).then(name => {
            if (name && item.senderName !== name) {
              item.senderName = name;
              activeMedia.update(s => (s && s.id === item.id ? { ...s, senderName: name } : s));
            }
          });
        }
      }
    }
  }
  items.sort((a, b) => (a.time || 0) - (b.time || 0));
  return items;
}

function isSameMedia(item, target) {
  if (!item || !target) return false;
  if (item === target) return true;
  if (item.id && target.id) {
    return String(item.id) === String(target.id);
  }
  if (item.messageId != null && target.messageId != null && String(item.messageId) === String(target.messageId)) {
    const a1 = item.attach;
    const a2 = target.attach;
    if (a1 && a2) {
      const id1 = a1.audioId ?? a1.videoId ?? a1.id ?? a1.video_id ?? a1.token;
      const id2 = a2.audioId ?? a2.videoId ?? a2.id ?? a2.video_id ?? a2.token;
      if (id1 && id2) return String(id1) === String(id2);
      if (a1.localPath && a2.localPath) return a1.localPath === a2.localPath;
    }
    return true;
  }
  return false;
}

const preloadedMedia = new Map();

export async function preloadTrack(item) {
  if (!item || !item.id || preloadedMedia.has(item.id)) return;
  try {
    const url = await resolvePlayableUrl(item.attach, item.chatId, item.messageId);
    if (url) {
      preloadedMedia.set(item.id, url);
    }
  } catch {}
}

export function buildChatPlaylist(chatId, currentMessageId, initialMessages = [], forcedIndex = -1) {
  if (!initialMessages || initialMessages.length === 0) {
    initialMessages = get(activeChatMessages) || [];
  }
  let combined = parseMediaItems(initialMessages, chatId);

  const cur = get(activeMedia);
  if (cur && (cur.chatId === chatId || cur.chatId == null)) {
    if (!combined.some(i => isSameMedia(i, cur))) {
      combined.push({
        id: cur.id,
        chatId: chatId ?? cur.chatId,
        messageId: cur.messageId,
        type: cur.type,
        duration: cur.duration || 0,
        time: cur.time || Date.now(),
        senderName: cur.senderName,
        senderId: cur.senderId,
        attach: cur.attach,
        title: cur.title,
      });
      combined.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
  }

  let targetIdx = -1;
  if (forcedIndex >= 0 && forcedIndex < combined.length) {
    targetIdx = forcedIndex;
  } else {
    targetIdx = combined.findIndex(
      i => (currentMessageId != null && String(i.messageId) === String(currentMessageId)) || (cur && isSameMedia(i, cur))
    );
    if (targetIdx < 0) {
      const prevPl = get(mediaPlaylist);
      if (prevPl?.currentIndex >= 0 && (prevPl.chatId === chatId || chatId == null)) {
        targetIdx = prevPl.currentIndex;
      }
    }
  }
  if (targetIdx < 0) targetIdx = 0;

  mediaPlaylist.set({
    chatId,
    items: combined,
    currentIndex: targetIdx,
  });

  if (targetIdx + 1 < combined.length) {
    preloadTrack(combined[targetIdx + 1]);
  }

  if (forcedIndex < 0) {
    (async () => {
      try {
        const api = await getApiInstance();
        if (api && api.getChatMedia) {
          const resp = await api.getChatMedia(chatId, currentMessageId, ['AUDIO', 'VIDEO'], 50, 50);
          const list = (resp && Array.isArray(resp.messages)) ? resp.messages : (Array.isArray(resp) ? resp : []);
          if (list.length > 0) {
            const remote = parseMediaItems(list, chatId);
            const currentList = get(mediaPlaylist).items || combined;
            let changed = false;
            const merged = [...currentList];
            for (const it of remote) {
              if (!merged.some(m => isSameMedia(m, it))) {
                merged.push(it);
                changed = true;
              }
            }
            if (changed) {
              merged.sort((a, b) => (a.time || 0) - (b.time || 0));
              const activeNow = get(activeMedia);
              const newIdx = activeNow ? merged.findIndex(i => isSameMedia(i, activeNow)) : targetIdx;
              mediaPlaylist.set({
                chatId,
                items: merged,
                currentIndex: newIdx >= 0 ? newIdx : targetIdx,
              });
              if (newIdx >= 0 && newIdx + 1 < merged.length) {
                preloadTrack(merged[newIdx + 1]);
              }
            }
          }
        }
      } catch {}
    })();
  }

  return combined;
}

export async function playMedia(track, playlistContext = {}) {
  const current = get(activeMedia);
  if (current && isSameMedia(current, track) && !playlistContext.forceReload) {
    togglePlayPause();
    return;
  }

  stopVideoRenderLoop();
  if (globalAudioElement) {
    try {
      globalAudioElement.pause();
    } catch {}
  }
  if (globalVideoElement) {
    try {
      globalVideoElement.pause();
    } catch {}
  }

  let playUrl = track.url || preloadedMedia.get(track.id);
  if (!playUrl && track.attach) {
    playUrl = await resolvePlayableUrl(track.attach, track.chatId, track.messageId);
  }

  const speed = getTrackSpeed(track.id);
  const muted = isTrackMuted(track.id);
  const vol = muted ? 0 : getTrackVolume(track.id);

  const targetElement = track.type === 'video_note' ? globalVideoElement : globalAudioElement;
  const otherElement = track.type === 'video_note' ? globalAudioElement : globalVideoElement;

  if (otherElement) {
    try {
      otherElement.pause();
      otherElement.currentTime = 0;
      otherElement.removeAttribute('src');
      otherElement.load();
    } catch {}
  }

  const resolvedSender = resolveSenderDisplayName(track.senderId, track.senderName) ||
    (track.senderName && isNaN(Number(track.senderName)) ? track.senderName : 'Собеседник');

  const newState = {
    ...track,
    senderName: resolvedSender,
    url: playUrl,
    speed,
    volume: vol,
    muted,
    isPlaying: true,
    currentTime: 0,
    duration: track.duration || 0,
    isGlobalPlayback: !!track.isGlobalPlayback,
  };

  activeMedia.set(newState);

  if (track.senderId && (!resolvedSender || resolvedSender === 'Собеседник')) {
    fetchSenderDisplayName(track.senderId, track.senderName).then((name) => {
      if (name) {
        activeMedia.update((s) => (s && s.id === track.id ? { ...s, senderName: name } : s));
      }
    });
  }

  if (targetElement) {
    targetElement.playbackRate = speed;
    targetElement.volume = vol;
    targetElement.muted = muted;

    if (playUrl) {
      const isSameSrc = targetElement.src && (targetElement.src === playUrl || targetElement.src.endsWith(playUrl));
      if (!isSameSrc) {
        targetElement.src = playUrl;
      }
      targetElement.currentTime = 0;

      const attemptPlay = () => {
        const p = targetElement.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (err && err.name !== 'AbortError') {
              updateMediaPlaybackState(track.id, false);
              stopVideoRenderLoop();
            }
          });
        }
      };

      if (isSameSrc && targetElement.readyState >= 2) {
        attemptPlay();
      } else {
        let started = false;
        const onCanPlay = () => {
          if (started) return;
          started = true;
          targetElement.removeEventListener('canplay', onCanPlay);
          targetElement.removeEventListener('loadeddata', onCanPlay);
          attemptPlay();
        };
        targetElement.addEventListener('canplay', onCanPlay, { once: true });
        targetElement.addEventListener('loadeddata', onCanPlay, { once: true });
        attemptPlay();
      }

      if (track.type === 'video_note') {
        startVideoRenderLoop();
        renderAllCanvasesForTrack(track.id);
      }
    } else {
      updateMediaPlaybackState(track.id, false);
      if (isAdvancing) {
        playNextMedia();
      }
    }
  }

  const effectiveChatId = playlistContext.chatId ?? track.chatId;
  if (effectiveChatId != null) {
    const listMessages = (playlistContext.messages && playlistContext.messages.length > 0)
      ? playlistContext.messages
      : (get(activeChatMessages) || []);
    buildChatPlaylist(
      effectiveChatId,
      track.messageId,
      listMessages,
      playlistContext.forcedIndex ?? -1,
    );
  }

  const pl = get(mediaPlaylist);
  if (pl && pl.items && pl.currentIndex >= 0 && pl.currentIndex + 1 < pl.items.length) {
    preloadTrack(pl.items[pl.currentIndex + 1]);
  }
}

export async function playPlaylistItem(index) {
  const pl = get(mediaPlaylist);
  if (!pl || !pl.items || index < 0 || index >= pl.items.length) return;
  const item = pl.items[index];
  mediaPlaylist.update(p => ({ ...p, currentIndex: index }));
  await playMedia(item, { chatId: pl.chatId, messages: pl.items, forcedIndex: index, forceReload: true });
}

export async function playNextMedia() {
  if (isAdvancing) return;
  isAdvancing = true;
  try {
    const pl = get(mediaPlaylist);
    if (!pl || !pl.items || pl.items.length === 0) {
      stopCurrentMedia();
      return;
    }
    const nextIdx = pl.currentIndex + 1;
    if (nextIdx < pl.items.length) {
      await playPlaylistItem(nextIdx);
    } else {
      stopCurrentMedia();
    }
  } finally {
    isAdvancing = false;
  }
}

export async function playPrevMedia() {
  const pl = get(mediaPlaylist);
  if (!pl || !pl.items || pl.items.length === 0) return;
  const prevIdx = pl.currentIndex - 1;
  if (prevIdx >= 0) {
    await playPlaylistItem(prevIdx);
  }
}
