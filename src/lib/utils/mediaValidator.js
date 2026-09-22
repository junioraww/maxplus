const OGG_CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let r = i << 24;
  for (let j = 0; j < 8; j++) {
    r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
  }
  OGG_CRC_TABLE[i] = r >>> 0;
}

export function calculateOggCrc(data, offset = 0, length = data.length) {
  let crc = 0;
  for (let i = offset; i < offset + length; i++) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  }
  return crc;
}

export function validateAudioMessage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 28) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'File too small' };
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'WebM format rejected for audio messages' };
  }

  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'WAV format rejected for audio messages' };
  }

  if ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'MP3 format rejected for audio messages' };
  }

  if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'Missing OggS signature' };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerType = view.getUint8(5);
  if ((headerType & 0x02) === 0) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'First page is not BOS' };
  }

  const segmentCount = view.getUint8(26);
  if (bytes.length < 27 + segmentCount + 19) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'Incomplete OpusHead page' };
  }

  let headOffset = 27 + segmentCount;
  const headSignature = String.fromCharCode(...bytes.subarray(headOffset, headOffset + 8));
  if (headSignature !== 'OpusHead') {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'Missing OpusHead' };
  }

  const channels = view.getUint8(headOffset + 9);
  const sampleRate = view.getUint32(headOffset + 12, true);

  if (channels !== 1) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'Audio message must be mono' };
  }

  if (sampleRate !== 48000) {
    return { valid: false, error: 'AUDIO_VALIDATION_FAILED', reason: 'Audio message sample rate must be 48000Hz' };
  }

  return { valid: true, format: 'ogg/opus', channels, sampleRate };
}

export function sanitizeMp4EditList(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let sanitized = false;
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x65 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x73) {
      bytes[i] = 0x66;
      bytes[i + 1] = 0x72;
      bytes[i + 2] = 0x65;
      bytes[i + 3] = 0x65;
      sanitized = true;
    }
  }
  return sanitized;
}

export function validateVideoNote(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16) {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'File too small' };
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'WebM format rejected for video notes' };
  }

  const ftypTag = String.fromCharCode(...bytes.subarray(4, 8));
  if (ftypTag !== 'ftyp') {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'Not an MP4 container' };
  }

  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x65 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x73) {
      return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'Video note contains edit list (edts)' };
    }
  }

  let moovOffset = -1;
  let mdatOffset = -1;
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'moov' && moovOffset === -1) {
      moovOffset = offset;
    }
    if (type === 'mdat' && mdatOffset === -1) {
      mdatOffset = offset;
    }
    if (size === 0) break;
    offset += size === 1 && offset + 16 <= bytes.length ? Number(view.getBigUint64(offset + 8, false)) : size;
  }

  if (moovOffset === -1) {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'Missing moov box' };
  }

  if (mdatOffset !== -1 && moovOffset > mdatOffset) {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'moov after mdat (not faststart)' };
  }

  const str = String.fromCharCode(...bytes);
  if (!str.includes('vide')) {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'Missing video track' };
  }

  if (!str.includes('soun')) {
    return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'Missing audio track' };
  }

  const tkhdIdx = str.indexOf('tkhd');
  if (tkhdIdx !== -1 && tkhdIdx + 88 <= bytes.length) {
    const ver = bytes[tkhdIdx + 4];
    const wOff = tkhdIdx + 4 + (ver === 1 ? 84 : 76);
    if (wOff + 6 <= bytes.length) {
      const w = view.getUint16(wOff, false);
      const h = view.getUint16(wOff + 4, false);
      if (w > 0 && h > 0 && w !== h) {
        return { valid: false, error: 'VIDEO_VALIDATION_FAILED', reason: 'Video note must be square (1:1)' };
      }
    }
  }

  return { valid: true, format: 'mp4' };
}
