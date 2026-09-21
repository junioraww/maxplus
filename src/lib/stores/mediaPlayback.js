import { writable, get } from 'svelte/store';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getAssetUrl, getProxiedMediaUrl } from '$lib/utils/images';

async function getApiInstance() {
  try {
    const mod = await import('$lib/stores/api');
    return mod.default ? get(mod.default) : null;
  } catch {
    return null;
  }
}

export const activeMedia = writable(null);
export const globalSpeed = writable(1.0);
export const globalVolume = writable(1.0);
export const isMuted = writable(false);
export const trackSettings = writable({});
export const mediaPlaylist = writable({ chatId: null, items: [], currentIndex: -1 });
export const showPlaylistModal = writable(false);
export const activeChatMessages = writable([]);

let currentAudioElement = null;
let currentVideoElement = null;
let globalAudioElement = null;
let globalVideoElement = null;

export function registerGlobalElements(audio, video) {
  globalAudioElement = audio;
  globalVideoElement = video;
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
    if (state.element) state.element.playbackRate = finalSpeed;
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
    if (state.element) {
      state.element.volume = clamped;
      state.element.muted = muted;
    }
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
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
    } catch {}
    currentAudioElement = null;
  }
  if (currentVideoElement) {
    try {
      currentVideoElement.pause();
      currentVideoElement.currentTime = 0;
    } catch {}
    currentVideoElement = null;
  }
  if (globalAudioElement) {
    try {
      globalAudioElement.pause();
      globalAudioElement.currentTime = 0;
    } catch {}
  }
  if (globalVideoElement) {
    try {
      globalVideoElement.pause();
      globalVideoElement.currentTime = 0;
    } catch {}
  }
  activeMedia.set(null);
}

export function pauseCurrentMedia() {
  const state = get(activeMedia);
  if (state?.element) {
    try { state.element.pause(); } catch {}
  }
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
  activeMedia.update((s) => (s ? { ...s, isPlaying: true } : null));
  const onErr = () => {
    updateMediaPlaybackState(state.id, false);
  };
  if (state.element) {
    try {
      const p = state.element.play();
      if (p && typeof p.catch === 'function') p.catch(onErr);
    } catch {
      onErr();
    }
  } else if (state.type === 'voice' && globalAudioElement) {
    try {
      const p = globalAudioElement.play();
      if (p && typeof p.catch === 'function') p.catch(onErr);
    } catch {
      onErr();
    }
  } else if (state.type === 'video_note' && globalVideoElement) {
    try {
      const p = globalVideoElement.play();
      if (p && typeof p.catch === 'function') p.catch(onErr);
    } catch {
      onErr();
    }
  }
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
  if (currentVideoElement && currentVideoElement !== element) {
    try { currentVideoElement.pause(); } catch {}
    currentVideoElement = null;
  }
  if (currentAudioElement && currentAudioElement !== element) {
    try { currentAudioElement.pause(); } catch {}
  }
  currentAudioElement = element;
  const speed = getTrackSpeed(id);
  const muted = isTrackMuted(id);
  const vol = muted ? 0 : getTrackVolume(id);

  element.playbackRate = speed;
  element.volume = vol;
  element.muted = muted;

  activeMedia.set({
    id,
    type: 'voice',
    element,
    isPlaying: !element.paused,
    currentTime: element.currentTime || 0,
    duration: element.duration || metadata.duration || 0,
    speed,
    volume: vol,
    muted,
    ...metadata,
  });
}

export function registerVideo(id, element, metadata = {}) {
  if (currentAudioElement && currentAudioElement !== element) {
    try { currentAudioElement.pause(); } catch {}
    currentAudioElement = null;
  }
  if (currentVideoElement && currentVideoElement !== element) {
    try { currentVideoElement.pause(); } catch {}
  }
  currentVideoElement = element;
  const speed = getTrackSpeed(id);
  const muted = isTrackMuted(id);
  const vol = muted ? 0 : getTrackVolume(id);

  element.playbackRate = speed;
  element.volume = vol;
  element.muted = muted;

  activeMedia.set({
    id,
    type: metadata.isNote ? 'video_note' : 'video',
    element,
    isPlaying: !element.paused,
    currentTime: element.currentTime || 0,
    duration: element.duration || metadata.duration || 0,
    speed,
    volume: vol,
    muted,
    ...metadata,
  });
}

