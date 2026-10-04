import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { activeCall, patchCallState, resetCallState, CALL_PHASE, CALL_MODE } from '$lib/stores/calls.js';
import { CallEncryptionSession, generateCallKeyPair, exportPublicKeyBytes, deriveSharedSecret } from '$lib/crypto/callEncryption.js';
import { mediaPipeline } from '$lib/services/MediaPipelineHost.js';
import { showAlert } from '$lib/utils/alert.js';
import { currentUser } from '$lib/stores/api.js';

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
  console.log('[call]', ...args);
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

function getRTCPeerConnection() {
  if (typeof window !== 'undefined') {
    return window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection || null;
  }
  if (typeof globalThis !== 'undefined') {
    return globalThis.RTCPeerConnection || globalThis.webkitRTCPeerConnection || null;
  }
  return null;
}

function getRTCSessionDescription() {
  if (typeof window !== 'undefined') {
    return window.RTCSessionDescription || window.webkitRTCSessionDescription || null;
  }
  if (typeof globalThis !== 'undefined') {
    return globalThis.RTCSessionDescription || null;
  }
  return null;
}

function getRTCIceCandidate() {
  if (typeof window !== 'undefined') {
    return window.RTCIceCandidate || window.webkitRTCIceCandidate || null;
  }
  if (typeof globalThis !== 'undefined') {
    return globalThis.RTCIceCandidate || null;
  }
  return null;
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
  #peerId = null;
  #myCallUserId = null;
  #topology = null;
  #iceServers = ICE_DEFAULTS;
  #pendingCandidates = [];
  #remoteDescSet = false;
  #role = null;
  #sfuSessionId = null;
  #dtlsFingerprint = null;

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

  async begin({ endpoint, conversationId, role, isVideo, mode, peerId = null }) {
    this.#conversationId = conversationId;
    this.#role = role;
    this.#peerId = peerId;
    let myCallUserId = null;
    try {
      const parsedUrl = new URL(endpoint);
      myCallUserId = parsedUrl.searchParams.get('userId');
    } catch {}
    this.#myCallUserId = myCallUserId;
    patchCallState({ myCallUserId });
    log(`begin session: role=${role} isVideo=${isVideo} mode=${mode} convId=${conversationId} myCallUserId=${myCallUserId}`);

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
      log('e2e data channel opened');
      if (this._myPublicKeyBytes) {
        try {
          dc.send(JSON.stringify({
            type: 'e2e-pubkey',
            pubkey: Array.from(this._myPublicKeyBytes),
          }));
        } catch {}
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
    ch.on('accepted-call', () => {
      log('accepted-call received');
      patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: get(activeCall).startedAt || Date.now() });
    });
    ch.on('hungup', (msg) => {
      log('hungup', msg);
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
      log('getUserMedia audio unavailable:', e.name, e.message);
      patchCallState({ muted: true, localStream: null });
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

    log('instantiating RTCPeerConnection, iceServers:', this.#iceServers);
    const pc = new PeerConnection({
      iceServers: this.#iceServers,
      sdpSemantics: 'unified-plan',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        log('ICE candidate local:', e.candidate.type, e.candidate.protocol);
        if (this.#topology !== 'SERVER' && this.#peerId) {
          this.#voiceChannel?.send('transmit-data', {
            participantId: Number(this.#peerId),
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
          }).catch(() => {});
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
      log('Remote media track received:', e.track.kind, e.track.id);
      const track = e.track;
      const stream = e.streams[0] || new MediaStream([track]);
      patchCallState({ remoteStream: stream });
      const targetId = this.#resolveParticipantIdFromTrack(track.id) || this.#peerId;
      if (targetId) {
        const streams = { ...get(activeCall).participantStreams, [String(targetId)]: stream };
        patchCallState({ participantStreams: streams });
      }
      if (this.#encryption.mode === CALL_MODE.SECURE) {
        this.#encryption.applyToReceiver(e.receiver);
      }
    };

    try {
      const dc = pc.createDataChannel('max-e2e', { negotiated: true, id: 0 });
      this.#setupDataChannel(dc);
    } catch {}

    pc.ondatachannel = (e) => {
      if (e.channel) this.#setupDataChannel(e.channel);
    };

    if (this.#localStream) {
      for (const track of this.#localStream.getTracks()) {
        const sender = pc.addTrack(track, this.#localStream);
        if (this.#encryption.mode === CALL_MODE.SECURE) {
          this.#encryption.applyToSender(sender);
        }
      }
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    if (!this.#cameraStream && !this.#screenStream) {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

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
      const ice = this.#parseIceServers(msg.conversationParams || {});
      if (ice.length) {
        this.#iceServers = ice;
      }

      const isGroup = get(activeCall).isGroup || this.#topology === 'SERVER';
      const myId = String(this.#myCallUserId || '');

      if (Array.isArray(conversation.participants)) {
        const roster = conversation.participants
          .filter(p => String(p.userId || p.id) !== myId)
          .map(parseParticipant);
        patchCallState({ participants: roster, roomName: conversation.name || conversation.title || null });
        if (!this.#peerId && roster.length > 0) {
          this.#peerId = roster[0].id;
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

      if (this.#role === 'originator') {
        patchCallState({ phase: CALL_PHASE.OUTGOING });
        const offer = await pc.createOffer(OFFER_CONSTRAINTS);
        await pc.setLocalDescription(offer);
        await this.#gatherDone();
        const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || offer.sdp);
        this.#extractAndApplyFingerprint(localSdp);
        if (this.#peerId) {
          await this.#voiceChannel.send('transmit-data', {
            participantId: Number(this.#peerId),
            participantType: 'USER',
            deviceIdx: 0,
            data: {
              sdp: { type: offer.type || 'offer', sdp: localSdp },
            },
            capabilities: WS2_CAPABILITIES,
          });
        }
      } else if (this.#role === 'joiner' || this.#role === 'responder') {
        const offer = await pc.createOffer(OFFER_CONSTRAINTS);
        await pc.setLocalDescription(offer);
        await this.#gatherDone();
        const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || offer.sdp);
        this.#extractAndApplyFingerprint(localSdp);
        if (this.#peerId) {
          await this.#voiceChannel.send('transmit-data', {
            participantId: Number(this.#peerId),
            participantType: 'USER',
            deviceIdx: 0,
            data: {
              sdp: { type: offer.type || 'offer', sdp: localSdp },
            },
            capabilities: WS2_CAPABILITIES,
          });
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

  async #onRemoteSignal(msg) {
    try {
      const raw = msg.data;
      if (!raw) return;
      let signal;
      try {
        signal = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return;
      }

      if (msg.participantId && !this.#peerId) {
        this.#peerId = msg.participantId;
      }

      const sdpData = signal.sdp || (signal.type ? signal : null);
      const candData = signal.candidate;

      const pc = await this.#buildPeerConnection();

      if (sdpData && sdpData.type) {
        const type = sdpData.type;
        const sdp = sdpData.sdp || sdpData.description || '';
        log(`Signaling transmitted SDP received: type=${type}`);
        this.#extractAndApplyFingerprint(sdp);

        const SessionDesc = getRTCSessionDescription();
        const descObj = SessionDesc ? new SessionDesc({ type, sdp }) : { type, sdp };
        await pc.setRemoteDescription(descObj);
        this.#remoteDescSet = true;
        await this.#flushCandidates();

        if (type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this.#gatherDone();
          const localSdp = this.#applyTrackLabels(pc.localDescription?.sdp || answer.sdp);
          if (this.#peerId) {
            await this.#voiceChannel.send('transmit-data', {
              participantId: Number(this.#peerId),
              participantType: 'USER',
              deviceIdx: 0,
              data: {
                sdp: { type: 'answer', sdp: localSdp },
              },
              capabilities: WS2_CAPABILITIES,
            });
          }
        } else if (type === 'answer') {
          patchCallState({ phase: CALL_PHASE.ACTIVE, startedAt: get(activeCall).startedAt || Date.now() });
        }
      } else if (candData) {
        const candidateStr = typeof candData === 'string' ? candData : (candData.candidate || '');
        const sdpMid = candData.sdpMid ?? '0';
        const sdpMLineIndex = candData.sdpMLineIndex ?? 0;
        const IceCand = getRTCIceCandidate();
        const candidateObj = IceCand
          ? new IceCand({ candidate: candidateStr, sdpMid, sdpMLineIndex })
          : { candidate: candidateStr, sdpMid, sdpMLineIndex };
        if (this.#remoteDescSet) {
          await pc.addIceCandidate(candidateObj).catch(() => {});
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
    if (!pc) return;
    for (const c of this.#pendingCandidates) {
      await pc.addIceCandidate(c).catch(() => {});
    }
    this.#pendingCandidates = [];
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
    if (!this.#peerId) {
      this.#peerId = p.id;
      if (this.#role === 'originator' && this.#pc?.localDescription) {
        this.#voiceChannel?.send('transmit-data', {
          participantId: Number(this.#peerId),
          participantType: 'USER',
          deviceIdx: 0,
          data: {
            sdp: { type: this.#pc.localDescription.type || 'offer', sdp: this.#applyTrackLabels(this.#pc.localDescription.sdp) },
          },
          capabilities: WS2_CAPABILITIES,
        }).catch(() => {});
      }
    }
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
    if (!get(activeCall).isGroup && (id === String(this.#peerId) || cur.length === 0)) {
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
    if (!this.#peerId && roster.length > 0) {
      this.#peerId = roster[0].id;
    }
    this.#sendSfuDisplayLayout();
  }

  async #attemptIceRestart() {
    if (this.#destroyed) return;
    try {
      const pc = this.#pc;
      if (!pc) return;
      log('Attempting ICE restart');
      const offer = await pc.createOffer({ ...OFFER_CONSTRAINTS, iceRestart: true });
      await pc.setLocalDescription(offer);
      if (this.#topology !== 'SERVER' && this.#peerId) {
        await this.#voiceChannel?.send('transmit-data', {
          participantId: Number(this.#peerId),
          participantType: 'USER',
          deviceIdx: 0,
          data: {
            sdp: { type: offer.type || 'offer', sdp: pc.localDescription.sdp },
          },
          capabilities: WS2_CAPABILITIES,
        });
      }
    } catch (e) {
      log('ICE restart error:', e.message);
    }
  }

  #onChannelLost() {
    log('Voice channel disconnected');
    if (!this.#destroyed) {
      patchCallState({ connectionStatus: 'disconnected' });
    }
  }

  #parseIceServers(convParams) {
    const servers = [];
    const raw = convParams.iceServers || convParams.stunServers || [];
    for (const s of raw) {
      if (s.url || s.urls) {
        servers.push({ urls: s.urls || s.url, username: s.username, credential: s.credential });
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
    if (on && !this.#cameraStream) {
      try {
        try {
          this.#cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          });
        } catch {
          this.#cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
        mediaPipeline.setSourceTracks(this.#cameraStream.getVideoTracks()[0], this.#localStream?.getAudioTracks()[0] || null);
        const processedStream = mediaPipeline.getProcessedVideoStream();
        const track = processedStream?.getVideoTracks()[0];
        if (track && this.#pc) {
          const sender = this.#pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(track);
          else {
            const s = this.#pc.addTrack(track, processedStream);
            if (this.#encryption.mode === CALL_MODE.SECURE) this.#encryption.applyToSender(s);
          }
        }
        patchCallState({ videoOn: true, localCameraStream: this.#cameraStream });
      } catch (e) {
        log('getUserMedia video failed:', e.name, e.message);
        showAlert('Не удалось получить доступ к камере');
        return;
      }
    } else if (!on && this.#cameraStream) {
      for (const t of this.#cameraStream.getTracks()) t.stop();
      this.#cameraStream = null;
      const sender = this.#pc?.getSenders().find(s => s.track?.kind === 'video');
      await sender?.replaceTrack(null);
      patchCallState({ videoOn: false, localCameraStream: null });
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
  }

  async enableScreen(on) {
    if (on && !this.#screenStream) {
      try {
        this.#screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.#screenStream.getVideoTracks()[0].onended = () => this.enableScreen(false);
        const track = this.#screenStream.getVideoTracks()[0];
        if (this.#pc) {
          const sender = this.#pc.getSenders().find(s => s.track?.kind === 'video' && !get(activeCall).videoOn);
          if (sender) await sender.replaceTrack(track);
          else {
            const s = this.#pc.addTrack(track, this.#screenStream);
            if (this.#encryption.mode === CALL_MODE.SECURE) this.#encryption.applyToSender(s);
          }
        }
        patchCallState({ screenOn: true, localScreenStream: this.#screenStream });
      } catch (e) {
        if (e.name !== 'NotAllowedError') showAlert('Демонстрация экрана недоступна');
        return;
      }
    } else if (!on && this.#screenStream) {
      for (const t of this.#screenStream.getTracks()) t.stop();
      this.#screenStream = null;
      const sender = this.#pc?.getSenders().find(s => s.track?.kind === 'video' && get(activeCall).screenOn);
      await sender?.replaceTrack(null);
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
    for (const t of (this.#localStream?.getTracks() || [])) t.stop();
    for (const t of (this.#cameraStream?.getTracks() || [])) t.stop();
    for (const t of (this.#screenStream?.getTracks() || [])) t.stop();
    mediaPipeline.teardown();
    this.#voiceChannel?.close();
    this.#pc?.close();
    this.#pc = null;
    this.#voiceChannel = null;
    this.#sfuCommandChannel = null;
    resetCallState();
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
      const session = new MaxCallSession();
      _activeSession = session;
      await session.begin({ endpoint, conversationId: convId, role: 'originator', isVideo: false, mode, peerId });
    } catch (e) {
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
      const session = new MaxCallSession();
      _activeSession = session;
      await session.begin({ endpoint, conversationId: convId, role: 'originator', isVideo: true, mode, peerId });
    } catch (e) {
      showAlert('Не удалось начать видеозвонок: ' + (e?.message || e));
      resetCallState();
    }
  },

  async handleIncomingPush(pushData) {
    try {
      const vcp = pushData.vcp || pushData.conversationParams;
      const conversationId = pushData.conversationId || pushData.conference_id;
      const callerId = pushData.callerId || pushData.caller_id;
      let convParams = {};
      if (vcp) {
        try {
          convParams = await invoke('decode_call_push', { blob: vcp });
        } catch (e) {
          log('vcp decode error:', e);
        }
      }
      const endpoint = convParams.endpoint || convParams.ws2url || pushData.endpoint;
      if (!endpoint) { log('incoming call without endpoint'); return; }
      const callType = pushData.isVideo ? 'video' : 'audio';
      patchCallState({
        phase: CALL_PHASE.INCOMING,
        callType,
        conversationId,
        peerId: callerId,
      });
      this._pendingIncoming = { endpoint, conversationId, callerId, isVideo: pushData.isVideo };
    } catch (e) {
      log('handleIncomingPush failed:', e);
    }
  },

  async acceptIncoming(mode = CALL_MODE.PLAIN) {
    const pending = this._pendingIncoming;
    if (!pending) return;
    this._pendingIncoming = null;
    const session = new MaxCallSession();
    _activeSession = session;
    await session.begin({
      endpoint: pending.endpoint,
      conversationId: pending.conversationId,
      role: 'responder',
      isVideo: pending.isVideo,
      mode,
      peerId: pending.callerId,
    });
  },

  declineIncoming() {
    this._pendingIncoming = null;
    this._endActive();
    resetCallState();
  },

  async hangup() {
    this._pendingIncoming = null;
    const session = _activeSession;
    _activeSession = null;
    resetCallState();
    if (session) {
      try {
        await session.hangup();
      } catch {
        session.destroy();
      }
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
      const session = new MaxCallSession();
      _activeSession = session;
      await session.begin({ endpoint, conversationId: convId, role: 'joiner', isVideo, mode, peerId: null });
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

  getActiveSession() { return _activeSession; },
};
