import { STYLE_KEYS, STYLE_TO_SERVER_NAME, SERVER_NAME_TO_STYLE } from "./constants.js";
import {
  appendSpan,
  clipSpan,
  isSpanEnclosed,
  shiftSpansOnTextChange,
} from "./ranges.js";

export class ComposerFormatState {
  constructor() {
    this.styles = new Map();
  }

  clear() {
    this.styles.clear();
  }

  hasAnyFormatting() {
    for (const list of this.styles.values()) {
      if (list && list.length > 0) return true;
    }
    return false;
  }

  getRanges(styleKey) {
    return this.styles.get(styleKey) || [];
  }

  isStyleActive(styleKey, start, end) {
    if (start >= end) return false;
    const ranges = this.getRanges(styleKey);
    return isSpanEnclosed(ranges, start, end);
  }

  toggleStyle(styleKey, start, end, metadata = null) {
    if (start >= end) return;
    const ranges = this.getRanges(styleKey);
    if (isSpanEnclosed(ranges, start, end)) {
      const clipped = clipSpan(ranges, start, end);
      if (clipped.length > 0) {
        this.styles.set(styleKey, clipped);
      } else {
        this.styles.delete(styleKey);
      }
    } else {
      const appended = appendSpan(ranges, start, end, metadata);
      this.styles.set(styleKey, appended);
    }
  }

  onTextChanged(oldText, newText) {
    if (oldText === newText) return;
    for (const [key, ranges] of this.styles.entries()) {
      const shifted = shiftSpansOnTextChange(ranges, oldText, newText);
      if (shifted.length > 0) {
        this.styles.set(key, shifted);
      } else {
        this.styles.delete(key);
      }
    }
  }

  importData(text, rawElements = []) {
    this.clear();
    if (!text || !Array.isArray(rawElements)) return;
    const textLen = text.length;

    for (const el of rawElements) {
      if (!el || typeof el !== "object") continue;
      const styleKey = SERVER_NAME_TO_STYLE[el.type];
      if (!styleKey) continue;

      const from = Math.max(0, Math.min(Number(el.from) || 0, textLen));
      const len = Math.max(0, Number(el.length) || 0);
      const to = Math.min(from + len, textLen);
      if (to <= from) continue;

      const metadata = {};
      if (el.attributes) metadata.attributes = el.attributes;
      if (el.entityId != null) metadata.entityId = el.entityId;
      if (el.entityName != null) metadata.entityName = el.entityName;

      const existing = this.getRanges(styleKey);
      const appended = appendSpan(existing, from, to, Object.keys(metadata).length ? metadata : null);
      this.styles.set(styleKey, appended);
    }
  }

  getRawElements(sourceText) {
    if (!sourceText) return [];
    const textLen = sourceText.length;
    const elements = [];

    for (const [styleKey, ranges] of this.styles.entries()) {
      const serverType = STYLE_TO_SERVER_NAME[styleKey];
      if (!serverType) continue;

      for (const span of ranges) {
        const from = Math.max(0, Math.min(span.start, textLen));
        const to = Math.max(0, Math.min(span.end, textLen));
        const length = to - from;
        if (length <= 0) continue;

        const payload = {
          type: serverType,
          from,
          length,
        };

        if (span.metadata?.attributes) {
          payload.attributes = span.metadata.attributes;
        }
        if (span.metadata?.entityId != null) {
          payload.entityId = span.metadata.entityId;
        }
        if (span.metadata?.entityName != null) {
          payload.entityName = span.metadata.entityName;
        }

        elements.push(payload);
      }
    }

    return elements;
  }

  exportData(sourceText) {
    if (!sourceText) {
      return { text: "", elements: [] };
    }

    const trimmedText = sourceText.trim();
    if (!trimmedText) {
      return { text: "", elements: [] };
    }

    const leadingSpaces = sourceText.length - sourceText.trimStart().length;
    const trimmedLen = trimmedText.length;
    const elements = [];

    for (const [styleKey, ranges] of this.styles.entries()) {
      const serverType = STYLE_TO_SERVER_NAME[styleKey];
      if (!serverType) continue;

      for (const span of ranges) {
        let from = span.start - leadingSpaces;
        let to = span.end - leadingSpaces;

        if (to <= 0 || from >= trimmedLen) continue;
        if (from < 0) from = 0;
        if (to > trimmedLen) to = trimmedLen;
        const length = to - from;
        if (length <= 0) continue;

        const payload = {
          type: serverType,
          from,
          length,
        };

        if (span.metadata?.attributes) {
          payload.attributes = span.metadata.attributes;
        }
        if (span.metadata?.entityId != null) {
          payload.entityId = span.metadata.entityId;
        }
        if (span.metadata?.entityName != null) {
          payload.entityName = span.metadata.entityName;
        }

        elements.push(payload);
      }
    }

    return { text: trimmedText, elements };
  }

  processMarkdownTokens(inputText) {
    if (!inputText) return { text: "", hasTransformed: false };

    let currentText = inputText;
    let transformed = false;

    const patterns = [
      { regex: /\*\*([^\*]+?)\*\*/, style: STYLE_KEYS.BOLD },
      { regex: /(?<!\*)\*([^\*]+?)\*(?!\*)/, style: STYLE_KEYS.ITALIC },
      { regex: /`([^`]+?)`/, style: STYLE_KEYS.CODE },
      { regex: /~~([^~]+?)~~/, style: STYLE_KEYS.STRIKE },
    ];

    let safety = 0;
    while (safety < 50) {
      safety++;
      let earliestMatch = null;
      let selectedRule = null;

      for (const rule of patterns) {
        const m = rule.regex.exec(currentText);
        if (m && (earliestMatch === null || m.index < earliestMatch.index)) {
          earliestMatch = m;
          selectedRule = rule;
        }
      }

      if (!earliestMatch) break;

      transformed = true;
      const fullMatch = earliestMatch[0];
      const innerContent = earliestMatch[1];
      const startIndex = earliestMatch.index;
      const nextText =
        currentText.slice(0, startIndex) +
        innerContent +
        currentText.slice(startIndex + fullMatch.length);

      this.onTextChanged(currentText, nextText);
      currentText = nextText;

      const innerLen = innerContent.length;
      if (innerLen > 0) {
        this.toggleStyle(selectedRule.style, startIndex, startIndex + innerLen);
      }
    }

    return { text: currentText, hasTransformed: transformed };
  }
}
