import { writable, get } from "svelte/store";
import { saveChatScroll } from "$lib/stores/chatScroll.js";

export const DEFAULT_HEIGHT = 120;
export const OVERSCAN = 1500;

export function createVirtualScrollManager() {
  const messageHeights = writable({});
  let cumulativeHeights = [];
  let pendingHeightUpdates = {};
  let resizeObserver = null;

  function setupResizeObserver() {
    if (resizeObserver || typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        const wrapper = el.closest(".message-wrapper");
        if (!wrapper) continue;
        const id = wrapper.id?.replace("m-", "");
        if (!id) continue;
        const height = entry.contentRect.height;
        if (height > 0) {
          pendingHeightUpdates[id] = height;
        }
      }
    });
  }

  function observeResize(node) {
    if (resizeObserver) resizeObserver.observe(node);
    return {
      destroy() {
        if (resizeObserver) resizeObserver.unobserve(node);
      },
    };
  }

  function applyPendingHeights(messagesList = []) {
    const updates = pendingHeightUpdates;
    pendingHeightUpdates = {};
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    messageHeights.update((h) => {
      const newH = { ...h };
      for (const id of keys) newH[id] = updates[id];
      return newH;
    });
    computeCumulativeHeights(messagesList);
  }

  function computeCumulativeHeights(messagesList = []) {
    const heights = [];
    let sum = 0;
    const currentHeights = get(messageHeights);
    for (const msg of messagesList) {
      const h = currentHeights[msg.id] || DEFAULT_HEIGHT;
      sum += h;
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

  function measureAllHeights(innerList) {
    if (!innerList) return;
    const wrappers = innerList.querySelectorAll(".message-wrapper");
    const updates = {};
    for (const wrapper of wrappers) {
      const id = wrapper.id?.replace("m-", "");
      if (!id) continue;
      const content =
        wrapper.querySelector("#clickable-area") ||
        wrapper.querySelector(".observer-area") ||
        wrapper;
      if (content) {
        const height = content.getBoundingClientRect().height;
        if (height > 0) updates[id] = height;
      }
    }
    if (Object.keys(updates).length) {
      messageHeights.update((h) => ({ ...h, ...updates }));
    }
  }

  function captureScrollAnchor(scrollElement, visibleMessages) {
    if (!scrollElement) return null;
    const containerRect = scrollElement.getBoundingClientRect();

    for (const id in visibleMessages) {
      const el = visibleMessages[id];
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerRect.top) {
        return {
          id: el.id,
          offset: rect.top - containerRect.top,
        };
      }
    }
    return null;
  }

  function restoreScrollAnchor(scrollElement, scrollAnchor) {
    if (!scrollAnchor || !scrollElement) return;
    const el = document.getElementById(scrollAnchor.id);
    if (!el) return;

    const containerRect = scrollElement.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const delta = rect.top - containerRect.top - scrollAnchor.offset;

    if (delta !== 0) {
      scrollElement.scrollTop += delta;
    }
  }

  function calculateVisibleMessages({ scrollElement, messagesList = [] }) {
    if (!scrollElement) return {};
    applyPendingHeights(messagesList);

    const { scrollTop, clientHeight } = scrollElement;
    const totalHeight = cumulativeHeights.length ? cumulativeHeights[cumulativeHeights.length - 1] : 0;
    if (totalHeight === 0) {
      return {};
    }

    const isNearBottom = totalHeight - scrollTop - clientHeight < 50;
    let startIdx;
    let endIdx;

    if (isNearBottom) {
      const targetOffset = Math.max(0, totalHeight - clientHeight - OVERSCAN);
      startIdx = findIndexByOffset(targetOffset);
      endIdx = messagesList.length - 1;
    } else {
      const viewTop = Math.max(0, scrollTop - OVERSCAN);
      const viewBottom = scrollTop + clientHeight + OVERSCAN;
      startIdx = findIndexByOffset(viewTop);
      endIdx = findIndexByOffset(viewBottom);
      endIdx = Math.min(endIdx, messagesList.length - 1);
      if (startIdx > endIdx) endIdx = startIdx;
    }

    const newVisible = {};
    for (let i = startIdx; i <= endIdx && i < messagesList.length; i++) {
      const id = messagesList[i].id;
      if (!newVisible[id]) {
        newVisible[id] = document.getElementById("m-" + id);
      }
    }
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
      const el = visibleMessages[id];
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
    destroy,
  };
}
