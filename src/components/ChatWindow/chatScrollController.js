import { tick } from "svelte";

export function isMessageReadOnScreen(rect, containerRect) {
  if (rect.bottom <= containerRect.top) return true;
  if (rect.top >= containerRect.bottom - 2) return false;
  const h = rect.bottom - rect.top;
  if (h <= 0) return false;
  const visibleTop = Math.max(rect.top, containerRect.top);
  const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
  const visibleHeight = Math.max(0, visibleBottom - visibleTop);
  return visibleHeight >= Math.min(h * 0.7, containerRect.height * 0.5);
}

export function createChatScrollController(options) {
  const {
    getScrollElement,
    getInnerList,
    virtualScroll,
    loader: directLoader,
    getLoader,
    getChat,
    getChatId,
    getChatSettings,
    getCurrentUser,
    getMessages,
    getUniqueMessages,
    getVisibleMessages,
    getDateSeparators,
    updateVisibleMessages,
    makeVisible,
    getApi,
    saveChats,
    getChatFromCache,
    onShowScrollDownChange,
    onUnreadBadgeCountChange,
    onShowUnreadSeparatorChange,
    onUnreadAnchorIdChange,
    onUserScrolled,
  } = options;

  function loader() {
    return typeof getLoader === "function" ? getLoader() : directLoader;
  }
  let userHasScrolled = false;
  let isInitialMounting = true;
  let isProgrammaticScroll = false;
  let unreadBadgeCount = 0;
  let showUnreadSeparator = false;
  let unreadAnchorId = null;
  let showScrollDown = false;
  let lastReadMessageId = null;
  let readMarkTime = 0;
  let unreadStartTime = 0;
  let sessionInitialUnread = 0;
  let pendingReadTimeout = null;
  let savePositionTimeout = null;
  let updateScheduled = false;
  let scrollLoaderTimeout = null;
  let scrollBottomLoaderTimeout = null;
  let scrollResizeObserver = null;
  let currentScrollAnchor = null;

  function setShowScrollDown(val) {
    if (showScrollDown !== val) {
      showScrollDown = val;
      onShowScrollDownChange?.(val);
    }
  }

  function setUnreadBadgeCount(val) {
    if (unreadBadgeCount !== val) {
      unreadBadgeCount = val;
      onUnreadBadgeCountChange?.(val);
    }
  }

  function setShowUnreadSeparator(val) {
    if (showUnreadSeparator !== val) {
      showUnreadSeparator = val;
      onShowUnreadSeparatorChange?.(val);
    }
  }

  function setUnreadAnchorId(val) {
    if (unreadAnchorId !== val) {
      unreadAnchorId = val;
      onUnreadAnchorIdChange?.(val);
    }
  }

  function captureAnchor() {
    const el = getScrollElement?.();
    if (el) {
      currentScrollAnchor = virtualScroll.captureScrollAnchor(el);
    }
  }

  async function restoreAnchor() {
    const el = getScrollElement?.();
    if (el && currentScrollAnchor) {
      await tick();
      virtualScroll.restoreScrollAnchor(el, currentScrollAnchor);
      await updateVisibleMessages?.();
      currentScrollAnchor = null;
    }
  }

  function saveCurrentPosition() {
    const scrollEl = getScrollElement?.();
    const chat = getChat?.();
    const chatId = getChatId?.();
    const messages = getMessages?.() || [];
    virtualScroll.savePosition({
      targetChatId: chat?.id ?? chatId,
      scrollElement: scrollEl,
      all_loaded_newer: loader()?.all_loaded_newer,
      visibleMessages: getVisibleMessages?.() || {},
      messagesList: messages,
      isInitialMounting,
      isProgrammaticScroll,
    });
  }

  function queueSavePosition() {
    if (savePositionTimeout) clearTimeout(savePositionTimeout);
    savePositionTimeout = setTimeout(saveCurrentPosition, 200);
  }

  function removeUnreadSeparatorSafely() {
    if (!showUnreadSeparator) return;
    const scrollEl = getScrollElement?.();
    const sep = document.getElementById("unread-separator");
    const isAbove = sep && scrollEl && (sep.offsetTop + sep.offsetHeight <= scrollEl.scrollTop);
    const distanceFromBottom = scrollEl
      ? scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
      : 0;
    const isNearEnd = distanceFromBottom <= 35;

    setShowUnreadSeparator(false);

    if (isNearEnd && scrollEl) {
      requestAnimationFrame(() => {
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
        }
      });
    } else if (isAbove && scrollEl) {
      const anchor = virtualScroll.captureScrollAnchor(scrollEl);
      if (anchor) {
        requestAnimationFrame(() => {
          virtualScroll.restoreScrollAnchor(scrollEl, anchor);
        });
      }
    }
  }

  function resolveUnreadState(unreadCount) {
    sessionInitialUnread = unreadCount;
    const messages = getMessages?.() || [];
    const chat = getChat?.();
    const myId = Number(getCurrentUser?.());
    const peerMsgs = messages.filter((m) => Number(m.sender) !== myId && !m.deleted);
    const myMark = Number(chat?.participants?.[myId] || 0);

    let firstUnread = null;
    if (unreadCount > 0 && peerMsgs.length > 0) {
      if (myMark > 0) {
        firstUnread = peerMsgs.find((m) => Number(m.time || 0) > myMark) || null;
      }
      if (!firstUnread) {
        firstUnread = peerMsgs.length >= unreadCount
          ? peerMsgs[peerMsgs.length - unreadCount]
          : peerMsgs[0];
      }
    }

    setUnreadAnchorId(firstUnread ? firstUnread.id : null);
    setShowUnreadSeparator(Boolean(firstUnread && unreadCount > 0));

    if (firstUnread) {
      unreadStartTime = Number(firstUnread.time || 0);
      const idx = peerMsgs.findIndex((m) => String(m.id) === String(firstUnread.id));
      if (idx > 0) {
        readMarkTime = Number(peerMsgs[idx - 1].time || 0);
      } else {
        readMarkTime = myMark > 0 ? myMark : Math.max(0, unreadStartTime - 1);
      }
    } else {
      unreadStartTime = 0;
      const lastMsg = messages.filter((m) => !m.deleted).pop();
      readMarkTime = lastMsg ? Number(lastMsg.time || 0) : myMark;
    }
  }

  function checkUnreadMessagesOnScroll() {
    if (isInitialMounting || isProgrammaticScroll) return;
    const chatSettings = getChatSettings?.();
    if (chatSettings?.reader === false) return;
    const chat = getChat?.();
    const scrollEl = getScrollElement?.();
    const messages = getMessages?.() || [];
    if (!chat || !scrollEl || messages.length === 0) return;
    if (unreadBadgeCount <= 0 && !showUnreadSeparator) return;

    const myId = Number(getCurrentUser?.());
    const containerRect = scrollEl.getBoundingClientRect();
    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;

    let candidate = null;
    let highestVisibleTime = readMarkTime;

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.deleted) continue;
      if (unreadStartTime && Number(m.time || 0) < unreadStartTime) continue;

      const el = document.getElementById("m-" + m.id);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      if (isMessageReadOnScreen(rect, containerRect)) {
        candidate = m;
        highestVisibleTime = Math.max(highestVisibleTime, Number(m.time || 0));
        break;
      }
    }

    if (!candidate || highestVisibleTime <= readMarkTime) {
      return;
    }

    readMarkTime = highestVisibleTime;
    let targetMsg = candidate;
    if (Number(candidate.sender) === myId) {
      const peerMsg = messages
        .filter((m) => Number(m.sender) !== myId && !m.deleted && Number(m.time) <= highestVisibleTime)
        .pop();
      if (peerMsg) {
        targetMsg = peerMsg;
      }
    }
    lastReadMessageId = targetMsg.id;

    const peerMessages = messages.filter(
      (m) => Number(m.sender) !== myId && !m.deleted
    );

    let remaining;
    const l = loader();
    if (l?.all_loaded_newer) {
      const unreadPeerMsgs = peerMessages.filter(
        (m) => Number(m.time || 0) >= unreadStartTime
      );
      remaining = unreadPeerMsgs.filter(
        (m) => Number(m.time || 0) > readMarkTime
      ).length;
    } else {
      const unreadPeerMsgs = peerMessages.filter(
        (m) => Number(m.time || 0) >= unreadStartTime
      );
      const readCount = unreadPeerMsgs.filter(
        (m) => Number(m.time || 0) <= readMarkTime
      ).length;
      remaining = Math.max(0, sessionInitialUnread - readCount);
    }

    setUnreadBadgeCount(remaining);

    let updatedChat = null;
    const currentChatCache = getChatFromCache?.(chat.id);
    if (currentChatCache?.chatInfo) {
      currentChatCache.chatInfo.update((current) => {
        if (!current) return current;
        updatedChat = {
          ...current,
          newMessages: remaining,
          participants: {
            ...(current.participants || {}),
            [myId]: candidate.time,
          },
        };
        return updatedChat;
      });
    }

    if (remaining === 0) {
      removeUnreadSeparatorSafely();
      if (distanceFromBottom <= 50) {
        setShowScrollDown(false);
      }
    }

    if (pendingReadTimeout) clearTimeout(pendingReadTimeout);
    pendingReadTimeout = setTimeout(() => {
      pendingReadTimeout = null;
      if (updatedChat && saveChats) {
        saveChats([ updatedChat ]).catch(() => {});
      }
      const api = getApi?.();
      api?.readMessage?.(chat.id, targetMsg.id, remaining, highestVisibleTime)?.catch((e) => {
        console.error("readMessage failed", e);
      });
    }, 250);
  }

  function handleScroll(event) {
    if (isInitialMounting || isProgrammaticScroll) return;

    userHasScrolled = true;
    onUserScrolled?.();
    queueSavePosition();
    const target = event.currentTarget;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const l = loader();
    setShowScrollDown(!l?.all_loaded_newer || unreadBadgeCount > 0 || distanceFromBottom > 50);

    checkUnreadMessagesOnScroll();

    if (!updateScheduled) {
      updateScheduled = true;
      requestAnimationFrame(async () => {
        await updateVisibleMessages?.();
        updateScheduled = false;
      });
    }

    if (target.scrollTop <= 80 && !l?.loading && !l?.all_loaded) {
      if (scrollLoaderTimeout) return;
      scrollLoaderTimeout = setTimeout(async () => {
        isProgrammaticScroll = true;
        try {
          await l?.loadHistory?.();
        } finally {
          isProgrammaticScroll = false;
          scrollLoaderTimeout = null;
        }
      }, 50);
    }

    if (distanceFromBottom <= 100 && !l?.loadingNewer && !l?.all_loaded_newer) {
      if (scrollBottomLoaderTimeout) return;
      scrollBottomLoaderTimeout = setTimeout(async () => {
        isProgrammaticScroll = true;
        try {
          await l?.loadNewer?.();
        } finally {
          isProgrammaticScroll = false;
          scrollBottomLoaderTimeout = null;
        }
      }, 50);
    }
  }

  function startAutoScrollIfAtBottom(hasSavedScroll, initialUnreadCount) {
    const scrollEl = getScrollElement?.();
    if (!scrollEl) return;
    const innerList = getInnerList?.();

    if (scrollResizeObserver) {
      scrollResizeObserver.disconnect();
    }

    scrollResizeObserver = new ResizeObserver(() => {
      const el = getScrollElement?.();
      if (!el || isProgrammaticScroll) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (!userHasScrolled && !hasSavedScroll && initialUnreadCount === 0) {
        el.scrollTop = scrollHeight;
        setShowScrollDown(false);
        return;
      }

      if (distanceFromBottom <= 30 && unreadBadgeCount === 0) {
        setShowScrollDown(false);
      }
    });

    if (innerList) {
      scrollResizeObserver.observe(innerList);
    }
  }

  async function scrollToBottomDirect() {
    const scrollEl = getScrollElement?.();
    if (!scrollEl) return;
    isProgrammaticScroll = true;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    await tick();
    await updateVisibleMessages?.();
    await tick();
    scrollEl.scrollTop = scrollEl.scrollHeight;
    setShowScrollDown(false);
    setTimeout(() => {
      isProgrammaticScroll = false;
    }, 150);
  }

  async function scrollToUnreadBanner() {
    const scrollEl = getScrollElement?.();
    if (!scrollEl) return false;
    await tick();
    let sep = document.getElementById("unread-separator");
    if (!sep && unreadAnchorId) {
      await makeVisible?.(unreadAnchorId);
      sep = document.getElementById("unread-separator");
    }
    if (!sep) return false;

    isProgrammaticScroll = true;
    let containerRect = scrollEl.getBoundingClientRect();
    let sepRect = sep.getBoundingClientRect();
    let delta = sepRect.bottom - (containerRect.bottom - 2);
    scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta);

    await tick();
    await updateVisibleMessages?.();
    await tick();

    sep = document.getElementById("unread-separator");
    if (sep) {
      containerRect = scrollEl.getBoundingClientRect();
      sepRect = sep.getBoundingClientRect();
      delta = sepRect.bottom - (containerRect.bottom - 2);
      if (Math.abs(delta) > 2) {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + delta);
      }
    }

    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    const l = loader();
    setShowScrollDown(!l?.all_loaded_newer || (unreadBadgeCount > 0 && distanceFromBottom > 10) || distanceFromBottom > 50);

    setTimeout(() => {
      isProgrammaticScroll = false;
    }, 150);
    return true;
  }

  async function scrollToMessage(targetMsgId, options = {}) {
    const scrollEl = getScrollElement?.();
    if (!scrollEl || !targetMsgId) return false;
    await tick();
    let targetEl = document.getElementById("m-" + targetMsgId);
    if (!targetEl) return false;

    isProgrammaticScroll = true;
    const { offset = 40 } = options;
    const containerRect = scrollEl.getBoundingClientRect();
    let elRect = targetEl.getBoundingClientRect();
    let currentScroll = scrollEl.scrollTop;
    scrollEl.scrollTop = Math.max(0, currentScroll + (elRect.top - containerRect.top) - offset);

    await tick();
    await updateVisibleMessages?.();
    await tick();

    targetEl = document.getElementById("m-" + targetMsgId);
    if (targetEl) {
      const cRect = scrollEl.getBoundingClientRect();
      elRect = targetEl.getBoundingClientRect();
      const diff = elRect.top - cRect.top - offset;
      if (Math.abs(diff) >= 0.5) {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + diff);
      }
    }

    setTimeout(() => {
      isProgrammaticScroll = false;
    }, 150);
    return true;
  }

  async function jumpToBottom() {
    setUnreadBadgeCount(0);
    removeUnreadSeparatorSafely();
    const chat = getChat?.();
    if (chat?.id != null && getChatFromCache) {
      let updatedChat = null;
      getChatFromCache(chat.id).chatInfo.update((c) => {
        if (!c) return c;
        updatedChat = { ...c, newMessages: 0 };
        return updatedChat;
      });
      if (updatedChat && saveChats) {
        saveChats([ updatedChat ]).catch(() => {});
      }
    }

    const l = loader();
    if (l && !l.all_loaded_newer) {
      l.all_loaded_newer = true;
      const drift = 0;
      await l.loadHistory(true, Date.now() + drift, 40, 0);
      await tick();
    }

    await updateVisibleMessages?.();
    await tick();
    const scrollEl = getScrollElement?.();
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
    userHasScrolled = true;
    onUserScrolled?.();
    setShowScrollDown(false);
    await tick();
    await updateVisibleMessages?.();
    await tick();
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }

    const messages = getMessages?.() || [];
    const latest = messages[messages.length - 1];
    const chatSettings = getChatSettings?.();
    if (latest && chatSettings?.reader !== false && chat?.id != null) {
      lastReadMessageId = latest.id;
      const api = getApi?.();
      api?.readMessage?.(chat.id, latest.id, 0, latest.time)?.catch((e) => {
        console.error("readMessage failed", e);
      });
    }
  }

  function destroy() {
    if (savePositionTimeout) {
      clearTimeout(savePositionTimeout);
      savePositionTimeout = null;
    }
    if (pendingReadTimeout) {
      clearTimeout(pendingReadTimeout);
      pendingReadTimeout = null;
    }
    if (scrollLoaderTimeout) {
      clearTimeout(scrollLoaderTimeout);
      scrollLoaderTimeout = null;
    }
    if (scrollBottomLoaderTimeout) {
      clearTimeout(scrollBottomLoaderTimeout);
      scrollBottomLoaderTimeout = null;
    }
    if (scrollResizeObserver) {
      scrollResizeObserver.disconnect();
      scrollResizeObserver = null;
    }
  }

  return {
    get userHasScrolled() { return userHasScrolled; },
    set userHasScrolled(val) { userHasScrolled = val; },
    get isInitialMounting() { return isInitialMounting; },
    set isInitialMounting(val) { isInitialMounting = val; },
    get isProgrammaticScroll() { return isProgrammaticScroll; },
    set isProgrammaticScroll(val) { isProgrammaticScroll = val; },
    get unreadBadgeCount() { return unreadBadgeCount; },
    get showUnreadSeparator() { return showUnreadSeparator; },
    get unreadAnchorId() { return unreadAnchorId; },
    get showScrollDown() { return showScrollDown; },
    get unreadStartTime() { return unreadStartTime; },
    get readMarkTime() { return readMarkTime; },
    captureAnchor,
    restoreAnchor,
    saveCurrentPosition,
    queueSavePosition,
    removeUnreadSeparatorSafely,
    resolveUnreadState,
    checkUnreadMessagesOnScroll,
    handleScroll,
    startAutoScrollIfAtBottom,
    scrollToBottomDirect,
    scrollToUnreadBanner,
    scrollToMessage,
    jumpToBottom,
    destroy,
  };
}
