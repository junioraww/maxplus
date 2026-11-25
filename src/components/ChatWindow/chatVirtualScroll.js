import { writable, get } from "svelte/store";
import { saveChatScroll } from "$lib/stores/chatScroll";

export const DEFAULT_HEIGHT = 48;
export const MESSAGE_GAP = 8;
export const TOP_SPACER = 10;
export const OVERSCAN = 1000;

const globalMeasuredHeights = new Map();

export function getWidthBucket(clientWidth = 800) {
  return clientWidth >= 600 ? "wide" : String(Math.round(clientWidth / 40) * 40);
}

export function getCacheKey(id, clientWidth = 800) {
  return `${id}_${getWidthBucket(clientWidth)}`;
}

export function estimateHeight(msg, clientWidth = 800, hasDateSeparator = false) {
  if (!msg) return 46;
  const attaches = msg.attaches || [];

  const isSystem = Boolean(attaches.some((a) => (a._type || a.type) === "CONTROL"));
  if (isSystem) return 36;

  let attachHeight = 0;

  // 1. Photo & Video grid matching Attachments.svelte layout
  const mediaItems = attaches.filter((a) => {
    const t = a._type || a.type;
    return t === "PHOTO" || (t === "VIDEO" && a.videoType !== 1 && !a.isNote);
  });
  if (mediaItems.length > 0) {
    const n = mediaItems.length;
    if (n === 1) {
      const item = mediaItems[0];
      const w = item.width || 1;
      const h = item.height || 1;
      const maxWidth = 320;
      const maxHeight = 450;
      attachHeight += Math.min(maxWidth / (w / h), maxHeight) + 14;
    } else if (n === 2) {
      attachHeight += 200 + 14;
    } else if (n === 3 || n === 4) {
      attachHeight += 302 + 14;
    } else {
      const rows = Math.ceil(n / 3);
      attachHeight += rows * 150 + (rows - 1) * 2 + 14;
    }
  }

  // 2. Video notes (round video bubbles)
  const videoNotes = attaches.filter((a) => {
    const t = a._type || a.type;
    return t === "VIDEO" && (a.videoType === 1 || a.isNote);
  });
  if (videoNotes.length > 0) {
    attachHeight += videoNotes.length * 256;
  }

  // 3. Polls (header + title + options + footer)
  const polls = attaches.filter((a) => (a._type || a.type) === "POLL");
  for (const poll of polls) {
    const answersCount = (poll.answers && poll.answers.length) || 3;
    const titleLength = (poll.title || "").length;
    const titleLines = Math.max(1, Math.ceil(titleLength / 35));
    attachHeight += 44 + (titleLines * 24 + 8) + answersCount * 54 + 36;
  }

  // 4. File attachments
  const files = attaches.filter((a) => (a._type || a.type) === "FILE");
  if (files.length > 0) {
    attachHeight += files.length * 56 + 14;
  }

  // 5. Audio / Voice attachments
  const audioList = attaches.filter((a) => {
    const t = a._type || a.type;
    return t === "AUDIO" || t === "VOICE";
  });
  if (audioList.length > 0) {
    attachHeight += audioList.length * 85;
  }

  // 6. Stickers
  if (attaches.some((a) => (a._type || a.type) === "STICKER")) {
    attachHeight += 162;
  }

  // 7. Calls
  if (attaches.some((a) => (a._type || a.type) === "CALL")) {
    attachHeight += 52;
  }

  // 8. Contact & Location cards
  const contactOrLoc = attaches.filter((a) => {
    const t = a._type || a.type;
    return t === "CONTACT" || t === "LOCATION";
  });
  if (contactOrLoc.length > 0) {
    attachHeight += contactOrLoc.length * 60;
  }

  // 9. Text message lines calculation
  const text = msg.text || "";
  let textHeight = 0;
  let totalLines = 0;
  if (text) {
    const bubbleMaxW = clientWidth <= 500 ? clientWidth * 0.85 : Math.min(480, clientWidth * 0.72);
    const charsPerLine = Math.max(20, Math.floor((bubbleMaxW - 32) / 7.2));
    const rawLines = text.split("\n");
    for (const l of rawLines) {
      totalLines += Math.max(1, Math.ceil(l.length / charsPerLine));
    }
    if (totalLines === 1) {
      textHeight = 48.6;
    } else {
      textHeight = totalLines * 18.5 + 38;
    }
  }

  let h;
  if (attachHeight > 0 && textHeight > 0) {
    h = attachHeight + textHeight;
  } else if (attachHeight > 0) {
    h = attachHeight;
  } else {
    h = Math.max(48.6, textHeight || 48.6);
  }

  if (msg.reactionInfo?.totalCount) h += (totalLines <= 1 ? 14 : 26);
  if (msg.link && textHeight > 49) h += 20;
  if (hasDateSeparator) h += 45;

  return Math.round(h);
}

