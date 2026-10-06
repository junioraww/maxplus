export class LinuxNativePeerConnection extends EventTarget {
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
    this._closed = false;
    this._pollTimer = null;
    this._remoteStream = null;
    this._hasEmittedAudioTrack = false;
    this._hasEmittedVideoTrack = false;
    this._port = (typeof window !== 'undefined' && window.__MAXPLUS_PROXY__?.webrtcPort) || 14230;

    this._initNativeSession();
  }

  get _baseUrl() {
    return `http://127.0.0.1:${this._port}`;
  }

  get videoFeedUrl() {
    return `${this._baseUrl}/video_stream`;
  }

  async _initNativeSession() {
    try {
      await fetch(`${this._baseUrl}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iceServers: this.config.iceServers || [],
          isAudio: true,
          isVideo: true,
        }),
      });
      this._startPolling();
    } catch (e) {
      this.connectionState = 'failed';
      this.iceConnectionState = 'failed';
      this._emitStateChange();
    }
  }

  _startPolling() {
    if (this._pollTimer || this._closed) return;
    this._pollTimer = setInterval(async () => {
      if (this._closed) return;
      try {
        const candRes = await fetch(`${this._baseUrl}/candidates`);
        if (candRes.ok) {
          const data = await candRes.json();
          for (const c of data.candidates || []) {
            const ev = { candidate: c };
            if (typeof this.onicecandidate === 'function') {
              this.onicecandidate(ev);
            }
            this.dispatchEvent(new CustomEvent('icecandidate', { detail: ev }));
          }
        }

        const statRes = await fetch(`${this._baseUrl}/status`);
        if (statRes.ok) {
          const st = await statRes.json();
          let stateChanged = false;
          if (st.connectionState && st.connectionState !== this.connectionState) {
            this.connectionState = st.connectionState;
            stateChanged = true;
          }
          if (st.iceConnectionState && st.iceConnectionState !== this.iceConnectionState) {
            this.iceConnectionState = st.iceConnectionState;
            stateChanged = true;
          }
          if (stateChanged) {
            this._emitStateChange();
          }

          if (st.hasRemoteAudio && !this._hasEmittedAudioTrack) {
            this._hasEmittedAudioTrack = true;
            this._emitSyntheticTrack('audio');
          }
          if (st.hasRemoteVideo && !this._hasEmittedVideoTrack) {
            this._hasEmittedVideoTrack = true;
            this._emitSyntheticTrack('video');
          }
        }
      } catch {
        void 0;
      }
    }, 120);
  }

  _emitSyntheticTrack(kind) {
    if (!this._remoteStream) {
      this._remoteStream = new MediaStream();
    }
    let track;
    if (kind === 'audio') {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = actx.createOscillator();
      const dst = actx.createMediaStreamDestination();
      osc.connect(dst);
      track = dst.stream.getAudioTracks()[0];
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const stream = canvas.captureStream ? canvas.captureStream(10) : new MediaStream();
      track = stream.getVideoTracks()[0] || { kind: 'video', id: `linux-video-${Date.now()}`, enabled: true, readyState: 'live' };
    }

    if (track) {
      this._remoteStream.addTrack(track);
      const receiver = { track };
      this._receivers.push(receiver);
      const ev = {
        track,
        streams: [this._remoteStream],
        receiver
      };
      if (typeof this.ontrack === 'function') {
        this.ontrack(ev);
      }
      this.dispatchEvent(new CustomEvent('track', { detail: ev }));
    }
  }

  _emitStateChange() {
    if (typeof this.onconnectionstatechange === 'function') {
      this.onconnectionstatechange(new Event('connectionstatechange'));
    }
    this.dispatchEvent(new Event('connectionstatechange'));
    if (typeof this.oniceconnectionstatechange === 'function') {
      this.oniceconnectionstatechange(new Event('iceconnectionstatechange'));
    }
    this.dispatchEvent(new Event('iceconnectionstatechange'));
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
      track: { kind: track?.kind || 'video', id: `native-${track?.kind || 'video'}-${Date.now()}`, readyState: 'live', enabled: true }
    };
    this._receivers.push(receiver);
    const transceiver = {
      sender,
      receiver,
      direction: 'sendrecv'
    };
    this._transceivers.push(transceiver);
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
      track: { kind, id: `native-${kind}-${Date.now()}`, readyState: 'live', enabled: true }
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
    try {
      const res = await fetch(`${this._baseUrl}/create_offer`, { method: 'POST' });
      if (!res.ok) throw new Error('Daemon offer error');
      const data = await res.json();
      return { type: 'offer', sdp: data.sdp };
    } catch {
      return { type: 'offer', sdp: '' };
    }
  }

  async createAnswer(constraints = {}) {
    return { type: 'answer', sdp: this.localDescription?.sdp || '' };
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    this.iceGatheringState = 'gathering';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    try {
      const res = await fetch(`${this._baseUrl}/set_remote_description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: desc.type, sdp: desc.sdp }),
      });
      if (res.ok) {
        const data = await res.json();
        if (desc.type === 'offer' && data.sdp) {
          this.localDescription = { type: 'answer', sdp: data.sdp };
        }
      }
    } catch {
      void 0;
    }
  }

  async addIceCandidate(candidate) {
    if (!candidate || !candidate.candidate) return;
    try {
      await fetch(`${this._baseUrl}/add_ice_candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex ?? 0,
          sdpMid: candidate.sdpMid ?? '0',
        }),
      });
    } catch {
      void 0;
    }
  }

  restartIce() {}

  close() {
    this._closed = true;
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    fetch(`${this._baseUrl}/close`, { method: 'POST' }).catch(() => {});
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this.signalingState = 'closed';
    this._emitStateChange();
  }
}