export function handOffToGlobal(data) {
  const speed = getTrackSpeed(data.id);
  const muted = isTrackMuted(data.id);
  const vol = muted ? 0 : getTrackVolume(data.id);

  if (data.type === 'video_note') {
    if (currentVideoElement) {
      try { currentVideoElement.pause(); } catch {}
    }
    currentVideoElement = null;
    if (globalVideoElement) {
      const targetTime = data.currentTime || 0;
      const applyState = () => {
        try {
          if (targetTime > 0) globalVideoElement.currentTime = targetTime;
          globalVideoElement.playbackRate = speed;
          globalVideoElement.volume = vol;
          globalVideoElement.muted = muted;
          if (data.isPlaying) {
            globalVideoElement.play().catch(() => {});
          }
        } catch {}
      };

      if (data.url && (!globalVideoElement.src || !globalVideoElement.src.includes(data.url))) {
        globalVideoElement.src = data.url;
        if (globalVideoElement.readyState === undefined || globalVideoElement.readyState >= 1 || typeof globalVideoElement.addEventListener !== 'function') {
          applyState();
        } else {
          globalVideoElement.addEventListener('loadedmetadata', applyState, { once: true });
        }
      } else {
        applyState();
      }
    }
  } else if (data.type === 'voice') {
    if (currentAudioElement) {
      try { currentAudioElement.pause(); } catch {}
    }
    currentAudioElement = null;
    if (globalAudioElement) {
      if (data.url && (!globalAudioElement.src || !globalAudioElement.src.includes(data.url))) {
        globalAudioElement.src = data.url;
      }
      globalAudioElement.currentTime = data.currentTime || 0;
      globalAudioElement.playbackRate = speed;
      globalAudioElement.volume = vol;
      globalAudioElement.muted = muted;
      if (data.isPlaying) {
        globalAudioElement.play().catch(() => {});
      }
    }
  }

  activeMedia.update((s) => ({
    ...(s || {}),
    ...data,
    element: null,
    isGlobalPlayback: true,
    speed,
    volume: vol,
    muted,
  }));
}

export function takeOverFromGlobal(id, element) {
  const state = get(activeMedia);
  if (!state || state.id !== id) return;

  if (state.type === 'video_note') {
    let targetTime = state.currentTime || 0;
    if (globalVideoElement) {
      try {
        if (globalVideoElement.currentTime > 0) {
          targetTime = globalVideoElement.currentTime;
        }
        globalVideoElement.pause();
      } catch {}
    }
    currentVideoElement = element;
    const applyState = () => {
      try {
        if (targetTime > 0) element.currentTime = targetTime;
        element.playbackRate = state.speed || 1.0;
        element.volume = state.muted ? 0 : (state.volume ?? 1.0);
        element.muted = !!state.muted;
        if (state.isPlaying) {
          element.play().catch(() => {});
        }
      } catch {}
    };

    if (state.url && (!element.src || !element.src.includes(state.url))) {
      element.src = state.url;
      if (element.readyState === undefined || element.readyState >= 1 || typeof element.addEventListener !== 'function') {
        applyState();
      } else {
        element.addEventListener('loadedmetadata', applyState, { once: true });
      }
    } else {
      applyState();
    }
  } else if (state.type === 'voice') {
    if (globalAudioElement) {
      try {
        state.currentTime = globalAudioElement.currentTime || state.currentTime;
        globalAudioElement.pause();
      } catch {}
    }
    currentAudioElement = element;
    element.currentTime = state.currentTime || 0;
    element.playbackRate = state.speed || 1.0;
    element.volume = state.muted ? 0 : (state.volume ?? 1.0);
    element.muted = !!state.muted;
    if (state.isPlaying) {
      element.play().catch(() => {});
    }
  }

  activeMedia.update((s) => (s ? { ...s, element, isGlobalPlayback: false } : null));
}

