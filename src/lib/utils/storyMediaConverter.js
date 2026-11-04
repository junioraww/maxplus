import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import omggif from "omggif";
import { renderStoryLayersToCanvas } from "./storyCompositor";

export function createGifDecoder(arrayBuffer) {
  const gifReader = new omggif.GifReader(new Uint8Array(arrayBuffer));
  const count = gifReader.numFrames();
  const frames = [];
  let curTime = 0;

  for (let i = 0; i < count; i++) {
    const info = gifReader.frameInfo(i);
    const delaySec = Math.max(0.02, (info.delay || 10) / 100);
    frames.push({
      index: i,
      time: curTime,
      duration: delaySec
    });
    curTime += delaySec;
  }

  let scratchCanvas = null;
  let scratchCtx = null;
  let scratchPixels = null;
  let lastDecodedIndex = -1;

  function getFrameCanvas(index) {
    if (!scratchCanvas) {
      scratchCanvas = document.createElement("canvas");
      scratchCanvas.width = gifReader.width;
      scratchCanvas.height = gifReader.height;
      scratchCtx = scratchCanvas.getContext("2d");
      scratchPixels = new Uint8ClampedArray(gifReader.width * gifReader.height * 4);
    }
    if (lastDecodedIndex !== index) {
      gifReader.decodeAndBlitFrameRGBA(index, scratchPixels);
      const imgData = new ImageData(scratchPixels, gifReader.width, gifReader.height);
      scratchCtx.putImageData(imgData, 0, 0);
      lastDecodedIndex = index;
    }
    return scratchCanvas;
  }

  function getMatchingFrame(time) {
    if (frames.length === 0) return null;
    let target = frames[0];
    for (const f of frames) {
      if (time >= f.time) {
        target = f;
      } else {
        break;
      }
    }
    return target;
  }

  return {
    reader: gifReader,
    frames,
    duration: curTime,
    width: gifReader.width || 720,
    height: gifReader.height || 1280,
    getFrameCanvas,
    getMatchingFrame
  };
}

export async function renderGifToVideoBlob(gifDecoder, layers, options = {}) {
  const {
    trimStartSec = 0,
    trimEndSec = gifDecoder.duration,
    previewWidth = 360,
    doodleCanvas = null,
    targetWidth = 720,
    targetHeight = 1280
  } = options;

  let targetW = Math.max(2, Math.floor(targetWidth / 2) * 2);
  let targetH = Math.max(2, Math.floor(targetHeight / 2) * 2);
  const fps = 30;
  const target = new ArrayBufferTarget();

  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width: targetW,
      height: targetH,
      frameRate: fps
    },
    fastStart: "in-memory"
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error(e)
  });

  await encoder.configure({
    codec: "avc1.42001f",
    width: targetW,
    height: targetH,
    bitrate: 2_000_000,
    framerate: fps
  });

  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = targetW;
  renderCanvas.height = targetH;
  const renderCtx = renderCanvas.getContext("2d");

  const layersCanvas = document.createElement("canvas");
  layersCanvas.width = targetW;
  layersCanvas.height = targetH;
  const layersCtx = layersCanvas.getContext("2d");
  await renderStoryLayersToCanvas(layersCtx, layers, targetW, targetH, previewWidth, doodleCanvas);

  const start = Math.max(0, trimStartSec);
  const end = Math.min(gifDecoder.duration || trimEndSec, trimEndSec);
  const totalDuration = Math.max(0.1, end - start);
  const totalFrames = Math.max(1, Math.round(totalDuration * fps));

  for (let i = 0; i < totalFrames; i++) {
    const curT = start + (i / fps);
    const frameMeta = gifDecoder.getMatchingFrame(curT);
    const frameCanvas = frameMeta ? gifDecoder.getFrameCanvas(frameMeta.index) : null;

    renderCtx.clearRect(0, 0, targetW, targetH);
    if (frameCanvas) {
      renderCtx.drawImage(frameCanvas, 0, 0, targetW, targetH);
    }
    renderCtx.drawImage(layersCanvas, 0, 0);

    const vFrame = new VideoFrame(renderCanvas, {
      timestamp: Math.round(i * (1_000_000 / fps)),
      duration: Math.round(1_000_000 / fps)
    });
    encoder.encode(vFrame, { keyFrame: i % (fps * 2) === 0 });
    vFrame.close();
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();
  return new Blob([target.buffer], { type: "video/mp4" });
}

