const MAX_PLUGINS = 8;

class MediaPipelineHost {
  #videoPlugins = [];
  #audioPlugins = [];
  #rawVideoTrack = null;
  #rawAudioTrack = null;
  #processedVideoStream = null;
  #processedAudioTrack = null;
  #animFrameId = null;
  #canvas = null;
  #ctx = null;
  #videoEl = null;
  #audioContext = null;
  #audioSource = null;
  #audioDestination = null;
  #customMasks = new Map();
  #customBackgrounds = new Map();
  #customVoiceFilters = new Map();
  #trackListeners = new Set();
  #effectsListeners = new Set();
  #activeVideoEffects = false;
  #activePreviewVideo = null;
  #outputCanvas = null;

  onTrackChange = null;
  onRegistryChange = null;

  addTrackChangeListener(fn) {
    this.#trackListeners.add(fn);
    return () => this.#trackListeners.delete(fn);
  }

  addEffectsChangeListener(fn) {
    this.#effectsListeners.add(fn);
    return () => this.#effectsListeners.delete(fn);
  }

  _notifyTrackChange(data) {
    try { this.onTrackChange?.(data); } catch {}
    for (const fn of this.#trackListeners) {
      try { fn(data); } catch {}
    }
  }

  _notifyEffectsChange(isActive) {
    for (const fn of this.#effectsListeners) {
      try { fn(isActive); } catch {}
    }
  }

  setActiveVideoElement(el) {
    this.#activePreviewVideo = el;
  }

  setOutputCanvas(el) {
    this.#outputCanvas = el;
  }

  hasActiveVideoEffects() {
    return this.#activeVideoEffects;
  }