export function createVirtualScrollManager() {
  const heightsMap = globalMeasuredHeights;
  const messageHeights = writable({});
  const msgMap = new Map();
  let cumulativeHeights = [];
  let pendingHeightUpdates = {};
  let resizeObserver = null;
  let activeScrollElement = null;
  let currentDateSeparators = null;

  function setDateSeparators(map) {
    currentDateSeparators = map;
  }

  function getClientWidth() {
    return activeScrollElement?.clientWidth || 800;
  }

  function getHeight(msg, clientWidth, hasDateSeparator = false) {
    if (!msg) return 46;
    const cw = clientWidth || getClientWidth();
    const measured = heightsMap.get(getCacheKey(msg.id, cw));
    if (measured && measured > 0) return measured;
    const hasSep = hasDateSeparator || Boolean(currentDateSeparators && currentDateSeparators[msg.id]);
    return estimateHeight(msg, cw, hasSep);
  }

  function setupResizeObserver(getScrollElement, canAnchor) {
    if (resizeObserver || typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver((entries) => {
      const scrollEl = typeof getScrollElement === "function" ? getScrollElement() : activeScrollElement;
      if (scrollEl) activeScrollElement = scrollEl;
      const containerRect = scrollEl ? scrollEl.getBoundingClientRect() : null;
      const shouldAnchor = typeof canAnchor === "function" ? canAnchor() : false;
      const cw = scrollEl ? scrollEl.clientWidth : 800;

      for (const entry of entries) {
        const el = entry.target;
        const id = el.dataset.msgId || el.closest(".message-wrapper")?.id?.replace("m-", "");
        if (!id) continue;
        const rawH = entry.borderBoxSize?.[0]?.blockSize || entry.contentRect.height;
        if (rawH > 0) {
          const height = rawH;
          const cacheKey = getCacheKey(id, cw);
          const prev = heightsMap.get(cacheKey);

          const msg = msgMap.get(String(id));
          const hasSep = Boolean(currentDateSeparators && currentDateSeparators[id]);
          const baselineHeight = prev !== undefined ? prev : (msg ? estimateHeight(msg, cw, hasSep) : height);
          const diff = height - baselineHeight;

          if (prev === undefined || Math.abs(height - prev) >= 0.2) {
            heightsMap.set(cacheKey, height);
            pendingHeightUpdates[cacheKey] = { id, height };
          }
        }
      }
    });
  }

  function observeResize(node, msgId) {
    if (msgId != null) {
      node.dataset.msgId = String(msgId);
    }
    if (resizeObserver) resizeObserver.observe(node);
    return {
      destroy() {
        if (resizeObserver) resizeObserver.unobserve(node);
      },
    };
  }

  function applyPendingHeights(messagesList = [], clientWidth) {
    const updates = pendingHeightUpdates;
    pendingHeightUpdates = {};
    const keys = Object.keys(updates);
    if (keys.length === 0) return;

    const cw = clientWidth || getClientWidth();
    for (const key of keys) {
      const item = updates[key];
      heightsMap.set(key, item.height);
    }

    computeCumulativeHeights(messagesList, cw, currentDateSeparators);
  }

  function computeCumulativeHeights(messagesList = [], clientWidth, dateSeparatorsMap = null) {
    const cw = clientWidth || getClientWidth();
    if (dateSeparatorsMap) currentDateSeparators = dateSeparatorsMap;
    const dateMap = dateSeparatorsMap || currentDateSeparators;
    msgMap.clear();
    const heights = [];
    let sum = TOP_SPACER;
    for (let i = 0; i < messagesList.length; i++) {
      const msg = messagesList[i];
      if (msg?.id != null) {
        msgMap.set(String(msg.id), msg);
      }
      const hasDateSeparator = Boolean(dateMap && dateMap[msg.id]);
      const h = getHeight(msg, cw, hasDateSeparator);
      sum += h + MESSAGE_GAP;
      heights.push(sum);
    }
    cumulativeHeights = heights;
    return cumulativeHeights;
  }

  function findIndexByOffset(target) {
    let lo = 0;
    let hi = cumulativeHeights.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulativeHeights[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function measureAllHeights(innerList, clientWidth) {
    if (!innerList) return;
    const cw = clientWidth || getClientWidth();
    const wrappers = innerList.querySelectorAll(".message-wrapper");
    for (const wrapper of wrappers) {
      const id = wrapper.id?.replace("m-", "");
      if (!id) continue;
      const content = wrapper.querySelector(".observer-area");
      if (content) {
        const height = content.getBoundingClientRect().height;
        if (height > 0) heightsMap.set(getCacheKey(id, cw), height);
      }
    }
  }

  function captureScrollAnchor(scrollElement) {
    if (!scrollElement) return null;
    const containerRect = scrollElement.getBoundingClientRect();

    // Iterate message wrappers in visual DOM order from top to bottom
    const wrappers = scrollElement.querySelectorAll(".message-wrapper");
    for (let i = 0; i < wrappers.length; i++) {
      const el = wrappers[i];
      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerRect.top) {
        return {
          id: el.id,
          offset: rect.top - containerRect.top,
          scrollHeight: scrollElement.scrollHeight,
          scrollTop: scrollElement.scrollTop,
        };
      }
    }

    return {
      id: null,
      offset: 0,
      scrollHeight: scrollElement.scrollHeight,
      scrollTop: scrollElement.scrollTop,
    };
  }

  function restoreScrollAnchor(scrollElement, scrollAnchor) {
    if (!scrollAnchor || !scrollElement) return;

    if (scrollAnchor.id) {
      const el = document.getElementById(scrollAnchor.id);
      if (el) {
        const containerRect = scrollElement.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const currentOffset = rect.top - containerRect.top;
        const delta = currentOffset - scrollAnchor.offset;

        if (Math.abs(delta) >= 0.5) {
          scrollElement.scrollTop += delta;
        }
        return;
      }
    }

    if (scrollAnchor.scrollHeight && scrollAnchor.scrollTop !== undefined) {
      const deltaHeight = scrollElement.scrollHeight - scrollAnchor.scrollHeight;
      if (deltaHeight > 0) {
        scrollElement.scrollTop = scrollAnchor.scrollTop + deltaHeight;
      }
    }
  }

  let lastStartIdx = -1;
  let lastEndIdx = -1;
  let lastMessagesCount = -1;
  let lastFirstId = null;
  let lastLastId = null;
  let cachedVisible = {};

  function findWrapperIndexByOffset(wrappers, targetY) {
    let lo = 0;
    let hi = wrappers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const el = wrappers[mid];
      if (el.offsetTop + el.offsetHeight < targetY) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  function calculateVisibleMessages({ scrollElement, messagesList = [], dateSeparatorsMap = null }) {
    if (!scrollElement || !messagesList.length) return {};
    activeScrollElement = scrollElement;
    const clientWidth = scrollElement.clientWidth || 800;
    if (dateSeparatorsMap) currentDateSeparators = dateSeparatorsMap;

    for (let i = 0; i < messagesList.length; i++) {
      const msg = messagesList[i];
      if (msg?.id != null) msgMap.set(String(msg.id), msg);
    }

    const wrappers = scrollElement.getElementsByClassName("message-wrapper");
    const count = Math.min(wrappers.length, messagesList.length);
    if (count === 0) {
      // Fallback before initial DOM wrappers exist
      const end = messagesList.length - 1;
      const start = Math.max(0, end - 30);
      const initial = {};
      for (let i = start; i <= end; i++) {
        initial[messagesList[i].id] = true;
      }
      cachedVisible = initial;
      lastStartIdx = start;
      lastEndIdx = end;
      lastMessagesCount = messagesList.length;
      return initial;
    }

    const { scrollTop, clientHeight, scrollHeight } = scrollElement;
    const viewTop = Math.max(0, scrollTop - OVERSCAN);
    const viewBottom = Math.min(scrollHeight, scrollTop + clientHeight + OVERSCAN);

    let startIdx = findWrapperIndexByOffset(wrappers, viewTop);
    let endIdx = findWrapperIndexByOffset(wrappers, viewBottom);

    if (startIdx >= count) startIdx = Math.max(0, count - 1);
    endIdx = Math.min(count - 1, Math.max(startIdx, endIdx));

    // If near bottom, always include up to the last message
    if (scrollHeight - scrollTop - clientHeight < 120) {
      endIdx = count - 1;
    }

    const firstId = messagesList[0]?.id ?? null;
    const lastId = messagesList[messagesList.length - 1]?.id ?? null;

    if (
      startIdx === lastStartIdx &&
      endIdx === lastEndIdx &&
      messagesList.length === lastMessagesCount &&
      firstId === lastFirstId &&
      lastId === lastLastId
    ) {
      return cachedVisible;
    }

    lastStartIdx = startIdx;
    lastEndIdx = endIdx;
    lastMessagesCount = messagesList.length;
    lastFirstId = firstId;
    lastLastId = lastId;

    const newVisible = {};
    for (let i = startIdx; i <= endIdx; i++) {
      const id = messagesList[i]?.id;
      if (id != null) newVisible[id] = true;
    }
    cachedVisible = newVisible;
    return newVisible;
  }

  function savePosition({
    targetChatId,
    scrollElement,
    all_loaded_newer,
    visibleMessages,
    messagesList = [],
    isInitialMounting,
    isProgrammaticScroll,
  }) {
    if (!scrollElement || targetChatId == null || isInitialMounting || isProgrammaticScroll) return;
    if (scrollElement.clientHeight <= 0 || scrollElement.scrollHeight <= 0) return;
    if (scrollElement.scrollHeight <= scrollElement.clientHeight + 20) return;

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
    const isAtBottom = all_loaded_newer && distanceFromBottom < 60;
    if (isAtBottom) {
      saveChatScroll(targetChatId, {
        wasAtBottom: true,
        lastSeenTime: Date.now(),
      });
      return;
    }

    const containerRect = scrollElement.getBoundingClientRect();
    let bottomMsg = null;
    let bottomOffset = 0;
    let maxBottom = -Infinity;

    for (const id in visibleMessages) {
      if (!visibleMessages[id]) continue;
      const el = document.getElementById("m-" + id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < containerRect.bottom && rect.bottom > maxBottom) {
        maxBottom = rect.bottom;
        const m = messagesList.find((x) => String(x.id) === String(id));
        if (m) {
          bottomMsg = m;
          bottomOffset = rect.top - containerRect.top;
        }
      }
    }

    if (!bottomMsg && messagesList && messagesList.length > 0) {
      const currentScroll = scrollElement.scrollTop;
      const idx = findIndexByOffset(currentScroll + scrollElement.clientHeight / 2);
      if (idx >= 0 && idx < messagesList.length) {
        bottomMsg = messagesList[idx];
        bottomOffset = 40;
      }
    }

    if (bottomMsg) {
      saveChatScroll(targetChatId, {
        wasAtBottom: false,
        bottomMessageId: bottomMsg.id,
        bottomMessageTime: bottomMsg.time,
        offset: bottomOffset,
        scrollTop: scrollElement.scrollTop,
        lastSeenTime: Date.now(),
      });
    }
  }

  function destroy() {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  return {
    messageHeights,
    getHeight,
    estimateHeight,
    getCumulativeHeights: () => cumulativeHeights,
    setupResizeObserver,
    observeResize,
    applyPendingHeights,
    computeCumulativeHeights,
    findIndexByOffset,
    measureAllHeights,
    captureScrollAnchor,
    restoreScrollAnchor,
    calculateVisibleMessages,
    savePosition,
    setDateSeparators,
    destroy,
  };
}
