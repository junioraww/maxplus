import { renderStoryLayersToCanvas } from '$lib/utils/storyCompositor';

function sanitizeMp4EditList(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x65 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x73) {
      bytes[i] = 0x66;
      bytes[i + 1] = 0x72;
      bytes[i + 2] = 0x65;
      bytes[i + 3] = 0x65;
    }
  }
}

export async function cropVideoToMp4(videoEl, options = {}) {
  const {
    cropX = 0,
    cropY = 0,
    cropSize = Math.min(videoEl.videoWidth || 480, videoEl.videoHeight || 480),
    cropWidth = null,
    cropHeight = null,
    targetWidth = null,
    targetHeight = null,
    startSec = 0,
    endSec = videoEl.duration || 1,
    targetFps = 30,
  } = options;

  const actualCropW = cropWidth ?? cropSize;
  const actualCropH = cropHeight ?? cropSize;
  const width = targetWidth ?? (cropWidth ? cropWidth : 480);
  const height = targetHeight ?? (cropHeight ? cropHeight : 480);
  const duration = Math.max(0.1, endSec - startSec);
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
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
    firstTimestampBehavior: 'offset',
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
    return await createMinimalMp4(width, height, Math.round(duration * 1000));
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  let overlayCanvas = null;
  if ((options.layers && options.layers.length > 0) || (options.doodleCanvas && typeof options.doodleCanvas.hasContent === 'function' && options.doodleCanvas.hasContent())) {
    try {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = width;
      overlayCanvas.height = height;
      const overlayCtx = overlayCanvas.getContext('2d');
      await renderStoryLayersToCanvas(overlayCtx, options.layers || [], width, height, options.previewWidth || 360, options.doodleCanvas || null);
    } catch {}
  }

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
    offscreenVideo.poster = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
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

    const isNon916Story = width === 720 && height === 1280 && Math.abs(actualCropW / actualCropH - 9 / 16) > 0.02;
    const cropAspect = actualCropW / actualCropH;
    let fitW = width;
    let fitH = width / cropAspect;
    if (fitH > height) {
      fitH = height;
      fitW = height * cropAspect;
    }
    const posX = (width - fitW) / 2;
    const posY = (height - fitH) / 2;

    while (frameIdx < totalFrames && offscreenVideo.currentTime < endSec + 0.1) {
      const srcVideo = (offscreenVideo.videoWidth > 0 && offscreenVideo.videoHeight > 0) ? offscreenVideo : videoEl;

      if (isNon916Story) {
        ctx.save();
        ctx.filter = 'blur(20px)';
        ctx.drawImage(srcVideo, cropX, cropY, actualCropW, actualCropH, -20, -20, width + 40, height + 40);
        ctx.filter = 'none';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      if (options.filterCss && options.filterCss !== 'none') {
        ctx.filter = options.filterCss;
      }

      if (isNon916Story) {
        ctx.drawImage(srcVideo, cropX, cropY, actualCropW, actualCropH, posX, posY, fitW, fitH);
      } else {
        ctx.drawImage(srcVideo, cropX, cropY, actualCropW, actualCropH, 0, 0, width, height);
      }
      ctx.filter = 'none';

      if (overlayCanvas) {
        ctx.drawImage(overlayCanvas, 0, 0, width, height);
      }

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(frameIdx * (1_000_000 / targetFps)),
        duration: Math.round(1_000_000 / targetFps),
      });

      videoEncoder.encode(frame, { keyFrame: frameIdx % keyInterval === 0 });
      frame.close();
      frameIdx++;

      await new Promise((r) => setTimeout(r, 0));
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

export async function createMinimalMp4(width = 480, height = 480, durationMs = 1000) {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
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
    firstTimestampBehavior: 'offset',
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
    return await createMinimalMp4(480, 480, 1000);
  }
  const url = URL.createObjectURL(blob);
  const videoEl = document.createElement('video');
  videoEl.poster = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
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
