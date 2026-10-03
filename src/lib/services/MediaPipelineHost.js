const MAX_PLUGINS = 8;

class MediaPipelineHost {
  #videoPlugins = [];
  #audioPlugins = [];
  #rawVideoTrack = null;
  #rawAudioTrack = null;
  #processedVideoStream = null;
  #processedAudioStream = null;
  #animFrameId = null;
  #canvas = null;
  #ctx = null;
  #videoEl = null;

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
  }

  async removeAudioPlugin(pluginId) {
    const idx = this.#audioPlugins.findIndex(p => p.id === pluginId);
    if (idx === -1) return;
    await this.#audioPlugins[idx].destroy?.();
    this.#audioPlugins.splice(idx, 1);
  }

  setSourceTracks(videoTrack, audioTrack) {
    this.#rawVideoTrack = videoTrack;
    this.#rawAudioTrack = audioTrack;
    this._restartVideoPipeline();
  }

  _restartVideoPipeline() {
    if (this.#animFrameId) cancelAnimationFrame(this.#animFrameId);
    if (!this.#rawVideoTrack || this.#videoPlugins.length === 0) {
      this.#processedVideoStream = this.#rawVideoTrack
        ? new MediaStream([this.#rawVideoTrack])
        : null;
      return;
    }
    if (!this.#canvas) {
      this.#canvas = document.createElement('canvas');
      this.#ctx = this.#canvas.getContext('2d', { willReadFrequently: false });
      this.#videoEl = document.createElement('video');
      this.#videoEl.srcObject = new MediaStream([this.#rawVideoTrack]);
      this.#videoEl.muted = true;
      this.#videoEl.play();
    }
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
  }

  getProcessedVideoStream() {
    if (this.#videoPlugins.length === 0 && this.#rawVideoTrack) {
      return new MediaStream([this.#rawVideoTrack]);
    }
    return this.#processedVideoStream;
  }

  getProcessedAudioTrack() {
    return this.#rawAudioTrack;
  }

  async teardown() {
    if (this.#animFrameId) cancelAnimationFrame(this.#animFrameId);
    for (const p of [...this.#videoPlugins, ...this.#audioPlugins]) {
      await p.destroy?.();
    }
    this.#videoPlugins = [];
    this.#audioPlugins = [];
    this.#processedVideoStream = null;
    if (this.#videoEl) { this.#videoEl.srcObject = null; this.#videoEl = null; }
    this.#canvas = null;
    this.#ctx = null;
    this.#rawVideoTrack = null;
    this.#rawAudioTrack = null;
  }

  listVideoPlugins() { return this.#videoPlugins.map(p => ({ id: p.id, name: p.name })); }
  listAudioPlugins() { return this.#audioPlugins.map(p => ({ id: p.id, name: p.name })); }
}

export const mediaPipeline = new MediaPipelineHost();
