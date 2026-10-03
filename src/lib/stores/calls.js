import { writable } from 'svelte/store';

export const CALL_PHASE = Object.freeze({
  IDLE: 'idle',
  OUTGOING: 'outgoing',
  INCOMING: 'incoming',
  CONNECTING: 'connecting',
  ACTIVE: 'active',
  ENDING: 'ending',
});

export const CALL_MODE = Object.freeze({
  PLAIN: 'plain',
  SECURE: 'secure',
});

const INITIAL_STATE = {
  phase: CALL_PHASE.IDLE,
  callType: 'audio',
  mode: CALL_MODE.PLAIN,
  conversationId: null,
  peerId: null,
  peerName: null,
  peerAvatar: null,
  isGroup: false,
  roomName: null,
  muted: false,
  videoOn: false,
  screenOn: false,
  speakerOn: false,
  startedAt: null,
  serverTopology: null,
  secureKeyFingerprint: null,
  secureStatus: 'none',
  remoteStream: null,
  localStream: null,
  localCameraStream: null,
  localScreenStream: null,
  participants: [],
  ws2Endpoint: null,
  minimized: false,
  errorText: null,
  connectionStatus: null,
};

export const activeCall = writable({ ...INITIAL_STATE });

export function resetCallState() {
  activeCall.set({ ...INITIAL_STATE });
}

export function patchCallState(patch) {
  activeCall.update(s => ({ ...s, ...patch }));
}
