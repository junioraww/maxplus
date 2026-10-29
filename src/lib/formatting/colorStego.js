export const COLOR_MARKER = "\u200B";

const MODIFIER_REGEX = /^https?:\/\/max\.ru\/c\/(\d+)-([0-9a-fA-F]{6})$/i;

const MODIFIER_HANDLERS = {
  c: {
    type: "color",
    encode: (len, val) => `https://max.ru/c/${len}-${val}`,
    parse: (val) => {
      const clean = val.replace(/^#/, "").toUpperCase();
      return /^[0-9A-F]{6}$/.test(clean) ? `#${clean}` : null;
    },
  },
};

export function registerModifierHandler(key, handler) {
  if (key && handler && typeof handler.encode === "function" && typeof handler.parse === "function") {
    MODIFIER_HANDLERS[key] = handler;
  }
}

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

export function getContrastStyle(hex, isMe = false) {
  return "text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);";
}

function countMarkersBefore(positions, target) {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (positions[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function countInsertionsBefore(cleanPositions, cleanPos, isEnd) {
  let low = 0;
  let high = cleanPositions.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const cond = isEnd ? cleanPositions[mid] < cleanPos : cleanPositions[mid] <= cleanPos;
    if (cond) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function normalizeColorSpans(spans, maxLen) {
  let result = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const start = Math.max(0, Math.min(span.start, maxLen));
    const end = Math.max(0, Math.min(span.end, maxLen));
    if (start >= end) continue;

    const next = [];
    for (let j = 0; j < result.length; j++) {
      const existing = result[j];
      if (existing.end <= start || existing.start >= end) {
        next.push(existing);
      } else {
        if (existing.start < start) {
          next.push({ start: existing.start, end: start, hex: existing.hex });
        }
        if (existing.end > end) {
          next.push({ start: end, end: existing.end, hex: existing.hex });
        }
      }
    }
    next.push({ start, end, hex: span.hex });
    next.sort((a, b) => a.start - b.start);

    const merged = [];
    for (let j = 0; j < next.length; j++) {
      const item = next[j];
      const last = merged[merged.length - 1];
      if (last && last.end >= item.start && last.hex === item.hex) {
        last.end = Math.max(last.end, item.end);
      } else {
        merged.push({ ...item });
      }
    }
    result = merged;
  }
  return result.map((s) => ({ ...s, length: s.end - s.start }));
}

export function parseStegoColors(rawText, rawElements = []) {
  if (!rawText) return { cleanText: "", colorSpans: [], elements: [] };

  const elements = Array.isArray(rawElements) ? rawElements : [];
  if (elements.length === 0 || !rawText.includes(COLOR_MARKER)) {
    return {
      cleanText: rawText,
      colorSpans: [],
      elements: [...elements],
    };
  }

  const detected = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (
      el &&
      el.type === "LINK" &&
      Number(el.length) === 1 &&
      typeof el.attributes?.url === "string"
    ) {
      const match = el.attributes.url.match(MODIFIER_REGEX);
      if (!match) continue;

      const rawPos = Number(el.from) || 0;
      if (rawText[rawPos] !== COLOR_MARKER) continue;

      const targetLen = parseInt(match[1], 10);
      if (!Number.isFinite(targetLen) || targetLen <= 0) continue;

      const parsedValue = MODIFIER_HANDLERS.c.parse(match[2], targetLen);
      if (!parsedValue) continue;

      detected.push({
        elementIndex: i,
        rawPos,
        length: targetLen,
        type: "color",
        value: parsedValue,
      });
    }
  }

  if (detected.length === 0) {
    return {
      cleanText: rawText,
      colorSpans: [],
      elements: [...elements],
    };
  }

  detected.sort((a, b) => a.rawPos - b.rawPos);
  const colorIndexSet = new Set(detected.map((d) => d.elementIndex));
  const markerPositions = detected.map((d) => d.rawPos);

  const textChunks = [];
  let lastRaw = 0;
  for (let i = 0; i < markerPositions.length; i++) {
    const pos = markerPositions[i];
    textChunks.push(rawText.slice(lastRaw, pos));
    lastRaw = pos + 1;
  }
  textChunks.push(rawText.slice(lastRaw));
  const cleanText = textChunks.join("");

  function mapRawToClean(rawPos) {
    const removed = countMarkersBefore(markerPositions, rawPos);
    return Math.max(0, Math.min(rawPos - removed, cleanText.length));
  }

  const colorSpans = [];
  for (let i = 0; i < detected.length; i++) {
    const d = detected[i];
    if (d.type === "color") {
      const cleanStart = mapRawToClean(d.rawPos);
      const cleanEnd = Math.max(cleanStart, Math.min(cleanStart + d.length, cleanText.length));
      colorSpans.push({
        start: cleanStart,
        end: cleanEnd,
        color: d.value,
      });
    }
  }

  const mappedElements = [];
  for (let i = 0; i < elements.length; i++) {
    if (colorIndexSet.has(i)) continue;
    const el = elements[i];
    if (!el || typeof el !== "object") continue;

    const rawFrom = Math.max(0, Math.min(Number(el.from) || 0, rawText.length));
    const rawLen = Math.max(0, Number(el.length) || 0);
    const rawTo = Math.min(rawFrom + rawLen, rawText.length);
    if (rawTo <= rawFrom) continue;

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

  const rawSpans = [];
  const inputRanges = Array.isArray(colorRanges) ? colorRanges : [];
  for (let i = 0; i < inputRanges.length; i++) {
    const r = inputRanges[i];
    if (!r || r.start >= r.end) continue;
    const rawColor = String(r.metadata?.color || r.color || "").trim();
    if (!rawColor) continue;
    const hexMatch = rawColor.replace(/^#/, "").match(/^([a-fA-F0-9]{6})$|^([a-fA-F0-9]{3})$/);
    if (!hexMatch) continue;
    const hex = (hexMatch[1] || (hexMatch[2][0] + hexMatch[2][0] + hexMatch[2][1] + hexMatch[2][1] + hexMatch[2][2] + hexMatch[2][2])).toUpperCase();
    const start = Math.max(0, Math.min(Number(r.start) || 0, cleanText.length));
    const end = Math.max(0, Math.min(Number(r.end) || 0, cleanText.length));
    if (start >= end) continue;
    rawSpans.push({ start, end, hex });
  }

  const validSpans = normalizeColorSpans(rawSpans, cleanText.length);

  if (validSpans.length === 0) {
    return {
      textToSend: cleanText,
      elementsToSend: Array.isArray(cleanElements) ? cleanElements : [],
    };
  }

  validSpans.sort((a, b) => a.start - b.start || a.end - b.end);

  const cleanPositions = new Array(validSpans.length);
  const textChunks = [];
  let lastClean = 0;
  let currentRawLength = 0;
  const rawPositions = new Array(validSpans.length);

  for (let i = 0; i < validSpans.length; i++) {
    const span = validSpans[i];
    const prefix = cleanText.slice(lastClean, span.start);
    textChunks.push(prefix);
    currentRawLength += prefix.length;
    rawPositions[i] = currentRawLength;
    textChunks.push(COLOR_MARKER);
    currentRawLength += 1;
    cleanPositions[i] = span.start;
    lastClean = span.start;
  }
  textChunks.push(cleanText.slice(lastClean));
  const textToSend = textChunks.join("");

  function mapCleanToRaw(cleanPos, isEnd = false) {
    const shift = countInsertionsBefore(cleanPositions, cleanPos, isEnd);
    return cleanPos + shift;
  }

  const colorElements = new Array(validSpans.length);
  for (let i = 0; i < validSpans.length; i++) {
    const span = validSpans[i];
    colorElements[i] = {
      type: "LINK",
      from: rawPositions[i],
      length: 1,
      attributes: {
        url: MODIFIER_HANDLERS.c.encode(span.length, span.hex),
      },
    };
  }

  const mappedCleanElements = [];
  const srcElements = Array.isArray(cleanElements) ? cleanElements : [];
  for (let i = 0; i < srcElements.length; i++) {
    const el = srcElements[i];
    if (!el || typeof el !== "object") continue;

    const cFrom = Math.max(0, Math.min(Number(el.from) || 0, cleanText.length));
    const cLen = Math.max(0, Number(el.length) || 0);
    const cTo = Math.min(cFrom + cLen, cleanText.length);
    if (cTo <= cFrom) continue;

    const rFrom = mapCleanToRaw(cFrom, false);
    const rTo = mapCleanToRaw(cTo, true);
    const rLen = rTo - rFrom;
    if (rLen <= 0) continue;

    mappedCleanElements.push({
      ...el,
      from: rFrom,
      length: rLen,
    });
  }

  const elementsToSend = [...colorElements, ...mappedCleanElements].sort(
    (a, b) => (Number(a.from) || 0) - (Number(b.from) || 0)
  );

  return { textToSend, elementsToSend };
}
