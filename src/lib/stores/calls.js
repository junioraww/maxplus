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

const initialStubs = typeof window !== 'undefined' && localStorage.getItem('maxplus_call_use_stubs') === 'true';

export const callUseStubs = writable(initialStubs);

export function setCallUseStubs(enabled) {
  callUseStubs.set(Boolean(enabled));
  if (typeof window !== 'undefined') {
    localStorage.setItem('maxplus_call_use_stubs', enabled ? 'true' : 'false');
  }
  patchCallState({ useStubs: Boolean(enabled) });
}

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
  participantStreams: {},
  myCallUserId: null,
  swapped: false,
  ws2Endpoint: null,
  minimized: false,
  errorText: null,
  connectionStatus: null,
  cameraLoading: false,
  peerVideoOn: false,
  peerScreenOn: false,
  useStubs: initialStubs,
};

export const activeCall = writable({ ...INITIAL_STATE });

export function resetCallState() {
  activeCall.set({ ...INITIAL_STATE, useStubs: initialStubs });
}

export function patchCallState(patch) {
  activeCall.update(s => ({ ...s, ...patch }));
}
