const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

export function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ bytes[i]) & 0xff];
  }
  return (c ^ (-1)) >>> 0;
}

export function strToU8(str) {
  return new TextEncoder().encode(str);
}

export function strFromU8(bytes) {
  return new TextDecoder().decode(bytes);
}

export function zipSync(files) {
  const encoder = new TextEncoder();
  const entries = [];
  let totalLocalSize = 0;

  for (const [name, rawData] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = typeof rawData === "string"
      ? encoder.encode(rawData)
      : (rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData));
    const crc = crc32(data);
    entries.push({ nameBytes, data, crc, offset: totalLocalSize });
    totalLocalSize += 30 + nameBytes.length + data.length;
  }

  let totalCdSize = 0;
  for (const entry of entries) {
    totalCdSize += 46 + entry.nameBytes.length;
  }

  const out = new Uint8Array(totalLocalSize + totalCdSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  for (const entry of entries) {
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true);
    view.setUint16(pos + 8, 0, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, 0x5c21, true);
    view.setUint32(pos + 14, entry.crc, true);
    view.setUint32(pos + 18, entry.data.length, true);
    view.setUint32(pos + 22, entry.data.length, true);
    view.setUint16(pos + 26, entry.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;

    out.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;

    out.set(entry.data, pos);
    pos += entry.data.length;
  }

  const cdOffset = pos;
  for (const entry of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, 0, true);
    view.setUint16(pos + 14, 0x5c21, true);
    view.setUint32(pos + 16, entry.crc, true);
    view.setUint32(pos + 20, entry.data.length, true);
    view.setUint32(pos + 24, entry.data.length, true);
    view.setUint16(pos + 28, entry.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, entry.offset, true);
    pos += 46;

    out.set(entry.nameBytes, pos);
    pos += entry.nameBytes.length;
  }

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, totalCdSize, true);
  view.setUint32(pos + 16, cdOffset, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

export function unzipSync(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const result = {};
  let pos = 0;

  while (pos + 30 <= bytes.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break;

    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const nameStart = pos + 30;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
    const name = decoder.decode(nameBytes);
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.slice(dataStart, dataStart + compSize);

    result[name] = data;
    pos = dataStart + compSize;
  }

  if (Object.keys(result).length === 0) {
    let eocdPos = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos !== -1) {
      const entryCount = view.getUint16(eocdPos + 10, true);
      let cdPos = view.getUint32(eocdPos + 16, true);
      for (let i = 0; i < entryCount; i++) {
        if (cdPos + 46 > bytes.length) break;
        if (view.getUint32(cdPos, true) !== 0x02014b50) break;
        const compSize = view.getUint32(cdPos + 20, true);
        const nameLen = view.getUint16(cdPos + 28, true);
        const extraLen = view.getUint16(cdPos + 30, true);
        const commentLen = view.getUint16(cdPos + 32, true);
        const localOffset = view.getUint32(cdPos + 42, true);
        const nameStart = cdPos + 46;
        const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        result[name] = bytes.slice(dataStart, dataStart + compSize);
        cdPos = nameStart + nameLen + extraLen + commentLen;
      }
    }
  }

  return result;
}
