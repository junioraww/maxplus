import { SERVER_NAME_TO_STYLE, STYLE_KEYS } from "./constants.js";

const WEB_LINK_PATTERN = /(?:https?:\/\/[^\s<>"'()]+|www\.[^\s<>"'()]+|\bmax\.ru\/[A-Za-z0-9_/-]+)/gi;

export function compileDisplayBlocks(rawText, rawElements = []) {
  if (!rawText) return [];

  const textLength = rawText.length;
  const elements = Array.isArray(rawElements) ? rawElements : [];

  const parsedRanges = [];
  let hasExplicitLinks = false;

  for (const item of elements) {
    if (!item || typeof item !== "object") continue;
    const style = SERVER_NAME_TO_STYLE[item.type];
    if (!style) continue;

    const from = Math.max(0, Math.min(Number(item.from) || 0, textLength));
    const length = Math.max(0, Number(item.length) || 0);
    const to = Math.min(from + length, textLength);
    if (to <= from) continue;

    if (style === STYLE_KEYS.LINK) {
      hasExplicitLinks = true;
    }

    parsedRanges.push({
      style,
      start: from,
      end: to,
      entityId: item.entityId ?? null,
      entityName: item.entityName ?? null,
      attributes: item.attributes ?? null,
    });
  }

  if (!hasExplicitLinks) {
    let match;
    WEB_LINK_PATTERN.lastIndex = 0;
    while ((match = WEB_LINK_PATTERN.exec(rawText)) !== null) {
      const matchText = match[0];
      const start = match.index;
      const end = start + matchText.length;
      let url = matchText;
      if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
      }
      parsedRanges.push({
        style: STYLE_KEYS.LINK,
        start,
        end,
        attributes: { url },
      });
    }
  }

  const boundarySet = new Set([0, textLength]);
  for (const range of parsedRanges) {
    boundarySet.add(range.start);
    boundarySet.add(range.end);
  }
  const splitPoints = Array.from(boundarySet).sort((a, b) => a - b);

  const flatSlices = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    const sliceStart = splitPoints[i];
    const sliceEnd = splitPoints[i + 1];
    if (sliceEnd <= sliceStart) continue;

    const activeStyles = new Set();
    let linkUrl = null;
    let animojiUrl = null;
    let mentionId = null;
    let mentionName = null;

    for (const range of parsedRanges) {
      if (range.start <= sliceStart && range.end >= sliceEnd) {
        activeStyles.add(range.style);
        if (range.style === STYLE_KEYS.LINK && range.attributes?.url) {
          linkUrl = range.attributes.url;
        }
        if (range.style === STYLE_KEYS.ANIMOJI && range.attributes?.animojiLottieUrl) {
          animojiUrl = range.attributes.animojiLottieUrl;
        }
        if (range.style === STYLE_KEYS.MENTION) {
          mentionId = range.entityId;
          mentionName = range.entityName;
        }
      }
    }

    flatSlices.push({
      start: sliceStart,
      end: sliceEnd,
      text: rawText.substring(sliceStart, sliceEnd),
      styles: activeStyles,
      linkUrl,
      animojiUrl,
      mentionId,
      mentionName,
    });
  }

  const blocks = [];
  let currentBlockQuote = false;
  let currentSpans = [];

  function finalizeBlock() {
    if (!currentSpans.length) return;
    trimSpanEdges(currentSpans);
    if (currentSpans.length) {
      blocks.push({
        isQuote: currentBlockQuote,
        spans: currentSpans,
      });
    }
    currentSpans = [];
  }

  for (const slice of flatSlices) {
    const isQuote = slice.styles.has(STYLE_KEYS.QUOTE);
    if (isQuote !== currentBlockQuote) {
      finalizeBlock();
      currentBlockQuote = isQuote;
    }
    currentSpans.push(slice);
  }

  finalizeBlock();
  return blocks;
}

function trimSpanEdges(spans) {
  while (spans.length) {
    const first = spans[0];
    const trimmed = first.text.replace(/^\n+/, "");
    if (!trimmed) {
      spans.shift();
      continue;
    }
    if (trimmed !== first.text) {
      first.text = trimmed;
    }
    break;
  }

  while (spans.length) {
    const last = spans[spans.length - 1];
    const trimmed = last.text.replace(/\n+$/, "");
    if (!trimmed) {
      spans.pop();
      continue;
    }
    if (trimmed !== last.text) {
      last.text = trimmed;
    }
    break;
  }
}

export function compileBackdropSpans(rawText, rawElements = []) {
  if (!rawText) return [];

  const textLength = rawText.length;
  const elements = Array.isArray(rawElements) ? rawElements : [];

  const parsedRanges = [];
  for (const item of elements) {
    if (!item || typeof item !== "object") continue;
    const style = SERVER_NAME_TO_STYLE[item.type];
    if (!style) continue;

    const from = Math.max(0, Math.min(Number(item.from) || 0, textLength));
    const length = Math.max(0, Number(item.length) || 0);
    const to = Math.min(from + length, textLength);
    if (to <= from) continue;

    parsedRanges.push({
      style,
      start: from,
      end: to,
      linkUrl: item.attributes?.url || null,
    });
  }

  const boundarySet = new Set([0, textLength]);
  for (const range of parsedRanges) {
    boundarySet.add(range.start);
    boundarySet.add(range.end);
  }
  const splitPoints = Array.from(boundarySet).sort((a, b) => a - b);

  const spans = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    const sliceStart = splitPoints[i];
    const sliceEnd = splitPoints[i + 1];
    if (sliceEnd <= sliceStart) continue;

    const activeStyles = new Set();
    let linkUrl = null;

    for (const range of parsedRanges) {
      if (range.start <= sliceStart && range.end >= sliceEnd) {
        activeStyles.add(range.style);
        if (range.style === STYLE_KEYS.LINK && range.linkUrl) {
          linkUrl = range.linkUrl;
        }
      }
    }

    spans.push({
      start: sliceStart,
      end: sliceEnd,
      text: rawText.substring(sliceStart, sliceEnd),
      styles: activeStyles,
      linkUrl,
    });
  }

  return spans;
}

