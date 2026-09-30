export function normalizeRangeList(ranges) {
  if (!ranges || ranges.length <= 1) return ranges ? [...ranges] : [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const result = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = result[result.length - 1];

    if (current.start <= prev.end) {
      if (current.end > prev.end) {
        prev.end = current.end;
      }
    } else {
      result.push({ ...current });
    }
  }

  return result;
}

export function appendSpan(ranges, start, end, metadata = null) {
  if (start >= end) return ranges ? [...ranges] : [];
  const next = ranges ? [...ranges, { start, end, metadata }] : [{ start, end, metadata }];
  return normalizeRangeList(next);
}

export function clipSpan(ranges, start, end) {
  if (!ranges || !ranges.length || start >= end) return ranges ? [...ranges] : [];
  const result = [];

  for (const range of ranges) {
    if (range.end <= start || range.start >= end) {
      result.push({ ...range });
      continue;
    }
    if (range.start < start) {
      result.push({
        start: range.start,
        end: start,
        metadata: range.metadata,
      });
    }
    if (range.end > end) {
      result.push({
        start: end,
        end: range.end,
        metadata: range.metadata,
      });
    }
  }

  return result;
}

export function isSpanEnclosed(ranges, start, end) {
  if (!ranges || !ranges.length || start >= end) return false;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let needle = start;

  for (const span of sorted) {
    if (span.start > needle) return false;
    if (span.end > needle) {
      needle = span.end;
    }
    if (needle >= end) return true;
  }

  return needle >= end;
}

export function shiftSpansOnTextChange(ranges, oldText, newText) {
  if (!ranges || !ranges.length) return [];
  const oldLen = oldText.length;
  const newLen = newText.length;

  let prefix = 0;
  const maxPrefix = Math.min(oldLen, newLen);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) {
    prefix++;
  }

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]
  ) {
    suffix++;
  }

  const editStart = prefix;
  const oldEditEnd = oldLen - suffix;
  const lengthDelta = newLen - oldLen;

  function remapPosition(pos) {
    if (pos < editStart) return pos;
    if (pos >= oldEditEnd) return pos + lengthDelta;
    return editStart;
  }

  const updated = [];
  for (const range of ranges) {
    const nextStart = remapPosition(range.start);
    const nextEnd = remapPosition(range.end);
    if (nextEnd > nextStart) {
      updated.push({
        start: nextStart,
        end: nextEnd,
        metadata: range.metadata,
      });
    }
  }

  return normalizeRangeList(updated);
}