export function updateMediaProgress(id, currentTime, duration) {
  activeMedia.update((state) => {
    if (!state || state.id !== id) return state;
    return {
      ...state,
      currentTime,
      duration: duration || state.duration,
    };
  });
}

export function updateMediaPlaybackState(id, isPlaying) {
  activeMedia.update((state) => {
    if (!state || state.id !== id) return state;
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
  const applySeek = (el) => {
    if (!el) return;
    if (el.readyState === undefined || el.readyState >= 1 || typeof el.addEventListener !== 'function') {
      try { el.currentTime = clampedTime; } catch {}
    } else {
      el.addEventListener('loadedmetadata', () => {
        try { el.currentTime = clampedTime; } catch {}
      }, { once: true });
    }
  };

  if (state.element) {
    applySeek(state.element);
  }
  if (state.type === 'voice' && globalAudioElement) {
    applySeek(globalAudioElement);
  }
  if (state.type === 'video_note' && globalVideoElement) {
    applySeek(globalVideoElement);
  }
  activeMedia.update((s) => (s ? { ...s, currentTime: clampedTime } : null));
}

function toPlayableUrl(path) {
  if (!path) return null;
  return getProxiedMediaUrl(path);
}

export async function resolvePlayableUrl(attach, chatId, messageId) {
  if (!attach) return null;
  if (attach.localPath) {
    return toPlayableUrl(attach.localPath);
  }

  const isVideoNote = (attach.videoType === 1 || attach.isNote || attach._type === 'VIDEO' || attach.type === 'VIDEO');
  const vId = attach.videoId ?? attach.audioId ?? attach.id ?? attach.video_id ?? 0;
  const token = attach.videoToken ?? attach.token ?? null;
  if ((vId || token) && chatId != null && messageId != null) {
    try {
      const api = await getApiInstance();
      const res = await api.getVideoById(chatId, messageId, vId, token);
      const qualityPriority = ['MP4_720', 'MP4_480', 'MP4_360', 'MP4_240', 'MP4_144', 'MP4_1080', 'OGG', 'MP3', 'AUDIO', 'audio', 'EXTERNAL', 'url', 'baseUrl', 'fileUrl'];
      let picked = null;
      for (const q of qualityPriority) {
        if (res && res[q]) { picked = res[q]; break; }
      }
      if (!picked && res && res.HLS) picked = res.HLS;
      if (!picked && res && typeof res === 'object') {
        picked = Object.values(res).find(v => typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://')));
      }
      const mediaType = isVideoNote ? 'video_note' : 'voice';
      if (picked) {
        if (picked.startsWith('http://') || picked.startsWith('https://')) {
          invoke('cache_url', {
            src: picked,
            chatId: chatId != null ? Number(chatId) : null,
            mediaType,
          }).catch(() => {});
        }
        return toPlayableUrl(picked);
      }
    } catch {}
  }

  const mediaType = isVideoNote ? 'video_note' : 'voice';
  const fallback = isVideoNote ? (attach.videoUrl || attach.fileUrl) : (attach.url || attach.fileUrl || attach.baseUrl);
  if (fallback) {
    if (fallback.startsWith('http://') || fallback.startsWith('https://')) {
      invoke('cache_url', {
        src: fallback,
        chatId: chatId != null ? Number(chatId) : null,
        mediaType,
      }).catch(() => {});
    }
    return toPlayableUrl(fallback);
  }
  return null;
}

function parseMediaItems(messages, chatId) {
  if (!messages || !Array.isArray(messages)) return [];
  const items = [];
  for (const m of messages) {
    if (!m) continue;
    if (m.attach && (m.type === 'voice' || m.type === 'video_note')) {
      items.push(m);
      continue;
    }
    if (!m.attaches || !Array.isArray(m.attaches)) continue;
    for (const attach of m.attaches) {
      const type = (attach._type || attach.type || '').toUpperCase();
      const vType = Number(attach.videoType ?? attach.video_type);
      if (type === 'AUDIO' || type === 'VOICE') {
        const dur = attach.duration ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration) : 0;
        const id = String(m.id ?? attach.audioId ?? attach.videoId ?? attach.token ?? Math.random());
        items.push({
          id,
          chatId: chatId ?? m.chatId,
          messageId: m.id,
          type: 'voice',
          duration: dur,
          time: Number(m.time || m.created_at || 0),
          senderName: m.senderName || (m.sender ? String(m.sender) : ''),
          senderId: m.sender,
          attach,
          title: 'Голосовое сообщение',
        });
      } else if (type === 'VIDEO' && (vType === 1 || attach.isNote || attach.videoType === 'VIDEO_NOTE' || attach.is_note)) {
        const dur = attach.duration ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration) : 0;
        const id = String(m.id ?? attach.videoId ?? attach.token ?? Math.random());
        items.push({
          id,
          chatId: chatId ?? m.chatId,
          messageId: m.id,
          type: 'video_note',
          duration: dur,
          time: Number(m.time || m.created_at || 0),
          senderName: m.senderName || (m.sender ? String(m.sender) : ''),
          senderId: m.sender,
          attach,
          title: 'Видеосообщение',
        });
      }
    }
  }
  items.sort((a, b) => (a.time || 0) - (b.time || 0));
  return items;
}

const preloadedMedia = new Map();
const preloadedAudioElements = new Map();

export async function preloadTrack(item) {
  if (!item || !item.id || preloadedMedia.has(item.id)) return;
  try {
    const url = await resolvePlayableUrl(item.attach, item.chatId, item.messageId);
    if (url) {
      preloadedMedia.set(item.id, url);
      if (typeof document !== 'undefined') {
        const el = item.type === 'video_note' ? document.createElement('video') : new Audio();
        el.preload = 'auto';
        el.src = url;
        try { el.load(); } catch {}
        preloadedAudioElements.set(item.id, el);
      }
    }
  } catch {}
}

export async function buildChatPlaylist(chatId, currentMessageId, initialMessages = [], forcedIndex = -1) {
  if (!initialMessages || initialMessages.length === 0) {
    initialMessages = get(activeChatMessages) || [];
  }
  let combined = parseMediaItems(initialMessages, chatId);

  const cur = get(activeMedia);
  if (cur && (cur.chatId === chatId || cur.chatId == null)) {
    if (!combined.some(i => String(i.id) === String(cur.id) || (cur.messageId && String(i.messageId) === String(cur.messageId)))) {
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

  try {
    const api = await getApiInstance();
    if (api && api.getChatMedia) {
      const resp = await api.getChatMedia(chatId, currentMessageId, ['AUDIO', 'VIDEO'], 50, 50);
      const list = (resp && Array.isArray(resp.messages)) ? resp.messages : (Array.isArray(resp) ? resp : []);
      if (list.length > 0) {
        const remote = parseMediaItems(list, chatId);
        const seen = new Set(combined.map(i => `${i.messageId}_${i.type}`));
        for (const it of remote) {
          const key = `${it.messageId}_${it.type}`;
          if (!seen.has(key)) {
            seen.add(key);
            combined.push(it);
          }
        }
        combined.sort((a, b) => (a.time || 0) - (b.time || 0));
      }
    }
  } catch {}

  const prevPl = get(mediaPlaylist);
  const sameItems = prevPl && prevPl.chatId === chatId && prevPl.items &&
    prevPl.items.length === combined.length &&
    prevPl.items.every((it, idx) => String(it.id) === String(combined[idx]?.id));

  let currentIdx;
  if (forcedIndex >= 0 && prevPl?.items?.[forcedIndex]) {
    const forcedId = String(prevPl.items[forcedIndex].id);
    const found = combined.findIndex(i => String(i.id) === forcedId);
    currentIdx = found >= 0 ? found : forcedIndex;
  } else {
    currentIdx = combined.findIndex(
      i => (currentMessageId && String(i.messageId) === String(currentMessageId)) || (cur && String(i.id) === String(cur.id))
    );
    if (currentIdx < 0 && prevPl?.currentIndex >= 0 && (prevPl.chatId === chatId || chatId == null)) {
      currentIdx = prevPl.currentIndex;
    }
  }

  const resolvedItems = sameItems ? prevPl.items : combined;
  const targetIdx = currentIdx >= 0 ? currentIdx : 0;

  mediaPlaylist.set({
    chatId,
    items: resolvedItems,
    currentIndex: targetIdx,
  });

  if (targetIdx + 1 < resolvedItems.length) {
    preloadTrack(resolvedItems[targetIdx + 1]);
  }

  return combined;
}

export async function playMedia(track, playlistContext = {}) {
  const current = get(activeMedia);
  if (current && current.id === track.id) {
    togglePlayPause();
    return;
  }

  let playUrl = track.url || preloadedMedia.get(track.id);
  if (!playUrl && track.attach) {
    playUrl = await resolvePlayableUrl(track.attach, track.chatId, track.messageId);
  }

  if (currentAudioElement && currentAudioElement !== track.element) {
    try {
      currentAudioElement.pause();
      currentAudioElement.currentTime = 0;
    } catch {}
    currentAudioElement = null;
  }
  if (currentVideoElement && currentVideoElement !== track.element) {
    try {
      currentVideoElement.pause();
      currentVideoElement.currentTime = 0;
    } catch {}
    currentVideoElement = null;
  }
  if (track.type !== 'voice' && globalAudioElement) {
    try { globalAudioElement.pause(); } catch {}
  }
  if (track.type !== 'video_note' && globalVideoElement) {
    try { globalVideoElement.pause(); } catch {}
  }

  const speed = getTrackSpeed(track.id);
  const muted = isTrackMuted(track.id);
  const vol = muted ? 0 : getTrackVolume(track.id);

  const newState = {
    ...track,
    url: playUrl,
    speed,
    volume: vol,
    muted,
    isPlaying: true,
    currentTime: 0,
    isGlobalPlayback: !track.element,
  };

  activeMedia.set(newState);

  const onPlayErr = (err) => {
    if (err && err.name === 'AbortError') return;
    updateMediaPlaybackState(track.id, false);
  };

  if (track.type === 'voice' && globalAudioElement && !track.element) {
    if (playUrl) {
      if (!globalAudioElement.src || !globalAudioElement.src.includes(playUrl)) {
        globalAudioElement.src = playUrl;
      }
      globalAudioElement.currentTime = 0;
      globalAudioElement.playbackRate = speed;
      globalAudioElement.volume = vol;
      globalAudioElement.muted = muted;
      try {
        const p = globalAudioElement.play();
        if (p && typeof p.catch === 'function') p.catch(onPlayErr);
      } catch (err) {
        onPlayErr(err);
      }
    }
  } else if (track.element) {
    if (track.type === 'voice') {
      currentAudioElement = track.element;
    } else {
      currentVideoElement = track.element;
    }
    if (playUrl && (!track.element.src || !track.element.src.includes(playUrl))) {
      track.element.src = playUrl;
    }
    track.element.currentTime = 0;
    track.element.playbackRate = speed;
    track.element.volume = vol;
    track.element.muted = muted;
    try {
      const p = track.element.play();
      if (p && typeof p.catch === 'function') p.catch(onPlayErr);
    } catch {
      onPlayErr();
    }
  } else if (track.type === 'video_note' && globalVideoElement) {
    if (playUrl) {
      if (!globalVideoElement.src || !globalVideoElement.src.includes(playUrl)) {
        globalVideoElement.src = playUrl;
      }
      globalVideoElement.currentTime = 0;
      globalVideoElement.playbackRate = speed;
      globalVideoElement.volume = vol;
      globalVideoElement.muted = muted;
      try {
        const p = globalVideoElement.play();
        if (p && typeof p.catch === 'function') p.catch(onPlayErr);
      } catch {
        onPlayErr();
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
  await playMedia(item, { chatId: pl.chatId, messages: pl.items, forcedIndex: index });
}

export async function playNextMedia() {
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
}

export async function playPrevMedia() {
  const pl = get(mediaPlaylist);
  if (!pl || !pl.items || pl.items.length === 0) return;
  const prevIdx = pl.currentIndex - 1;
  if (prevIdx >= 0) {
    await playPlaylistItem(prevIdx);
  }
}
