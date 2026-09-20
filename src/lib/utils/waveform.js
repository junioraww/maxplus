export function parseWaveform(waveRaw, fallbackCount = 40) {
  if (!waveRaw) {
    return Array.from({ length: fallbackCount }, () => 0.3);
  }
  let values = [];
  if (typeof waveRaw === 'string') {
    values = Array.from(waveRaw, (c) => c.charCodeAt(0));
  } else if (Array.isArray(waveRaw)) {
    values = [...waveRaw];
  } else if (waveRaw instanceof Uint8Array) {
    values = Array.from(waveRaw);
  }
  if (!values.length) {
    return Array.from({ length: fallbackCount }, () => 0.3);
  }
  const max = Math.max(...values, 1);
  return values.map((v) => Math.max(0.12, Math.min(1.0, v / max)));
}

export function generateWaveformFromBuffer(audioBuffer, targetLength = 80) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleSize = Math.floor(channelData.length / targetLength);
  const result = new Uint8Array(targetLength);
  if (sampleSize <= 0) {
    return result;
  }
  let globalPeak = 0;
  const peaks = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const start = i * sampleSize;
    const end = Math.min(start + sampleSize, channelData.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    peaks[i] = max;
    if (max > globalPeak) globalPeak = max;
  }
  const factor = globalPeak > 0 ? 255 / globalPeak : 1;
  for (let i = 0; i < targetLength; i++) {
    result[i] = Math.round(peaks[i] * factor);
  }
  return result;
}

export function generateWaveformFromAmplitudes(amplitudes, targetLength = 80) {
  const result = new Uint8Array(targetLength);
  if (!amplitudes || !amplitudes.length) {
    return result;
  }
  const max = Math.max(...amplitudes, 0.001);
  const step = amplitudes.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    const idx = Math.min(Math.floor(i * step), amplitudes.length - 1);
    const norm = Math.min(1, Math.max(0, amplitudes[idx] / max));
    result[i] = Math.round(norm * 255);
  }
  return result;
}
