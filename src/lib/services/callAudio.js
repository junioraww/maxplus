import { get } from 'svelte/store';
import { callSoundEnabled } from '$lib/utils/notifications';

let activeContext = null;
let activeLoopTimer = null;
let currentSoundType = null;

function getOrCreateContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!activeContext || activeContext.state === 'closed') {
    activeContext = new AudioCtx();
  }
  if (activeContext.state === 'suspended') {
    activeContext.resume().catch(() => {});
  }
  return activeContext;
}

function playDualTone(ctx, freq1, freq2, durationSec, startDelaySec = 0, gainLevel = 0.25) {
  const now = ctx.currentTime + startDelaySec;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.type = 'sine';
  osc2.type = 'sine';
  osc1.frequency.setValueAtTime(freq1, now);
  osc2.frequency.setValueAtTime(freq2, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(gainLevel, now + 0.05);
  gain.gain.setValueAtTime(gainLevel, now + durationSec - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + durationSec);
  osc2.stop(now + durationSec);
}

function playChimeNote(ctx, frequency, startDelaySec, durationSec, volume = 0.2) {
  const now = ctx.currentTime + startDelaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequency, now);

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + durationSec);
}

function triggerIncomingPattern(ctx) {
  playChimeNote(ctx, 587.33, 0.0, 0.25, 0.22);
  playChimeNote(ctx, 880.00, 0.12, 0.35, 0.25);
  playChimeNote(ctx, 1174.66, 0.24, 0.45, 0.28);
  playChimeNote(ctx, 880.00, 0.48, 0.3, 0.18);
  playChimeNote(ctx, 1174.66, 0.6, 0.6, 0.25);
}

function triggerOutgoingPattern(ctx) {
  playDualTone(ctx, 425, 425, 1.2, 0, 0.15);
}

export function startIncomingRingtone() {
  if (!get(callSoundEnabled)) return;
  stopCallAudio();
  const ctx = getOrCreateContext();
  if (!ctx) return;
  currentSoundType = 'incoming';
  triggerIncomingPattern(ctx);
  activeLoopTimer = setInterval(() => {
    if (!get(callSoundEnabled)) {
      stopCallAudio();
      return;
    }
    const current = getOrCreateContext();
    if (current) triggerIncomingPattern(current);
  }, 2400);
}

export function startOutgoingRingback() {
  if (!get(callSoundEnabled)) return;
  stopCallAudio();
  const ctx = getOrCreateContext();
  if (!ctx) return;
  currentSoundType = 'outgoing';
  triggerOutgoingPattern(ctx);
  activeLoopTimer = setInterval(() => {
    if (!get(callSoundEnabled)) {
      stopCallAudio();
      return;
    }
    const current = getOrCreateContext();
    if (current) triggerOutgoingPattern(current);
  }, 4000);
}

export function stopCallAudio() {
  if (activeLoopTimer) {
    clearInterval(activeLoopTimer);
    activeLoopTimer = null;
  }
  currentSoundType = null;
  if (activeContext) {
    try {
      activeContext.close().catch(() => {});
    } catch {}
    activeContext = null;
  }
}

export function playRejectionTone() {
  if (!get(callSoundEnabled)) return;
  stopCallAudio();
  const ctx = getOrCreateContext();
  if (!ctx) return;
  playDualTone(ctx, 480, 620, 0.2, 0.0, 0.2);
  playDualTone(ctx, 480, 620, 0.2, 0.3, 0.2);
  playDualTone(ctx, 480, 620, 0.2, 0.6, 0.2);
  setTimeout(() => {
    stopCallAudio();
  }, 950);
}
