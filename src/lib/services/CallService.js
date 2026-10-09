import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { activeCall, patchCallState, resetCallState, CALL_PHASE, CALL_MODE, callUseStubs } from '$lib/stores/calls.js';
import { CallEncryptionSession, generateCallKeyPair, exportPublicKeyBytes, deriveSharedSecret } from '$lib/crypto/callEncryption.js';
import { mediaPipeline } from '$lib/services/MediaPipelineHost.js';
import { showAlert } from '$lib/utils/alert.js';
import { currentUser, currentSessionChats } from '$lib/stores/api.js';
import { startIncomingRingtone, startOutgoingRingback, stopCallAudio, playRejectionTone } from '$lib/services/callAudio.js';
import { showDesktopCallNotification, cancelDesktopCallNotification } from '$lib/utils/notifications.js';
import { getContactDirect } from '$lib/stores/contacts.js';
import { NativeRustPeerConnection } from '$lib/services/NativeRustPeerConnection.js';
import { createSyntheticAudioStream, createSyntheticVideoStream } from '$lib/utils/mediaFallback.js';

import { platform } from '@tauri-apps/plugin-os';

let isLinuxClient = false;
try {
  isLinuxClient = platform() === 'linux';
} catch {
  isLinuxClient = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent || navigator.platform || '') && !/android/i.test(navigator.userAgent || '');
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

const WS2_VERSION = '5';
const WS2_CAPABILITIES = '3c02f';
const INTERNAL_PARAMS_PLATFORM = 'ANDROID';
const INTERNAL_PARAMS_SDK = '0.2.1.3';
const CLIENT_APP_KEY = 'CGPGAGLGDIHBABABA';
const DEFAULT_OS_VERSION = '34';
const DEFAULT_DEVICE = 'Android/Unknown';

const OFFER_CONSTRAINTS = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true,
};

const ICE_DEFAULTS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

function log(...args) {
  const sanitized = args.map(arg => {
    if (typeof arg === 'string') {
      return arg.replace(/([?&]token=)[^&]+/gi, '$1[REDACTED]');
    }
    return arg;
  });
  console.log('[call]', ...sanitized);
}

function labelLocalTracks(sdp, userId, cameraTrackId, screenTrackId) {
  if (!sdp || !userId) return sdp;
  const prefix = `u${userId}`;
  let result = sdp;
  if (cameraTrackId) {
    const escaped = cameraTrackId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result
      .replace(new RegExp(`^a=msid:(\\S+) ${escaped}\\s*$`, 'gm'), `a=msid:$1 ${prefix}:sCAMERA`)
      .replace(new RegExp(`^(a=ssrc:\\d+ msid:\\S+) ${escaped}\\s*$`, 'gm'), `$1 ${prefix}:sCAMERA`)
      .replace(new RegExp(`^(a=ssrc:\\d+ label:)${escaped}\\s*$`, 'gm'), `$1${prefix}:sCAMERA`);
    if (!result.includes(`${prefix}:sCAMERA`)) {
      const lines = result.split('\n');
      let inVideo = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('m=')) {
          inVideo = line.startsWith('m=video');
        } else if (inVideo) {
          if (line.startsWith('a=msid:')) {
            lines[i] = line.replace(/^a=msid:(\S+)\s+\S+/, `a=msid:$1 ${prefix}:sCAMERA`);
          } else if (line.startsWith('a=ssrc:') && line.includes(' msid:')) {
            lines[i] = line.replace(/^(a=ssrc:\d+\s+msid:\S+)\s+\S+/, `$1 ${prefix}:sCAMERA`);
          } else if (line.startsWith('a=ssrc:') && line.includes(' label:')) {
            lines[i] = line.replace(/^(a=ssrc:\d+\s+label:)\S+/, `$1${prefix}:sCAMERA`);
          }
        }
      }
      result = lines.join('\n');
    }
  }
  if (screenTrackId) {
    const escaped = screenTrackId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result
      .replace(new RegExp(`^a=msid:(\\S+) ${escaped}\\s*$`, 'gm'), `a=msid:$1 ${prefix}:sSCREEN`)
      .replace(new RegExp(`^(a=ssrc:\\d+ msid:\\S+) ${escaped}\\s*$`, 'gm'), `$1 ${prefix}:sSCREEN`)
      .replace(new RegExp(`^(a=ssrc:\\d+ label:)${escaped}\\s*$`, 'gm'), `$1${prefix}:sSCREEN`);
    if (!result.includes(`${prefix}:sSCREEN`)) {
      const lines = result.split('\n');
      let inVideo = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('m=')) {
          inVideo = line.startsWith('m=video');
        } else if (inVideo) {
          if (line.startsWith('a=msid:')) {
            lines[i] = line.replace(/^a=msid:(\S+)\s+\S+/, `a=msid:$1 ${prefix}:sSCREEN`);
          } else if (line.startsWith('a=ssrc:') && line.includes(' msid:')) {
            lines[i] = line.replace(/^(a=ssrc:\d+\s+msid:\S+)\s+\S+/, `$1 ${prefix}:sSCREEN`);
          } else if (line.startsWith('a=ssrc:') && line.includes(' label:')) {
            lines[i] = line.replace(/^(a=ssrc:\d+\s+label:)\S+/, `$1${prefix}:sSCREEN`);
          }
        }
      }
      result = lines.join('\n');
    }
  }
  return result;
}

function encodeDisplayLayout(trackKeys) {
  const parts = [];
  parts.push(0x94, 0x00, 0x00, 0x01, 0xc3);
  if (!trackKeys.length) {
    parts.push(0xc0);
  } else {
    const total = trackKeys.length * 2;
    if (total < 16) {
      parts.push(0x90 | total);
    } else {
      parts.push(0xdc, (total >> 8) & 0xff, total & 0xff);
    }
    for (const key of trackKeys) {
      const keyBytes = new TextEncoder().encode(key);
      if (keyBytes.length < 32) {
        parts.push(0xa0 | keyBytes.length);
      } else {
        parts.push(0xd9, keyBytes.length);
      }
      for (let i = 0; i < keyBytes.length; i++) parts.push(keyBytes[i]);
      parts.push(0x00, 0xc0, 0xcd, (640 >> 8) & 0xff, 640 & 0xff, 0xcd, (360 >> 8) & 0xff, 360 & 0xff, 0x00);
    }
  }
  parts.push(0xc0);
  return new Uint8Array(parts);
}

function sanitizeSdpBundle(sdp) {
  return sdp;
}

function extractVideoSlotMids(sdp) {
  if (!sdp) return new Set();
  const mids = new Set();
  let kind = null;
  let mid = null;
  let recvOnly = false;
  const flush = () => {
    if (kind === 'video' && recvOnly && mid) mids.add(mid);
  };
  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('m=')) {
      flush();
      kind = line.substring(2).split(/\s+/)[0];
      mid = null;
      recvOnly = false;
    } else if (line.startsWith('a=mid:')) {
      mid = line.substring(6).trim();
    } else if (line === 'a=recvonly') {
      recvOnly = true;
    }
  }
  flush();
  return mids;
}

function getRTCPeerConnection() {
  if (isLinuxClient) {
    return NativeRustPeerConnection;
  }
  if (typeof window !== 'undefined') {
    const pc = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (pc) return pc;
  }
  if (typeof globalThis !== 'undefined') {
    const pc = globalThis.RTCPeerConnection || globalThis.webkitRTCPeerConnection;
    if (pc) return pc;
  }
  return NativeRustPeerConnection;
}

function getRTCSessionDescription() {
  if (typeof window !== 'undefined') {
    const sd = window.RTCSessionDescription || window.webkitRTCSessionDescription;
    if (sd) return sd;
  }
  if (typeof globalThis !== 'undefined') {
    const sd = globalThis.RTCSessionDescription;
    if (sd) return sd;
  }
  return class MockSessionDescription {
    constructor(init = {}) {
      this.type = init.type || 'offer';
      this.sdp = init.sdp || '';
    }
  };
}

function getRTCIceCandidate() {
  if (typeof window !== 'undefined') {
    const ic = window.RTCIceCandidate || window.webkitRTCIceCandidate;
    if (ic) return ic;
  }
  if (typeof globalThis !== 'undefined') {
    const ic = globalThis.RTCIceCandidate;
    if (ic) return ic;
  }
  return class MockIceCandidate {
    constructor(init = {}) {
      this.candidate = init.candidate || '';
      this.sdpMid = init.sdpMid || '0';
      this.sdpMLineIndex = init.sdpMLineIndex ?? 0;
    }
  };
}

class VoiceChannel {
  #socket = null;
  #pendingRequests = new Map();
  #seq = 1;
  #listeners = new Map();
  #onClose = null;

  connect(url, onClose) {
    this.#onClose = onClose;
    log('[call:ws2:connect]', url);
    this.#socket = new WebSocket(url);

    this.#socket.onmessage = (e) => {
      const dataStr = typeof e.data === 'string' ? e.data.trim() : '';
      if (dataStr === 'ping') {
        try {
          this.#socket?.send('pong');
        } catch {}
        return;
      }
      if (dataStr === 'pong') {
        return;
      }
      try {
        const parsed = JSON.parse(e.data);
        this.#dispatch(parsed);
      } catch (err) {
        log('[call:ws2:parse-error]', err, e.data);
      }
    };

    this.#socket.onclose = (ev) => {
      log('[call:ws2:close]', ev.code, ev.reason);
      if (ev.code !== 1000 && ev.reason) {
        patchCallState({ errorText: ev.reason });
      }
      onClose?.();
    };

    this.#socket.onerror = (ev) => {
      log('[call:ws2:error]', ev);
      onClose?.();
    };

    return new Promise((resolve, reject) => {
      this.#socket.onopen = () => {
        log('[call:ws2:open]');
        resolve();
      };
      setTimeout(() => reject(new Error('ws2 connect timeout')), 10000);
    });
  }

  #dispatch(msg) {
    const seq = msg.sequence;
    if (seq != null && this.#pendingRequests.has(seq)) {
      const { resolve, reject } = this.#pendingRequests.get(seq);
      this.#pendingRequests.delete(seq);
      if (msg.type === 'error' || msg.error) {
        reject(new Error(msg.message || msg.error || 'Server error'));
        return;
      }
      resolve(msg);
      return;
    }

    const name = msg.notification || msg.type;
    log(`[call:ws2:recv] ${name ?? 'NO-TYPE'}`, msg);

    if (msg.type === 'error' || msg.error) {
      const errorMsg = msg.message || msg.error || 'Server error';
      if (errorMsg === 'conversation-ended' || msg.error === 'conversation-ended') {
        log('[call:ws2:conversation-ended]');
        this.destroy();
        return;
      }
      log('[call:ws2:server-error]', errorMsg);
      patchCallState({ errorText: errorMsg });
      showAlert(errorMsg);
    }

    if (name) {
      for (const fn of (this.#listeners.get(name) || [])) fn(msg);
      for (const fn of (this.#listeners.get('*') || [])) fn(msg);
    }
  }

  send(cmd, extra = {}) {
    const seq = this.#seq++;
    const msg = { command: cmd, sequence: seq, ...extra };
    log(`[call:ws2:send] ${cmd}`, msg);
    this.#socket.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.#pendingRequests.set(seq, { resolve, reject });
      setTimeout(() => {
        if (this.#pendingRequests.has(seq)) {
          this.#pendingRequests.delete(seq);
          reject(new Error(`ws2 timeout: ${cmd}`));
        }
      }, 15000);
    });
  }

  sendQuiet(cmd, extra = {}) {
    try {
      if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
        const seq = this.#seq++;
        this.#socket.send(JSON.stringify({ command: cmd, sequence: seq, ...extra }));
      }
    } catch {}
  }

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
    return () => {
      const arr = this.#listeners.get(event);
      if (arr) this.#listeners.set(event, arr.filter(f => f !== fn));
    };
  }

  close() {
    this.#pendingRequests.forEach(({ reject }) => reject(new Error('channel closed')));
    this.#pendingRequests.clear();
    this.#listeners.clear();
    this.#socket?.close();
    this.#socket = null;
  }
}

