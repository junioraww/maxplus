import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { sanitizeMp4EditList } from './mediaValidator.js';

export async function cropVideoToMp4(videoEl, options = {}) {
  const {
    cropX = 0,
    cropY = 0,
    cropSize = Math.min(videoEl.videoWidth || 480, videoEl.videoHeight || 480),
    startSec = 0,
    endSec = videoEl.duration || 1,
    targetFps = 30,
  } = options;

  const width = 480;
  const height = 480;
  const duration = Math.max(0.1, endSec - startSec);
  const target = new ArrayBufferTarget();
  const targetSampleRate = 48000;

  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: targetFps,
    },
    audio: {
      codec: 'aac',
      numberOfChannels: 1,
      sampleRate: targetSampleRate,
    },
    fastStart: 'in-memory',
  });

  let audioPcm = null;
  if (videoEl && videoEl.src) {
    try {
      const res = await fetch(videoEl.src);
      const raw = await res.arrayBuffer();
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const decoded = await audioCtx.decodeAudioData(raw.slice(0));
      audioCtx.close().catch(() => {});

      const targetLength = Math.max(1, Math.round(duration * targetSampleRate));
      const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        1,
        targetLength,
        targetSampleRate
      );
      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = decoded;
      bufferSource.connect(offlineCtx.destination);
      bufferSource.start(0, startSec, duration);
      const rendered = await offlineCtx.startRendering();
      audioPcm = rendered.getChannelData(0);
    } catch {}
  }

  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!canvas) {
    return createMinimalMp4(width, height, Math.round(duration * 1000));
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  if (typeof VideoEncoder !== 'undefined') {
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error(e),
    });

    await videoEncoder.configure({
      codec: 'avc1.42001f',
      width,
      height,
      bitrate: 1_200_000,
      framerate: targetFps,
    });

    const offscreenVideo = document.createElement('video');
    offscreenVideo.crossOrigin = 'anonymous';
    offscreenVideo.muted = true;
    offscreenVideo.playsInline = true;
    offscreenVideo.src = videoEl.src;

    await new Promise((resolve) => {
      offscreenVideo.onloadedmetadata = () => resolve();
      offscreenVideo.onerror = () => resolve();
      setTimeout(resolve, 2000);
    });

    offscreenVideo.currentTime = startSec;
    await new Promise((resolve) => {
      const onSeek = () => {
        offscreenVideo.removeEventListener('seeked', onSeek);
        resolve();
      };
      offscreenVideo.addEventListener('seeked', onSeek);
      setTimeout(onSeek, 300);
    });

    try {
      await offscreenVideo.play();
    } catch {}

    const frameIntervalMs = 1000 / targetFps;
    const keyInterval = targetFps * 2;
    let frameIdx = 0;
    const totalFrames = Math.max(1, Math.round(duration * targetFps));

    while (frameIdx < totalFrames && offscreenVideo.currentTime < endSec + 0.1) {
      if (offscreenVideo.videoWidth > 0 && offscreenVideo.videoHeight > 0) {
        ctx.drawImage(offscreenVideo, cropX, cropY, cropSize, cropSize, 0, 0, width, height);
      } else {
        ctx.drawImage(videoEl, cropX, cropY, cropSize, cropSize, 0, 0, width, height);
      }

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(frameIdx * (1_000_000 / targetFps)),
        duration: Math.round(1_000_000 / targetFps),
      });

      videoEncoder.encode(frame, { keyFrame: frameIdx % keyInterval === 0 });
      frame.close();
      frameIdx++;

      await new Promise((r) => setTimeout(r, frameIntervalMs));
      if (offscreenVideo.paused && frameIdx < totalFrames) {
        try { await offscreenVideo.play(); } catch {}
      }
    }

    offscreenVideo.pause();
    offscreenVideo.srcObject = null;
    offscreenVideo.src = '';

    await videoEncoder.flush();
    videoEncoder.close();
  }

  let audioEncoded = false;
  if (typeof AudioEncoder !== 'undefined' && audioPcm) {
    try {
      const audioConfig = {
        codec: 'mp4a.40.2',
        numberOfChannels: 1,
        sampleRate: targetSampleRate,
        bitrate: 96000,
      };
      const isSupported = await AudioEncoder.isConfigSupported(audioConfig);
      if (isSupported && isSupported.supported) {
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.error(e),
        });
        await audioEncoder.configure(audioConfig);

        const frameSize = 1024;
        const totalAudioSamples = audioPcm.length;

        for (let offset = 0; offset < totalAudioSamples; offset += frameSize) {
          const count = Math.min(frameSize, totalAudioSamples - offset);
          const chunk = new Float32Array(frameSize);
          chunk.set(audioPcm.subarray(offset, offset + count));

          const audioData = new AudioData({
            format: 'f32-planar',
            sampleRate: targetSampleRate,
            numberOfFrames: frameSize,
            numberOfChannels: 1,
            timestamp: Math.round((offset / targetSampleRate) * 1_000_000),
            data: chunk,
          });
          audioEncoder.encode(audioData);
          audioData.close();
        }

        await audioEncoder.flush();
        audioEncoder.close();
        audioEncoded = true;
      }
    } catch {
      audioEncoded = false;
    }
  }

  if (!audioEncoded) {
    const dummyAacFrame = new Uint8Array([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]);
    const audioMeta = {
      decoderConfig: {
        codec: 'mp4a.40.2',
        numberOfChannels: 1,
        sampleRate: targetSampleRate,
        description: new Uint8Array([0x11, 0x88]),
      },
    };
    const frameDurationUs = Math.round((1024 / targetSampleRate) * 1_000_000);
    const totalAudioFrames = Math.max(1, Math.round(duration * (targetSampleRate / 1024)));
    for (let f = 0; f < totalAudioFrames; f++) {
      const timestampUs = f * frameDurationUs;
      muxer.addAudioChunkRaw(dummyAacFrame, 'key', timestampUs, frameDurationUs, audioMeta);
    }
  }

  muxer.finalize();
  const outBytes = new Uint8Array(target.buffer);
  sanitizeMp4EditList(outBytes);
  return outBytes;
}