  setActiveVideoEffects(active) {
    const val = Boolean(active);
    if (this.#activeVideoEffects === val) return;
    this.#activeVideoEffects = val;
    this._restartVideoPipeline();
    this._notifyEffectsChange(this.#activeVideoEffects);
  }

  getProcessedCanvas() {
    return this.#canvas;
  }

  async installVideoPlugin(plugin) {
    if (this.#videoPlugins.length >= MAX_PLUGINS) throw new Error('Too many video plugins');
    const existingIdx = this.#videoPlugins.findIndex(p => p.id === plugin.id);
    if (existingIdx !== -1) {
      await this.#videoPlugins[existingIdx].destroy?.();
      this.#videoPlugins.splice(existingIdx, 1);
    }
    await plugin.init?.();
    this.#videoPlugins.push(plugin);
    this._restartVideoPipeline();
  }

  async removeVideoPlugin(pluginId) {
    const idx = this.#videoPlugins.findIndex(p => p.id === pluginId);
    if (idx === -1) return;
    await this.#videoPlugins[idx].destroy?.();
    this.#videoPlugins.splice(idx, 1);
    this._restartVideoPipeline();
  }

  async installAudioPlugin(plugin) {
    if (this.#audioPlugins.length >= MAX_PLUGINS) throw new Error('Too many audio plugins');
    const existingIdx = this.#audioPlugins.findIndex(p => p.id === plugin.id);
    if (existingIdx !== -1) {
      await this.#audioPlugins[existingIdx].destroy?.();
      this.#audioPlugins.splice(existingIdx, 1);
    }
    await plugin.init?.();
    this.#audioPlugins.push(plugin);
    this._restartAudioPipeline();
  }

  async removeAudioPlugin(pluginId) {
    const idx = this.#audioPlugins.findIndex(p => p.id === pluginId);
    if (idx === -1) return;
    await this.#audioPlugins[idx].destroy?.();
    this.#audioPlugins.splice(idx, 1);
    this._restartAudioPipeline();
  }

  setSourceTracks(videoTrack, audioTrack) {
    this.#rawVideoTrack = videoTrack;
    this.#rawAudioTrack = audioTrack;
    this._restartVideoPipeline();
    this._restartAudioPipeline();
  }

  clearSourceTracks() {
    if (this.#animFrameId) {
      cancelAnimationFrame(this.#animFrameId);
      this.#animFrameId = null;
    }
    if (this.#processedVideoStream) {
      this.#processedVideoStream.getTracks().forEach(t => {
        try { t.stop(); } catch {}
      });
      this.#processedVideoStream = null;
    }
    if (this.#videoEl) {
      if (this.#videoEl.parentNode) {
        try { this.#videoEl.parentNode.removeChild(this.#videoEl); } catch {}
      }
      if (this.#videoEl.srcObject) {
        try {
          this.#videoEl.srcObject.getTracks().forEach(t => t.stop());
        } catch {}
        this.#videoEl.srcObject = null;
      }
    }
    if (this.#activePreviewVideo) {
      this.#activePreviewVideo = null;
    }
    this.#outputCanvas = null;
    if (this.#audioSource) {
      try { this.#audioSource.disconnect(); } catch {}
      this.#audioSource = null;
    }
    if (this.#audioDestination) {
      try { this.#audioDestination.disconnect(); } catch {}
      this.#audioDestination = null;
    }
    if (this.#audioContext) {
      try { this.#audioContext.close(); } catch {}
      this.#audioContext = null;
    }
    if (this.#rawVideoTrack) {
      try { this.#rawVideoTrack.stop(); } catch {}
      this.#rawVideoTrack = null;
    }
    if (this.#rawAudioTrack) {
      try { this.#rawAudioTrack.stop(); } catch {}
      this.#rawAudioTrack = null;
    }
    this.#processedAudioTrack = null;
    this._notifyTrackChange({
      videoTrack: null,
      audioTrack: null
    });
  }

  _restartVideoPipeline() {
    if (this.#animFrameId) {
      cancelAnimationFrame(this.#animFrameId);
      this.#animFrameId = null;
    }
    if (this.#processedVideoStream) {
      this.#processedVideoStream.getTracks().forEach(t => {
        if (t !== this.#rawVideoTrack) {
          try { t.stop(); } catch {}
        }
      });
      this.#processedVideoStream = null;
    }
    if (!this.#rawVideoTrack || !this.#activeVideoEffects || this.#videoPlugins.length === 0) {
      this.#processedVideoStream = this.#rawVideoTrack
        ? new MediaStream([this.#rawVideoTrack])
        : null;
      this._notifyTrackChange({
        videoTrack: this.getProcessedVideoTrack(),
        audioTrack: this.getProcessedAudioTrack()
      });
      return;
    }
    if (!this.#canvas) {
      this.#canvas = document.createElement('canvas');
      this.#ctx = this.#canvas.getContext('2d', { willReadFrequently: false });
    }
    if (!this.#videoEl) {
      this.#videoEl = document.createElement('video');
      this.#videoEl.poster = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
      this.#videoEl.muted = true;
      this.#videoEl.playsInline = true;
      this.#videoEl.autoplay = true;
    }
    if (typeof document !== 'undefined' && !this.#videoEl.isConnected) {
      this.#videoEl.style.position = 'fixed';
      this.#videoEl.style.top = '-9999px';
      this.#videoEl.style.left = '-9999px';
      this.#videoEl.style.width = '1px';
      this.#videoEl.style.height = '1px';
      this.#videoEl.style.opacity = '0.001';
      this.#videoEl.style.pointerEvents = 'none';
      try { document.body.appendChild(this.#videoEl); } catch {}
    }
    if (!this.#videoEl.srcObject || this.#videoEl.srcObject.getVideoTracks()?.[0] !== this.#rawVideoTrack) {
      this.#videoEl.srcObject = new MediaStream([this.#rawVideoTrack]);
      this.#videoEl.play().catch(() => {});
    }
    const settings = this.#rawVideoTrack.getSettings?.() || {};
    this.#canvas.width = settings.width || 1280;
    this.#canvas.height = settings.height || 720;
    try {
      this.#processedVideoStream = this.#canvas.captureStream(30);
    } catch {
      this.#processedVideoStream = new MediaStream([this.#rawVideoTrack]);
    }

    const render = async () => {
      if (!this.#rawVideoTrack || this.#rawVideoTrack.readyState === 'ended' || !this.#activeVideoEffects) return;
      let source = (this.#activePreviewVideo && this.#activePreviewVideo.videoWidth > 0 && !this.#activePreviewVideo.paused)
        ? this.#activePreviewVideo
        : this.#videoEl;
      if (!source || !source.videoWidth || !source.videoHeight) {
        this.#animFrameId = requestAnimationFrame(render);
        return;
      }
      if (this.#canvas.width !== source.videoWidth || this.#canvas.height !== source.videoHeight) {
        this.#canvas.width = source.videoWidth;
        this.#canvas.height = source.videoHeight;
      }
      this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
      let frameHandled = false;
      for (const plugin of this.#videoPlugins) {
        if (plugin.processVideoFrame) {
          try {
            const res = await plugin.processVideoFrame(source, this.#canvas, this.#ctx);
            if (res === true || res?.handled) {
              frameHandled = true;
            } else if (res && res !== source) {
              source = res;
            }
          } catch {}
        }
      }
      if (!frameHandled && source && source !== this.#canvas) {
        if (source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement || source instanceof ImageBitmap) {
          try {
            this.#ctx.drawImage(source, 0, 0, this.#canvas.width, this.#canvas.height);
          } catch {}
        }
      }
      if (this.#outputCanvas) {
        if (this.#outputCanvas.width !== this.#canvas.width || this.#outputCanvas.height !== this.#canvas.height) {
          this.#outputCanvas.width = this.#canvas.width;
          this.#outputCanvas.height = this.#canvas.height;
        }
        const outCtx = this.#outputCanvas.getContext('2d');
        if (outCtx) {
          outCtx.clearRect(0, 0, this.#outputCanvas.width, this.#outputCanvas.height);
          outCtx.drawImage(this.#canvas, 0, 0);
        }
      }
      this.#animFrameId = requestAnimationFrame(render);
    };
    this.#animFrameId = requestAnimationFrame(render);
    this._notifyTrackChange({
      videoTrack: this.getProcessedVideoTrack(),
      audioTrack: this.getProcessedAudioTrack()
    });
  }

  _restartAudioPipeline() {
    if (this.#audioSource) {
      try { this.#audioSource.disconnect(); } catch {}
      this.#audioSource = null;
    }
    if (this.#audioDestination) {
      try { this.#audioDestination.disconnect(); } catch {}
      this.#audioDestination = null;
    }
    if (!this.#rawAudioTrack || this.#audioPlugins.length === 0) {
      if (this.#audioContext) {
        try { this.#audioContext.close(); } catch {}
        this.#audioContext = null;
      }
      this.#processedAudioTrack = this.#rawAudioTrack;
      this._notifyTrackChange({
        videoTrack: this.getProcessedVideoTrack(),
        audioTrack: this.getProcessedAudioTrack()
      });
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.#audioContext || this.#audioContext.state === 'closed') {
        this.#audioContext = new AudioCtx();
      }
      if (this.#audioContext.state === 'suspended') {
        this.#audioContext.resume().catch(() => {});
      }
      this.#audioSource = this.#audioContext.createMediaStreamSource(new MediaStream([this.#rawAudioTrack]));
      this.#audioDestination = this.#audioContext.createMediaStreamDestination();
      let currentNode = this.#audioSource;
      for (const plugin of this.#audioPlugins) {
        if (plugin.processAudio) {
          currentNode = plugin.processAudio(this.#audioContext, currentNode) || currentNode;
        }
      }
      currentNode.connect(this.#audioDestination);
      this.#processedAudioTrack = this.#audioDestination.stream.getAudioTracks()[0] || null;
    } catch {
      this.#processedAudioTrack = this.#rawAudioTrack;
    }
    this._notifyTrackChange({
      videoTrack: this.getProcessedVideoTrack(),
      audioTrack: this.getProcessedAudioTrack()
    });
  }

  restartAudioPipeline() {
    this._restartAudioPipeline();
  }

  getProcessedVideoStream() {
    if ((!this.#activeVideoEffects || this.#videoPlugins.length === 0) && this.#rawVideoTrack) {
      return new MediaStream([this.#rawVideoTrack]);
    }
    return this.#processedVideoStream || (this.#rawVideoTrack ? new MediaStream([this.#rawVideoTrack]) : null);
  }

  getProcessedVideoTrack() {
    if (!this.#activeVideoEffects || this.#videoPlugins.length === 0) {
      return this.#rawVideoTrack;
    }
    return this.#processedVideoStream?.getVideoTracks()[0] || this.#rawVideoTrack;
  }

  getProcessedAudioTrack() {
    if (this.#audioPlugins.length === 0 && this.#rawAudioTrack) {
      return this.#rawAudioTrack;
    }
    return this.#processedAudioTrack || this.#rawAudioTrack;
  }

  hasActiveProcessors() {
    return this.#videoPlugins.length > 0 || this.#audioPlugins.length > 0;
  }

  registerMask(mask) {
    if (!mask?.id) return;
    this.#customMasks.set(mask.id, mask);
    this.onRegistryChange?.();
  }

  unregisterMask(id) {
    this.#customMasks.delete(id);
    this.onRegistryChange?.();
  }

  registerBackground(bg) {
    if (!bg?.id) return;
    this.#customBackgrounds.set(bg.id, bg);
    this.onRegistryChange?.();
  }

  unregisterBackground(id) {
    this.#customBackgrounds.delete(id);
    this.onRegistryChange?.();
  }

  registerVoiceFilter(vf) {
    if (!vf?.id) return;
    this.#customVoiceFilters.set(vf.id, vf);
    this.onRegistryChange?.();
  }

  unregisterVoiceFilter(id) {
    this.#customVoiceFilters.delete(id);
    this.onRegistryChange?.();
  }

  getCustomEffects() {
    return {
      masks: Array.from(this.#customMasks.values()),
      backgrounds: Array.from(this.#customBackgrounds.values()),
      voiceFilters: Array.from(this.#customVoiceFilters.values()),
    };
  }

  async teardown() {
    this.clearSourceTracks();
    for (const p of [...this.#videoPlugins, ...this.#audioPlugins]) {
      try { await p.destroy?.(); } catch {}
    }
    this.#videoPlugins = [];
    this.#audioPlugins = [];
    this.#customMasks.clear();
    this.#customBackgrounds.clear();
    this.#customVoiceFilters.clear();
    if (this.#videoEl) {
      this.#videoEl = null;
    }
    this.#canvas = null;
    this.#ctx = null;
    this.onTrackChange = null;
    this.onRegistryChange = null;
  }

  listVideoPlugins() { return this.#videoPlugins.map(p => ({ id: p.id, name: p.name })); }
  listAudioPlugins() { return this.#audioPlugins.map(p => ({ id: p.id, name: p.name })); }
}

export const mediaPipeline = new MediaPipelineHost();
