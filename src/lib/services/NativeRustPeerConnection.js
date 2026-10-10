import { invoke, Channel } from '@tauri-apps/api/core';

export class NativeRustPeerConnection extends EventTarget {
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
    this.sessionId = null;

    const audioSender = {
      track: { kind: 'audio', id: 'audio0', readyState: 'live', enabled: true },
      replaceTrack: async () => {},
    };
    const videoSender = {
      track: { kind: 'video', id: 'camera0', readyState: 'live', enabled: true },
      replaceTrack: async () => {},
    };
    const audioReceiver = {
      track: { kind: 'audio', id: 'rem-audio0', readyState: 'live', enabled: true },
    };
    const videoReceiver = {
      track: { kind: 'video', id: 'rem-video0', readyState: 'live', enabled: true },
    };
    const audioTransceiver = {
      mid: '0',
      sender: audioSender,
      receiver: audioReceiver,
      direction: 'sendrecv',
    };
    const videoTransceiver = {
      mid: '1',
      sender: videoSender,
      receiver: videoReceiver,
      direction: 'sendrecv',
    };
    this._senders = [audioSender, videoSender];
    this._receivers = [audioReceiver, videoReceiver];
    this._transceivers = [audioTransceiver, videoTransceiver];
    this._remoteStream = new MediaStream();
    this._closed = false;
    this._attachedCanvases = new Set();
    this._videoChannel = null;
    this._candidatesChannel = null;
    this._stateChannel = null;

