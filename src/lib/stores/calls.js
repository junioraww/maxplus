import { writable, get } from 'svelte/store';

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

let inMemoryStubs = false;

export const callUseStubs = writable(inMemoryStubs);

export function setCallUseStubs(enabled) {
  inMemoryStubs = Boolean(enabled);
  callUseStubs.set(inMemoryStubs);
  patchCallState({ useStubs: inMemoryStubs });
}

export const callSheetModal = writable(null);

export function openCallSheet(type, data = {}) {
  callSheetModal.set({ type, ...data });
}

export function closeCallSheet() {
  callSheetModal.set(null);
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
  secureIncludesPassword: false,
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
  cameraFacing: 'user',
  hasMultipleCameras: false,
  peerVideoOn: false,
  peerScreenOn: false,
  incomingSecureRequest: null,
  useStubs: inMemoryStubs,
  isRecording: false,
};

export const activeCall = writable({ ...INITIAL_STATE });

export function resetCallState() {
  activeCall.set({ ...INITIAL_STATE, useStubs: get(callUseStubs) });
}

export function patchCallState(patch) {
  activeCall.update(s => ({ ...s, ...patch }));
}