export async function renderPhotoToVideoBlob(photoBlob, audioFile, durationSec = 5, options = {}) {
  const img = new Image();
  img.src = URL.createObjectURL(photoBlob);
  await new Promise((r) => {
    img.onload = r;
    img.onerror = r;
  });

  let targetW = options.targetWidth || 720;
  let targetH = options.targetHeight || 1280;
  if (options.isAttachmentMode) {
    const srcW = img.naturalWidth || 720;
    const srcH = img.naturalHeight || 1280;
    const maxDim = 1280;
    if (srcW > maxDim || srcH > maxDim) {
      if (srcW >= srcH) {
        targetH = Math.round((srcH * maxDim) / srcW);
        targetW = maxDim;
      } else {
        targetW = Math.round((srcW * maxDim) / srcH);
        targetH = maxDim;
      }
    } else {
      targetW = srcW;
      targetH = srcH;
    }
  }
  targetW = Math.max(2, Math.floor(targetW / 2) * 2);
  targetH = Math.max(2, Math.floor(targetH / 2) * 2);

  if (audioFile && options.photoVideoDuration > 0) {
    durationSec = options.photoVideoDuration;
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");

  try {
    if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
      const videoConfig = {
        codec: "avc1.42001f",
        width: targetW,
        height: targetH,
        bitrate: 2_000_000,
        framerate: 30
      };
      const isVideoSupported = await VideoEncoder.isConfigSupported(videoConfig);
      if (isVideoSupported.supported) {
        let canEncodeAudio = false;
        let audioBuffer = null;
        const audioCodec = "mp4a.40.2";

        if (audioFile && typeof AudioEncoder !== "undefined") {
          try {
            const actx = new (window.AudioContext || window.webkitAudioContext)();
            const ab = await audioFile.arrayBuffer();
            audioBuffer = await actx.decodeAudioData(ab);
            actx.close();
            if (audioBuffer?.duration && Number.isFinite(audioBuffer.duration)) {
              durationSec = Math.max(1, Math.round(audioBuffer.duration));
            }
            const support = await AudioEncoder.isConfigSupported({
              codec: audioCodec,
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: Math.min(2, audioBuffer.numberOfChannels)
            });
            canEncodeAudio = !!support.supported;
          } catch (_) {
            canEncodeAudio = false;
          }
        }

        if (!audioFile || canEncodeAudio) {
          const target = new ArrayBufferTarget();
          const fps = 30;
          const totalFrames = Math.max(1, Math.round(durationSec * fps));

          const muxerConfig = {
            target,
            video: {
              codec: "avc",
              width: targetW,
              height: targetH,
              frameRate: fps
            },
            fastStart: "in-memory"
          };

          if (canEncodeAudio && audioBuffer) {
            muxerConfig.audio = {
              codec: "aac",
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: Math.min(2, audioBuffer.numberOfChannels)
            };
          }

          const muxer = new Muxer(muxerConfig);
          const encoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => console.error(e)
          });
          await encoder.configure({
            codec: "avc1.42001f",
            width: targetW,
            height: targetH,
            bitrate: 2_000_000,
            framerate: fps
          });

          let audioEncoder = null;
          if (canEncodeAudio && audioBuffer) {
            audioEncoder = new AudioEncoder({
              output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
              error: (e) => console.error(e)
            });
            await audioEncoder.configure({
              codec: audioCodec,
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: Math.min(2, audioBuffer.numberOfChannels),
              bitrate: 128_000
            });
          }

          ctx.drawImage(img, 0, 0, targetW, targetH);
          for (let i = 0; i < totalFrames; i++) {
            const frame = new VideoFrame(canvas, {
              timestamp: Math.round(i * (1_000_000 / fps)),
              duration: Math.round(1_000_000 / fps)
            });
            encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
            frame.close();
          }
          await encoder.flush();
          encoder.close();

          if (audioEncoder && audioBuffer) {
            const sampleRate = audioBuffer.sampleRate;
            const channels = Math.min(2, audioBuffer.numberOfChannels);
            const totalAudioSamples = Math.min(
              audioBuffer.length,
              Math.round(durationSec * sampleRate)
            );
            const chunkSize = 2048;
            for (let offset = 0; offset < totalAudioSamples; offset += chunkSize) {
              const frames = Math.min(chunkSize, totalAudioSamples - offset);
              const planarData = new Float32Array(frames * channels);
              for (let ch = 0; ch < channels; ch++) {
                const chData = audioBuffer.getChannelData(ch);
                planarData.set(chData.subarray(offset, offset + frames), ch * frames);
              }
              const audioData = new AudioData({
                format: "f32-planar",
                sampleRate,
                numberOfFrames: frames,
                numberOfChannels: channels,
                timestamp: Math.round((offset / sampleRate) * 1_000_000),
                data: planarData
              });
              audioEncoder.encode(audioData);
              audioData.close();
            }
            await audioEncoder.flush();
            audioEncoder.close();
          }

          muxer.finalize();
          return new Blob([target.buffer], { type: "video/mp4" });
        }
      }
    }
  } catch (e) {
    console.warn("WebCodecs photo to video failed:", e);
  }

  const stream = canvas.captureStream(30);
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();

  if (audioFile) {
    const audioBuf = await audioFile.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(audioBuf);
    if (decoded?.duration && Number.isFinite(decoded.duration)) {
      durationSec = Math.max(1, Math.round(decoded.duration));
    }
    const source = audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(dest);
    source.start(0);
  }

  const combinedTracks = [...stream.getVideoTracks(), ...dest.stream.getAudioTracks()];
  const combinedStream = new MediaStream(combinedTracks);

  let mimeType = "video/webm;codecs=vp9,opus";
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";

  const rec = new MediaRecorder(combinedStream, { mimeType });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const donePromise = new Promise((resolve) => {
    rec.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    setTimeout(() => {
      if (rec.state !== "inactive") rec.stop();
    }, (durationSec + 1) * 1000);
  });

  rec.start();
  const startTime = performance.now();
  const totalMs = durationSec * 1000;

  await new Promise((resolve) => {
    function drawFrame(now) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (now - startTime < totalMs) {
        requestAnimationFrame(drawFrame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(drawFrame);
  });

  rec.stop();
  audioCtx.close().catch(() => {});
  return await donePromise;
}
