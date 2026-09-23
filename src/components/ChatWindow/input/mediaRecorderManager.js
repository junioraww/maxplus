import { Mp4Encoder, isWebCodecsMp4Available } from "$lib/utils/mp4Encoder.js";
import { convertAudioBlobToOggOpus } from "$lib/utils/audioEncoder.js";
import { generateWaveformFromAmplitudes } from "$lib/utils/waveform.js";

export function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function formatSeconds(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

export function createFallbackAudioStream() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  const sampleRate = audioContext.sampleRate || 44100;
  const bufferSize = sampleRate * 2;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = (Math.random() * 2 - 1) * 0.12;
  }
  const whiteNoise = audioContext.createBufferSource();
  whiteNoise.buffer = noiseBuffer;
  whiteNoise.loop = true;

  const analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 64;

  const destination = audioContext.createMediaStreamDestination();
  whiteNoise.connect(analyserNode);
  analyserNode.connect(destination);
  whiteNoise.start(0);

  return { stream: destination.stream, audioContext, analyserNode };
}

export function createFallbackVideoStream(fallbackCanvasEl) {
  const { stream: audioStream, audioContext, analyserNode } = createFallbackAudioStream();
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const startT = Date.now();
  const imgData = ctx.createImageData(480, 480);
  const buf = new Uint32Array(imgData.data.buffer);

  const drawFrame = () => {
    for (let i = 0; i < buf.length; i++) {
      const v = (Math.random() * 255) | 0;
      buf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    ctx.putImageData(imgData, 0, 0);

    const sec = ((Date.now() - startT) / 1000).toFixed(1);
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(90, 210, 300, 60);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`TEST NOISE ${sec}s`, 240, 240);
    ctx.restore();

    if (fallbackCanvasEl) {
      const fctx = fallbackCanvasEl.getContext('2d');
      if (fctx) fctx.drawImage(canvas, 0, 0, fallbackCanvasEl.width, fallbackCanvasEl.height);
    }
  };

  drawFrame();
  const fallbackInterval = setInterval(drawFrame, 40);

  let canvasStream;
  if (typeof canvas.captureStream === 'function') {
    canvasStream = canvas.captureStream(25);
  } else {
    canvasStream = new MediaStream();
  }

  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTrack = audioStream.getAudioTracks()[0];
  const combined = new MediaStream();
  if (videoTrack) combined.addTrack(videoTrack);
  if (audioTrack) combined.addTrack(audioTrack);

  return { stream: combined, audioContext, analyserNode, fallbackInterval };
}

export async function extractAudioAmplitudes(arrayBuffer) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  const duration = decoded.duration || 1;
  const channel = decoded.getChannelData(0);
  const step = Math.floor(channel.length / 80) || 1;
  const amps = [];
  for (let i = 0; i < 80; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < step && (i * step + j) < channel.length; j++) {
      sum += Math.abs(channel[i * step + j]);
      count++;
    }
    amps.push(count > 0 ? Math.min(1.0, (sum / count) * 3.5) : 0);
  }
  audioCtx.close().catch(() => {});
  return { amps, duration };
}

export class MediaRecorderSession {
  constructor({ onElapsed, onAmplitudes, onError }) {
    this.onElapsed = onElapsed;
    this.onAmplitudes = onAmplitudes;
    this.onError = onError;

    this.isRecording = false;
    this.isFallbackVideo = false;
    this.recordMode = 'voice';
    this.videoFacingMode = 'user';

    this.mediaStream = null;
    this.mediaRecorder = null;
    this.opusRecorder = null;
    this.opusRecordedBlob = null;
    this.recordedChunks = [];
    this.audioContext = null;
    this.analyserNode = null;
    this.animFrameId = null;
    this.recordTimer = null;
    this.recordStartTime = 0;
    this.elapsedMs = 0;
    this.liveAmplitudes = [];

    this.fallbackInterval = null;
    this.recordSquareCanvas = null;
    this.recordSquareCtx = null;
    this.recordSquareAnimId = null;
    this.recordSquareStream = null;
    this.mp4Encoder = null;
  }