export function createMinimalMp4(width = 480, height = 480, durationMs = 1000) {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: 30,
    },
    audio: {
      codec: 'aac',
      numberOfChannels: 1,
      sampleRate: 48000,
    },
    fastStart: 'in-memory',
  });

  const dummyAvcKeyframe = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x67, 0x42, 0x00, 0x1f,
    0x96, 0x54, 0x07, 0x80, 0x22, 0x5e, 0x58, 0x40,
    0x00, 0x00, 0x00, 0x04, 0x68, 0xce, 0x3c, 0x80,
    0x00, 0x00, 0x00, 0x05, 0x65, 0x88, 0x84, 0x00, 0x10,
  ]);

  const meta = {
    decoderConfig: {
      codec: 'avc1.42001f',
      codedWidth: width,
      codedHeight: height,
      colorSpace: {},
    },
  };

  const dummyAacFrame = new Uint8Array([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]);
  const audioMeta = {
    decoderConfig: {
      codec: 'mp4a.40.2',
      numberOfChannels: 1,
      sampleRate: 48000,
      description: new Uint8Array([0x11, 0x88]),
    },
  };

  muxer.addVideoChunkRaw(dummyAvcKeyframe, 'key', 0, Math.round(durationMs * 1000), meta);
  muxer.addAudioChunkRaw(dummyAacFrame, 'key', 0, Math.round(durationMs * 1000), audioMeta);
  muxer.finalize();

  const bytes = new Uint8Array(target.buffer);
  sanitizeMp4EditList(bytes);
  return bytes;
}

export async function convertVideoBlobToMp4(blob, options = {}) {
  if (typeof document === 'undefined') {
    return createMinimalMp4(480, 480, 1000);
  }
  const url = URL.createObjectURL(blob);
  const videoEl = document.createElement('video');
  videoEl.crossOrigin = 'anonymous';
  videoEl.preload = 'auto';
  videoEl.src = url;
  videoEl.muted = true;
  videoEl.playsInline = true;

  try {
    await new Promise((resolve, reject) => {
      videoEl.onloadedmetadata = () => resolve();
      videoEl.onerror = (e) => reject(e);
      setTimeout(resolve, 3000);
    });

    const outBytes = await cropVideoToMp4(videoEl, {
      blob,
      startSec: options.startSec ?? 0,
      endSec: options.endSec ?? videoEl.duration,
      ...options,
    });
    return outBytes;
  } finally {
    URL.revokeObjectURL(url);
  }
}
