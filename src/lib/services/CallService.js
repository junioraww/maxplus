import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get } from 'svelte/store';
import { activeCall, patchCallState, resetCallState, CALL_PHASE, CALL_MODE } from '$lib/stores/calls.js';
import { CallEncryptionSession, generateCallKeyPair, exportPublicKeyBytes, deriveSharedSecret } from '$lib/crypto/callEncryption.js';
import { mediaPipeline } from '$lib/services/MediaPipelineHost.js';
import { showAlert } from '$lib/utils/alert.js';
import { currentUser } from '$lib/stores/api.js';
import { createSyntheticAudioStream, createSyntheticVideoStream } from '$lib/utils/mediaFallback.js';
import { startIncomingRingtone, startOutgoingRingback, stopCallAudio, playRejectionTone } from '$lib/services/callAudio.js';
import { showDesktopCallNotification, cancelDesktopCallNotification } from '$lib/utils/notifications.js';
import { getContactDirect } from '$lib/stores/contacts.js';
import { LinuxFallbackPeerConnection } from '$lib/services/LinuxFallbackPeerConnection.js';

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
  }
  if (screenTrackId) {
    const escaped = screenTrackId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result
      .replace(new RegExp(`^a=msid:(\\S+) ${escaped}\\s*$`, 'gm'), `a=msid:$1 ${prefix}:sSCREEN`)
      .replace(new RegExp(`^(a=ssrc:\\d+ msid:\\S+) ${escaped}\\s*$`, 'gm'), `$1 ${prefix}:sSCREEN`)
      .replace(new RegExp(`^(a=ssrc:\\d+ label:)${escaped}\\s*$`, 'gm'), `$1${prefix}:sSCREEN`);
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

function alignSdpMLines(answerSdp, offerSdp) {
  if (!answerSdp || !offerSdp) return answerSdp;

  const parseCleanSdp = (sdp) => {
    const rawLines = sdp.split(/\r?\n/);
    const sessionLines = [];
    const mSections = [];
    let cur = null;

    for (const raw of rawLines) {
      const line = raw.trim();
      if (!line || !/^[a-zA-Z0-9_-]+=/.test(line)) continue;
      if (line.startsWith('m=')) {
        if (cur) mSections.push(cur);
        const m = line.match(/^m=(\w+)/i);
        cur = {
          type: m ? m[1].toLowerCase() : '',
          mid: null,
          direction: 'sendrecv',
          lines: [line],
        };
      } else if (cur) {
        cur.lines.push(line);
        const midMatch = line.match(/^a=mid:(\S+)/i);
        if (midMatch) cur.mid = midMatch[1];
        if (line === 'a=sendrecv' || line === 'a=sendonly' || line === 'a=recvonly' || line === 'a=inactive') {
          cur.direction = line.substring(2);
        }
      } else {
        sessionLines.push(line);
      }
    }
    if (cur) mSections.push(cur);
    return { sessionLines, mSections };
  };

  const offer = parseCleanSdp(offerSdp);
  const answer = parseCleanSdp(answerSdp);

  if (!offer.mSections.length || !answer.mSections.length) return answerSdp;

  const remaining = [...answer.mSections];
  const ordered = [];

  for (const offSec of offer.mSections) {
    let idx = -1;
    if (offSec.mid) {
      idx = remaining.findIndex(s => s.mid === offSec.mid && s.type === offSec.type);
      if (idx === -1) {
        idx = remaining.findIndex(s => s.mid === offSec.mid);
      }
    }
    if (idx === -1 && offSec.type) {
      idx = remaining.findIndex(s => s.type === offSec.type);
    }
    if (idx !== -1) {
      const matched = remaining.splice(idx, 1)[0];
      if (offSec.mid) {
        matched.lines = matched.lines.map(l => l.startsWith('a=mid:') ? `a=mid:${offSec.mid}` : l);
        if (!matched.lines.some(l => l.startsWith('a=mid:'))) {
          matched.lines.push(`a=mid:${offSec.mid}`);
        }
        matched.mid = offSec.mid;
      }
      let targetDir = matched.direction || 'sendrecv';
      if (offSec.direction === 'recvonly') {
        if (targetDir === 'sendrecv' || targetDir === 'sendonly') targetDir = 'sendonly';
        else targetDir = 'inactive';
      } else if (offSec.direction === 'sendonly') {
        if (targetDir === 'sendrecv' || targetDir === 'recvonly') targetDir = 'recvonly';
        else targetDir = 'inactive';
      } else if (offSec.direction === 'inactive') {
        targetDir = 'inactive';
      }
      matched.lines = matched.lines.filter(l => !['a=sendrecv', 'a=sendonly', 'a=recvonly', 'a=inactive'].includes(l));
      matched.lines.push(`a=${targetDir}`);
      matched.direction = targetDir;
      ordered.push(matched);
    } else {
      const proto = offSec.type === 'application' ? 'UDP/DTLS/SCTP webrtc-datachannel' : 'UDP/TLS/RTP/SAVPF 0';
      const lines = [
        `m=${offSec.type} 0 ${proto}`,
        'c=IN IP4 0.0.0.0',
      ];
      if (offSec.mid) {
        lines.push(`a=mid:${offSec.mid}`);
      }
      lines.push('a=inactive');
      ordered.push({
        type: offSec.type,
        mid: offSec.mid,
        direction: 'inactive',
        lines,
      });
    }
  }

  const activeMids = ordered.filter(s => {
    const mLine = s.lines[0] || '';
    const portMatch = mLine.match(/^m=\w+\s+(\d+)/);
    const port = portMatch ? parseInt(portMatch[1], 10) : 0;
    return port > 0 && s.mid;
  }).map(s => s.mid);

  let sessionLines = answer.sessionLines.filter(l => !l.startsWith('a=group:BUNDLE'));
  if (activeMids.length > 0) {
    sessionLines.push(`a=group:BUNDLE ${activeMids.join(' ')}`);
  }

  const resultLines = [...sessionLines];
  for (const sec of ordered) {
    resultLines.push(...sec.lines);
  }

  return resultLines.join('\r\n') + '\r\n';
}

function getRTCPeerConnection() {
  if (typeof window !== 'undefined') {
    const pc = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (pc) return pc;
  }
  if (typeof globalThis !== 'undefined') {
    const pc = globalThis.RTCPeerConnection || globalThis.webkitRTCPeerConnection;
    if (pc) return pc;
  }
  return LinuxFallbackPeerConnection;
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
    log('ws2 connecting →', url);
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
        log('ws2 parse error:', err, e.data);
      }
    };

    this.#socket.onclose = (ev) => {
      log('ws2 closed', ev.code, ev.reason);
      if (ev.code !== 1000 && ev.reason) {
        patchCallState({ errorText: ev.reason });
      }
      onClose?.();
    };

    this.#socket.onerror = (ev) => {
      log('ws2 error event', ev);
      onClose?.();
    };

    return new Promise((resolve, reject) => {
      this.#socket.onopen = () => {
        log('ws2 open ✓');
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
    log(`ws2 ← [${name ?? 'NO-TYPE'}]`, msg);

    if (msg.type === 'error' || msg.error) {
      const errorMsg = msg.message || msg.error || 'Server error';
      log('ws2 server error:', errorMsg);
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
    log(`ws2 → [${cmd}]`, msg);
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
  #localStream = null;
  #cameraStream = null;
  #screenStream = null;
  #encryption = new CallEncryptionSession();
  #destroyed = false;
  #conversationId = null;
  #contactPeerId = null;
  #ws2PeerId = null;
  #pendingOffer = false;
  #pendingLocalCandidates = [];
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
  #androidScreenCapture = null;
  #unlistenScreenCaptureStopped = null;
  #cameraToggling = false;
  #remoteStream = null;
  #participantStreams = new Map();
  #signalQueue = Promise.resolve();
  #iceRestarting = false;

  get encryption() { return this.#encryption; }

  #applyTrackLabels(sdp) {
    const camTrack = this.#cameraStream?.getVideoTracks()[0]?.id;
    const scrTrack = this.#screenStream?.getVideoTracks()[0]?.id;
    return labelLocalTracks(sdp, this.#myCallUserId, camTrack, scrTrack);
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
    let myCallUserId = null;
    try {
      const parsedUrl = new URL(endpoint);
      myCallUserId = parsedUrl.searchParams.get('userId');
    } catch {}
    this.#myCallUserId = myCallUserId;
    patchCallState({ myCallUserId });
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

    if (mode === CALL_MODE.SECURE) {
      try {
        this._keyPair = await generateCallKeyPair();
        this._myPublicKeyBytes = await exportPublicKeyBytes(this._keyPair);
        patchCallState({
          mode: CALL_MODE.SECURE,
          secureStatus: 'negotiating',
          secureKeyFingerprint: null,
        });
      } catch (err) {
        log('secure init failed:', err);
      }
    }

    await this.#captureMedia(isVideo);
    await this.#openVoiceChannel(endpoint);
  }

  async enableSecureMode() {
    try {
      this._keyPair = await generateCallKeyPair();
      this._myPublicKeyBytes = await exportPublicKeyBytes(this._keyPair);
      patchCallState({
        mode: CALL_MODE.SECURE,
        secureStatus: 'negotiating',
        secureKeyFingerprint: null,
      });

      if (this.#dataChannel && this.#dataChannel.readyState === 'open') {
        this.#dataChannel.send(JSON.stringify({
          type: 'e2e-pubkey',
          pubkey: Array.from(this._myPublicKeyBytes),
        }));
        showAlert('Запрос E2E шифрования отправлен...');
      } else if (this.#dtlsFingerprint) {
        const fpCode = this.#formatFingerprintCode(this.#dtlsFingerprint);
        patchCallState({
          secureStatus: 'active',
          secureKeyFingerprint: fpCode,
        });
        showAlert('E2E (DTLS-SRTP) активно. Код: ' + fpCode);
        return;
      } else {
        showAlert('Запрос E2E шифрования отправлен...');
      }

      setTimeout(() => {
        if (!this.#destroyed && this.#encryption.mode === 'plain') {
          if (this.#dtlsFingerprint) {
            const fpCode = this.#formatFingerprintCode(this.#dtlsFingerprint);
            patchCallState({
              secureStatus: 'active',
              secureKeyFingerprint: fpCode,
            });
          } else {
            patchCallState({ secureStatus: 'unsupported' });
            showAlert('Собеседник не поддерживает E2E шифрование');
          }
        }
      }, 5000);
    } catch (e) {
      log('enableSecureMode error:', e);
      showAlert('Не удалось запросить E2E шифрование');
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
      return;
    }
    this.#dataChannel = dc;
    dc.onopen = () => {
      if (this.#encryption.mode === CALL_MODE.SECURE) {
        log('e2e data channel opened');
        if (this._myPublicKeyBytes) {
          try {
            dc.send(JSON.stringify({
              type: 'e2e-pubkey',
              pubkey: Array.from(this._myPublicKeyBytes),
            }));
          } catch {}
        }
      }
    };
    dc.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'e2e-pubkey' && Array.isArray(msg.pubkey)) {
          await this.#handlePeerPublicKey(new Uint8Array(msg.pubkey));
        }
      } catch {}
    };
  }

  async #handlePeerPublicKey(peerPubBytes) {
    try {
      if (!this._keyPair) {
        this._keyPair = await generateCallKeyPair();
        this._myPublicKeyBytes = await exportPublicKeyBytes(this._keyPair);
        if (this.#dataChannel && this.#dataChannel.readyState === 'open') {
          this.#dataChannel.send(JSON.stringify({
            type: 'e2e-pubkey',
            pubkey: Array.from(this._myPublicKeyBytes),
          }));
        }
      }
      const secret = await deriveSharedSecret(this._keyPair.privateKey, peerPubBytes);
      await this.#encryption.initSecure(secret);
      if (this.#pc) {
        for (const sender of this.#pc.getSenders()) this.#encryption.applyToSender(sender);
        for (const receiver of this.#pc.getReceivers()) this.#encryption.applyToReceiver(receiver);
      }
      patchCallState({
        mode: CALL_MODE.SECURE,
        secureStatus: 'active',
        secureKeyFingerprint: this.#encryption.fingerprint,
      });
      showAlert('E2E шифрование установлено. Код: ' + this.#encryption.fingerprint);
    } catch (err) {
      log('Failed to handle peer public key:', err);
    }
  }

  #extractAndApplyFingerprint(sdp) {
    if (!sdp) return;
    const m = sdp.match(/^a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/m);
    if (!m) return;
    this.#dtlsFingerprint = m[1];
    if (get(activeCall).mode === CALL_MODE.SECURE && get(activeCall).phase === CALL_PHASE.ACTIVE) {
      const code = this.#formatFingerprintCode(m[1]);
      if (code) {
        patchCallState({ secureStatus: 'active', secureKeyFingerprint: code });
      }
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

  #onAcceptedCall(msg) {
    log('accepted-call received');
    stopCallAudio();
    patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: get(activeCall).startedAt || Date.now() });
    const pid = msg.participantId || msg.userId || msg.id;
    if (pid && String(pid) !== String(this.#myCallUserId)) {
      this.#ws2PeerId = String(pid);
      this.#transmitPendingOffer();
    }
  }

  async #transmitPendingOffer() {
    if (!this.#pendingOffer || !this.#ws2PeerId || !this.#pc?.localDescription) return;
    this.#pendingOffer = false;
    try {
      await this.#voiceChannel?.send('transmit-data', {
        participantId: Number(this.#ws2PeerId),
        participantType: 'USER',
        deviceIdx: 0,
        data: {
          sdp: {
            type: this.#pc.localDescription.type || 'offer',
            sdp: this.#applyTrackLabels(this.#pc.localDescription.sdp),
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
        participantType: 'USER',
        deviceIdx: 0,
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

    log(`instantiating RTCPeerConnection (${PeerConnection.name || 'Anonymous'}), iceServers:`, this.#iceServers);
    const pc = new PeerConnection({
      iceServers: this.#iceServers,
      sdpSemantics: 'unified-plan',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        log('ICE candidate local:', e.candidate.candidate);
        const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
        if (this.#topology !== 'SERVER' && targetPeerId && !this.#pendingOffer) {
          this.#voiceChannel?.send('transmit-data', {
            participantId: Number(targetPeerId),
            participantType: 'USER',
            deviceIdx: 0,
            data: {
              candidate: {
                candidate: e.candidate.candidate,
                sdpMid: e.candidate.sdpMid,
                sdpMLineIndex: e.candidate.sdpMLineIndex ?? 0,
              },
            },
            capabilities: WS2_CAPABILITIES,
          }).catch((err) => {
            log('transmit-data candidate error:', err?.message || err);
          });
        } else if (this.#topology !== 'SERVER') {
          this.#pendingLocalCandidates.push(e.candidate);
        }
      } else {
        log('ICE candidate gathering completed');
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      log('ICE connection state:', state);
      patchCallState({ connectionStatus: state });
      this.#checkActive(pc);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      log('Peer connection state:', state);
      patchCallState({ connectionStatus: state });
      this.#checkActive(pc);
    };

    pc.ontrack = (e) => {
      const track = e.track;
      log(`Remote media track received: kind=${track.kind} id=${track.id} readyState=${track.readyState} enabled=${track.enabled} muted=${track.muted}`);
      track.onmute = () => {
        log(`Remote track muted: ${track.kind} ${track.id}`);
      };
      track.onunmute = () => {
        log(`Remote track unmuted: ${track.kind} ${track.id}`);
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
        log(`Remote track ended: ${track.kind} ${track.id}`);
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
        this.#encryption.applyToReceiver(e.receiver);
      }
    };

    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) {
        const sender = pc.addTrack(track, this.#localStream);
        if (this.#encryption.mode === CALL_MODE.SECURE) {
          this.#encryption.applyToSender(sender);
        }
      }
    } else {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }

    if (this.#cameraStream) {
      for (const track of this.#cameraStream.getVideoTracks()) {
        const sender = pc.addTrack(track, this.#cameraStream);
        if (this.#encryption.mode === CALL_MODE.SECURE) {
          this.#encryption.applyToSender(sender);
        }
      }
    } else if (this.#screenStream) {
      for (const track of this.#screenStream.getVideoTracks()) {
        const sender = pc.addTrack(track, this.#screenStream);
        if (this.#encryption.mode === CALL_MODE.SECURE) {
          this.#encryption.applyToSender(sender);
        }
      }
    } else {
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }

    if (this.#encryption.mode === CALL_MODE.SECURE) {
      try {
        const dc = pc.createDataChannel('max-e2e', { negotiated: true, id: 0 });
        this.#setupDataChannel(dc);
      } catch {}
    }

    pc.ondatachannel = (e) => {
      if (e.channel) this.#setupDataChannel(e.channel);
    };

    this.#pc = pc;
    return pc;
  }

  #resolveParticipantIdFromTrack(trackId) {
    if (!trackId) return null;
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
        patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: cur.startedAt || Date.now() });
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
              bundlePolicy: 'max-bundle',
              rtcpMuxPolicy: 'require',
            });
          } catch (e) {
            log('setConfiguration error:', e);
          }
        }
      }

      const isGroup = get(activeCall).isGroup || this.#topology === 'SERVER';
      const myId = String(this.#myCallUserId || '');

      if (Array.isArray(conversation.participants)) {
        const roster = conversation.participants
          .filter(p => String(p.userId || p.id) !== myId)
          .map(parseParticipant);
        patchCallState({ participants: roster, roomName: conversation.name || conversation.title || null });
        const peer = roster.find(p => p.id && p.id !== myId);
        if (peer) {
          this.#ws2PeerId = peer.id;
          patchCallState({
            peerVideoOn: Boolean(peer.videoOn),
            peerScreenOn: Boolean(peer.screenOn),
          });
        }
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

      if (this.#role === 'originator') {
        patchCallState({ phase: CALL_PHASE.OUTGOING });
        const offer = await pc.createOffer(OFFER_CONSTRAINTS);
        await pc.setLocalDescription(offer);
        const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || offer.sdp);
        this.#extractAndApplyFingerprint(localSdp);
        if (targetPeerId) {
          await this.#voiceChannel.send('transmit-data', {
            participantId: Number(targetPeerId),
            participantType: 'USER',
            deviceIdx: 0,
            data: {
              sdp: { type: offer.type || 'offer', sdp: localSdp },
            },
            capabilities: WS2_CAPABILITIES,
          });
          await this.#flushPendingLocalCandidates();
        } else {
          this.#pendingOffer = true;
        }
      } else if (this.#role === 'joiner') {
        const offer = await pc.createOffer(OFFER_CONSTRAINTS);
        await pc.setLocalDescription(offer);
        const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || offer.sdp);
        this.#extractAndApplyFingerprint(localSdp);
        if (targetPeerId) {
          await this.#voiceChannel.send('transmit-data', {
            participantId: Number(targetPeerId),
            participantType: 'USER',
            deviceIdx: 0,
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
        this.#sfuSessionId = msg.sessionId;
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

      if (!sdp) {
        log('producer-updated payload had no SDP description', msg);
        return;
      }

      const ssrcs = this.#extractSsrcs(sdp);
      this.#extractAndApplyFingerprint(sdp);

      const pc = await this.#buildPeerConnection();
      const SessionDesc = getRTCSessionDescription();
      const descObj = SessionDesc ? new SessionDesc({ type, sdp }) : { type, sdp };
      await pc.setRemoteDescription(descObj);
      this.#remoteDescSet = true;
      await this.#flushCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.#gatherDone();

      const answerSdp = this.#applyTrackLabels(pc.localDescription?.sdp || answer.sdp || '');
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
      if (rawPeerId && !this.#ws2PeerId) {
        this.#ws2PeerId = String(rawPeerId);
        this.#transmitPendingOffer();
      }

      const sdpData = signal.sdp || (signal.type ? signal : null);

      const pc = await this.#buildPeerConnection();
      if (!pc || this.#destroyed) return;

      if (sdpData && sdpData.type) {
        const type = sdpData.type;
        const sdp = sdpData.sdp || sdpData.description || '';
        log(`Signaling transmitted SDP received: type=${type}`);
        this.#extractAndApplyFingerprint(sdp);

        if (type === 'answer') {
          if (pc.signalingState !== 'have-local-offer') {
            log(`Ignoring remote answer in signaling state: ${pc.signalingState}`);
            return;
          }
        }

        if (type === 'offer' && pc.signalingState === 'have-local-offer') {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch {}
        }

        const finalSdp = type === 'answer' ? alignSdpMLines(sdp, pc.localDescription?.sdp) : sdp;
        const SessionDesc = getRTCSessionDescription();
        let descObj = SessionDesc ? new SessionDesc({ type, sdp: finalSdp }) : { type, sdp: finalSdp };
        try {
          await pc.setRemoteDescription(descObj);
        } catch (err) {
          if (type === 'answer' && pc.signalingState === 'stable') {
            log('Answer already applied, ignoring duplicate error');
            return;
          }
          if (finalSdp !== sdp) {
            log('setRemoteDescription aligned fallback to raw SDP:', err);
            descObj = SessionDesc ? new SessionDesc({ type, sdp }) : { type, sdp };
            try {
              await pc.setRemoteDescription(descObj);
            } catch (err2) {
              if (type === 'answer' && pc.signalingState === 'stable') {
                return;
              }
              throw err2;
            }
          } else {
            throw err;
          }
        }
        this.#remoteDescSet = true;
        await this.#flushCandidates();

        if (type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || answer.sdp);
          const targetPeerId = this.#ws2PeerId || this.#contactPeerId;
          if (targetPeerId) {
            await this.#voiceChannel.send('transmit-data', {
              participantId: Number(targetPeerId),
              participantType: 'USER',
              deviceIdx: 0,
              data: {
                sdp: { type: 'answer', sdp: localSdp },
              },
              capabilities: WS2_CAPABILITIES,
            });
            await this.#flushPendingLocalCandidates();
          }
        } else if (type === 'answer') {
          stopCallAudio();
          patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: get(activeCall).startedAt || Date.now() });
        }
      } else {
        const rawCandidates = Array.isArray(signal.candidates)
          ? signal.candidates
          : (signal.candidate ? [signal.candidate] : (signal.ice ? [signal.ice] : []));
        for (const item of rawCandidates) {
          if (!item) continue;
          const candidateStr = typeof item === 'string' ? item : (item.candidate || '');
          if (!candidateStr || typeof candidateStr !== 'string' || !candidateStr.trim()) continue;
          const sdpMid = item.sdpMid != null ? String(item.sdpMid) : undefined;
          const sdpMLineIndex = item.sdpMLineIndex != null ? Number(item.sdpMLineIndex) : undefined;
          log(`Remote ICE candidate received: ${candidateStr} (mid=${sdpMid}, mline=${sdpMLineIndex})`);
          const IceCand = getRTCIceCandidate();
          const candidateObj = IceCand
            ? new IceCand({ candidate: candidateStr, ...(sdpMid != null ? { sdpMid } : {}), ...(sdpMLineIndex != null ? { sdpMLineIndex } : {}) })
            : { candidate: candidateStr, sdpMid, sdpMLineIndex };
          if (this.#remoteDescSet) {
            try {
              await pc.addIceCandidate(candidateObj);
              log('Remote ICE candidate added successfully');
            } catch (candErr) {
              log('Failed to add remote ICE candidate:', candErr?.message || candErr);
            }
          } else {
            this.#pendingCandidates.push(candidateObj);
          }
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
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(() => {
        log('ICE gathering wait timed out, continuing');
        resolve();
      }, 4000);
    });
  }

  #onPeerMedia(msg) {
    const ms = msg.mediaSettings || {};
    const pid = String(msg.participantId || '');
    const myId = String(this.#myCallUserId || '');
    if (pid && pid !== myId) {
      patchCallState({
        peerVideoOn: Boolean(ms.isVideoEnabled),
        peerScreenOn: Boolean(ms.isScreenSharingEnabled),
      });
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
    if (this.#destroyed || this.#iceRestarting) return;
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
          participantType: 'USER',
          deviceIdx: 0,
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
      if (on && !this.#cameraStream) {
        patchCallState({ videoOn: true, cameraLoading: true });
        try {
          try {
            this.#cameraStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            });
          } catch {
            this.#cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
          }
        } catch (e) {
          log('getUserMedia video failed, using synthetic fallback:', e?.name, e?.message);
          try {
            this.#syntheticVideo = createSyntheticVideoStream();
            this.#cameraStream = this.#syntheticVideo.stream;
          } catch (err) {
            showAlert('Не удалось получить доступ к камере');
            patchCallState({ videoOn: false, localCameraStream: null, cameraLoading: false });
            return;
          }
        }

        mediaPipeline.setSourceTracks(this.#cameraStream.getVideoTracks()[0], this.#localStream?.getAudioTracks()[0] || null);
        const processedStream = mediaPipeline.getProcessedVideoStream();
        const track = processedStream?.getVideoTracks()[0] || this.#cameraStream.getVideoTracks()[0];
        if (track && this.#pc) {
          const senders = typeof this.#pc.getSenders === 'function' ? this.#pc.getSenders() : [];
          let sender = senders.find(s => s.track?.kind === 'video');
          const transceivers = typeof this.#pc.getTransceivers === 'function' ? this.#pc.getTransceivers() : [];
          const transceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
          if (transceiver) {
            transceiver.direction = 'sendrecv';
            sender = transceiver.sender;
          }
          if (sender) await sender.replaceTrack(track);
          else {
            const s = this.#pc.addTrack(track, processedStream || this.#cameraStream);
            if (this.#encryption.mode === CALL_MODE.SECURE) this.#encryption.applyToSender(s);
          }
          if (this.#topology !== 'SERVER') {
            await this.#renegotiate();
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
        if (this.#topology !== 'SERVER') {
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
    if (!this.#pc || this.#topology === 'SERVER' || !this.#ws2PeerId) return;
    try {
      const offer = await this.#pc.createOffer(OFFER_CONSTRAINTS);
      await this.#pc.setLocalDescription(offer);
      const localSdp = this.#applyTrackLabels(this.#pc.localDescription?.sdp || offer.sdp);
      this.#extractAndApplyFingerprint(localSdp);
      await this.#voiceChannel?.send('transmit-data', {
        participantId: Number(this.#ws2PeerId),
        participantType: 'USER',
        deviceIdx: 0,
        data: {
          sdp: { type: offer.type || 'offer', sdp: localSdp },
        },
        capabilities: WS2_CAPABILITIES,
      });
      await this.#flushPendingLocalCandidates();
    } catch (e) {
      log('renegotiate error:', e);
    }
  }

  async enableScreen(on) {
    if (this.#destroyed) return;
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
          let sender = senders.find(s => s.track?.kind === 'video' && !get(activeCall).videoOn);
          const transceivers = typeof this.#pc.getTransceivers === 'function' ? this.#pc.getTransceivers() : [];
          const transceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
          if (transceiver && !get(activeCall).videoOn) {
            transceiver.direction = 'sendrecv';
            sender = transceiver.sender;
          }
          if (sender) await sender.replaceTrack(track);
          else {
            const s = this.#pc.addTrack(track, this.#screenStream);
            if (this.#encryption.mode === CALL_MODE.SECURE) this.#encryption.applyToSender(s);
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
      if (transceiver && !get(activeCall).videoOn) {
        transceiver.direction = 'recvonly';
        await transceiver.sender?.replaceTrack(null);
      } else {
        const senders = typeof this.#pc?.getSenders === 'function' ? this.#pc.getSenders() : [];
        const sender = senders.find(s => s.track?.kind === 'video' && get(activeCall).screenOn);
        await sender?.replaceTrack(null);
      }
      if (this.#topology !== 'SERVER') {
        await this.#renegotiate();
      }
      patchCallState({ screenOn: false, localScreenStream: null });
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
    try { this.#pc?.close(); } catch {}
    this.#pc = null;
    this.#voiceChannel = null;
    this.#sfuCommandChannel = null;
    invoke('cancel_call_notification').catch(() => {});
    setTimeout(() => {
      resetCallState();
    }, 320);
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
      const isVideo = Boolean(pushData.isVideo || convParams.iv);
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
};