  async start({ mode, videoPreviewEl, fallbackCanvasEl }) {
    if (this.isRecording) return;
    this.recordMode = mode;
    this.recordedChunks = [];
    this.liveAmplitudes = [];
    this.elapsedMs = 0;
    this.isFallbackVideo = false;

    try {
      if (this.recordMode === 'voice') {
        if (!navigator?.mediaDevices?.getUserMedia) throw new Error("No mediaDevices");
        this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const source = this.audioContext.createMediaStreamSource(this.mediaStream);
          this.analyserNode = this.audioContext.createAnalyser();
          this.analyserNode.fftSize = 64;
          source.connect(this.analyserNode);
        } catch {}
      } else {
        if (!navigator?.mediaDevices?.getUserMedia) throw new Error("No mediaDevices");
        try {
          this.mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: true,
          });
        } catch {
          try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
          } catch {
            const vStream = await navigator.mediaDevices.getUserMedia({ video: true });
            let aStream = null;
            try {
              aStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch {}
            this.mediaStream = new MediaStream();
            vStream.getVideoTracks().forEach(t => this.mediaStream.addTrack(t));
            if (aStream && aStream.getAudioTracks().length > 0) {
              aStream.getAudioTracks().forEach(t => this.mediaStream.addTrack(t));
            } else {
              const fallbackA = createFallbackAudioStream();
              this.audioContext = fallbackA.audioContext;
              this.analyserNode = fallbackA.analyserNode;
              fallbackA.stream.getAudioTracks().forEach(t => this.mediaStream.addTrack(t));
            }
          }
        }
        if (!this.audioContext) {
          try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioTracks = this.mediaStream.getAudioTracks();
            if (audioTracks.length > 0) {
              const audioOnlyStream = new MediaStream([audioTracks[0]]);
              const source = this.audioContext.createMediaStreamSource(audioOnlyStream);
              this.analyserNode = this.audioContext.createAnalyser();
              this.analyserNode.fftSize = 64;
              source.connect(this.analyserNode);
            }
          } catch {}
        }
      }
    } catch {
      if (this.recordMode === 'voice') {
        const fallbackA = createFallbackAudioStream();
        this.mediaStream = fallbackA.stream;
        this.audioContext = fallbackA.audioContext;
        this.analyserNode = fallbackA.analyserNode;
      } else {
        this.isFallbackVideo = true;
        const fallbackV = createFallbackVideoStream(fallbackCanvasEl);
        this.mediaStream = fallbackV.stream;
        this.audioContext = fallbackV.audioContext;
        this.analyserNode = fallbackV.analyserNode;
        this.fallbackInterval = fallbackV.fallbackInterval;
      }
    }

    try {
      this.opusRecordedBlob = null;
      this.opusRecorder = null;
      if (this.recordMode === 'voice' && typeof Recorder !== 'undefined' && Recorder.isRecordingSupported()) {
        try {
          this.opusRecorder = new Recorder({
            encoderPath: '/encoderWorker.min.js',
            numberOfChannels: 1,
            encoderSampleRate: 48000,
            encoderApplication: 2049,
            streamPages: false,
          });
          this.opusRecorder.ondataavailable = (typedArray) => {
            this.opusRecordedBlob = new Blob([typedArray], { type: 'audio/ogg' });
          };
          await this.opusRecorder.start();
        } catch {
          this.opusRecorder = null;
        }
      }

      if (this.recordMode === 'video' && !this.isFallbackVideo) {
        if (typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
          this.recordSquareCanvas = document.createElement('canvas');
          this.recordSquareCanvas.width = 480;
          this.recordSquareCanvas.height = 480;
          this.recordSquareCtx = this.recordSquareCanvas.getContext('2d', { alpha: false });

          const drawSquareLoop = () => {
            if (videoPreviewEl && videoPreviewEl.videoWidth > 0 && videoPreviewEl.videoHeight > 0) {
              const vw = videoPreviewEl.videoWidth;
              const vh = videoPreviewEl.videoHeight;
              const size = Math.min(vw, vh);
              const sx = Math.floor((vw - size) / 2);
              const sy = Math.floor((vh - size) / 2);
              this.recordSquareCtx.drawImage(videoPreviewEl, sx, sy, size, size, 0, 0, 480, 480);
            } else if (fallbackCanvasEl) {
              this.recordSquareCtx.drawImage(fallbackCanvasEl, 0, 0, 480, 480);
            }
            this.recordSquareAnimId = requestAnimationFrame(drawSquareLoop);
          };
          drawSquareLoop();

          if (typeof this.recordSquareCanvas.captureStream === 'function') {
            try {
              this.recordSquareStream = this.recordSquareCanvas.captureStream(30);
              const audioTracks = this.mediaStream.getAudioTracks();
              if (audioTracks.length > 0) {
                this.recordSquareStream.addTrack(audioTracks[0]);
              }
            } catch {
              this.recordSquareStream = null;
            }
          }
        }
      }

      if (!this.opusRecorder) {
        if (this.recordMode === 'video' && isWebCodecsMp4Available()) {
          this.mp4Encoder = new Mp4Encoder({ width: 480, height: 480, fps: 30 });
          await this.mp4Encoder.start(this.mediaStream);
        } else {
          let mimeType = '';
          if (this.recordMode === 'voice') {
            if (typeof MediaRecorder !== 'undefined') {
              if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';
              else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
              else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
            }
          } else {
            if (typeof MediaRecorder !== 'undefined') {
              if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1,mp4a.40.2')) mimeType = 'video/mp4;codecs=avc1,mp4a.40.2';
              else if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) mimeType = 'video/mp4;codecs=avc1';
              else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
              else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) mimeType = 'video/webm;codecs=vp8,opus';
              else if (MediaRecorder.isTypeSupported('video/webm')) mimeType = 'video/webm';
            }
          }

          const streamToRecord = (this.recordMode === 'video' && !this.isFallbackVideo && this.recordSquareStream)
            ? this.recordSquareStream
            : this.mediaStream;
          this.mediaRecorder = new MediaRecorder(streamToRecord, mimeType ? { mimeType } : {});
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.recordedChunks.push(e.data);
            }
          };

          this.mediaRecorder.start(100);
        }
      }

      this.isRecording = true;
      this.recordStartTime = Date.now();

      this.recordTimer = setInterval(() => {
        this.elapsedMs = Date.now() - this.recordStartTime;
        if (this.onElapsed) this.onElapsed(this.elapsedMs);
      }, 100);

      if (this.analyserNode) {
        const pcmData = new Uint8Array(this.analyserNode.frequencyBinCount);
        const pollAmp = () => {
          if (!this.isRecording) return;
          this.analyserNode.getByteFrequencyData(pcmData);
          let sum = 0;
          for (let i = 0; i < pcmData.length; i++) sum += pcmData[i];
          const avg = sum / pcmData.length;
          this.liveAmplitudes.push(avg);
          if (this.liveAmplitudes.length > 50) this.liveAmplitudes.shift();
          if (this.onAmplitudes) this.onAmplitudes([...this.liveAmplitudes]);
          this.animFrameId = requestAnimationFrame(pollAmp);
        };
        pollAmp();
      }

      if (this.recordMode === 'video' && videoPreviewEl) {
        videoPreviewEl.srcObject = this.mediaStream;
        videoPreviewEl.play().catch(() => {});
      }
    } catch (recorderErr) {
      this.isRecording = false;
      this.stopTracks(videoPreviewEl);
      if (this.onError) this.onError(recorderErr);
    }
  }

  stopTracks(videoPreviewEl) {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.recordSquareAnimId) {
      cancelAnimationFrame(this.recordSquareAnimId);
      this.recordSquareAnimId = null;
    }
    if (this.recordSquareStream && this.recordSquareStream !== this.mediaStream) {
      this.recordSquareStream.getTracks().forEach((t) => t.stop());
      this.recordSquareStream = null;
    }
    this.recordSquareCanvas = null;
    this.recordSquareCtx = null;
    if (this.recordTimer) clearInterval(this.recordTimer);
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
    this.isFallbackVideo = false;
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (videoPreviewEl) {
      videoPreviewEl.srcObject = null;
    }
  }

  cancel(videoPreviewEl) {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.stopTracks(videoPreviewEl);
    if (this.mp4Encoder) {
      this.mp4Encoder.abort();
      this.mp4Encoder = null;
    }
    if (this.opusRecorder) {
      try { this.opusRecorder.close(); } catch {}
      this.opusRecorder = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.opusRecordedBlob = null;
    this.recordedChunks = [];
    this.liveAmplitudes = [];
  }

  async stop(videoPreviewEl) {
    if (!this.isRecording) return null;
    const finalElapsed = this.elapsedMs;
    this.isRecording = false;
    if (this.recordTimer) clearInterval(this.recordTimer);

    let mp4RecordedBlob = null;
    if (this.mp4Encoder) {
      try {
        mp4RecordedBlob = await this.mp4Encoder.stop();
      } catch (e) {
        console.error(e);
      }
      this.mp4Encoder = null;
    }

    if (this.opusRecorder) {
      await new Promise((resolve) => {
        this.opusRecorder.onstop = resolve;
        this.opusRecorder.stop();
      });
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        this.mediaRecorder.onstop = resolve;
        this.mediaRecorder.stop();
      });
    }

    this.stopTracks(videoPreviewEl);

    if (finalElapsed < 800 || (this.recordedChunks.length === 0 && !this.opusRecordedBlob && !mp4RecordedBlob)) {
      if (this.opusRecorder) {
        try { this.opusRecorder.close(); } catch {}
        this.opusRecorder = null;
      }
      this.opusRecordedBlob = null;
      this.recordedChunks = [];
      this.liveAmplitudes = [];
      return null;
    }

    const isVoice = this.recordMode === 'voice';
    const actualMime = (isVoice && this.opusRecordedBlob)
      ? 'audio/ogg'
      : (mp4RecordedBlob ? 'video/mp4' : (this.mediaRecorder?.mimeType || (isVoice ? 'audio/ogg' : 'video/mp4')));
    let finalBlob = (isVoice && this.opusRecordedBlob)
      ? this.opusRecordedBlob
      : (mp4RecordedBlob || new Blob(this.recordedChunks, { type: actualMime }));
    const ext = isVoice ? 'ogg' : 'mp4';
    const finalMime = isVoice ? 'audio/ogg' : 'video/mp4';

    if (isVoice && !this.opusRecordedBlob) {
      try {
        finalBlob = await convertAudioBlobToOggOpus(finalBlob);
      } catch {}
    }

    const wave = Array.from(generateWaveformFromAmplitudes(this.liveAmplitudes, 80));
    const capturedAmps = [...this.liveAmplitudes];
    this.liveAmplitudes = [];
    this.recordedChunks = [];

    return {
      finalElapsed,
      isVoice,
      finalBlob,
      ext,
      finalMime,
      wave,
      capturedAmps,
    };
  }

  async stopForReview(videoPreviewEl) {
    if (!this.isRecording) return null;
    const finalElapsed = this.elapsedMs;
    this.isRecording = false;
    if (this.recordTimer) clearInterval(this.recordTimer);
    const capturedAmps = [...this.liveAmplitudes];

    let mp4RecordedBlob = null;
    if (this.mp4Encoder) {
      try {
        mp4RecordedBlob = await this.mp4Encoder.stop();
      } catch (e) {
        console.error(e);
      }
      this.mp4Encoder = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        this.mediaRecorder.onstop = resolve;
        this.mediaRecorder.stop();
      });
    }

    this.stopTracks(videoPreviewEl);

    if (finalElapsed < 800 || (!mp4RecordedBlob && this.recordedChunks.length === 0)) {
      this.recordedChunks = [];
      this.liveAmplitudes = [];
      return null;
    }

    const actualMime = mp4RecordedBlob ? 'video/mp4' : (this.mediaRecorder?.mimeType || 'video/mp4');
    const vBlob = mp4RecordedBlob || new Blob(this.recordedChunks, { type: actualMime });
    this.recordedChunks = [];
    this.liveAmplitudes = [];

    return {
      finalElapsed,
      vBlob,
      capturedAmps,
    };
  }

  async flipCamera(videoPreviewEl) {
    this.videoFacingMode = this.videoFacingMode === 'user' ? 'environment' : 'user';
    if (!this.mediaStream) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.videoFacingMode, width: { ideal: 480 }, height: { ideal: 480 } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = this.mediaStream.getVideoTracks()[0];
      if (oldTrack) {
        this.mediaStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      if (newTrack) {
        this.mediaStream.addTrack(newTrack);
      }
      if (videoPreviewEl) {
        videoPreviewEl.srcObject = this.mediaStream;
        videoPreviewEl.play().catch(() => {});
      }
    } catch {}
  }
}
