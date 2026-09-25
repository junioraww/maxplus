import { writable, get } from 'svelte/store';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getAssetUrl, getProxiedMediaUrl } from '$lib/utils/images';
import { getContactDirect } from '$lib/stores/contacts';
import { currentUser } from '$lib/stores/api';
import { getCurrentAccount } from '$lib/stores/accounts';

async function getApiInstance() {
  try {
    const mod = await import('$lib/stores/api');
    return mod.default ? get(mod.default) : null;
  } catch {
    return null;
  }
}

export function resolveSenderDisplayName(senderId, fallbackName = '') {
  if (senderId != null) {
    const myId = get(currentUser);
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

const activeVideoCanvases = new Map();
const activeAudioFades = new Set();
const playingAudioElements = new Set();

let videoCallbackId = null;
let videoRafId = null;

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
  if (cur && String(cur.id) === key && globalVideoElement) {
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

export function fadeVolume(element, fromVol, toVol, durationMs = 160, onDone = null) {
  if (!element) {
    if (onDone) onDone();
    return () => {};
  }

  const startVal = Math.max(0, Math.min(1, fromVol));
  const endVal = Math.max(0, Math.min(1, toVol));
  const startTime = Date.now();

  try {
    element.volume = startVal;
  } catch {}

  let timerId = null;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    if (timerId) clearInterval(timerId);
    activeAudioFades.delete(cancel);
  };
  activeAudioFades.add(cancel);

  timerId = setInterval(() => {
    if (cancelled) return;
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1, elapsed / Math.max(1, durationMs));
    const currentVol = startVal + (endVal - startVal) * progress;
    try {
      element.volume = Math.max(0, Math.min(1, currentVol));
    } catch {}

    if (progress >= 1) {
      clearInterval(timerId);
      activeAudioFades.delete(cancel);
      if (onDone) onDone();
    }
  }, 16);

  return cancel;
}

function fadeOutAndStop(el, durationMs = 160, keepSrc = false) {
  if (!el) return;
  const curVol = (typeof el.volume === 'number') ? el.volume : 1.0;
  if (curVol <= 0.01 || el.paused) {
    try {
      el.pause();
      if (!keepSrc) {
        el.currentTime = 0;
        el.removeAttribute('src');
        el.load();
      }
    } catch {}
    playingAudioElements.delete(el);
    return;
  }

  fadeVolume(el, curVol, 0, durationMs, () => {
    try {
      el.pause();
      if (!keepSrc) {
        el.currentTime = 0;
        el.removeAttribute('src');
        el.load();
      }
    } catch {}
    playingAudioElements.delete(el);
  });
}

function fadeInAndPlay(el, targetVolume, durationMs = 160, onPlayErr = null) {
  if (!el) return;
  playingAudioElements.add(el);
  if (targetVolume <= 0) {
    try {
      el.volume = 0;
      el.muted = true;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(onPlayErr || (() => {}));
    } catch (err) {
      if (onPlayErr) onPlayErr(err);
    }
    return;
  }

  try {
    el.volume = 0;
    el.muted = false;
    const p = el.play();
    const handleStartFade = () => {
      fadeVolume(el, 0, targetVolume, durationMs);
    };
    if (p && typeof p.then === 'function') {
      p.then(handleStartFade).catch(onPlayErr || (() => {}));
    } else {
      handleStartFade();
    }
  } catch (err) {
    if (onPlayErr) onPlayErr(err);
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
  if (state.element && typeof state.element.currentTime === 'number') {
    return state.element.currentTime;
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
  stopVideoRenderLoop();
  for (const cancel of activeAudioFades) {
    cancel();
  }
  activeAudioFades.clear();

  const allElements = new Set([
    currentAudioElement,
    currentVideoElement,
    globalAudioElement,
    globalVideoElement,
    ...playingAudioElements,
  ]);

  for (const el of allElements) {
    if (el) {
      try {
        el.pause();
        el.currentTime = 0;
        el.removeAttribute('src');
        el.load();
      } catch {}
    }
  }

  currentAudioElement = null;
  currentVideoElement = null;
  playingAudioElements.clear();
  activeMedia.set(null);
}

export function pauseCurrentMedia() {
  const state = get(activeMedia);
  stopVideoRenderLoop();
  for (const cancel of activeAudioFades) {
    cancel();
  }
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
    stopVideoRenderLoop();
  };

  const speed = getTrackSpeed(state.id);
  const muted = isTrackMuted(state.id);
  const vol = muted ? 0 : getTrackVolume(state.id);

  let target = state.element;
  if (!target) {
    target = state.type === 'voice' ? globalAudioElement : globalVideoElement;
  }

  if (target) {
    target.playbackRate = speed;
    fadeInAndPlay(target, vol, 160, onErr);
    if (state.type === 'video_note') {
      startVideoRenderLoop();
    }
  } else {
    if (state.type === 'voice' && globalAudioElement) {
      globalAudioElement.playbackRate = speed;
      fadeInAndPlay(globalAudioElement, vol, 160, onErr);
    } else if (state.type === 'video_note' && globalVideoElement) {
      globalVideoElement.playbackRate = speed;
      fadeInAndPlay(globalVideoElement, vol, 160, onErr);
      startVideoRenderLoop();
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

export function handOffToGlobal(data = {}) {
  const speed = getTrackSpeed(data.id);
  const muted = isTrackMuted(data.id);
  const vol = muted ? 0 : getTrackVolume(data.id);

  if (data.type === 'video_note') {
    if (globalVideoElement) {
      const isAlreadyPlayingSame = Boolean(
        (data.id && globalVideoElement.dataset.trackId === String(data.id)) ||
        (data.url && globalVideoElement.src && globalVideoElement.src.includes(data.url))
      );

      if (data.id) {
        globalVideoElement.dataset.trackId = String(data.id);
      }

      if (!isAlreadyPlayingSame && data.url) {
        const targetTime = data.currentTime || 0;
        const applyState = () => {
          try {
            if (targetTime > 0) globalVideoElement.currentTime = targetTime;
            globalVideoElement.playbackRate = speed;
            globalVideoElement.volume = vol;
            globalVideoElement.muted = muted;
            if (data.isPlaying) {
              globalVideoElement.play().catch(() => {});
              startVideoRenderLoop();
            }
          } catch {}
        };

        globalVideoElement.src = data.url;
        if (globalVideoElement.readyState >= 1 || typeof globalVideoElement.addEventListener !== 'function') {
          applyState();
        } else {
          globalVideoElement.addEventListener('loadedmetadata', applyState, { once: true });
        }
      } else {
        globalVideoElement.playbackRate = speed;
        globalVideoElement.volume = vol;
        globalVideoElement.muted = muted;
        if (data.isPlaying && globalVideoElement.paused) {
          globalVideoElement.play().catch(() => {});
        }
        startVideoRenderLoop();
      }
    }
  } else if (data.type === 'voice') {
    if (currentAudioElement && currentAudioElement !== globalAudioElement) {
      try {
        currentAudioElement.pause();
      } catch {}
    }
    if (globalAudioElement) {
      const isAlreadyPlayingSame = Boolean(
        data.url && globalAudioElement.src && globalAudioElement.src.includes(data.url)
      );
      if (!isAlreadyPlayingSame && data.url) {
        globalAudioElement.src = data.url;
        globalAudioElement.currentTime = data.currentTime || 0;
      }
      globalAudioElement.playbackRate = speed;
      globalAudioElement.volume = vol;
      globalAudioElement.muted = muted;
      if (data.isPlaying && globalAudioElement.paused) {
        globalAudioElement.play().catch(() => {});
      }
    }
  }

  activeMedia.update((s) => ({
    ...(s || {}),
    ...data,
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
    renderAllCanvasesForTrack(id);
    if (globalVideoElement && state.isPlaying) {
      startVideoRenderLoop();
    }
  } else if (state.type === 'voice') {
    if (element && element !== globalAudioElement) {
      const isElementReady = element.src && (element.src.includes(state.url) || element.readyState >= 1);
      if (!isElementReady) {
        activeMedia.update((s) => (s ? { ...s, isGlobalPlayback: false } : null));
        return;
      }
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
      if (state.isPlaying && typeof element.play === 'function') {
        element.play().catch(() => {});
      }
    }
  }

  activeMedia.update((s) => (s ? { ...s, element: element || s.element, isGlobalPlayback: false } : null));
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
      } catch (e) {
        console.error('Failed to resolve encrypted playable url:', e);
      }
    }
    return null;
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
    } catch (_) {}

    const mediaType = isVideoNote ? 'video_note' : 'voice';
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
    }

    const fallback = isVideoNote ? (attach.videoUrl || attach.fileUrl) : (attach.url || attach.fileUrl || attach.baseUrl);
    if (fallback) {
      if (fallback.startsWith('http://') || fallback.startsWith('https://')) {
        invoke('cache_url', {
          account: accountId,
          src: fallback,
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
      const playable = toPlayableUrl(fallback);
      resolvedUrlCache.set(mediaKey, playable);
      return playable;
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
        const id = String(m.id || attach.audioId || attach.videoId || attach.token || attach.localPath || Math.random());
        const initialSender = resolveSenderDisplayName(m.sender, m.senderName) || (m.senderName && isNaN(Number(m.senderName)) ? m.senderName : 'Собеседник');
        const item = {
          id,
          chatId: chatId ?? m.chatId,
          messageId: m.id,
          type: 'voice',
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
      } else if (type === 'VIDEO' && (vType === 1 || attach.isNote || attach.videoType === 'VIDEO_NOTE' || attach.is_note)) {
        const dur = attach.duration ? (attach.duration > 120 ? attach.duration / 1000 : attach.duration) : 0;
        const id = String(m.id || attach.videoId || attach.token || attach.audioId || attach.localPath || Math.random());
        const initialSender = resolveSenderDisplayName(m.sender, m.senderName) || (m.senderName && isNaN(Number(m.senderName)) ? m.senderName : 'Собеседник');
        const item = {
          id,
          chatId: chatId ?? m.chatId,
          messageId: m.id,
          type: 'video_note',
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

  const speed = getTrackSpeed(track.id);
  const muted = isTrackMuted(track.id);
  const vol = muted ? 0 : getTrackVolume(track.id);

  let targetElement = null;
  if (track.type === 'voice') {
    targetElement = globalAudioElement || track.element;
  } else if (track.type === 'video_note') {
    targetElement = globalVideoElement || track.element;
  } else {
    targetElement = track.element || globalVideoElement;
  }

  const candidatesToStop = new Set([
    currentAudioElement,
    currentVideoElement,
    globalAudioElement,
    globalVideoElement,
    ...playingAudioElements,
  ]);

  for (const el of candidatesToStop) {
    if (el && el !== targetElement) {
      fadeOutAndStop(el, 160);
    }
  }

  if (track.type === 'voice') {
    currentAudioElement = targetElement;
    currentVideoElement = null;
  } else {
    currentVideoElement = targetElement;
    currentAudioElement = null;
  }

  const hasCanvases = track.type === 'video_note' && activeVideoCanvases.has(String(track.id)) && activeVideoCanvases.get(String(track.id)).size > 0;
  const isGlobal = track.isGlobalPlayback !== undefined ? !!track.isGlobalPlayback : (track.element ? false : (track.type === 'video_note' ? !hasCanvases : true));

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
    element: targetElement,
    isGlobalPlayback: isGlobal,
  };

  activeMedia.set(newState);

  if (track.senderId && (!resolvedSender || resolvedSender === 'Собеседник')) {
    fetchSenderDisplayName(track.senderId, track.senderName).then((name) => {
      if (name) {
        activeMedia.update((s) => (s && s.id === track.id ? { ...s, senderName: name } : s));
      }
    });
  }

  const onPlayErr = (err) => {
    if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
    updateMediaPlaybackState(track.id, false);
    stopVideoRenderLoop();
  };

  if (targetElement) {
    const isSameTrack = (targetElement.dataset?.trackId === String(track.id)) ||
      (playUrl && targetElement.src && targetElement.src.includes(playUrl));

    if (targetElement.dataset) {
      targetElement.dataset.trackId = String(track.id);
    }

    if (!isSameTrack && playUrl) {
      targetElement.src = playUrl;
      targetElement.currentTime = 0;
    }
    targetElement.playbackRate = speed;

    const triggerPlay = () => {
      fadeInAndPlay(targetElement, vol, 160, onPlayErr);
    };

    if (targetElement.readyState >= 1) {
      triggerPlay();
    } else {
      let started = false;
      const onReady = () => {
        if (started) return;
        started = true;
        targetElement.removeEventListener('loadedmetadata', onReady);
        targetElement.removeEventListener('canplay', onReady);
        triggerPlay();
      };
      targetElement.addEventListener('loadedmetadata', onReady, { once: true });
      targetElement.addEventListener('canplay', onReady, { once: true });
      setTimeout(onReady, 250);
    }

    if (track.type === 'video_note') {
      startVideoRenderLoop();
      if (typeof targetElement.addEventListener === 'function') {
        const renderOnce = () => {
          renderAllCanvasesForTrack(track.id);
        };
        targetElement.addEventListener('loadeddata', renderOnce, { once: true });
        targetElement.addEventListener('canplay', renderOnce, { once: true });
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
