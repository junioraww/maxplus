import { writable, get } from 'svelte/store';

export const activeMedia = writable(null);
export const globalSpeed = writable(1.0);
export const globalVolume = writable(1.0);
export const isMuted = writable(false);

export const trackSettings = writable({});

let currentAudioElement = null;
let currentVideoElement = null;
let previousUnmutedVolume = 1.0;

export function snapSpeed(rawSpeed) {
  const clamped = Math.max(0.5, Math.min(4.0, rawSpeed));
  if (Math.abs(clamped - 1.0) <= 0.08) {
    return 1.0;
  }
  return Math.round(clamped * 20) / 20;
}

export function getTrackSpeed(id) {
  const settings = get(trackSettings);
  return settings[id]?.speed ?? 1.0;
}

export function getTrackVolume(id) {
  const settings = get(trackSettings);
  return settings[id]?.volume ?? 1.0;
}

export function isTrackMuted(id) {
  const settings = get(trackSettings);
  return settings[id]?.muted ?? false;
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

  const state = get(activeMedia);
  if (state && state.id === id && state.element) {
    state.element.playbackRate = finalSpeed;
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

  const state = get(activeMedia);
  if (state && state.id === id && state.element) {
    state.element.volume = clamped;
    state.element.muted = muted;
    activeMedia.update(s => s ? { ...s, volume: clamped, muted } : null);
  }
}

export function toggleTrackMute(id) {
  const settings = get(trackSettings);
  const currentMuted = settings[id]?.muted ?? false;
  const currentVol = settings[id]?.volume ?? 1.0;

  if (currentMuted) {
    const restore = currentVol > 0 ? currentVol : 1.0;
    setTrackVolume(id, restore);
  } else {
    setTrackVolume(id, 0.0);
  }
}

export function setPlaybackSpeed(newSpeed) {
  const finalSpeed = snapSpeed(newSpeed);
  globalSpeed.set(finalSpeed);
  if (currentAudioElement) {
    currentAudioElement.playbackRate = finalSpeed;
  }
  if (currentVideoElement) {
    currentVideoElement.playbackRate = finalSpeed;
  }
  activeMedia.update((state) => {
    if (!state) return null;
    return { ...state, speed: finalSpeed };
  });
  return finalSpeed;
}

export function cyclePlaybackSpeed() {
  const cur = get(globalSpeed);
  let next = 1.0;
  if (Math.abs(cur - 0.5) < 0.1) next = 1.0;
  else if (Math.abs(cur - 1.0) < 0.1) next = 1.5;
  else if (Math.abs(cur - 1.5) < 0.1) next = 2.0;
  else if (Math.abs(cur - 2.0) < 0.1) next = 0.5;
  else if (cur < 1.0) next = 1.0;
  else if (cur < 1.5) next = 1.5;
  else if (cur < 2.0) next = 2.0;
  else next = 1.0;
  return setPlaybackSpeed(next);
}

export function setMediaVolume(newVolume) {
  const clamped = Math.max(0.0, Math.min(1.0, newVolume));
  globalVolume.set(clamped);
  if (clamped > 0) {
    isMuted.set(false);
    previousUnmutedVolume = clamped;
  } else {
    isMuted.set(true);
  }
  if (currentAudioElement) {
    currentAudioElement.volume = clamped;
    currentAudioElement.muted = clamped === 0;
  }
  if (currentVideoElement) {
    currentVideoElement.volume = clamped;
    currentVideoElement.muted = clamped === 0;
  }
  activeMedia.update((state) => {
    if (!state) return null;
    return { ...state, volume: clamped, muted: clamped === 0 };
  });
}

export function toggleMediaMute() {
  const currentlyMuted = get(isMuted);
  if (currentlyMuted) {
    const restore = previousUnmutedVolume > 0 ? previousUnmutedVolume : 1.0;
    setMediaVolume(restore);
  } else {
    previousUnmutedVolume = get(globalVolume);
    setMediaVolume(0.0);
  }
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
  activeMedia.set(null);
}

export function pauseCurrentMedia() {
  if (currentAudioElement) {
    try {
      currentAudioElement.pause();
    } catch {}
  }
  if (currentVideoElement) {
    try {
      currentVideoElement.pause();
    } catch {}
  }
  activeMedia.update((state) => {
    if (!state) return null;
    return { ...state, isPlaying: false };
  });
}

export function registerAudio(id, element, metadata = {}) {
  stopCurrentMedia();
  currentAudioElement = element;
  const settings = get(trackSettings)[id];
  const speed = settings?.speed ?? 1.0;
  const muted = settings?.muted ?? false;
  const vol = muted ? 0 : (settings?.volume ?? 1.0);

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
  stopCurrentMedia();
  currentVideoElement = element;
  const settings = get(trackSettings)[id];
  const speed = settings?.speed ?? 1.0;
  const muted = settings?.muted ?? false;
  const vol = muted ? 0 : (settings?.volume ?? 1.0);

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
  if (state && state.id === id && state.element) {
    state.element.currentTime = targetTime;
    activeMedia.update((s) => (s ? { ...s, currentTime: targetTime } : null));
  }
}
