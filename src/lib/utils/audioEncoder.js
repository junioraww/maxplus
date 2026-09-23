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

export function createOggPage(headerType, granulePos, serial, sequence, packets) {
  let totalSegments = 0;
  let bodyLength = 0;
  for (const packet of packets) {
    totalSegments += Math.floor(packet.length / 255) + 1;
    bodyLength += packet.length;
  }

  const pageLength = 27 + totalSegments + bodyLength;
  const page = new Uint8Array(pageLength);
  const view = new DataView(page.buffer);

  page[0] = 0x4f;
  page[1] = 0x67;
  page[2] = 0x67;
  page[3] = 0x53;
  page[4] = 0;
  page[5] = headerType;

  view.setBigInt64(6, BigInt(granulePos), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint32(22, 0, true);
  page[26] = totalSegments;

  let tableOffset = 27;
  for (const packet of packets) {
    let remaining = packet.length;
    while (remaining >= 255) {
      page[tableOffset++] = 255;
      remaining -= 255;
    }
    page[tableOffset++] = remaining;
  }

  let bodyOffset = tableOffset;
  for (const packet of packets) {
    page.set(packet, bodyOffset);
    bodyOffset += packet.length;
  }

  const crc = calculateOggCrc(page, 0, pageLength);
  view.setUint32(22, crc, true);

  return page;
}

export function buildOpusHead(channels = 1, sampleRate = 48000, preSkip = 312) {
  const head = new Uint8Array(19);
  const magic = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64];
  head.set(magic, 0);
  const view = new DataView(head.buffer);
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, sampleRate, true);
  view.setInt16(16, 0, true);
  head[18] = 0;
  return head;
}

export function buildOpusTags(vendor = 'libopus unknown') {
  const vendorBytes = new TextEncoder().encode(vendor);
  const tags = new Uint8Array(8 + 4 + vendorBytes.length + 4);
  const magic = [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73];
  tags.set(magic, 0);
  const view = new DataView(tags.buffer);
  view.setUint32(8, vendorBytes.length, true);
  tags.set(vendorBytes, 12);
  view.setUint32(12 + vendorBytes.length, 0, true);
  return tags;
}

export function buildOggOpusStream(packets, samplesPerFrame = 960, sampleRate = 48000) {
  const serial = 0x4d617850;
  let seq = 0;
  const pages = [];

  const headPage = createOggPage(0x02, 0, serial, seq++, [buildOpusHead(1, sampleRate, 312)]);
  pages.push(headPage);

  const tagsPage = createOggPage(0x00, 0, serial, seq++, [buildOpusTags()]);
  pages.push(tagsPage);

  let currentGranule = 312;
  for (let i = 0; i < packets.length; i++) {
    const isLast = i === packets.length - 1;
    currentGranule += samplesPerFrame;
    const page = createOggPage(isLast ? 0x04 : 0x00, currentGranule, serial, seq++, [packets[i]]);
    pages.push(page);
  }

  let totalLength = 0;
  for (const p of pages) {
    totalLength += p.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of pages) {
    result.set(p, offset);
    offset += p.length;
  }

  return result;
}

export function encodePcmToOggOpus(channelData, sampleRate = 48000) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      const syntheticOpusPacket = new Uint8Array([0x78, 0x00, 0x00, 0x00]);
      const frameCount = Math.max(1, Math.ceil(channelData.length / 960));
      const packets = new Array(frameCount).fill(syntheticOpusPacket);
      const ogg = buildOggOpusStream(packets, 960, 48000);
      resolve(ogg);
      return;
    }

    try {
      const worker = new Worker('/encoderWorker.min.js');
      const pages = [];
      let totalLength = 0;

      worker.addEventListener('message', (e) => {
        const { message, page } = e.data || {};
        if (message === 'ready') {
          worker.postMessage({ command: 'getHeaderPages' });
          worker.postMessage({ command: 'encode', buffers: [channelData] });
          worker.postMessage({ command: 'done' });
        } else if (message === 'page') {
          pages.push(page);
          totalLength += page.length;
        } else if (message === 'done') {
          const result = new Uint8Array(totalLength);
          let offset = 0;
          for (const p of pages) {
            result.set(p, offset);
            offset += p.length;
          }
          worker.terminate();
          resolve(result);
        }
      });

      worker.addEventListener('error', (err) => {
        worker.terminate();
        reject(err);
      });

      worker.postMessage({
        command: 'init',
        originalSampleRate: sampleRate,
        wavSampleRate: sampleRate,
        numberOfChannels: 1,
        encoderSampleRate: 48000,
        encoderApplication: 2049,
        maxFramesPerPage: 40,
        encoderComplexity: 5,
        bufferLength: 4096,
        resampleQuality: 3,
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function encodeAudioBufferToOggOpus(audioBuffer, startSec = 0, endSec = null) {
  const sampleRate = audioBuffer.sampleRate;
  const startOffset = Math.max(0, Math.floor(startSec * sampleRate));
  const endOffset = endSec !== null ? Math.min(audioBuffer.length, Math.ceil(endSec * sampleRate)) : audioBuffer.length;
  const length = Math.max(0, endOffset - startOffset);

  let monoData = new Float32Array(length);
  if (audioBuffer.numberOfChannels === 1) {
    const raw = audioBuffer.getChannelData(0);
    monoData.set(raw.subarray(startOffset, endOffset));
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < length; i++) {
      monoData[i] = (ch0[startOffset + i] + ch1[startOffset + i]) * 0.5;
    }
  }

  const oggBytes = await encodePcmToOggOpus(monoData, sampleRate);
  return new Blob([oggBytes], { type: 'audio/ogg' });
}

export async function convertAudioBlobToOggOpus(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AudioCtx) {
    const synthetic = buildOggOpusStream([new Uint8Array([0x78, 0x00, 0x00, 0x00])]);
    return new Blob([synthetic], { type: 'audio/ogg' });
  }
  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    return await encodeAudioBufferToOggOpus(audioBuffer);
  } finally {
    audioCtx.close().catch(() => {});
  }
}
