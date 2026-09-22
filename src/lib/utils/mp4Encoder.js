import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export function isWebCodecsMp4Available() {
  try {
    return typeof VideoEncoder === 'function'
      && typeof VideoFrame === 'function'
      && typeof AudioEncoder === 'function'
      && typeof AudioData === 'function';
  } catch {
    return false;
  }
}

export class Mp4Encoder {
  #target;
  #muxer;
  #videoEncoder;
  #audioEncoder;
  #videoEl;
  #canvas;
  #ctx;
  #audioCtx;
  #audioSource;
  #audioProcessor;
  #running = false;
  #frameCount = 0;
  #audioSampleCount = 0;
  #timer = null;
  #width;
  #height;
  #fps;
  #videoBitrate;
  #audioBitrate;
  #sampleRate = 48000;
  #hasAudio = false;

  constructor({ width = 480, height = 480, fps = 30, videoBitrate = 1_500_000, audioBitrate = 64_000 } = {}) {
    this.#width = width;
    this.#height = height;
    this.#fps = fps;
    this.#videoBitrate = videoBitrate;
    this.#audioBitrate = audioBitrate;
  }

  async start(mediaStream) {
    const videoTracks = mediaStream.getVideoTracks();
    const audioTracks = mediaStream.getAudioTracks();
    if (videoTracks.length === 0) throw new Error('No video track');

    this.#target = new ArrayBufferTarget();

    this.#videoEl = document.createElement('video');
    this.#videoEl.muted = true;
    this.#videoEl.playsInline = true;
    this.#videoEl.srcObject = mediaStream;
    try {
      await this.#videoEl.play();
    } catch {}

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.#width;
    this.#canvas.height = this.#height;
    this.#ctx = this.#canvas.getContext('2d', { alpha: false });

    this.#hasAudio = audioTracks.length > 0;
    if (this.#hasAudio) {
      try {
        this.#audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.#sampleRate = this.#audioCtx.sampleRate;
      } catch {
        this.#hasAudio = false;
      }
    }

    const muxerOpts = {
      target: this.#target,
      video: {
        codec: 'avc',
        width: this.#width,
        height: this.#height,
        frameRate: this.#fps,
      },
      fastStart: 'in-memory',
    };
    if (this.#hasAudio) {
      muxerOpts.audio = {
        codec: 'aac',
        numberOfChannels: 1,
        sampleRate: this.#sampleRate,
      };
    }
    this.#muxer = new Muxer(muxerOpts);

    this.#videoEncoder = new VideoEncoder({
      output: (chunk, meta) => this.#muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error(e),
    });
    this.#videoEncoder.configure({
      codec: 'avc1.42001f',
      width: this.#width,
      height: this.#height,
      bitrate: this.#videoBitrate,
      framerate: this.#fps,
    });

    if (this.#hasAudio) {
      this.#audioEncoder = new AudioEncoder({
        output: (chunk, meta) => this.#muxer.addAudioChunk(chunk, meta),
        error: (e) => console.error(e),
      });
      this.#audioEncoder.configure({
        codec: 'mp4a.40.2',
        sampleRate: this.#sampleRate,
        numberOfChannels: 1,
        bitrate: this.#audioBitrate,
      });

      try {
        this.#audioSource = this.#audioCtx.createMediaStreamSource(mediaStream);
        this.#audioProcessor = this.#audioCtx.createScriptProcessor(4096, 1, 1);
        this.#audioProcessor.onaudioprocess = (e) => {
          if (!this.#running) return;
          const inputData = e.inputBuffer.getChannelData(0);
          const copy = new Float32Array(inputData.length);
          copy.set(inputData);
          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: this.#sampleRate,
            numberOfFrames: inputData.length,
            numberOfChannels: 1,
            timestamp: Math.round((this.#audioSampleCount / this.#sampleRate) * 1_000_000),
            data: copy,
          });
          if (this.#audioEncoder?.state === 'configured') {
            this.#audioEncoder.encode(audioData);
          }
          audioData.close();
          this.#audioSampleCount += inputData.length;
        };

        this.#audioSource.connect(this.#audioProcessor);
        this.#audioProcessor.connect(this.#audioCtx.destination);
      } catch {
        this.#hasAudio = false;
      }
    }

    this.#running = true;
    this.#frameCount = 0;
    this.#audioSampleCount = 0;

    const frameIntervalMs = 1000 / this.#fps;
    const keyInterval = this.#fps * 2;
    const step = () => {
      if (!this.#running) return;
      const vw = this.#videoEl?.videoWidth || 0;
      const vh = this.#videoEl?.videoHeight || 0;
      if (vw > 0 && vh > 0) {
        const size = Math.min(vw, vh);
        const sx = Math.floor((vw - size) / 2);
        const sy = Math.floor((vh - size) / 2);
        this.#ctx.drawImage(this.#videoEl, sx, sy, size, size, 0, 0, this.#width, this.#height);
      } else {
        this.#ctx.fillStyle = '#000000';
        this.#ctx.fillRect(0, 0, this.#width, this.#height);
      }

      const timestampUs = Math.round(this.#frameCount * (1_000_000 / this.#fps));
      const frame = new VideoFrame(this.#canvas, {
        timestamp: timestampUs,
        duration: Math.round(1_000_000 / this.#fps),
      });
      if (this.#videoEncoder?.state === 'configured') {
        this.#videoEncoder.encode(frame, { keyFrame: this.#frameCount % keyInterval === 0 });
      }
      frame.close();
      this.#frameCount++;
    };

    this.#timer = setInterval(step, frameIntervalMs);
  }

  async stop() {
    this.#running = false;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }

    if (this.#videoEl) {
      this.#videoEl.pause();
      this.#videoEl.srcObject = null;
      this.#videoEl = null;
    }

    if (this.#audioProcessor) {
      this.#audioProcessor.disconnect();
      this.#audioProcessor = null;
    }
    if (this.#audioSource) {
      this.#audioSource.disconnect();
      this.#audioSource = null;
    }
    if (this.#audioCtx) {
      this.#audioCtx.close().catch(() => {});
      this.#audioCtx = null;
    }

    if (this.#videoEncoder?.state === 'configured') {
      await this.#videoEncoder.flush();
    }
    try { this.#videoEncoder?.close(); } catch {}
    this.#videoEncoder = null;

    if (this.#hasAudio && this.#audioSampleCount === 0 && this.#audioEncoder) {
      const dummyAacFrame = new Uint8Array([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]);
      const audioMeta = {
        decoderConfig: {
          codec: 'mp4a.40.2',
          numberOfChannels: 1,
          sampleRate: this.#sampleRate,
          description: new Uint8Array([0x11, 0x88]),
        },
      };
      const durationUs = Math.round((Math.max(1, this.#frameCount) / this.#fps) * 1_000_000);
      this.#muxer.addAudioChunkRaw(dummyAacFrame, 'key', 0, durationUs, audioMeta);
    }

    if (this.#audioEncoder?.state === 'configured') {
      await this.#audioEncoder.flush();
    }
    try { this.#audioEncoder?.close(); } catch {}
    this.#audioEncoder = null;

    this.#muxer.finalize();
    const bytes = new Uint8Array(this.#target.buffer);
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (bytes[i] === 0x65 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x73) {
        bytes[i] = 0x66;
        bytes[i + 1] = 0x72;
        bytes[i + 2] = 0x65;
        bytes[i + 3] = 0x65;
      }
    }
    return new Blob([bytes], { type: 'video/mp4' });
  }

  abort() {
    this.#running = false;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#videoEl) {
      this.#videoEl.pause();
      this.#videoEl.srcObject = null;
      this.#videoEl = null;
    }
    if (this.#audioProcessor) {
      this.#audioProcessor.disconnect();
      this.#audioProcessor = null;
    }
    if (this.#audioSource) {
      this.#audioSource.disconnect();
      this.#audioSource = null;
    }
    if (this.#audioCtx) {
      this.#audioCtx.close().catch(() => {});
      this.#audioCtx = null;
    }
    try { this.#videoEncoder?.close(); } catch {}
    try { this.#audioEncoder?.close(); } catch {}
    this.#videoEncoder = null;
    this.#audioEncoder = null;
  }
}
