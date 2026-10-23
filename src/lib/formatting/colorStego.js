export const ZW_CHARS = ["\u200B", "\u200C", "\u200D", "\u2060"];

const CHAR_TO_VAL = {
  "\u200B": 0,
  "\u200C": 1,
  "\u200D": 2,
  "\u2060": 3,
};

export const COLOR_PREFIX = "\u200B\u2060";
export const COLOR_MID = "\u2060\u200C";
export const COLOR_SUFFIX = "\u200C\u200B";

export const STEGO_TYPES = {
  COLOR: "\u200B",
  TAG_1: "\u200C",
  TAG_2: "\u200D",
  TAG_3: "\u2060",
};

export function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  const m = hex.trim().replace(/^#/, "").match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    || hex.trim().replace(/^#/, "").match(/^([a-f\d])([a-f\d])([a-f\d])$/i);
  if (!m) return null;
  return [
    parseInt(m[1].length === 1 ? m[1] + m[1] : m[1], 16),
    parseInt(m[2].length === 1 ? m[2] + m[2] : m[2], 16),
    parseInt(m[3].length === 1 ? m[3] + m[3] : m[3], 16),
  ];
}

export function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, v];
}

export function encodeColorPayload(hexColor) {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return "";
  const num = ((rgb[0] & 0xFF) << 16) | ((rgb[1] & 0xFF) << 8) | (rgb[2] & 0xFF);
  let payload = "";
  for (let i = 11; i >= 0; i--) {
    const val = (num >> (i * 2)) & 0x03;
    payload += ZW_CHARS[val];
  }
  return payload;
}

export function decodeColorPayload(payload12) {
  if (!payload12 || payload12.length !== 12) return null;
  let num = 0;
  for (let i = 0; i < 12; i++) {
    const char = payload12[i];
    const val = CHAR_TO_VAL[char];
    if (val === undefined) return null;
    num = (num << 2) | val;
  }
  const r = (num >> 16) & 0xFF;
  const g = (num >> 8) & 0xFF;
  const b = num & 0xFF;
  return rgbToHex(r, g, b);
}

const ENVELOPE_REGEX = /\u200B\u2060([\u200B\u200C\u200D\u2060]{12,13})\u2060\u200C([\s\S]*?)\u200C\u200B/g;

export function parseStegoColors(rawText, rawElements = []) {
  if (!rawText) return { cleanText: "", colorSpans: [], elements: [] };

  ENVELOPE_REGEX.lastIndex = 0;
  if (!ENVELOPE_REGEX.test(rawText)) {
    return {
      cleanText: rawText,
      colorSpans: [],
      elements: Array.isArray(rawElements) ? rawElements : [],
    };
  }

  ENVELOPE_REGEX.lastIndex = 0;
  let cleanText = "";
  let lastRawIndex = 0;
  const colorSpans = [];
  const cuts = [];

  let match;
  while ((match = ENVELOPE_REGEX.exec(rawText)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const rawPayload = match[1];
    const innerText = match[2];
    const headerLen = 2 + rawPayload.length + 2;

    let colorHex = null;
    if (rawPayload.length === 13) {
      const typeTag = rawPayload[0];
      if (typeTag === STEGO_TYPES.COLOR) {
        colorHex = decodeColorPayload(rawPayload.slice(1));
      }
    } else if (rawPayload.length === 12) {
      colorHex = decodeColorPayload(rawPayload);
    }

    cleanText += rawText.slice(lastRawIndex, matchStart);
    const colorStartInClean = cleanText.length;
    cleanText += innerText;
    const colorEndInClean = cleanText.length;

    if (colorHex && colorEndInClean > colorStartInClean) {
      colorSpans.push({
        start: colorStartInClean,
        end: colorEndInClean,
        color: colorHex,
      });
    }

    cuts.push({
      rawStart: matchStart,
      rawEnd: matchStart + headerLen,
      cutLen: headerLen,
    });
    cuts.push({
      rawStart: matchEnd - 2,
      rawEnd: matchEnd,
      cutLen: 2,
    });

    lastRawIndex = matchEnd;
  }
  cleanText += rawText.slice(lastRawIndex);

  function mapRawToClean(rawPos) {
    let cleanPos = rawPos;
    for (const cut of cuts) {
      if (rawPos >= cut.rawEnd) {
        cleanPos -= cut.cutLen;
      } else if (rawPos > cut.rawStart) {
        cleanPos -= (rawPos - cut.rawStart);
      }
    }
    return Math.max(0, Math.min(cleanPos, cleanText.length));
  }

  const mappedElements = [];
  for (const el of (rawElements || [])) {
    if (!el || typeof el !== "object") continue;
    const rawFrom = Number(el.from) || 0;
    const rawLen = Number(el.length) || 0;
    const rawTo = rawFrom + rawLen;

    const cleanFrom = mapRawToClean(rawFrom);
    const cleanTo = mapRawToClean(rawTo);
    const cleanLen = cleanTo - cleanFrom;

    if (cleanLen > 0) {
      mappedElements.push({
        ...el,
        from: cleanFrom,
        length: cleanLen,
      });
    }
  }

  return { cleanText, colorSpans, elements: mappedElements };
}

export function encodeStegoMessage(cleanText, cleanElements = [], colorRanges = []) {
  if (!cleanText) {
    return { textToSend: "", elementsToSend: [] };
  }

  const validSpans = (colorRanges || [])
    .filter((r) => r && r.start < r.end && (r.metadata?.color || r.color))
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, cleanText.length)),
      end: Math.max(0, Math.min(r.end, cleanText.length)),
      color: r.metadata?.color || r.color,
    }))
    .filter((r) => r.start < r.end)
    .sort((a, b) => a.start - b.start);

  if (validSpans.length === 0) {
    return {
      textToSend: cleanText,
      elementsToSend: Array.isArray(cleanElements) ? cleanElements : [],
    };
  }

  let textToSend = "";
  let lastEnd = 0;
  const insertions = [];

  for (const span of validSpans) {
    const payload = encodeColorPayload(span.color);
    if (!payload) continue;

    textToSend += cleanText.slice(lastEnd, span.start);
    insertions.push({ cleanPos: span.start, added: 17, isStart: true });

    textToSend += COLOR_PREFIX + STEGO_TYPES.COLOR + payload + COLOR_MID;
    textToSend += cleanText.slice(span.start, span.end);

    insertions.push({ cleanPos: span.end, added: 2, isStart: false });
    textToSend += COLOR_SUFFIX;

    lastEnd = span.end;
  }
  textToSend += cleanText.slice(lastEnd);

  function mapCleanToRaw(cleanPos, isRangeEnd = false) {
    let rawPos = cleanPos;
    for (const ins of insertions) {
      if (isRangeEnd ? cleanPos > ins.cleanPos : cleanPos >= ins.cleanPos) {
        rawPos += ins.added;
      }
    }
    return rawPos;
  }

  const elementsToSend = [];
  for (const el of (cleanElements || [])) {
    if (!el || typeof el !== "object") continue;
    const cleanFrom = Number(el.from) || 0;
    const cleanLen = Number(el.length) || 0;
    const cleanTo = cleanFrom + cleanLen;

    const rawFrom = mapCleanToRaw(cleanFrom, false);
    const rawTo = mapCleanToRaw(cleanTo, true);
    const rawLen = rawTo - rawFrom;

    if (rawLen > 0) {
      elementsToSend.push({
        ...el,
        from: rawFrom,
        length: rawLen,
      });
    }
  }

  return { textToSend, elementsToSend };
}

export function getContrastStyle(hex, isMe = false) {
  return "text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);";
}