    this._initPromise = this._init();
  }

  async _init() {
    const iceServers = [];
    for (const server of this.config.iceServers || []) {
      const u = server.urls || server.url;
      const urls = Array.isArray(u) ? u : (typeof u === 'string' ? [u] : []);
      if (urls.length === 0) continue;
      iceServers.push({
        urls,
        username: server.username || '',
        password: server.credential || server.password || '',
      });
    }

    try {
      this.sessionId = await invoke('webrtc_create', { iceServers });
      console.log('[NativeRustPeerConnection] session created:', this.sessionId);
    } catch (err) {
      console.error('[NativeRustPeerConnection] webrtc_create failed:', err);
      throw err;
    }

    this._candidatesChannel = new Channel();
    this._candidatesChannel.onmessage = (payload) => {
      if (!payload || !payload.candidate) {
        this.iceGatheringState = 'complete';
        this.dispatchEvent(new Event('icegatheringstatechange'));
        const ev = { candidate: null };
        this.onicecandidate?.(ev);
        this.dispatchEvent(new CustomEvent('icecandidate', { detail: ev }));
        return;
      }
      const candObj = {
        candidate: payload.candidate,
        sdpMid: payload.sdpMid ?? '0',
        sdpMLineIndex: payload.sdpMLineIndex ?? 0,
      };
      const ev = { candidate: candObj };
      this.onicecandidate?.(ev);
      this.dispatchEvent(new CustomEvent('icecandidate', { detail: ev }));
    };
    invoke('webrtc_listen_candidates', {
      sessionId: this.sessionId,
      channel: this._candidatesChannel,
    }).catch((e) => console.error('[NativeRustPeerConnection] listen_candidates error:', e));

    this._stateChannel = new Channel();
    this._stateChannel.onmessage = (stateStr) => {
      if (!stateStr) return;
      this.connectionState = stateStr;
      this.iceConnectionState = stateStr === 'connected' ? 'completed' : stateStr;
      this.onconnectionstatechange?.(new Event('connectionstatechange'));
      this.dispatchEvent(new Event('connectionstatechange'));
      this.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'));
      this.dispatchEvent(new Event('iceconnectionstatechange'));
    };
    invoke('webrtc_listen_state', {
      sessionId: this.sessionId,
      channel: this._stateChannel,
    }).catch((e) => console.error('[NativeRustPeerConnection] listen_state error:', e));

    this._videoChannel = new Channel();
    this._videoChannel.onmessage = (buffer) => {
      if (!buffer || buffer.byteLength < 8) return;
      this._renderVideoFrame(buffer);
    };
    invoke('webrtc_listen_video', {
      sessionId: this.sessionId,
      channel: this._videoChannel,
    }).catch((e) => console.error('[NativeRustPeerConnection] listen_video error:', e));
  }

  attachVideoCanvas(canvas) {
    if (!canvas) return;
    this._setupCanvasRenderer(canvas);
    this._attachedCanvases.add(canvas);
  }

  detachVideoCanvas(canvas) {
    if (!canvas) return;
    this._attachedCanvases.delete(canvas);
  }

  _setupCanvasRenderer(canvas) {
    if (canvas._glContext) return;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: false, alpha: false });
    if (!gl) return;

    const vsSource = `
      attribute vec2 a_pos;
      attribute vec2 a_tex;
      varying vec2 v_tex;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_tex = a_tex;
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 v_tex;
      uniform sampler2D u_y;
      uniform sampler2D u_u;
      uniform sampler2D u_v;
      void main() {
        float y = texture2D(u_y, v_tex).r;
        float u = texture2D(u_u, v_tex).r - 0.5;
        float v = texture2D(u_v, v_tex).r - 0.5;
        float r = y + 1.402 * v;
        float g = y - 0.344136 * u - 0.714136 * v;
        float b = y + 1.772 * u;
        gl_FragColor = vec4(r, g, b, 1.0);
      }
    `;

    const createShader = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };

    const program = gl.createProgram();
    gl.attachShader(program, createShader(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    gl.useProgram(program);

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1.0,  1.0, 0.0, 0.0,
        -1.0, -1.0, 0.0, 1.0,
         1.0,  1.0, 1.0, 0.0,
         1.0, -1.0, 1.0, 1.0,
      ]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(program, 'a_pos');
    const aTex = gl.getAttribLocation(program, 'a_tex');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);

    const createTexture = (unit) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    };

    const yTex = createTexture(0);
    const uTex = createTexture(1);
    const vTex = createTexture(2);

    gl.uniform1i(gl.getUniformLocation(program, 'u_y'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_u'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_v'), 2);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    canvas._glContext = { gl, program, yTex, uTex, vTex };
  }

  _renderVideoFrame(arrayBuffer) {
    if (!this._hasRemoteVideo) {
      this._hasRemoteVideo = true;
      this.dispatchEvent(new Event('firstvideoframe'));
    }

    const view = new DataView(arrayBuffer);
    const width = view.getUint32(0, true);
    const height = view.getUint32(4, true);

    const ySize = width * height;
    const chromaW = Math.floor((width + 1) / 2);
    const chromaH = Math.floor((height + 1) / 2);
    const chromaSize = chromaW * chromaH;

    const yData = new Uint8Array(arrayBuffer, 8, ySize);
    const uData = new Uint8Array(arrayBuffer, 8 + ySize, chromaSize);
    const vData = new Uint8Array(arrayBuffer, 8 + ySize + chromaSize, chromaSize);

    for (const canvas of this._attachedCanvases) {
      const ctx = canvas._glContext;
      if (!ctx) continue;
      const { gl, yTex, uTex, vTex } = ctx;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, yTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, yData);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, uTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, chromaW, chromaH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, uData);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, vTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, chromaW, chromaH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, vData);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  async setCameraEnabled(enabled) {
    await this._initPromise;
    if (this.sessionId == null) return;
    await invoke('webrtc_set_camera_enabled', {
      sessionId: this.sessionId,
      enabled: Boolean(enabled),
    });
  }

  async setMicMuted(muted) {
    await this._initPromise;
    if (this.sessionId == null) return;
    await invoke('webrtc_set_mic_muted', {
      sessionId: this.sessionId,
      muted: Boolean(muted),
    });
  }

  async setMute(muted) {
    await this.setMicMuted(muted);
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
      },
    };
    this._senders.push(sender);
    const receiver = {
      track: { kind: track?.kind || 'audio', id: `rem-${Date.now()}`, readyState: 'live', enabled: true },
    };
    this._receivers.push(receiver);
    const transceiver = {
      sender,
      receiver,
      direction: 'sendrecv',
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
      },
    };
    const receiver = {
      track: { kind, id: `trans-${kind}-${Date.now()}`, readyState: 'live', enabled: true },
    };
    this._senders.push(sender);
    this._receivers.push(receiver);
    const transceiver = {
      sender,
      receiver,
      direction: options.direction || 'sendrecv',
    };
    this._transceivers.push(transceiver);
    return transceiver;
  }

  createDataChannel(label, options = {}) {
    this._initPromise.then(() => {
      if (this.sessionId != null) {
        invoke('webrtc_create_data_channel', {
          sessionId: this.sessionId,
          label,
        }).catch((e) => console.warn('[NativeRustPeerConnection] create_data_channel warn:', e));
      }
    });

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
      onerror: null,
    };
    setTimeout(() => {
      dc.onopen?.({ type: 'open' });
    }, 0);
    return dc;
  }

  async createOffer(options = {}) {
    await this._initPromise;
    try {
      const res = await invoke('webrtc_create_offer', {
        sessionId: this.sessionId,
        iceRestart: Boolean(options.iceRestart),
      });
      const offer = { type: res.sdp_type || res.sdpType || 'offer', sdp: res.sdp || '' };
      return offer;
    } catch (err) {
      console.error('[NativeRustPeerConnection] createOffer error:', err);
      throw err;
    }
  }

  async createAnswer() {
    await this._initPromise;
    try {
      const res = await invoke('webrtc_create_answer', {
        sessionId: this.sessionId,
      });
      const answer = { type: res.sdp_type || res.sdpType || 'answer', sdp: res.sdp || '' };
      return answer;
    } catch (err) {
      console.error('[NativeRustPeerConnection] createAnswer error:', err);
      throw err;
    }
  }

  async setLocalDescription(desc) {
    this.localDescription = desc;
    await this._initPromise;
    try {
      await invoke('webrtc_set_local_description', {
        sessionId: this.sessionId,
        sdpType: desc?.type || 'offer',
        sdp: desc?.sdp || '',
      });
      if (desc?.type === 'offer') {
        this.signalingState = 'have-local-offer';
      } else if (desc?.type === 'answer' || desc?.type === 'rollback') {
        this.signalingState = 'stable';
      }
    } catch (err) {
      console.error('[NativeRustPeerConnection] setLocalDescription error:', err);
      throw err;
    }
  }

  async setRemoteDescription(desc) {
    this.remoteDescription = desc;
    await this._initPromise;
    const type = desc?.type || 'offer';
    try {
      await invoke('webrtc_set_remote_description', {
        sessionId: this.sessionId,
        sdpType: type,
        sdp: desc?.sdp || '',
      });
      if (type === 'answer') {
        this.signalingState = 'stable';
      } else if (type === 'offer') {
        this.signalingState = 'have-remote-offer';
      }
    } catch (err) {
      if (type === 'offer' && String(err).includes('have-local-offer')) {
        await invoke('webrtc_set_local_description', {
          sessionId: this.sessionId,
          sdpType: 'rollback',
          sdp: '',
        });
        this.signalingState = 'stable';
        await invoke('webrtc_set_remote_description', {
          sessionId: this.sessionId,
          sdpType: 'offer',
          sdp: desc?.sdp || '',
        });
        this.signalingState = 'have-remote-offer';
        return;
      }
      console.error('[NativeRustPeerConnection] setRemoteDescription error:', err);
      throw err;
    }
  }

  async addIceCandidate(candidate) {
    if (!candidate || !candidate.candidate) return;
    await this._initPromise;
    try {
      await invoke('webrtc_add_ice_candidate', {
        sessionId: this.sessionId,
        candidate: {
          candidate: candidate.candidate,
          sdp_mid: candidate.sdpMid != null ? String(candidate.sdpMid) : null,
          sdp_mline_index: candidate.sdpMLineIndex != null ? Number(candidate.sdpMLineIndex) : null,
        },
      });
    } catch (err) {
      console.error('[NativeRustPeerConnection] addIceCandidate error:', err);
    }
  }

  restartIce() {}

  async setEncryptionKeys(keys) {
    await this._initPromise;
    if (this.sessionId == null) return;
    try {
      await invoke('webrtc_set_encryption_keys', {
        sessionId: this.sessionId,
        keys,
      });
    } catch (err) {
      console.error('[NativeRustPeerConnection] setEncryptionKeys error:', err);
    }
  }

  async close() {
    this._closed = true;
    for (const canvas of this._attachedCanvases) {
      canvas._glContext = null;
    }
    this._attachedCanvases.clear();
    if (this.sessionId != null) {
      invoke('webrtc_close', { sessionId: this.sessionId }).catch(() => {});
      this.sessionId = null;
    }
    this.connectionState = 'closed';
    this.iceConnectionState = 'closed';
    this.signalingState = 'closed';
  }
}