function parseParticipant(raw) {
  return {
    id: String(raw.userId || raw.id || ''),
    name: raw.name || raw.displayName || raw.firstName || '',
    avatar: raw.avatarUrl || raw.photo || raw.avatar || null,
    muted: raw.isAudioEnabled === false || raw.isMicrophoneEnabled === false,
    videoOn: Boolean(raw.isVideoEnabled),
    screenOn: Boolean(raw.isScreenSharingEnabled),
    speaking: false,
  };
}

class MaxCallSession {
  #voiceChannel = null;
  #pc = null;
  #dataChannel = null;
  #sfuCommandChannel = null;
  #sfuNotificationChannel = null;
  #slotParticipants = new Map();
  #localStream = null;
  #cameraStream = null;
  #screenStream = null;
  #encryption = new CallEncryptionSession();
  #destroyed = false;
  #conversationId = null;
  #contactPeerId = null;
  #ws2PeerId = null;
  #peerType = 'USER';
  #peerDeviceIdx = 0;
  #pendingOffer = false;
  #pendingLocalCandidates = [];
  #allLocalCandidates = [];
  #syntheticAudio = null;
  #syntheticVideo = null;
  #myCallUserId = null;
  #topology = null;
  #iceServers = ICE_DEFAULTS;
  #pendingCandidates = [];
  #remoteDescSet = false;
  #role = null;
  #sfuSessionId = null;
  #dtlsFingerprint = null;
  #localDtlsFingerprint = null;
  #remoteDtlsFingerprint = null;
  #androidScreenCapture = null;
  #unlistenScreenCaptureStopped = null;
  #cameraToggling = false;
  #remoteStream = null;
  #participantStreams = new Map();
  #signalQueue = Promise.resolve();
  #iceRestarting = false;
  #isSfuPc = false;

  get encryption() { return this.#encryption; }

  #applyTrackLabels(sdp) {
    const isScreen = Boolean(get(activeCall).screenOn);
    const isVideo = Boolean(get(activeCall).videoOn);
    const camTrack = this.#cameraStream?.getVideoTracks()[0]?.id || (isLinuxClient && isVideo && !isScreen ? 'camera0' : null);
    const scrTrack = this.#screenStream?.getVideoTracks()[0]?.id || (isLinuxClient && isScreen ? 'camera0' : null);
    return labelLocalTracks(sdp, this.#myCallUserId, camTrack, scrTrack);
  }

  #onSfuSlots(slots) {
    if (!slots || typeof slots !== 'object') return;
    for (const [key, slot] of Object.entries(slots)) {
      if (typeof slot !== 'number' || slot < 0) continue;
      const match = key.split(':')[0].match(/^u?(\d+)/);
      if (match) {
        this.#slotParticipants.set(Number(slot), String(match[1]));
      }
    }
  }

