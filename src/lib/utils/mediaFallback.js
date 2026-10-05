export function createSyntheticAudioStream() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return { stream: new MediaStream(), audioContext: null };
  }
  const audioContext = new AudioCtx();
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
  const sampleRate = audioContext.sampleRate || 44100;
  const bufferSize = sampleRate * 2;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, sampleRate);
  const channelData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    channelData[i] = (Math.random() * 2 - 1) * 0.1;
  }
  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;

  const gainNode = audioContext.createGain();
  gainNode.gain.value = 0.5;

  const destination = audioContext.createMediaStreamDestination();
  noiseSource.connect(gainNode);
  gainNode.connect(destination);
  noiseSource.start(0);

  return {
    stream: destination.stream,
    audioContext,
    stop: () => {
      try {
        noiseSource.stop();
        noiseSource.disconnect();
        gainNode.disconnect();
        audioContext.close().catch(() => {});
      } catch {}
    }
  };
}

export function createSyntheticVideoStream() {
  const audioResult = createSyntheticAudioStream();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const startTime = Date.now();
  const imgData = ctx.createImageData(640, 480);
  const pixelBuffer = new Uint32Array(imgData.data.buffer);

  let active = true;
  const renderFrame = () => {
    if (!active) return;
    for (let i = 0; i < pixelBuffer.length; i++) {
      const lum = (Math.random() * 255) | 0;
      pixelBuffer[i] = 0xff000000 | (lum << 16) | (lum << 8) | lum;
    }
    ctx.putImageData(imgData, 0, 0);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.roundRect ? ctx.roundRect(140, 200, 360, 80, 16) : ctx.fillRect(140, 200, 360, 80);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`SIMULATED FEED ${elapsedSec}s`, 320, 240);
    ctx.restore();
  };

  renderFrame();
  const timer = setInterval(renderFrame, 40);

  let canvasStream;
  if (typeof canvas.captureStream === 'function') {
    canvasStream = canvas.captureStream(25);
  } else {
    canvasStream = new MediaStream();
  }

  const videoTrack = canvasStream.getVideoTracks()[0];
  const audioTrack = audioResult.stream.getAudioTracks()[0];
  const combined = new MediaStream();
  if (videoTrack) combined.addTrack(videoTrack);
  if (audioTrack) combined.addTrack(audioTrack);

  return {
    stream: combined,
    audioContext: audioResult.audioContext,
    videoTrack,
    audioTrack,
    stop: () => {
      active = false;
      clearInterval(timer);
      try {
        videoTrack?.stop();
        audioTrack?.stop();
        audioResult.stop?.();
      } catch {}
    }
  };
}
