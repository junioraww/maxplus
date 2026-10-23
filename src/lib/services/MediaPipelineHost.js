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

  onTrackChange = null;

  async installVideoPlugin(plugin) {
    if (this.#videoPlugins.length >= MAX_PLUGINS) throw new Error('Too many video plugins');
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

  _restartVideoPipeline() {
    if (this.#animFrameId) cancelAnimationFrame(this.#animFrameId);
    if (this.#processedVideoStream) {
      this.#processedVideoStream.getTracks().forEach(t => t.stop());
      this.#processedVideoStream = null;
    }
    if (!this.#rawVideoTrack || this.#videoPlugins.length === 0) {
      this.#processedVideoStream = this.#rawVideoTrack
        ? new MediaStream([this.#rawVideoTrack])
        : null;
      this.onTrackChange?.({
        videoTrack: this.getProcessedVideoTrack(),
        audioTrack: this.getProcessedAudioTrack()
      });
      return;
    }
    if (!this.#canvas) {
      this.#canvas = document.createElement('canvas');
      this.#ctx = this.#canvas.getContext('2d', { willReadFrequently: false });
      this.#videoEl = document.createElement('video');
      this.#videoEl.muted = true;
    }
    this.#videoEl.srcObject = new MediaStream([this.#rawVideoTrack]);
    this.#videoEl.play().catch(() => {});
    const settings = this.#rawVideoTrack.getSettings();
    this.#canvas.width = settings.width || 640;
    this.#canvas.height = settings.height || 480;
    this.#processedVideoStream = this.#canvas.captureStream(30);

    const render = async () => {
      if (!this.#rawVideoTrack || this.#rawVideoTrack.readyState === 'ended') return;
      let source = this.#videoEl;
      for (const plugin of this.#videoPlugins) {
        if (plugin.processVideoFrame) {
          source = await plugin.processVideoFrame(source, this.#canvas, this.#ctx) || source;
        }
      }
      if (source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement || source instanceof ImageBitmap) {
        this.#ctx.drawImage(source, 0, 0, this.#canvas.width, this.#canvas.height);
      }
      this.#animFrameId = requestAnimationFrame(render);
    };
    this.#animFrameId = requestAnimationFrame(render);
    this.onTrackChange?.({
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
      this.onTrackChange?.({
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
    this.onTrackChange?.({
      videoTrack: this.getProcessedVideoTrack(),
      audioTrack: this.getProcessedAudioTrack()
    });
  }

  getProcessedVideoStream() {
    if (this.#videoPlugins.length === 0 && this.#rawVideoTrack) {
      return new MediaStream([this.#rawVideoTrack]);
    }
    return this.#processedVideoStream;
  }

  getProcessedVideoTrack() {
    if (this.#videoPlugins.length === 0) {
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

  async teardown() {
    if (this.#animFrameId) cancelAnimationFrame(this.#animFrameId);
    for (const p of [...this.#videoPlugins, ...this.#audioPlugins]) {
      try { await p.destroy?.(); } catch {}
    }
    this.#videoPlugins = [];
    this.#audioPlugins = [];
    if (this.#processedVideoStream) {
      this.#processedVideoStream.getTracks().forEach(t => t.stop());
      this.#processedVideoStream = null;
    }
    if (this.#videoEl) {
      this.#videoEl.srcObject = null;
      this.#videoEl = null;
    }
    this.#canvas = null;
    this.#ctx = null;
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
    this.#processedAudioTrack = null;
    this.#rawVideoTrack = null;
    this.#rawAudioTrack = null;
    this.onTrackChange = null;
  }

  listVideoPlugins() { return this.#videoPlugins.map(p => ({ id: p.id, name: p.name })); }
  listAudioPlugins() { return this.#audioPlugins.map(p => ({ id: p.id, name: p.name })); }
}

export const mediaPipeline = new MediaPipelineHost();