  async #prepareVideoSlot(pc, offerSdp) {
    const mids = extractVideoSlotMids(offerSdp);
    if (!mids || mids.size === 0 || !pc || typeof pc.getTransceivers !== 'function') return;
    const transceivers = pc.getTransceivers();
    for (const tr of transceivers) {
      if (!mids.has(tr.mid)) continue;
      const track = this.#cameraStream?.getVideoTracks()[0];
      if (track) {
        try {
          await tr.sender?.replaceTrack(track);
        } catch {}
      }
      try {
        if (typeof tr.setDirection === 'function') {
          await tr.setDirection('sendonly');
        } else {
          tr.direction = 'sendonly';
        }
      } catch {}
      return;
    }
  }

  #sendSfuDisplayLayout() {
    if (!this.#sfuCommandChannel || this.#sfuCommandChannel.readyState !== 'open') return;
    const participants = get(activeCall).participants || [];
    const keys = [];
    for (const p of participants) {
      if (p.videoOn || p.screenOn) {
        keys.push(`u${p.id}:${p.screenOn ? 'sSCREEN' : 'sCAMERA'}`);
      }
    }
    try {
      const bytes = encodeDisplayLayout(keys);
      this.#sfuCommandChannel.send(bytes);
    } catch {}
  }

  async begin({ endpoint, conversationId, role, isVideo, mode, peerId = null, convParams = null }) {
    this.#conversationId = conversationId;
    this.#role = role;
    this.#contactPeerId = peerId;
    this.#pendingOffer = role === 'originator';
    this.#pendingLocalCandidates = [];
    this.#allLocalCandidates = [];
    let myCallUserId = null;
    try {
      const parsedUrl = new URL(endpoint);
      myCallUserId = parsedUrl.searchParams.get('userId');
    } catch {}
    if (!myCallUserId && convParams?.turnUser) {
      const parts = String(convParams.turnUser).split(':');
      if (parts.length > 0) {
        myCallUserId = parts[parts.length - 1];
      }
    }
    if (!myCallUserId) {
      const curUser = get(currentUser);
      const uid = curUser?.id ?? curUser?.userId ?? (typeof curUser === 'number' || typeof curUser === 'string' ? curUser : null);
      if (uid) myCallUserId = String(uid);
    }
    this.#myCallUserId = myCallUserId ? String(myCallUserId) : null;
    patchCallState({ myCallUserId: this.#myCallUserId });
    if (convParams) {
      const parsedIce = this.#parseIceServers(convParams);
      if (parsedIce.length) {
        this.#iceServers = parsedIce;
      }
    }
    log(`begin session: role=${role} isVideo=${isVideo} mode=${mode} convId=${conversationId} myCallUserId=${myCallUserId}`);

    if (role === 'responder') {
      patchCallState({ phase: CALL_PHASE.CONNECTING, connectionStatus: 'connecting' });
    }

    try {
      this.#unlistenScreenCaptureStopped = await listen('screen_capture_stopped', () => {
        if (get(activeCall).screenOn) {
          this.enableScreen(false);
        }
      });
    } catch {}

    await this.#encryption.initPlain();

    let isAutoSecure = false;
    const targetPeerId = peerId || this.#contactPeerId;
    if (mode === CALL_MODE.SECURE && targetPeerId) {
      const secret = await this.#resolveSharedSecret(targetPeerId);
      if (secret) {
        await this.#encryption.initFromChatSecret(secret, conversationId, role === 'originator');
        isAutoSecure = true;
        patchCallState({
          mode: CALL_MODE.SECURE,
          secureStatus: 'active',
          secureKeyFingerprint: this.#encryption.fingerprint,
        });
        await this.#syncEncryptionToMedia();
      }
    }

    if (!isAutoSecure && mode === CALL_MODE.SECURE) {
      patchCallState({
        mode: CALL_MODE.SECURE,
        secureStatus: 'pending',
        secureKeyFingerprint: null,
      });
      setTimeout(() => {
        if (this.#encryption.mode !== 'secure' && get(activeCall).mode === CALL_MODE.SECURE && get(activeCall).secureStatus === 'pending') {
          patchCallState({ secureStatus: 'unsupported' });
        }
      }, 15000);
    }

    await this.#captureMedia(isVideo);
    await this.#openVoiceChannel(endpoint);
  }

  async #resolveSharedSecret(peerId) {
    if (!peerId && !this.#contactPeerId) return null;
    try {
      const account = await getCurrentAccount().catch(() => null);
      if (!account?.id) return null;
      const user = get(currentUser);
      const myUid = user?.id || user?.userId || (typeof user === 'number' || typeof user === 'string' ? user : null);
      const candidates = new Set();
      if (peerId) candidates.add(Number(peerId));
      if (this.#contactPeerId) candidates.add(Number(this.#contactPeerId));
      const activePeer = get(activeCall).peerId;
      if (activePeer) candidates.add(Number(activePeer));
      if (myUid && peerId) {
        try {
          candidates.add(Number(BigInt(peerId) ^ BigInt(myUid)));
        } catch {}
      }
      if (myUid && this.#contactPeerId) {
        try {
          candidates.add(Number(BigInt(this.#contactPeerId) ^ BigInt(myUid)));
        } catch {}
      }
      const chats = get(currentSessionChats) || [];
      for (const c of chats) {
        if (!c?.id) continue;
        const cid = Number(c.id);
        if (c.type === 'DIALOG' || c.type === 'private') {
          if (c.participants && Object.keys(c.participants).some(p => String(p) === String(peerId) || String(p) === String(this.#contactPeerId))) {
            candidates.add(cid);
          }
          if (c.owner && (String(c.owner) === String(peerId) || String(c.owner) === String(this.#contactPeerId))) {
            candidates.add(cid);
          }
          if (c.userId && (String(c.userId) === String(peerId) || String(c.userId) === String(this.#contactPeerId))) {
            candidates.add(cid);
          }
          if (String(c.id) === String(peerId) || String(c.id) === String(this.#contactPeerId)) {
            candidates.add(cid);
          }
        }
      }

      for (const cid of candidates) {
        if (!cid) continue;
        const settings = await invoke('get_chat_settings', {
          account: Number(account.id),
          chatId: cid,
        }).catch(() => null);
        const secret = settings?.session?.shared_secret || settings?.keys?.current;
        if (secret) return secret;
      }
    } catch {}
    return null;
  }

  async #sendE2eKey(targetPeerId, isReply = false) {
    const myId = String(this.#myCallUserId || get(currentUser)?.id || '');
    if (!targetPeerId || String(targetPeerId) === myId) return;
    if (!this._keyPair) {
      this._keyPair = await generateCallKeyPair();
      this._myPublicKeyBytes = await exportPublicKeyBytes(this._keyPair);
    }
    if (this.#dataChannel && this.#dataChannel.readyState === 'open') {
      try {
        this.#dataChannel.send(JSON.stringify({
          type: isReply ? 'e2e_key_reply' : 'e2e_key',
          pubKey: Array.from(this._myPublicKeyBytes),
        }));
      } catch {}
    }
  }

  async enableSecureMode() {
    try {
      if (this.#encryption.mode === CALL_MODE.SECURE && this.#encryption.fingerprint) {
        showAlert('E2E шифрование активно. Код: ' + this.#encryption.fingerprint);
        return;
      }

      const myId = String(this.#myCallUserId || get(currentUser)?.id || '');
      const participants = get(activeCall).participants || [];
      const remoteParticipant = participants.find(p => String(p.id) !== myId);
      const targetPeerId = (this.#contactPeerId && String(this.#contactPeerId) !== myId ? this.#contactPeerId : null)
        || (get(activeCall).peerId && String(get(activeCall).peerId) !== myId ? get(activeCall).peerId : null)
        || (this.#ws2PeerId && String(this.#ws2PeerId) !== myId ? this.#ws2PeerId : null)
        || (remoteParticipant ? String(remoteParticipant.id) : null);

      if (targetPeerId) {
        const secret = await this.#resolveSharedSecret(targetPeerId);
        if (secret) {
          await this.#encryption.initFromChatSecret(secret, this.#conversationId, this.#role === 'originator');
          await this.#syncEncryptionToMedia();
          patchCallState({
            mode: CALL_MODE.SECURE,
            secureStatus: 'active',
            secureKeyFingerprint: this.#encryption.fingerprint,
          });
          showAlert('E2E шифрование установлено. Код: ' + this.#encryption.fingerprint);
          return;
        }
      }

      if (this.#pc) {
        if (!this.#localDtlsFingerprint && this.#pc.localDescription?.sdp) {
          this.#extractAndApplyFingerprint(this.#pc.localDescription.sdp, true);
        }
        if (!this.#remoteDtlsFingerprint && this.#pc.remoteDescription?.sdp) {
          this.#extractAndApplyFingerprint(this.#pc.remoteDescription.sdp, false);
        }
      }

      const fps = [this.#localDtlsFingerprint, this.#remoteDtlsFingerprint].filter(Boolean).sort();
      if (fps.length > 0) {
        const seedStr = `${fps.join('|')}|${this.#conversationId || 'default'}`;
        const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seedStr));
        const hashBytes = new Uint8Array(hashBuf);
        const hex = Array.from(hashBytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const code = hex.match(/.{4}/g)?.join('-') || hex;
        await this.#encryption.initSecure(hashBytes, this.#role === 'originator');
        patchCallState({
          mode: CALL_MODE.SECURE,
          secureStatus: 'active',
          secureKeyFingerprint: code,
        });
        showAlert('E2E шифрование установлено. Код: ' + code);
        return;
      }

      patchCallState({ mode: CALL_MODE.SECURE, secureStatus: 'pending', secureKeyFingerprint: null });
      showAlert('Запрос на установку E2E шифрования отправлен...');
    } catch (e) {
      log('enableSecureMode error:', e);
      showAlert('Не удалось включить E2E шифрование');
    }
  }

  #setupDataChannel(dc) {
    if (!dc) return;
    if (dc.label === 'producerCommand') {
      this.#sfuCommandChannel = dc;
      dc.onopen = () => {
        this.#sendSfuDisplayLayout();
      };
      return;
    }
    if (dc.label === 'producerNotification') {
      this.#sfuNotificationChannel = dc;
      dc.onmessage = (event) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
          const data = JSON.parse(raw);
          if (data?.slots) {
            this.#onSfuSlots(data.slots);
          }
        } catch {}
      };
      return;
    }
    this.#dataChannel = dc;

    dc.onopen = async () => {
      log('Data channel open:', dc.label);
      if (get(activeCall).mode === CALL_MODE.SECURE && this.#encryption.mode !== 'secure') {
        const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
        if (targetPeerId) {
          await this.#sendE2eKey(targetPeerId, false);
        }
      }
    };

    dc.onmessage = async (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
        const data = JSON.parse(raw);
        const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
        if (data.type === 'e2e_key' && Array.isArray(data.pubKey)) {
          log('Received e2e_key over data channel');
          await this.#handlePeerPublicKey(new Uint8Array(data.pubKey), false, targetPeerId);
        } else if (data.type === 'e2e_key_reply' && Array.isArray(data.pubKey)) {
          log('Received e2e_key_reply over data channel');
          await this.#handlePeerPublicKey(new Uint8Array(data.pubKey), true, targetPeerId);
        }
      } catch {}
    };
  }

  async #handlePeerPublicKey(peerPubBytes, isReply = false, targetPeerId = null) {
    try {
      if (!this._keyPair) {
        this._keyPair = await generateCallKeyPair();
        this._myPublicKeyBytes = await exportPublicKeyBytes(this._keyPair);
      }
      const secret = await deriveSharedSecret(this._keyPair.privateKey, peerPubBytes);
      const myId = String(this.#myCallUserId || get(currentUser)?.id || '');
      const isOriginator = this.#role ? this.#role === 'originator' : (String(myId) < String(targetPeerId || ''));
      await this.#encryption.initSecure(secret, isOriginator);
      await this.#syncEncryptionToMedia();
      patchCallState({
        mode: CALL_MODE.SECURE,
        secureStatus: 'active',
        secureKeyFingerprint: this.#encryption.fingerprint,
      });
      showAlert('E2E шифрование установлено. Код: ' + this.#encryption.fingerprint);

      if (!isReply) {
        const destId = targetPeerId || this.#ws2PeerId || this.#contactPeerId;
        if (destId) {
          await this.#sendE2eKey(destId, true);
        }
      }
    } catch (err) {
      log('Failed to handle peer public key:', err);
    }
  }

  async #syncEncryptionToMedia() {
    if (!this.#encryption || this.#encryption.mode !== 'secure') return;
    if (isLinuxClient) return;
    if (this.#pc && typeof this.#pc.setEncryptionKeys === 'function') {
      await this.#pc.setEncryptionKeys(this.#encryption.getExportedKeys());
    }
    if (this.#pc) {
      if (typeof this.#pc.getSenders === 'function') {
        for (const sender of this.#pc.getSenders()) {
          const kind = sender.track?.kind || 'audio';
          this.#encryption.applyToSender(sender, kind);
        }
      }
      if (typeof this.#pc.getReceivers === 'function') {
        for (const receiver of this.#pc.getReceivers()) {
          const kind = receiver.track?.kind || 'audio';
          this.#encryption.applyToReceiver(receiver, kind);
        }
      }
    }
  }

  #embedLocalCandidates(sdp) {
    return sdp;
  }

  async #retransmitAllLocalCandidates() {}

  #extractAndApplyFingerprint(sdp, isLocal = false) {
    if (!sdp) return;
    const m = sdp.match(/^a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/m);
    if (!m) return;
    const fp = m[1];
    this.#dtlsFingerprint = fp;
    if (isLocal) {
      this.#localDtlsFingerprint = fp;
    } else {
      this.#remoteDtlsFingerprint = fp;
    }
  }

  #formatFingerprintCode(fp) {
    if (!fp) return null;
    const clean = fp.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    const hex = clean.slice(0, 16);
    return hex.match(/.{4}/g)?.join('-') || hex;
  }

  async #openVoiceChannel(endpoint) {
    const ch = new VoiceChannel();
    this.#voiceChannel = ch;
    const url = this.#buildWs2Url(endpoint);
    await ch.connect(url, () => this.#onChannelLost());

    ch.on('connection', (msg) => this.#onConnection(msg));
    ch.on('producer-updated', (msg) => this.#onProducerUpdated(msg));
    ch.on('transmitted-data', (msg) => this.#onRemoteSignal(msg));
    ch.on('registered-peer', (msg) => this.#onRegisteredPeer(msg));
    ch.on('accepted-call', (msg) => this.#onAcceptedCall(msg));
    ch.on('hungup', (msg) => {
      log('hungup', msg);
      if (get(activeCall).phase === CALL_PHASE.OUTGOING || get(activeCall).phase === CALL_PHASE.INCOMING) {
        playRejectionTone();
      }
      const pid = String(msg.participantId || msg.participant?.id || '');
      if (pid === String(this.#myCallUserId)) {
        this.destroy();
        return;
      }
      if (!get(activeCall).isGroup) {
        this.destroy();
        return;
      }
      const cur = get(activeCall).participants.filter(p => p.id !== pid);
      patchCallState({ participants: cur });
    });
    ch.on('closed-conversation', () => {
      log('closed-conversation');
      this.destroy();
    });
    ch.on('media-settings-changed', (msg) => this.#onPeerMedia(msg));
    ch.on('topology-changed', (msg) => this.#onTopologyChanged(msg));

    ch.on('participant-joined', (msg) => this.#onParticipantJoined(msg));
    ch.on('participant-added', (msg) => this.#onParticipantJoined(msg));
    ch.on('participant-left', (msg) => this.#onParticipantLeft(msg));
    ch.on('participant-removed', (msg) => this.#onParticipantLeft(msg));
    ch.on('session-state', (msg) => this.#onSessionState(msg));
    ch.on('participants-state-changed', (msg) => this.#onSessionState(msg));
  }

  #onRegisteredPeer(msg) {
    const pid = msg.participantId || msg.userId || msg.id;
    if (pid && String(pid) !== String(this.#myCallUserId)) {
      this.#ws2PeerId = String(pid);
      this.#transmitPendingOffer();
    }
  }

  #onCallActivated() {
    patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: get(activeCall).startedAt || Date.now() });
    if (get(activeCall).mode === CALL_MODE.SECURE && this.#encryption.mode !== 'secure') {
      this.enableSecureMode().catch(() => {});
    }
  }

  #onAcceptedCall(msg) {
    log('accepted-call received');
    stopCallAudio();
    this.#onCallActivated();
    const pid = msg.participantId || msg.userId || msg.id;
    if (pid && String(pid) !== String(this.#myCallUserId)) {
      this.#ws2PeerId = String(pid);
      this.#transmitPendingOffer();
    }
  }

  async #rebuildSfuPc() {
    log('Rebuilding RTCPeerConnection for SFU');
    if (this.#sfuCommandChannel) {
      try { this.#sfuCommandChannel.close(); } catch {}
      this.#sfuCommandChannel = null;
    }
    if (this.#dataChannel) {
      try { this.#dataChannel.close(); } catch {}
      this.#dataChannel = null;
    }
    if (this.#pc) {
      try { await this.#pc.close(); } catch {}
      this.#pc = null;
    }
    this.#remoteDescSet = false;
    this.#pendingCandidates = [];
    this.#pendingLocalCandidates = [];

    const pc = await this.#buildPeerConnection();
    this.#isSfuPc = true;
    return pc;
  }

  async #onTopologyChanged(msg) {
    const topo = msg.topology;
    if (!topo) return;
    log('topology-changed ->', topo);
    const switchingToSfu = topo === 'SERVER' && this.#topology !== 'SERVER';
    this.#topology = topo;
    if (switchingToSfu) {
      patchCallState({ phase: CALL_PHASE.ACTIVE });
      if (this.#pc && !this.#isSfuPc) {
        await this.#rebuildSfuPc();
      }
      if (this.#pc && typeof this.#pc.createDataChannel === 'function') {
        try {
          const cmdDc = this.#pc.createDataChannel('producerCommand', { ordered: true });
          this.#setupDataChannel(cmdDc);
        } catch {}
        try {
          const notifDc = this.#pc.createDataChannel('producerNotification', { ordered: true });
          this.#setupDataChannel(notifDc);
        } catch {}
      }
      await this.#voiceChannel?.send('allocate-consumer', {
        capabilities: {
          maxH264Decoders: 10,
          producerNotificationDataChannelVersion: 7,
          producerCommandDataChannelVersion: 2,
          audioMix: true,
          consumerUpdate: true,
          onDemandTracks: true,
          singleSession: true,
          unifiedPlan: true,
          fastScreenShare: true,
          consumerFastScreenShareQualityOnDemand: true,
          red: true,
          videoTracksCount: 10,
          csrcAccessible: true,
        },
      }).catch(() => {});
    }
  }

  async #transmitPendingOffer() {
    if (!this.#pendingOffer || !this.#ws2PeerId || !this.#pc?.localDescription) return;
    const sdp = sanitizeSdpBundle(this.#applyTrackLabels(this.#pc.localDescription.sdp));
    if (!sdp || typeof sdp !== 'string' || !sdp.trim().startsWith('v=')) return;
    this.#pendingOffer = false;
    try {
      await this.#voiceChannel?.send('transmit-data', {
        participantId: Number(this.#ws2PeerId),
        participantType: this.#peerType || 'USER',
        deviceIdx: this.#peerDeviceIdx ?? 0,
        data: {
          sdp: {
            type: this.#pc.localDescription.type || 'offer',
            sdp,
          },
        },
        capabilities: WS2_CAPABILITIES,
      });
      await this.#flushPendingLocalCandidates();
    } catch (err) {
      log('Failed to transmit pending offer:', err);
    }
  }

  async #flushPendingLocalCandidates() {
    const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
    if (!targetPeerId || !this.#voiceChannel) return;
    for (const cand of this.#pendingLocalCandidates) {
      await this.#voiceChannel.send('transmit-data', {
        participantId: Number(targetPeerId),
        participantType: this.#peerType || 'USER',
        deviceIdx: this.#peerDeviceIdx ?? 0,
        data: {
          candidate: {
            candidate: cand.candidate,
            sdpMid: cand.sdpMid,
            sdpMLineIndex: cand.sdpMLineIndex ?? 0,
          },
        },
        capabilities: WS2_CAPABILITIES,
      }).catch((err) => {
        log('Failed to flush local candidate:', err?.message || err);
      });
    }
    this.#pendingLocalCandidates = [];
  }

  #buildWs2Url(endpoint) {
    try {
      const u = new URL(endpoint);
      u.searchParams.set('version', WS2_VERSION);
      u.searchParams.set('capabilities', WS2_CAPABILITIES);
      u.searchParams.set('platform', INTERNAL_PARAMS_PLATFORM);
      u.searchParams.set('clientType', 'ONE_ME');
      u.searchParams.set('appVersion', `sdk-${INTERNAL_PARAMS_SDK}`);
      u.searchParams.set('osVersion', DEFAULT_OS_VERSION);
      u.searchParams.set('device', DEFAULT_DEVICE);
      u.searchParams.set('tgt', 'start');
      const built = u.toString();
      log('ws2 url generated:', built);
      return built;
    } catch {
      return endpoint;
    }
  }

  async #captureMedia(isVideo) {
    try {
      try {
        this.#localStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        this.#localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      mediaPipeline.setSourceTracks(null, this.#localStream.getAudioTracks()[0]);
      patchCallState({ localStream: this.#localStream });
    } catch (e) {
      log('getUserMedia audio unavailable, using synthetic fallback:', e.name, e.message);
      try {
        this.#syntheticAudio = createSyntheticAudioStream();
        this.#localStream = this.#syntheticAudio.stream;
        mediaPipeline.setSourceTracks(null, this.#localStream.getAudioTracks()[0]);
        patchCallState({ localStream: this.#localStream });
      } catch (err) {
        log('synthetic audio failed:', err);
        patchCallState({ muted: true, localStream: null });
      }
    }

    if (isVideo) {
      await this.enableCamera(true);
    }
  }

  async #buildPeerConnection() {
    if (this.#pc) return this.#pc;
    const PeerConnection = getRTCPeerConnection();
    if (!PeerConnection) {
      const err = new Error('WebRTC (RTCPeerConnection) не поддерживается в данном окружении');
      log(err.message);
      patchCallState({ errorText: err.message, connectionStatus: 'failed' });
      showAlert(err.message);
      throw err;
    }

    log(`[call:pc:create] instantiating RTCPeerConnection (${PeerConnection.name || 'Anonymous'}), iceServers:`, this.#iceServers);
    const isVideo = get(activeCall).callType === 'video' || Boolean(this.#cameraStream);
    const useStubs = Boolean(get(activeCall).useStubs);
    const pc = new PeerConnection({
      iceServers: this.#iceServers,
      sdpSemantics: 'unified-plan',
      bundlePolicy: 'balanced',
      rtcpMuxPolicy: 'require',
      ...(this.#encryption.mode === CALL_MODE.SECURE ? { encodedInsertableStreams: true } : {}),
      isAudio: true,
      isVideo,
      useStubs,
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        log('[call:ice:local-candidate]', e.candidate.candidate);
        this.#allLocalCandidates.push(e.candidate);
        const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
        if (this.#topology !== 'SERVER' && targetPeerId && !this.#pendingOffer) {
          this.#voiceChannel?.send('transmit-data', {
            participantId: Number(targetPeerId),
            participantType: this.#peerType || 'USER',
            deviceIdx: this.#peerDeviceIdx ?? 0,
            data: {
              candidate: {
                candidate: e.candidate.candidate,
                sdpMid: e.candidate.sdpMid,
                sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0,
              },
            },
            capabilities: WS2_CAPABILITIES,
          }).catch((err) => {
            log('[call:ice:transmit-error]', err?.message || err);
          });
        } else if (this.#topology !== 'SERVER') {
          this.#pendingLocalCandidates.push(e.candidate);
        }
      } else {
        log('[call:ice:gathering-complete]');
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      log('[call:ice:state]', state);
      patchCallState({ connectionStatus: state });
      this.#checkActive(pc);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log('[call:pc:state]', state);
      patchCallState({ connectionStatus: state });
      this.#checkActive(pc);
    };

    if (typeof pc.addEventListener === 'function') {
      pc.addEventListener('firstvideoframe', () => {
        patchCallState({ peerVideoOn: true });
      });
    }

    pc.ontrack = (e) => {
      const track = e.track;
      log(`[call:media:track-recv] kind=${track.kind} id=${track.id} readyState=${track.readyState} enabled=${track.enabled} muted=${track.muted}`);
      track.onmute = () => {
        log(`[call:media:track-muted] ${track.kind} ${track.id}`);
      };
      track.onunmute = () => {
        log(`[call:media:track-unmuted] ${track.kind} ${track.id}`);
      };
      if (!this.#remoteStream) {
        this.#remoteStream = new MediaStream();
      }
      const existing = this.#remoteStream.getTracks().find(t => t.id === track.id || t.kind === track.kind);
      if (existing) {
        this.#remoteStream.removeTrack(existing);
      }
      this.#remoteStream.addTrack(track);

      track.onended = () => {
        log(`[call:media:track-ended] ${track.kind} ${track.id}`);
        if (this.#remoteStream) {
          this.#remoteStream.removeTrack(track);
          patchCallState({ remoteStream: new MediaStream(this.#remoteStream.getTracks()) });
        }
      };

      const unified = new MediaStream(this.#remoteStream.getTracks());
      patchCallState({ remoteStream: unified });

      const targetId = this.#resolveParticipantIdFromTrack(track.id) || this.#ws2PeerId || this.#contactPeerId;
      if (targetId) {
        let pStream = this.#participantStreams.get(String(targetId));
        if (!pStream) {
          pStream = new MediaStream();
          this.#participantStreams.set(String(targetId), pStream);
        }
        const ex = pStream.getTracks().find(t => t.id === track.id || t.kind === track.kind);
        if (ex) pStream.removeTrack(ex);
        pStream.addTrack(track);
        const streams = {
          ...get(activeCall).participantStreams,
          [String(targetId)]: new MediaStream(pStream.getTracks()),
        };
        patchCallState({ participantStreams: streams });
      }

      if (this.#encryption.mode === CALL_MODE.SECURE) {
        this.#encryption.applyToReceiver(e.receiver, track.kind || 'audio');
      }
    };

    const audioTracks = this.#localStream?.getAudioTracks() || [];
    if (audioTracks.length > 0) {
      for (const track of audioTracks) {
        pc.addTrack(track, this.#localStream);
      }
    } else {
      try {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      } catch {}
    }

    const videoTracks = (this.#cameraStream?.getVideoTracks() || []).concat(this.#screenStream?.getVideoTracks() || []);
    if (videoTracks.length > 0) {
      for (const track of videoTracks) {
        pc.addTrack(track, this.#cameraStream || this.#screenStream);
      }
    } else {
      try {
        pc.addTransceiver('video', { direction: 'recvonly' });
      } catch {}
    }

    pc.ondatachannel = (e) => {
      if (e.channel) this.#setupDataChannel(e.channel);
    };

    if (this.#topology === 'SERVER') {
      try {
        const cmdDc = pc.createDataChannel('producerCommand', { ordered: true });
        this.#setupDataChannel(cmdDc);
      } catch {}
      try {
        const notifDc = pc.createDataChannel('producerNotification', { ordered: true });
        this.#setupDataChannel(notifDc);
      } catch {}
    } else {
      try {
        const dc = pc.createDataChannel('maxplus-e2e', { ordered: true });
        this.#setupDataChannel(dc);
      } catch {}
    }

    if (this.#encryption.mode === CALL_MODE.SECURE && typeof pc.setEncryptionKeys === 'function') {
      pc.setEncryptionKeys(this.#encryption.getExportedKeys()).catch(() => {});
    }

    this.#pc = pc;
    return pc;
  }

  #resolveParticipantIdFromTrack(trackId) {
    if (!trackId) return null;
    const patMatch = trackId.match(/^video-pat-(\d+)$/);
    if (patMatch) {
      const slot = parseInt(patMatch[1], 10);
      const mapped = this.#slotParticipants.get(slot);
      if (mapped && mapped !== String(this.#myCallUserId)) {
        return mapped;
      }
    }
    const match = trackId.match(/^(?:video-|audio-)?u?(\d+)/);
    if (match && match[1] !== String(this.#myCallUserId)) {
      return match[1];
    }
    return null;
  }

  #checkActive(pc) {
    const ice = pc.iceConnectionState;
    const conn = pc.connectionState;
    if (conn === 'connected' || ice === 'connected' || ice === 'completed') {
      const cur = get(activeCall);
      if (cur.phase !== CALL_PHASE.ACTIVE) {
        log('Call marked ACTIVE through transport connection state');
        this.#onCallActivated();
      }
    } else if (conn === 'failed' || ice === 'failed') {
      log('Transport connection failed, triggering ice restart');
      this.#attemptIceRestart();
    }
  }

  async #onConnection(msg) {
    try {
      log('Processing ws2 connection message');
      const conversation = msg.conversation || {};
      this.#topology = conversation.topology || (get(activeCall).isGroup ? 'SERVER' : null);
      const convParams = msg.conversationParams || msg.params || msg.conversation?.conversationParams || msg.conversation?.params || {};
      const ice = this.#parseIceServers(convParams);
      if (ice.length) {
        this.#iceServers = ice;
        if (this.#pc && typeof this.#pc.setConfiguration === 'function') {
          try {
            this.#pc.setConfiguration({
              iceServers: this.#iceServers,
              sdpSemantics: 'unified-plan',
              bundlePolicy: 'balanced',
              rtcpMuxPolicy: 'require',
            });
          } catch (e) {
            log('setConfiguration error:', e);
          }
        }
      }

      const isGroup = get(activeCall).isGroup || this.#topology === 'SERVER';
      if (!this.#myCallUserId) {
        const msgPeerId = msg.peerId?.id ?? msg.peerId?.userId ?? (typeof msg.peerId === 'number' || typeof msg.peerId === 'string' ? msg.peerId : null);
        if (msgPeerId) {
          this.#myCallUserId = String(msgPeerId);
          patchCallState({ myCallUserId: this.#myCallUserId });
        }
      }
      const myId = String(this.#myCallUserId || '');

      if (Array.isArray(conversation.participants)) {
        const roster = conversation.participants
          .filter(p => {
            const pid = String(p.userId || p.id || '');
            return pid && pid !== myId;
          })
          .map(parseParticipant);
        patchCallState({ participants: roster, roomName: conversation.name || conversation.title || null });
        const remoteP = conversation.participants.find(p => {
          const pid = String(p.userId || p.id || '');
          return pid && pid !== myId;
        });
        if (remoteP) {
          this.#ws2PeerId = String(remoteP.userId || remoteP.id);
          if (Array.isArray(remoteP.responderTypes) && remoteP.responderTypes.length > 0) {
            this.#peerType = String(remoteP.responderTypes[0]);
          }
          if (Array.isArray(remoteP.responderDeviceIdxs) && remoteP.responderDeviceIdxs.length > 0) {
            this.#peerDeviceIdx = Number(remoteP.responderDeviceIdxs[0]);
          }
          patchCallState({
            peerVideoOn: Boolean(remoteP.mediaSettings?.isVideoEnabled),
            peerScreenOn: Boolean(remoteP.mediaSettings?.isScreenSharingEnabled),
          });
        }
      }

      if (!this.#ws2PeerId && this.#contactPeerId && String(this.#contactPeerId) !== myId) {
        this.#ws2PeerId = String(this.#contactPeerId);
      }

      patchCallState({ serverTopology: this.#topology });

      const pc = await this.#buildPeerConnection();

      await this.#voiceChannel.send('accept-call', {
        mediaSettings: {
          isVideoEnabled: get(activeCall).videoOn,
          isAudioEnabled: !get(activeCall).muted,
          isScreenSharingEnabled: false,
          isAnimojiEnabled: false,
        },
      }).catch(() => {});

      if (this.#topology === 'SERVER' || isGroup) {
        patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: get(activeCall).startedAt || Date.now() });

        await this.#voiceChannel.send('allocate-consumer', {
          capabilities: {
            maxH264Decoders: 10,
            producerNotificationDataChannelVersion: 7,
            producerCommandDataChannelVersion: 2,
            audioMix: true,
            consumerUpdate: true,
            onDemandTracks: true,
            singleSession: true,
            unifiedPlan: true,
            fastScreenShare: true,
            consumerFastScreenShareQualityOnDemand: true,
            red: true,
            videoTracksCount: 10,
            csrcAccessible: true,
          },
        });
        return;
      }

      const targetPeerId = this.#ws2PeerId || this.#contactPeerId;

      if (this.#role === 'originator' || this.#role === 'joiner') {
        patchCallState({ phase: this.#role === 'originator' ? CALL_PHASE.OUTGOING : CALL_PHASE.ACTIVE });
        const offer = await pc.createOffer(OFFER_CONSTRAINTS);
        await pc.setLocalDescription(offer);
        const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || offer.sdp);
        log(`[call:sdp:local-offer] role=${this.#role}`, localSdp);
        this.#extractAndApplyFingerprint(localSdp, true);
        if (targetPeerId && localSdp && localSdp.trim().startsWith('v=')) {
          this.#pendingOffer = false;
          await this.#voiceChannel.send('transmit-data', {
            participantId: Number(targetPeerId),
            participantType: this.#peerType || 'USER',
            deviceIdx: this.#peerDeviceIdx ?? 0,
            data: {
              sdp: { type: offer.type || 'offer', sdp: localSdp },
            },
            capabilities: WS2_CAPABILITIES,
          });
          await this.#flushPendingLocalCandidates();
        } else {
          this.#pendingOffer = true;
        }
      }
    } catch (err) {
      log('onConnection error:', err);
      patchCallState({ errorText: err?.message || String(err) });
    }
  }

  #extractSsrcs(sdp) {
    if (!sdp) return [];
    const set = new Set();
    const regex = /^a=ssrc:(\d+)/gm;
    let m;
    while ((m = regex.exec(sdp)) !== null) {
      if (m[1]) set.add(m[1]);
    }
    return Array.from(set);
  }

  async #onProducerUpdated(msg) {
    try {
      log('Processing producer-updated notification from SFU');
      if (msg.sessionId) {
        const prevSession = this.#sfuSessionId;
        this.#sfuSessionId = msg.sessionId;
        if (prevSession && prevSession !== msg.sessionId) {
          await this.#rebuildSfuPc();
        }
      }

      if (this.#topology === 'SERVER' && this.#pc && !this.#isSfuPc) {
        await this.#rebuildSfuPc();
      }

      const description = msg.description;
      let sdp = null;
      let type = 'offer';

      if (description && typeof description === 'object') {
        sdp = description.sdp || description.description;
        type = description.type || 'offer';
      } else if (typeof description === 'string') {
        sdp = description;
      } else if (msg.sdp) {
        sdp = msg.sdp;
      }

      if (!sdp || typeof sdp !== 'string' || !sdp.trim().startsWith('v=')) {
        log('producer-updated payload had no valid SDP description', msg);
        return;
      }

      const ssrcs = this.#extractSsrcs(sdp);
      this.#extractAndApplyFingerprint(sdp, false);

      let pc = await this.#buildPeerConnection();
      await this.#prepareVideoSlot(pc, sdp);
      const cleanSdp = sanitizeSdpBundle(sdp);
      const SessionDesc = getRTCSessionDescription();
      const descObj = SessionDesc ? new SessionDesc({ type, sdp: cleanSdp }) : { type, sdp: cleanSdp };
      try {
        await pc.setRemoteDescription(descObj);
      } catch (descErr) {
        if (String(descErr).includes('order of m-lines') || String(descErr).includes('m-line') || String(descErr).includes('InvalidAccessError')) {
          log('Subsequent offer m-line order mismatch, rebuilding SFU peer connection');
          pc = await this.#rebuildSfuPc();
          await this.#prepareVideoSlot(pc, sdp);
          await pc.setRemoteDescription(descObj);
        } else {
          throw descErr;
        }
      }
      this.#remoteDescSet = true;
      await this.#flushCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.#gatherDone();

      const answerSdp = this.#applyTrackLabels(pc.localDescription?.sdp || answer.sdp || '');
      this.#extractAndApplyFingerprint(answerSdp, true);
      if (get(activeCall).mode === CALL_MODE.SECURE && get(activeCall).secureStatus !== 'active') {
        this.enableSecureMode().catch(() => {});
      }
      log('Sending accept-producer response with answer SDP');

      await this.#voiceChannel.send('accept-producer', {
        description: answerSdp,
        ...(ssrcs.length > 0 ? { ssrcs } : {}),
        ...(this.#sfuSessionId ? { sessionId: this.#sfuSessionId } : {}),
      });
      this.#sendSfuDisplayLayout();
    } catch (err) {
      log('onProducerUpdated error:', err);
      patchCallState({ errorText: err?.message || String(err) });
    }
  }

  #onRemoteSignal(msg) {
    this.#signalQueue = this.#signalQueue.then(async () => {
      await this.#processRemoteSignal(msg);
    }).catch(err => {
      log('Signal queue error:', err);
    });
  }

  async #processRemoteSignal(msg) {
    if (this.#destroyed) return;
    try {
      const raw = msg.data;
      if (!raw) return;
      let signal;
      try {
        signal = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return;
      }

      const rawPeerId = msg.participantId ?? msg.peerId?.id ?? msg.peerId?.userId ?? (typeof msg.peerId === 'number' || typeof msg.peerId === 'string' ? msg.peerId : null) ?? msg.userId;
      if (rawPeerId) {
        if (!this.#ws2PeerId) {
          this.#ws2PeerId = String(rawPeerId);
          this.#transmitPendingOffer();
        } else {
          this.#ws2PeerId = String(rawPeerId);
        }
      }
      if (msg.participantType) this.#peerType = String(msg.participantType);
      if (msg.deviceIdx != null) this.#peerDeviceIdx = Number(msg.deviceIdx);

      if (signal.e2e?.pubKey) {
        const isReply = Boolean(signal.e2e.isReply);
        const targetPeerId = rawPeerId || this.#ws2PeerId || this.#contactPeerId;
        await this.#handlePeerPublicKey(new Uint8Array(signal.e2e.pubKey), isReply, targetPeerId);
      }

      const sdpData = signal.sdp || (signal.type ? signal : null);

      const pc = await this.#buildPeerConnection();
      if (!pc || this.#destroyed) return;

      if (sdpData && sdpData.type) {
        const type = sdpData.type;
        const sdp = sdpData.sdp || sdpData.description || '';
        if (!sdp || typeof sdp !== 'string' || !sdp.trim().startsWith('v=')) {
          log(`[call:sdp:invalid] remote type=${type}`);
          return;
        }
        log(`[call:sdp:remote-${type}]`, sdp);
        this.#extractAndApplyFingerprint(sdp, false);

        if (type === 'answer') {
          if (pc.signalingState !== 'have-local-offer') {
            log(`[call:sdp] Ignoring remote answer in signaling state: ${pc.signalingState}`);
            return;
          }
        }

        if (type === 'offer' && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch {}
        }

        const SessionDesc = getRTCSessionDescription();
        const descObj = SessionDesc ? new SessionDesc({ type, sdp }) : { type, sdp };
        try {
          await pc.setRemoteDescription(descObj);
        } catch (err) {
          if (type === 'answer' && pc.signalingState === 'stable') {
            log('[call:sdp] Answer already applied, ignoring duplicate error');
            return;
          }
          throw err;
        }
        this.#remoteDescSet = true;
        await this.#flushCandidates();
        if (get(activeCall).mode === CALL_MODE.SECURE && get(activeCall).secureStatus !== 'active') {
          this.enableSecureMode().catch(() => {});
        }

        if (type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || answer.sdp);
          this.#extractAndApplyFingerprint(localSdp, true);
          const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
          log('[call:sdp:local-answer]', localSdp);
          if (targetPeerId && localSdp && localSdp.trim().startsWith('v=')) {
            await this.#voiceChannel.send('transmit-data', {
              participantId: Number(targetPeerId),
              participantType: this.#peerType || 'USER',
              deviceIdx: this.#peerDeviceIdx ?? 0,
              data: {
                sdp: { type: 'answer', sdp: localSdp },
              },
              capabilities: WS2_CAPABILITIES,
            });
            await this.#flushPendingLocalCandidates();
          }
          stopCallAudio();
          this.#onCallActivated();
        } else if (type === 'answer') {
          stopCallAudio();
          this.#onCallActivated();
        }
      }

      const rawCandidates = Array.isArray(signal.candidates)
        ? signal.candidates
        : (signal.candidate ? [signal.candidate] : (signal.ice ? [signal.ice] : []));
      for (const item of rawCandidates) {
        if (!item) continue;
        const candidateStr = typeof item === 'string' ? item : (item.candidate || '');
        if (!candidateStr || typeof candidateStr !== 'string' || !candidateStr.trim()) continue;
        if (candidateStr.includes('e2ereq') || candidateStr.includes('e2erep')) continue;
        const sdpMid = item.sdpMid != null ? String(item.sdpMid) : undefined;
        const sdpMLineIndex = item.sdpMLineIndex != null ? Number(item.sdpMLineIndex) : undefined;
        log(`[call:ice:remote] ${candidateStr} (mid=${sdpMid}, mline=${sdpMLineIndex})`);
        const IceCand = getRTCIceCandidate();
        const candidateObj = IceCand
          ? new IceCand({ candidate: candidateStr, ...(sdpMid != null ? { sdpMid } : {}), ...(sdpMLineIndex != null ? { sdpMLineIndex } : {}) })
          : { candidate: candidateStr, sdpMid, sdpMLineIndex };
        if (this.#remoteDescSet) {
          try {
            await pc.addIceCandidate(candidateObj);
          } catch (candErr) {
            log('[call:ice:remote-error]', candErr?.message || candErr);
          }
        } else {
          this.#pendingCandidates.push(candidateObj);
        }
      }
    } catch (err) {
      log('onRemoteSignal error:', err);
    }
  }

  async #flushCandidates() {
    const pc = this.#pc;
    if (!pc || this.#pendingCandidates.length === 0) return;
    const list = [...this.#pendingCandidates];
    this.#pendingCandidates = [];
    log(`Flushing ${list.length} pending remote ICE candidates`);
    for (const c of list) {
      try {
        await pc.addIceCandidate(c);
        log('Flushed remote ICE candidate added successfully');
      } catch (candErr) {
        log('Failed to add flushed remote ICE candidate:', candErr?.message || candErr, c.candidate);
      }
    }
  }

  #gatherDone() {
    const pc = this.#pc;
    if (!pc) return Promise.resolve();
    if (pc.iceGatheringState === 'complete' || pc.connectionState === 'connected' || pc.iceConnectionState === 'connected') return Promise.resolve();
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        pc.removeEventListener('icegatheringstatechange', checkGathering);
        pc.removeEventListener('icecandidate', checkCandidate);
        clearTimeout(timer);
        resolve();
      };
      const checkGathering = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      const checkCandidate = (e) => {
        if (!e?.candidate || (e.candidate.candidate && e.candidate.candidate.includes('typ relay'))) {
          finish();
        }
      };
      pc.addEventListener('icegatheringstatechange', checkGathering);
      pc.addEventListener('icecandidate', checkCandidate);
      const timer = setTimeout(() => {
        finish();
      }, 1000);
    });
  }

  #onPeerMedia(msg) {
    const ms = msg.mediaSettings || {};
    const pid = String(msg.participantId || '');
    const myId = String(this.#myCallUserId || '');
    if (pid && pid !== myId) {
      const isVideo = Boolean(ms.isVideoEnabled);
      const isScreen = Boolean(ms.isScreenSharingEnabled);
      patchCallState({
        peerVideoOn: isVideo,
        peerScreenOn: isScreen,
      });
      if (!isVideo && !isScreen && this.#pc && typeof this.#pc.stopRemoteVideo === 'function') {
        this.#pc.stopRemoteVideo();
      }
    }
    patchCallState({
      participants: get(activeCall).participants.map(p =>
        p.id === pid
          ? { ...p, muted: !ms.isAudioEnabled, videoOn: Boolean(ms.isVideoEnabled), screenOn: Boolean(ms.isScreenSharingEnabled) }
          : p
      ),
    });
    this.#sendSfuDisplayLayout();
  }

  #onParticipantJoined(msg) {
    const raw = msg.participant || msg;
    if (!raw) return;
    const p = parseParticipant(raw);
    const myId = String(this.#myCallUserId || '');
    if (!p.id || p.id === myId) return;
    log('Participant joined room:', p.name, p.id);
    const cur = get(activeCall).participants;
    if (cur.some(x => x.id === p.id)) {
      patchCallState({ participants: cur.map(x => x.id === p.id ? { ...x, ...p } : x) });
    } else {
      patchCallState({ participants: [...cur, p] });
    }
    if (!this.#ws2PeerId) {
      this.#ws2PeerId = p.id;
    }
    this.#transmitPendingOffer();
    this.#sendSfuDisplayLayout();
  }

  #onParticipantLeft(msg) {
    const id = String(msg.participantId || msg.userId || msg.id || '');
    if (!id) return;
    log('Participant left room:', id);
    const cur = get(activeCall).participants.filter(p => p.id !== id);
    patchCallState({
      participants: cur,
    });
    if (!get(activeCall).isGroup && (id === String(this.#ws2PeerId) || cur.length === 0)) {
      this.destroy();
    }
  }

  #onSessionState(msg) {
    const list = msg.participants || msg.sessionParticipants || [];
    if (!list.length) return;
    const myId = String(this.#myCallUserId || '');
    const roster = list
      .filter(p => String(p.userId || p.id) !== myId)
      .map(parseParticipant);
    patchCallState({ participants: roster });
    const peer = roster.find(p => p.id && p.id !== myId);
    if (!this.#ws2PeerId && peer) {
      this.#ws2PeerId = peer.id;
      this.#transmitPendingOffer();
    }
    this.#sendSfuDisplayLayout();
  }

  async #attemptIceRestart() {
    if (this.#destroyed || this.#iceRestarting || this.#topology === 'SERVER') return;
    const pc = this.#pc;
    if (!pc || pc.signalingState !== 'stable') return;
    this.#iceRestarting = true;
    try {
      log('Attempting ICE restart');
      const offer = await pc.createOffer({ ...OFFER_CONSTRAINTS, iceRestart: true });
      if (pc.signalingState !== 'stable') return;
      await pc.setLocalDescription(offer);
      if (this.#topology !== 'SERVER' && this.#ws2PeerId) {
        await this.#voiceChannel?.send('transmit-data', {
          participantId: Number(this.#ws2PeerId),
          participantType: this.#peerType || 'USER',
          deviceIdx: this.#peerDeviceIdx ?? 0,
          data: {
            sdp: { type: offer.type || 'offer', sdp: pc.localDescription.sdp },
          },
          capabilities: WS2_CAPABILITIES,
        });
      }
    } catch (e) {
      log('ICE restart error:', e?.message || e);
    } finally {
      setTimeout(() => {
        this.#iceRestarting = false;
      }, 3000);
    }
  }

  #onChannelLost() {
    log('Voice channel disconnected');
    if (!this.#destroyed) {
      patchCallState({ connectionStatus: 'disconnected' });
    }
  }

  #normalizeIceUrl(url, scheme) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('stun:') || trimmed.startsWith('turn:') || trimmed.startsWith('turns:')) {
      return trimmed;
    }
    return `${scheme}:${trimmed}`;
  }

  #parseIceServers(convParams) {
    if (!convParams || typeof convParams !== 'object') {
      return [...ICE_DEFAULTS];
    }
    const servers = [];

    const rawList = convParams.iceServers || convParams.stunServers;
    if (Array.isArray(rawList)) {
      for (const s of rawList) {
        if (s && (s.url || s.urls)) {
          servers.push({
            urls: s.urls || s.url,
            ...(s.username ? { username: s.username } : {}),
            ...(s.credential ? { credential: s.credential } : {}),
          });
        }
      }
    }

    const stunRaw = convParams.stun || convParams.stn;
    if (stunRaw) {
      if (typeof stunRaw === 'string') {
        const url = this.#normalizeIceUrl(stunRaw, 'stun');
        if (url) servers.push({ urls: url });
      } else if (Array.isArray(stunRaw)) {
        const urls = stunRaw.map(u => this.#normalizeIceUrl(u, 'stun')).filter(Boolean);
        if (urls.length) servers.push({ urls });
      } else if (typeof stunRaw === 'object' && (stunRaw.urls || stunRaw.url)) {
        const u = stunRaw.urls || stunRaw.url;
        const urls = Array.isArray(u) ? u.map(x => this.#normalizeIceUrl(x, 'stun')).filter(Boolean) : this.#normalizeIceUrl(u, 'stun');
        if (urls) servers.push({ urls });
      }
    }

    const turnRaw = convParams.turn || convParams.trn;
    const turnUser = convParams.turnUser || convParams.trnu || convParams.username || '';
    const turnPassword = convParams.turnPassword || convParams.trnp || convParams.credential || convParams.password || '';

    if (turnRaw) {
      if (typeof turnRaw === 'string') {
        const url = this.#normalizeIceUrl(turnRaw, 'turn');
        if (url) {
          const entry = { urls: url };
          if (turnUser) entry.username = turnUser;
          if (turnPassword) entry.credential = turnPassword;
          servers.push(entry);
        }
      } else if (Array.isArray(turnRaw)) {
        const urls = turnRaw.map(u => this.#normalizeIceUrl(u, 'turn')).filter(Boolean);
        if (urls.length) {
          const entry = { urls };
          if (turnUser) entry.username = turnUser;
          if (turnPassword) entry.credential = turnPassword;
          servers.push(entry);
        }
      } else if (typeof turnRaw === 'object') {
        const u = turnRaw.urls || turnRaw.url;
        if (u) {
          const urls = Array.isArray(u) ? u.map(x => this.#normalizeIceUrl(x, 'turn')).filter(Boolean) : this.#normalizeIceUrl(u, 'turn');
          const entry = { urls };
          const uName = turnRaw.username || turnUser;
          const uCred = turnRaw.credential || turnPassword;
          if (uName) entry.username = uName;
          if (uCred) entry.credential = uCred;
          servers.push(entry);
        }
      }
    }

    for (const def of ICE_DEFAULTS) {
      if (!servers.some(s => s.urls === def.urls || (Array.isArray(s.urls) && s.urls.includes(def.urls)))) {
        servers.push(def);
      }
    }

    return servers;
  }

  async toggleMute(muted) {
    const tracks = this.#localStream?.getAudioTracks() || [];
    for (const t of tracks) t.enabled = !muted;
    if (this.#pc && typeof this.#pc.setMute === 'function') {
      await this.#pc.setMute(muted);
    }
    patchCallState({ muted });
    await this.#voiceChannel?.send('change-media-settings', {
      mediaSettings: {
        isVideoEnabled: get(activeCall).videoOn,
        isAudioEnabled: !muted,
        isScreenSharingEnabled: get(activeCall).screenOn,
        isAnimojiEnabled: false,
      },
    }).catch(() => {});
  }

  async enableCamera(on) {
    if (this.#cameraToggling) return;
    this.#cameraToggling = true;
    try {
      if (isLinuxClient) {
        if (this.#pc && typeof this.#pc.setCameraEnabled === 'function') {
          await this.#pc.setCameraEnabled(on);
        }
        patchCallState({ videoOn: on, localCameraStream: null, cameraLoading: false });
        if (this.#pc && this.#topology !== 'SERVER') {
          await this.#renegotiate();
        }
      } else if (on && !this.#cameraStream) {
        patchCallState({ videoOn: true, cameraLoading: true });
        try {
          try {
            this.#cameraStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            });
          } catch {
            this.#cameraStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        } catch (e) {
          log('[call:media] getUserMedia video failed, using synthetic fallback:', e?.name, e?.message);
          try {
            this.#syntheticVideo = createSyntheticVideoStream();
            this.#cameraStream = this.#syntheticVideo.stream;
          } catch (err) {
            showAlert('Не удалось получить доступ к камере');
            patchCallState({ videoOn: false, localCameraStream: null, cameraLoading: false });
            return;
          }
        }

        const rawVideoTrack = this.#cameraStream.getVideoTracks()[0];
        mediaPipeline.setSourceTracks(rawVideoTrack, this.#localStream?.getAudioTracks()[0] || null);
        const track = rawVideoTrack;
        if (track && this.#pc) {
          const transceivers = typeof this.#pc.getTransceivers === 'function' ? this.#pc.getTransceivers() : [];
          const transceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
          let sender = transceiver?.sender;
          if (transceiver) {
            transceiver.direction = 'sendrecv';
          }
          if (!sender) {
            const senders = typeof this.#pc.getSenders === 'function' ? this.#pc.getSenders() : [];
            sender = senders.find(s => s.track?.kind === 'video');
          }
          if (!get(activeCall).screenOn) {
            if (sender) {
              await sender.replaceTrack(track);
            } else {
              this.#pc.addTrack(track, this.#cameraStream);
            }
            if (this.#topology !== 'SERVER') {
              await this.#renegotiate();
            }
          }
        }
        patchCallState({ videoOn: true, localCameraStream: this.#cameraStream, cameraLoading: false });
      } else if (!on && this.#cameraStream) {
        patchCallState({ videoOn: false, localCameraStream: null, cameraLoading: false });
        for (const t of this.#cameraStream.getTracks()) t.stop();
        if (this.#syntheticVideo) {
          this.#syntheticVideo.stop();
          this.#syntheticVideo = null;
        }
        this.#cameraStream = null;
        if (!get(activeCall).screenOn) {
          const transceivers = typeof this.#pc?.getTransceivers === 'function' ? this.#pc.getTransceivers() : [];
          const transceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
          if (transceiver) {
            transceiver.direction = 'recvonly';
            await transceiver.sender?.replaceTrack(null);
          } else {
            const senders = typeof this.#pc?.getSenders === 'function' ? this.#pc.getSenders() : [];
            const sender = senders.find(s => s.track?.kind === 'video');
            await sender?.replaceTrack(null);
          }
        }
        if (this.#topology !== 'SERVER' && this.#pc) {
          await this.#renegotiate();
        }
      }
      await this.#voiceChannel?.send('change-media-settings', {
        mediaSettings: {
          isVideoEnabled: on,
          isAudioEnabled: !get(activeCall).muted,
          isScreenSharingEnabled: get(activeCall).screenOn,
          isAnimojiEnabled: false,
        },
      }).catch(() => {});
      this.#sendSfuDisplayLayout();
    } finally {
      this.#cameraToggling = false;
    }
  }

  async #renegotiate() {
    const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
    if (!this.#pc || this.#topology === 'SERVER' || !targetPeerId || this.#pc.signalingState !== 'stable') return;
    try {
      const offer = await this.#pc.createOffer(OFFER_CONSTRAINTS);
      await this.#pc.setLocalDescription(offer);
      const localSdp = sanitizeSdpBundle(this.#applyTrackLabels(this.#pc.localDescription?.sdp || offer.sdp));
      this.#extractAndApplyFingerprint(localSdp, true);
      if (localSdp && localSdp.trim().startsWith('v=')) {
        log('[call:sdp:renegotiate-offer]', localSdp);
        await this.#voiceChannel?.send('transmit-data', {
          participantId: Number(targetPeerId),
          participantType: this.#peerType || 'USER',
          deviceIdx: this.#peerDeviceIdx ?? 0,
          data: {
            sdp: { type: offer.type || 'offer', sdp: localSdp },
          },
          capabilities: WS2_CAPABILITIES,
        });
        await this.#flushPendingLocalCandidates();
      }
    } catch (e) {
      log('[call:sdp:renegotiate-error]', e);
    }
  }

  async enableScreen(on) {
    if (this.#destroyed) return;
    if (isLinuxClient) {
      patchCallState({ screenOn: on, localScreenStream: null });
      if (this.#pc && typeof this.#pc.setCameraEnabled === 'function') {
        await this.#pc.setCameraEnabled(on || get(activeCall).videoOn);
      }
      if (this.#pc && this.#topology !== 'SERVER') {
        await this.#renegotiate();
      }
      await this.#voiceChannel?.send('change-media-settings', {
        mediaSettings: {
          isVideoEnabled: get(activeCall).videoOn,
          isAudioEnabled: !get(activeCall).muted,
          isScreenSharingEnabled: on,
          isAnimojiEnabled: false,
        },
      }).catch(() => {});
      this.#sendSfuDisplayLayout();
      return;
    }
    if (on && !this.#screenStream) {
      try {
        let stream = null;
        if (navigator.mediaDevices?.getDisplayMedia) {
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          } catch {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          }
        } else {
          const captureInfo = await invoke('start_android_screen_capture');
          const port = captureInfo?.port;
          const width = captureInfo?.width || 720;
          const height = captureInfo?.height || 1280;
          if (!port) throw new Error('Не удалось запустить захват экрана');
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = `http://127.0.0.1:${port}/screen.mjpeg`;
          let streaming = true;
          const drawInterval = setInterval(() => {
            if (!streaming) return;
            try {
              if (img.naturalWidth > 0) {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              }
            } catch {}
          }, 1000 / 15);
          stream = canvas.captureStream(15);
          const trk = stream.getVideoTracks()[0];
          const origStop = trk.stop.bind(trk);
          trk.stop = () => {
            streaming = false;
            clearInterval(drawInterval);
            img.src = '';
            invoke('stop_android_screen_capture').catch(() => {});
            origStop();
          };
          this.#androidScreenCapture = {
            stream,
            cleanup: () => {
              streaming = false;
              clearInterval(drawInterval);
              img.src = '';
              invoke('stop_android_screen_capture').catch(() => {});
            }
          };
        }
        this.#screenStream = stream;
        this.#screenStream.getVideoTracks()[0].onended = () => this.enableScreen(false);
        const track = this.#screenStream.getVideoTracks()[0];
        if (this.#pc) {
          const senders = typeof this.#pc.getSenders === 'function' ? this.#pc.getSenders() : [];
          let sender = senders.find(s => s.track?.kind === 'video' || s.track === null);
          const transceivers = typeof this.#pc.getTransceivers === 'function' ? this.#pc.getTransceivers() : [];
          const transceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
          if (transceiver) {
            transceiver.direction = 'sendrecv';
            sender = transceiver.sender;
          }
          if (sender) {
            await sender.replaceTrack(track);
          } else {
            const s = this.#pc.addTrack(track, this.#screenStream);
            if (this.#encryption.mode === CALL_MODE.SECURE) this.#encryption.applyToSender(s, 'video');
          }
          if (this.#topology !== 'SERVER') {
            await this.#renegotiate();
          }
        }
        patchCallState({ screenOn: true, localScreenStream: this.#screenStream });
      } catch (e) {
        if (e.name !== 'NotAllowedError') showAlert('Демонстрация экрана недоступна');
        return;
      }
    } else if (!on && this.#screenStream) {
      if (this.#androidScreenCapture) {
        this.#androidScreenCapture.cleanup();
        this.#androidScreenCapture = null;
      }
      for (const t of this.#screenStream.getTracks()) t.stop();
      this.#screenStream = null;
      const transceivers = typeof this.#pc?.getTransceivers === 'function' ? this.#pc.getTransceivers() : [];
      const transceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
      const camTrack = get(activeCall).videoOn && this.#cameraStream ? this.#cameraStream.getVideoTracks()[0] : null;
      if (camTrack) {
        if (transceiver?.sender) {
          await transceiver.sender.replaceTrack(camTrack);
        } else {
          const senders = typeof this.#pc?.getSenders === 'function' ? this.#pc.getSenders() : [];
          const sender = senders.find(s => s.track?.kind === 'video' || s.track === null);
          if (sender) await sender.replaceTrack(camTrack);
        }
      } else {
        if (transceiver) {
          transceiver.direction = 'recvonly';
          await transceiver.sender?.replaceTrack(null);
        } else {
          const senders = typeof this.#pc?.getSenders === 'function' ? this.#pc.getSenders() : [];
          const sender = senders.find(s => s.track?.kind === 'video');
          await sender?.replaceTrack(null);
        }
      }
      patchCallState({ screenOn: false, localScreenStream: null });
      if (this.#topology !== 'SERVER' && this.#pc) {
        await this.#renegotiate();
      }
    }
    await this.#voiceChannel?.send('change-media-settings', {
      mediaSettings: {
        isVideoEnabled: get(activeCall).videoOn,
        isAudioEnabled: !get(activeCall).muted,
        isScreenSharingEnabled: on,
        isAnimojiEnabled: false,
      },
    }).catch(() => {});
    this.#sendSfuDisplayLayout();
  }

  async hangup() {
    try {
      this.#voiceChannel?.sendQuiet('hangup', {
        reason: 'HUNGUP',
      });
    } catch {}
    this.destroy();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    log('MaxCallSession destroyed');
    patchCallState({ phase: CALL_PHASE.ENDING });
    stopCallAudio();
    if (this.#unlistenScreenCaptureStopped) {
      try { this.#unlistenScreenCaptureStopped(); } catch {}
      this.#unlistenScreenCaptureStopped = null;
    }
    if (this.#androidScreenCapture) {
      try { this.#androidScreenCapture.cleanup(); } catch {}
      this.#androidScreenCapture = null;
    }
    invoke('stop_android_screen_capture').catch(() => {});
    if (this.#syntheticAudio) {
      try { this.#syntheticAudio.stop(); } catch {}
      this.#syntheticAudio = null;
    }
    if (this.#syntheticVideo) {
      try { this.#syntheticVideo.stop(); } catch {}
      this.#syntheticVideo = null;
    }
    for (const t of (this.#localStream?.getTracks() || [])) {
      try { t.stop(); } catch {}
    }
    for (const t of (this.#cameraStream?.getTracks() || [])) {
      try { t.stop(); } catch {}
    }
    for (const t of (this.#screenStream?.getTracks() || [])) {
      try { t.stop(); } catch {}
    }
    if (this.#remoteStream) {
      for (const t of this.#remoteStream.getTracks()) {
        try { t.stop(); } catch {}
      }
      this.#remoteStream = null;
    }
    this.#participantStreams.clear();
    this.#signalQueue = Promise.resolve();
    try { mediaPipeline.teardown(); } catch {}
    try { this.#voiceChannel?.close(); } catch {}
    try { this.#dataChannel?.close(); } catch {}
    if (this.#pc) {
      try { this.#pc.close()?.catch?.(() => {}); } catch {}
      this.#pc = null;
    }
    this.#isSfuPc = false;
    this.#dataChannel = null;
    this.#voiceChannel = null;
    this.#sfuCommandChannel = null;
    this._keyPair = null;
    this._myPublicKeyBytes = null;
    invoke('cancel_call_notification').catch(() => {});
    setTimeout(() => {
      resetCallState();
    }, 320);
  }

  attachVideoCanvas(canvas) {
    if (this.#pc && typeof this.#pc.attachVideoCanvas === 'function') {
      this.#pc.attachVideoCanvas(canvas);
    }
  }

  detachVideoCanvas(canvas) {
    if (this.#pc && typeof this.#pc.detachVideoCanvas === 'function') {
      this.#pc.detachVideoCanvas(canvas);
    }
  }
}

let _activeSession = null;

function _buildInternalParams(deviceId = '') {
  return JSON.stringify({
    platform: INTERNAL_PARAMS_PLATFORM,
    sdkVersion: INTERNAL_PARAMS_SDK,
    clientAppKey: CLIENT_APP_KEY,
    deviceId,
    protocolVersion: 5,
    onlyAdminCanRecord: false,
    isWaitForAdminEnabled: false,
  });
}

function _genConversationId() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

export const CallService = {
  async placeAudioCall(peerId, peerName, peerAvatar, mode = CALL_MODE.PLAIN) {
    if (!peerId || Number(peerId) === Number(get(currentUser))) {
      showAlert('Нельзя позвонить самому себе');
      return;
    }
    await this._endActive();
    patchCallState({
      phase: CALL_PHASE.CONNECTING,
      callType: 'audio',
      mode,
      peerId,
      peerName,
      peerAvatar,
      errorText: null,
    });
    try {
      const convId = _genConversationId();
      const resp = await invoke('begin_call', {
        calleeId: Number(peerId),
        isVideo: false,
        conversationId: convId,
        internalParams: _buildInternalParams(),
      });
      log('begin_call response:', resp);
      const endpoint = this._extractEndpoint(resp);
      if (!endpoint) throw new Error('No ws2 endpoint in response');
      startOutgoingRingback();
      const convParams = this._extractConvParams(resp);
      const session = new MaxCallSession();
      _activeSession = session;
      await session.begin({ endpoint, conversationId: convId, role: 'originator', isVideo: false, mode, peerId, convParams });
    } catch (e) {
      stopCallAudio();
      showAlert('Не удалось начать звонок: ' + (e?.message || e));
      resetCallState();
    }
  },

  async placeVideoCall(peerId, peerName, peerAvatar, mode = CALL_MODE.PLAIN) {
    if (!peerId || Number(peerId) === Number(get(currentUser))) {
      showAlert('Нельзя позвонить самому себе');
      return;
    }
    await this._endActive();
    patchCallState({
      phase: CALL_PHASE.CONNECTING,
      callType: 'video',
      mode,
      peerId,
      peerName,
      peerAvatar,
      errorText: null,
    });
    try {
      const convId = _genConversationId();
      const resp = await invoke('begin_call', {
        calleeId: Number(peerId),
        isVideo: true,
        conversationId: convId,
        internalParams: _buildInternalParams(),
      });
      log('begin_call response:', resp);
      const endpoint = this._extractEndpoint(resp);
      if (!endpoint) throw new Error('No ws2 endpoint in response');
      startOutgoingRingback();
      const convParams = this._extractConvParams(resp);
      const session = new MaxCallSession();
      _activeSession = session;
      await session.begin({ endpoint, conversationId: convId, role: 'originator', isVideo: true, mode, peerId, convParams });
    } catch (e) {
      stopCallAudio();
      showAlert('Не удалось начать видеозвонок: ' + (e?.message || e));
      resetCallState();
    }
  },

  async handleIncomingPush(pushData) {
    try {
      const vcp = pushData.vcp || pushData.conversationParams;
      let convParams = {};
      if (vcp) {
        try {
          convParams = await invoke('decode_call_push', { blob: vcp });
        } catch (e) {
          log('vcp decode error:', e);
        }
      }
      const conversationId = pushData.conversationId || pushData.vcId || pushData.conference_id || (convParams?.cid ? String(convParams.cid) : '');
      const callerId = pushData.callerId || pushData.suid || pushData.caller_id || (convParams?.from ? String(convParams.from) : '');
      let endpoint = convParams.endpoint || convParams.ws2url || pushData.endpoint;
      if (!endpoint && convParams.wse) {
        try {
          const u = new URL(convParams.wse);
          const myCallId = convParams.trnu ? convParams.trnu.split(':').pop() : '';
          u.searchParams.set('userId', myCallId);
          u.searchParams.set('entityType', 'USER');
          u.searchParams.set('conversationId', conversationId);
          if (convParams.tkn) u.searchParams.set('token', convParams.tkn);
          u.searchParams.set('version', WS2_VERSION);
          u.searchParams.set('capabilities', WS2_CAPABILITIES);
          u.searchParams.set('platform', INTERNAL_PARAMS_PLATFORM);
          u.searchParams.set('clientType', 'ONE_ME');
          u.searchParams.set('appVersion', `sdk-${INTERNAL_PARAMS_SDK}`);
          u.searchParams.set('osVersion', DEFAULT_OS_VERSION);
          u.searchParams.set('device', DEFAULT_DEVICE);
          endpoint = u.toString();
        } catch (err) {
          log('failed to construct incoming endpoint:', err);
        }
      }
      if (!endpoint) { log('incoming call without endpoint'); return; }
      const contact = callerId ? await getContactDirect(callerId) : null;
      const peerName = contact?.displayName || contact?.name || pushData.userName || pushData.title || pushData.name || (callerId ? `User ${callerId}` : 'Входящий звонок');
      const peerAvatar = contact?.avatar || contact?.baseRawUrl || contact?.baseUrl || contact?.photo || null;
      const isVideo = Boolean(
        pushData.isVideo ||
        pushData.type === 'VIDEO' ||
        pushData.callType === 'VIDEO' ||
        pushData.iv === true ||
        pushData.iv === 'true' ||
        convParams.iv ||
        convParams.isVideo
      );
      const callType = isVideo ? 'video' : 'audio';
      patchCallState({
        phase: CALL_PHASE.INCOMING,
        callType,
        conversationId,
        peerId: callerId,
        peerName,
        peerAvatar,
      });
      this._pendingIncoming = { endpoint, conversationId, callerId, isVideo, convParams };
      startIncomingRingtone();
      showDesktopCallNotification({
        callerName: peerName,
        isVideo,
        avatar: peerAvatar,
      });
    } catch (e) {
      log('handleIncomingPush failed:', e);
    }
  },

  async acceptIncoming(mode = CALL_MODE.PLAIN) {
    stopCallAudio();
    invoke('cancel_call_notification').catch(() => {});
    cancelDesktopCallNotification().catch(() => {});
    const pending = this._pendingIncoming;
    if (!pending) return;
    this._pendingIncoming = null;
    patchCallState({ phase: CALL_PHASE.CONNECTING, connectionStatus: 'connecting' });
    const session = new MaxCallSession();
    _activeSession = session;
    try {
      await session.begin({
        endpoint: pending.endpoint,
        conversationId: pending.conversationId,
        role: 'responder',
        isVideo: pending.isVideo,
        mode,
        peerId: pending.callerId,
        convParams: pending.convParams,
      });
    } catch (e) {
      log('acceptIncoming failed:', e);
      resetCallState();
      _activeSession = null;
    }
  },

  declineIncoming() {
    stopCallAudio();
    playRejectionTone();
    invoke('cancel_call_notification').catch(() => {});
    cancelDesktopCallNotification().catch(() => {});
    const pending = this._pendingIncoming;
    if (!pending) return;
    if (pending?.endpoint) {
      try {
        const ch = new VoiceChannel();
        ch.connect(pending.endpoint).then(() => {
          ch.sendQuiet('hangup', { reason: 'REJECTED' });
          setTimeout(() => ch.close(), 1000);
        }).catch(() => {});
      } catch {}
    }
    this._endActive();
    patchCallState({ phase: CALL_PHASE.ENDING });
    setTimeout(() => {
      resetCallState();
    }, 320);
  },

  async hangup() {
    stopCallAudio();
    invoke('cancel_call_notification').catch(() => {});
    cancelDesktopCallNotification().catch(() => {});
    this._pendingIncoming = null;
    const session = _activeSession;
    _activeSession = null;
    patchCallState({ phase: CALL_PHASE.ENDING });
    if (session) {
      try {
        await session.hangup();
      } catch {
        session.destroy();
      }
    } else {
      setTimeout(() => {
        resetCallState();
      }, 320);
    }
  },

  async toggleMute() {
    const state = get(activeCall);
    await _activeSession?.toggleMute(!state.muted);
  },

  async toggleVideo() {
    const state = get(activeCall);
    await _activeSession?.enableCamera(!state.videoOn);
  },

  async createConferenceRoom() {
    const convId = _genConversationId();
    await invoke('open_conference', { conversationId: convId });
    let link = `https://max.ru/joincall/${convId}`;
    try {
      const resp = await invoke('make_call_invite_link', { conversationId: convId });
      log('invite link response:', resp);
      if (resp?.link || resp?.joinLink) {
        link = resp.link || resp.joinLink;
      }
    } catch {}
    return { conversationId: convId, link };
  },

  async joinConferenceByLink(joinLink, isVideo = false, mode = CALL_MODE.PLAIN) {
    await this._endActive();
    patchCallState({
      phase: CALL_PHASE.ACTIVE,
      callType: isVideo ? 'video' : 'audio',
      mode,
      peerName: 'Групповой звонок',
      isGroup: true,
      startedAt: Date.now(),
      errorText: null,
      connectionStatus: 'connecting',
    });
    try {
      let token = joinLink.trim();
      if (token.includes('/')) {
        token = token.split('/').pop();
      }
      const resp = await invoke('enter_call_by_link', {
        joinLink: token,
        isVideo: Boolean(isVideo),
        internalParams: _buildInternalParams(),
      });
      log('enter_call_by_link response:', resp);
      const endpoint = this._extractEndpoint(resp);
      if (!endpoint) throw new Error('No ws2 endpoint in response');
      const convId = resp?.conversationId || token;
      const convParams = this._extractConvParams(resp);
      const session = new MaxCallSession();
      _activeSession = session;
      await session.begin({ endpoint, conversationId: convId, role: 'joiner', isVideo, mode, peerId: null, convParams });
    } catch (e) {
      showAlert('Не удалось присоединиться: ' + (e?.message || e));
      patchCallState({ errorText: String(e?.message || e) });
      resetCallState();
    }
  },

  async deleteCallHistory(historyIds) {
    try {
      await invoke('erase_call_records', { historyIds: historyIds.map(Number) });
    } catch (e) {
      showAlert('Ошибка при удалении: ' + (e?.message || e));
    }
  },

  async toggleScreen() {
    const state = get(activeCall);
    await _activeSession?.enableScreen(!state.screenOn);
  },

  async toggleSecure() {
    const cur = get(activeCall);
    if (cur.mode === CALL_MODE.SECURE && cur.secureStatus === 'active') {
      showAlert(`E2E шифрование активно. Код: ${cur.secureKeyFingerprint || 'OK'}`);
      return;
    }
    if (_activeSession) {
      await _activeSession.enableSecureMode();
    }
  },

  async _endActive() {
    if (_activeSession) {
      _activeSession.destroy();
      _activeSession = null;
    }
  },

  _extractEndpoint(resp) {
    if (!resp) return null;
    if (resp.endpoint) return resp.endpoint;
    const raw = resp.internalCallerParams || resp.internalParams || resp.callerParams;
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed.endpoint || null;
    } catch { return null; }
  },

  _extractConvParams(resp) {
    if (!resp) return null;
    if (resp.conversationParams && typeof resp.conversationParams === 'object') return resp.conversationParams;
    const raw = resp.internalCallerParams || resp.internalParams || resp.callerParams || resp.conversationParams;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed?.conversationParams) return parsed.conversationParams;
        return parsed;
      } catch {}
    }
    return null;
  },

  getActiveSession() { return _activeSession; },
  attachVideoCanvas(canvas) {
    _activeSession?.attachVideoCanvas(canvas);
  },
  detachVideoCanvas(canvas) {
    _activeSession?.detachVideoCanvas(canvas);
  },
};
