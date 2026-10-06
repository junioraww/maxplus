import { createSyntheticAudioStream, createSyntheticVideoStream } from '$lib/utils/mediaFallback.js';

export class LinuxFallbackPeerConnection extends EventTarget {
  constructor(config = {}) {
    super();
    this.config = config;
    this.connectionState = 'new';
    this.iceConnectionState = 'new';
    this.iceGatheringState = 'new';
    this.signalingState = 'stable';
    this.localDescription = null;
    this.remoteDescription = null;
    this.onicecandidate = null;
    this.oniceconnectionstatechange = null;
    this.onconnectionstatechange = null;
    this.ontrack = null;
    this.ondatachannel = null;
    this._senders = [];
    this._receivers = [];
    this._transceivers = [];
    this._syntheticAudio = null;
    this._syntheticVideo = null;
    this._closed = false;
  }

  getSenders() {
    return [...this._senders];
  }

  getReceivers() {
    return [...this._receivers];
  }

  getTransceivers() {
    return [...this._transceivers];
  }

  addTrack(track, stream) {
    const sender = {
      track,
      stream,
      replaceTrack: async (newTrack) => {
        sender.track = newTrack;
      }
    };
    this._senders.push(sender);
    const receiver = {
      track: { kind: track?.kind || 'video', id: `mock-${track?.kind || 'video'}-${Date.now()}` }
    };
    this._receivers.push(receiver);
    this._transceivers.push({
      sender,
      receiver,
      direction: 'sendrecv'
    });
    return sender;
  }

  removeTrack(sender) {
    const idx = this._senders.indexOf(sender);
    if (idx !== -1) {
      this._senders.splice(idx, 1);
    }
  }

  addTransceiver(kind, options = {}) {
    const sender = {
      track: null,
      replaceTrack: async (newTrack) => {
        sender.track = newTrack;
      }
    };
    const receiver = {
      track: { kind, id: `mock-${kind}-${Date.now()}` }
    };
    this._senders.push(sender);
    this._receivers.push(receiver);
    const transceiver = {
      sender,
      receiver,
      direction: options.direction || 'sendrecv'
    };
    this._transceivers.push(transceiver);
    return transceiver;
  }

  createDataChannel(label, options = {}) {
    const dc = {
      label,
      id: options.id ?? 0,
      readyState: 'open',
      send: () => {},
      close: () => {
        dc.readyState = 'closed';
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      onopen: null,
      onclose: null,
      onmessage: null,
      onerror: null
    };
    setTimeout(() => {
      dc.onopen?.({ type: 'open' });
    }, 10);
    return dc;
  }

  async createOffer(constraints = {}) {
    const sdp = this._generateSdp('offer');
    return { type: 'offer', sdp };
  }

  async createAnswer(constraints = {}) {
    const sdp = this._generateSdp('answer');
    return { type: 'answer', sdp };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    this.iceGatheringState = 'gathering';
    this.dispatchEvent(new Event('icegatheringstatechange'));

    setTimeout(() => {
      if (this._closed) return;
      const ufr = this._ufrag || 'mock';
      const candidate = {
        candidate: `candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host generation 0 ufrag ${ufr}`,
        sdpMid: '0',
        sdpMLineIndex: 0
      };
      if (typeof this.onicecandidate === 'function') {
        this.onicecandidate({ candidate });
      }
      this.dispatchEvent(new CustomEvent('icecandidate', { detail: { candidate } }));

      this.iceGatheringState = 'complete';
      this.dispatchEvent(new Event('icegatheringstatechange'));

      if (typeof this.onicecandidate === 'function') {
        this.onicecandidate({ candidate: null });
      }
      this.dispatchEvent(new CustomEvent('icecandidate', { detail: { candidate: null } }));
    }, 50);
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    this._updateState('connecting', 'checking');

    setTimeout(() => {
      if (this._closed) return;
      this._updateState('connected', 'connected');
      this._emitRemoteTracks();
    }, 100);
  }

  async addIceCandidate(candidate) {
    return Promise.resolve();
  }

  restartIce() {}

  close() {
    this._closed = true;
    this._updateState('closed', 'closed');
    this.signalingState = 'closed';
    if (this._syntheticAudio) {
      this._syntheticAudio.stop?.();
      this._syntheticAudio = null;
    }
    if (this._syntheticVideo) {
      this._syntheticVideo.stop?.();
      this._syntheticVideo = null;
    }
  }

  _updateState(connState, iceState) {
    this.connectionState = connState;
    this.iceConnectionState = iceState;
    if (typeof this.onconnectionstatechange === 'function') {
      this.onconnectionstatechange(new Event('connectionstatechange'));
    }
    this.dispatchEvent(new Event('connectionstatechange'));
    if (typeof this.oniceconnectionstatechange === 'function') {
      this.oniceconnectionstatechange(new Event('iceconnectionstatechange'));
    }
    this.dispatchEvent(new Event('iceconnectionstatechange'));
  }

  _emitRemoteTracks() {
    if (!this._syntheticAudio) {
      this._syntheticAudio = createSyntheticAudioStream();
    }
    const audioTrack = this._syntheticAudio.stream.getAudioTracks()[0];
    if (audioTrack) {
      const audioReceiver = { track: audioTrack };
      this._receivers.push(audioReceiver);
      const ev = {
        track: audioTrack,
        streams: [this._syntheticAudio.stream],
        receiver: audioReceiver
      };
      if (typeof this.ontrack === 'function') {
        this.ontrack(ev);
      }
      this.dispatchEvent(new CustomEvent('track', { detail: ev }));
    }

    if (!this._syntheticVideo) {
      this._syntheticVideo = createSyntheticVideoStream();
    }
    const videoTrack = this._syntheticVideo.stream.getVideoTracks()[0];
    if (videoTrack) {
      const videoReceiver = { track: videoTrack };
      this._receivers.push(videoReceiver);
      const ev = {
        track: videoTrack,
        streams: [this._syntheticVideo.stream],
        receiver: videoReceiver
      };
      if (typeof this.ontrack === 'function') {
        this.ontrack(ev);
      }
      this.dispatchEvent(new CustomEvent('track', { detail: ev }));
    }
  }

  _generateSdp(type) {
    const sessId = Date.now();
    if (!this._ufrag) {
      this._ufrag = Math.random().toString(36).substring(2, 6);
      this._pwd = Math.random().toString(36).substring(2, 26);
    }
    const setup = type === 'answer' ? 'active' : 'actpass';
    return [
      'v=0',
      `o=- ${sessId} 2 IN IP4 127.0.0.1`,
      's=-',
      't=0 0',
      'a=group:BUNDLE 0 1',
      'a=msid-semantic: WMS',
      `a=ice-ufrag:${this._ufrag}`,
      `a=ice-pwd:${this._pwd}`,
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      `a=setup:${setup}`,
      'm=audio 9 UDP/TLS/RTP/SAVPF 111 9',
      'c=IN IP4 0.0.0.0',
      'a=rtcp:9 IN IP4 0.0.0.0',
      'a=mid:0',
      'a=sendrecv',
      'a=rtpmap:111 opus/48000/2',
      'a=rtcp-mux',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
      'c=IN IP4 0.0.0.0',
      'a=rtcp:9 IN IP4 0.0.0.0',
      'a=mid:1',
      'a=sendrecv',
      'a=rtpmap:96 H264/90000',
      'a=rtcp-mux',
      ''
    ].join('\r\n');
  }
}
