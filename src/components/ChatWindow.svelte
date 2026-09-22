<script>
  import {
    getContext,
    onMount,
    onDestroy,
    tick,
    beforeUpdate,
    afterUpdate,
  } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { writable, get } from "svelte/store";

  import Message from "$components/ChatWindow/Message.svelte";
  import PinnedMessage from "$components/ChatWindow/PinnedMessage.svelte";
  import Bubbles from "$components/Bubbles.svelte";
  import "$lib/styles/AnimatedPanel.css";
  import API, {
    currentUser,
    currentSessionChats,
  } from "$lib/stores/api";
  import {
    getChatSettings,
    getChat
  } from "$lib/stores/messages";
  import {
    getContact
  } from "$lib/stores/contacts";
  import Session, {
    openChat,
    closeChat,
    get as sessionGet,
  } from "$lib/stores/session";
  import { handleReaction } from "$components/ChatWindow/actions.js";
  import {
    checkForEncryptionRequest,
    decode_msg,
  } from "$components/ChatWindow/e2e.js";
  import { scrollToBottom } from "$lib/utils/scroll.js";
  import { getChatScroll, saveChatScroll } from "$lib/stores/chatScroll.js";
  import * as Caching from "$lib/utils/caching.js";
  import Settings from "$components/ChatWindow/Settings.svelte";
  import E2eModal from "$components/ChatWindow/E2eModal.svelte";
  import Dropout from "$components/ChatWindow/Dropout.svelte";
  import Signature from "$components/main/Signature.svelte";
  import MediaViewer from "$components/ChatWindow/MediaViewer.svelte";
  import MediaPlaybackHeader from "$components/media/MediaPlaybackHeader.svelte";
  import { activeMedia, activeChatMessages, buildChatPlaylist } from "$lib/stores/mediaPlayback";
  import DateSeparator from "$components/ChatWindow/DateSeparator.svelte";
  import Input from "$components/ChatWindow/input/Input.svelte";
  import BotStart from "$components/ChatWindow/BotStart.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import StickerPackModal from "$components/ChatWindow/Stickers/StickerPackModal.svelte";
  import EditHistoryModal from "$components/ChatWindow/EditHistoryModal.svelte";
  import { computeTextDiff } from "$lib/utils/diff.js";
  import { clearChatNotification } from "$lib/utils/notifications.js";

  export let chatId;

  $: chat = $currentSessionChats?.find((c) => String(c.id) === String(chatId));

  let title;

  let startSecretChatRequest = null;
  let gotSecretChatRequest = null;

  let replyTo = null;
  let editingMessage = null;
  let historyModalMessage = null;

  let settingsShown = false;
  let dropoutActiveAt;
  let attachesDropout = null;
  let activeStickerPack = null;
  let inputComponent;
  let showStickerPanel = false;

  function handleOpenStickerPack(sticker) {
    if (!sticker) return;
    activeStickerPack = {
      stickerId: sticker.stickerId ? Number(sticker.stickerId) : null,
      setId: (sticker.setId || sticker.stickerPackId) ? Number(sticker.setId || sticker.stickerPackId) : null,
    };
  }

  let loading = false;
  let all_loaded = false;
  let loadingNewer = false;
  let all_loaded_newer = true;
  let allRendered = false;

  let scrollElement;
  let scrollLoaderTimeout;
  let scrollBottomLoaderTimeout;
  let showScrollDown = false;

  let viewerOpen = false;
  let viewerIndex = 0;

  let lastDate;

  let clickStartPos = { x: 0, y: 0 };

  const messages = writable([]);
  $: if ($messages) {
    activeChatMessages.set($messages);
  }
  let initialized = false;

  const BATCH_SIZE = 40;

  $: avatarUserId = (() => {
    if (chat?.type !== "DIALOG") return undefined;
    if (chat?.participants && Object.keys(chat.participants).length > 0) {
      const other = Object.keys(chat.participants).find(id => String(id) !== String($currentUser));
      if (other) return Number(other);
    }
    if ($currentUser != null && chat?.id != null) {
      try {
        return Number(BigInt(chat.id) ^ BigInt($currentUser));
      } catch (e) {
        return undefined;
      }
    }
    return undefined;
  })();

  $: unreadBadgeCount = Math.max(0, Number($currentSessionChats?.find((x) => x.id === chat?.id)?.newMessages ?? chat?.newMessages ?? 0));

  $: chatSettings = getChatSettings(chat?.id ?? chatId);

  const onBack = getContext("onBack");

  function handleCloseChat() {
    if (savePositionTimeout) {
      clearTimeout(savePositionTimeout);
      savePositionTimeout = null;
    }
    saveCurrentPosition();
    closeChat(chat?.id ?? chatId);
  }

  let touchStartX = 0;
  let touchStartY = 0;
  let currentDragX = 0;
  let isTouchTracking = false;
  let isSwipingChat = false;
  let isScrollingChat = false;
  let isClosingBySwipe = false;
  let chatWindowWidth = 0;

  function handleTouchStart(e) {
    if (e.touches.length !== 1) {
      isTouchTracking = false;
      return;
    }
    if (viewerOpen || settingsShown || dropoutActiveAt || isClosingBySwipe) {
      isTouchTracking = false;
      return;
    }
    if (e.target.closest("input, textarea, button, a, .icon-button, .scroll-down-container, .media-playback-header, .timeline-track-container, .speed-control-wrapper, .volume-control-wrapper, .hdr-btn")) {
      isTouchTracking = false;
      return;
    }

    isTouchTracking = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    currentDragX = 0;
    isSwipingChat = false;
    isScrollingChat = false;
    chatWindowWidth = window.innerWidth;
  }

  function handleTouchMove(e) {
    if (!isTouchTracking || isScrollingChat || isClosingBySwipe) return;
    if (e.touches.length !== 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartX;
    const diffY = currentY - touchStartY;

    if (!isSwipingChat) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        if (diffX > 10 && diffX > Math.abs(diffY) * 1.1) {
          isSwipingChat = true;
        } else {
          isScrollingChat = true;
          return;
        }
      } else {
        return;
      }
    }

    if (isSwipingChat) {
      if (diffX > 0) {
        currentDragX = diffX;
      } else {
        currentDragX = 0;
      }
      if (e.cancelable) e.preventDefault();
    }
  }

  function handleTouchEnd() {
    isTouchTracking = false;
    if (!isSwipingChat || isClosingBySwipe) {
      isSwipingChat = false;
      isScrollingChat = false;
      return;
    }

    const threshold = chatWindowWidth * 0.3;
    if (currentDragX >= threshold) {
      isClosingBySwipe = true;
      isSwipingChat = false;
      currentDragX = chatWindowWidth;
      setTimeout(() => {
        handleCloseChat();
      }, 220);
    } else {
      isSwipingChat = false;
      currentDragX = 0;
      isScrollingChat = false;
    }
  }

  function handleTouchCancel() {
    isTouchTracking = false;
    if (!isClosingBySwipe) {
      isSwipingChat = false;
      isScrollingChat = false;
      currentDragX = 0;
    }
  }

  let isMouseDragging = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseDragEngaged = false;

  function handleMouseDown(e) {
    if (isClosingBySwipe || viewerOpen || settingsShown || dropoutActiveAt) return;
    if (e.button !== 0) return;
    if (e.target.closest("input, textarea, button, a, .icon-button, .scroll-down-container, .media-playback-header, .timeline-track-container, .speed-control-wrapper, .volume-control-wrapper")) return;

    const isHeader = Boolean(e.target.closest("header"));
    const isLeftEdge = e.clientX <= 60;
    const isMessage = Boolean(e.target.closest(".message, .bubble"));

    if (!isHeader && !isLeftEdge && isMessage) {
      return;
    }

    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    isMouseDragging = true;
    mouseDragEngaged = false;
    chatWindowWidth = window.innerWidth;

    const onMouseMove = (moveEv) => {
      if (!isMouseDragging) return;
      const diffX = moveEv.clientX - mouseStartX;
      const diffY = moveEv.clientY - mouseStartY;

      if (!mouseDragEngaged) {
        if (diffX > 10 && diffX > Math.abs(diffY) * 1.1) {
          mouseDragEngaged = true;
          isSwipingChat = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        } else if (Math.abs(diffY) > 10) {
          isMouseDragging = false;
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
          return;
        }
      }

      if (mouseDragEngaged) {
        currentDragX = Math.max(0, diffX);
        moveEv.preventDefault();
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      if (!isMouseDragging) return;
      isMouseDragging = false;

      if (!mouseDragEngaged) {
        isSwipingChat = false;
        currentDragX = 0;
        return;
      }

      const threshold = chatWindowWidth * 0.3;
      if (currentDragX >= threshold) {
        isClosingBySwipe = true;
        isSwipingChat = false;
        currentDragX = chatWindowWidth;
        setTimeout(() => {
          handleCloseChat();
        }, 220);
      } else {
        isSwipingChat = false;
        currentDragX = 0;
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  $: swipeStyle = (() => {
    if (currentDragX > 0) {
      return `transform: translate3d(${currentDragX}px, 0, 0);`;
    }
    return "";
  })();

  onBack["chat"] = () => {
    handleCloseChat();
    delete onBack["chat"];
  };

  onDestroy(() => {
    if (savePositionTimeout) {
      clearTimeout(savePositionTimeout);
      savePositionTimeout = null;
    }
    delete onBack["chat"];
    if (onBack.dropout) delete onBack["dropout"];
    if (onBack.chatSettings) delete onBack["chatSettings"];
    scrollResizeObserver?.disconnect();
    if (resizeObserver) resizeObserver.disconnect();
  });

  const DEFAULT_HEIGHT = 120;
  const OVERSCAN = 1500;

  const messageHeights = writable({});
  let cumulativeHeights = [];
  let innerList;
  let visibleMessages = {};
  let scrollAnchor = { messageId: null, offset: 0 };

  let pendingHeightUpdates = {};

  let resizeObserver = null;
  function setupResizeObserver() {
    if (resizeObserver) return;
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        const wrapper = el.closest('.message-wrapper');
        if (!wrapper) continue;
        const id = wrapper.id?.replace('m-', '');
        if (!id) continue;
        const height = entry.contentRect.height;
        if (height > 0) {
          pendingHeightUpdates[id] = height;
        }
      }
    });
  }

  function observeResize(node, id) {
    if (resizeObserver) resizeObserver.observe(node);
    return {
      destroy() {
        if (resizeObserver) resizeObserver.unobserve(node);
      }
    };
  }

  function applyPendingHeights() {
    const updates = pendingHeightUpdates;
    pendingHeightUpdates = {};
    const keys = Object.keys(updates);
    if (keys.length === 0) return;
    messageHeights.update(h => {
      const newH = { ...h };
      for (const id of keys) newH[id] = updates[id];
      return newH;
    });
    computeCumulativeHeights();
  }

  function computeCumulativeHeights() {
    const heights = [];
    let sum = 0;
    for (const msg of $messages) {
      const h = $messageHeights[msg.id] || DEFAULT_HEIGHT;
      sum += h;
      heights.push(sum);
    }
    cumulativeHeights = heights;
  }

  function findIndexByOffset(target) {
    let lo = 0, hi = cumulativeHeights.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumulativeHeights[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function captureScrollAnchor() {
    if (!scrollElement) return;

    const containerRect = scrollElement.getBoundingClientRect();

    for (const id in visibleMessages) {
      const el = visibleMessages[id];
      if (!el) continue;

      const rect = el.getBoundingClientRect();

      if (rect.bottom > containerRect.top) {
        scrollAnchor = {
          id: el.id,
          offset: rect.top - containerRect.top
        };
        return;
      }
    }
  }

  function restoreScrollAnchor() {
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

  async function updateVisibleMessages() {
    if (!scrollElement) return;

    applyPendingHeights();

    const { scrollTop, clientHeight } = scrollElement;
    const totalHeight = cumulativeHeights.length ? cumulativeHeights[cumulativeHeights.length - 1] : 0;
    if (totalHeight === 0) {
      visibleMessages = {};
      return;
    }

    const isNearBottom = totalHeight - scrollTop - clientHeight < 50;
    let startIdx, endIdx;

    if (isNearBottom) {
      const targetOffset = Math.max(0, totalHeight - clientHeight - OVERSCAN);
      startIdx = findIndexByOffset(targetOffset);
      endIdx = $messages.length - 1;
    } else {
      const viewTop = Math.max(0, scrollTop - OVERSCAN);
      const viewBottom = scrollTop + clientHeight + OVERSCAN;
      startIdx = findIndexByOffset(viewTop);
      endIdx = findIndexByOffset(viewBottom);
      endIdx = Math.min(endIdx, $messages.length - 1);
      if (startIdx > endIdx) endIdx = startIdx;
    }

    const newVisible = {};
    for (let i = startIdx; i <= endIdx && i < $messages.length; i++) {
      const id = $messages[i].id;
      if (!newVisible[id]) {
        newVisible[id] = document.getElementById("m-" + id);
      }
    }
    visibleMessages = newVisible;

    if (userHasScrolled) {
      await scheduleRead();
    }
  }

  function measureAllHeights() {
    if (!innerList) return;
    const wrappers = innerList.querySelectorAll('.message-wrapper');
    const updates = {};
    for (const wrapper of wrappers) {
      const id = wrapper.id?.replace('m-', '');
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
      messageHeights.update(h => ({ ...h, ...updates }));
    }
  }

  const decodedMessages = writable({});

  const decodeMessagesBatch = async (list) => {
    const updates = {};
    const toRemove = [];

    await Promise.all(
      list.map(async msg => {
        const res = await decode_msg(msg);
        if (res) updates[msg.id] = res;
        else toRemove.push(msg.id);
      })
    );

    decodedMessages.update(old => {
      const next = { ...old, ...updates };
      for (const id of toRemove) delete next[id];
      return next;
    });
  };

  const mergeMessages = async (
    incoming,
    updateCache = false
  ) => {
    if (!incoming?.length) return;

    const map = new Map(
      get(messages).map(m => [String(m.id), m])
    );

    const changed = [];

    for (const msg of incoming) {
      const msgId = String(msg.id);
      const old = map.get(msgId);

      if (!old) {
        const isEdited = msg.status === "EDITED" || !!msg.edited;
        const entry = {
          ...msg,
          id: msgId,
          ...(isEdited ? { edited: true } : {}),
        };
        map.set(msgId, entry);
        changed.push(entry);
        continue;
      }

      const isEditedStatus = msg.status === "EDITED" || old.status === "EDITED" || old.edited || msg.edited;
      const isDeletedStatus = old.deleted || msg.deleted || msg.status === "REMOVED";

      let newHistory = Array.isArray(old.history) ? [...old.history] : [];
      if (Array.isArray(msg.history)) {
        for (const h of msg.history) {
          if (!newHistory.some(existing => existing.at === h.at)) {
            newHistory.push(h);
          }
        }
      }

      const textChanged = old.text && msg.text && old.text !== msg.text;
      if (textChanged && (!Array.isArray(msg.history) || !msg.history.length)) {
        const textDiff = computeTextDiff(old.text, msg.text);
        const at = msg.editTime || msg.edited_at || Date.now();
        newHistory.push({ at, diff: textDiff });
      }

      const merged = {
        ...old,
        ...msg,
        id: msgId,
        ...(isDeletedStatus ? { deleted: true, deleted_at: old.deleted_at || msg.deleted_at || Date.now() } : {}),
        ...(isEditedStatus ? { edited: true, edited_at: old.edited_at || msg.edited_at || msg.editTime || Date.now() } : {}),
        ...(newHistory.length ? { history: newHistory } : {}),
      };

      if (JSON.stringify(old) !== JSON.stringify(merged)) {
        map.set(msgId, merged);
        changed.push(merged);
      }
    }

    if (!changed.length) return;

    await decodeMessagesBatch(changed);

    messages.set(
      [...map.values()].sort(
        (a,b) => a.time - b.time
      )
    );

    if (updateCache) {
      chatCache.updateMessages(changed);
    }
  };

  const loadHistory = async (
    isInitial = false,
    from = Date.now() + sessionGet("drift"),
    backward = BATCH_SIZE,
    forward = 0
  ) => {
    const currentChatId = chat?.id ?? chatId;
    if (loading) return;
    if (all_loaded && !isInitial) return;
    if (currentChatId == null) return;

    loading = true;

    try {
      const cached = await chatCache.loadMessages(
        from,
        backward
      );

      captureScrollAnchor();

      await mergeMessages(cached, false);

      restoreScrollAnchor();
      captureScrollAnchor();

      if (!initialized || isInitial) {
        const {
          error,
          messages: serverMessages
        } = await $API.getMessages(currentChatId, from, backward, forward);

        if (error) throw new Error(error);

        await mergeMessages(serverMessages, true);

        if (serverMessages.length < backward + forward) {
          if (forward === 0) {
            all_loaded = true;
          }
        }

        initialized = true;
      } else {
        const oldest = get(messages)[0];

        const {
          error,
          messages: olderMessages
        } = await $API.getMessages(
          currentChatId,
          oldest?.time ?? from,
          backward,
          forward
        );

        if (error) throw new Error(error);

        if (olderMessages.length < backward) {
          all_loaded = true;
        }

        await mergeMessages(
          olderMessages,
          true
        );
      }
    } catch(e) {
      console.error(e);
    } finally {
      restoreScrollAnchor();
      loading = false;
    }

    restoreScrollAnchor();
  };

  const loadNewer = async () => {
    const currentChatId = chat?.id ?? chatId;
    if (loadingNewer || all_loaded_newer) return;
    if (currentChatId == null) return;

    loadingNewer = true;

    try {
      const msgs = get(messages);
      const newest = msgs[msgs.length - 1];
      const fromTime = newest?.time ?? (Date.now() + sessionGet("drift"));

      const {
        error,
        messages: newerMessages
      } = await $API.getNewerMessages(currentChatId, fromTime, BATCH_SIZE);

      if (error) throw new Error(error);

      if (!newerMessages || newerMessages.length < BATCH_SIZE) {
        all_loaded_newer = true;
      }

      await mergeMessages(
        newerMessages,
        false
      );
    } catch (e) {
      console.error(e);
    } finally {
      loadingNewer = false;
    }

    restoreScrollAnchor();
  };

  let scrollTimeout = null;
  let updateScheduled = false;
  let userHasScrolled = false;
  let savePositionTimeout = null;
  let isInitialMounting = true;
  let isProgrammaticScroll = false;

  let readTimer = null;
  let lastReadMessageId = null;

  function saveCurrentPosition() {
    const targetChatId = chat?.id ?? chatId;
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
        const m = $messages.find((x) => String(x.id) === String(id));
        if (m) {
          bottomMsg = m;
          bottomOffset = rect.top - containerRect.top;
        }
      }
    }

    if (!bottomMsg && $messages && $messages.length > 0) {
      const currentScroll = scrollElement.scrollTop;
      const idx = findIndexByOffset(currentScroll + scrollElement.clientHeight / 2);
      if (idx >= 0 && idx < $messages.length) {
        bottomMsg = $messages[idx];
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

  function queueSavePosition() {
    if (savePositionTimeout) clearTimeout(savePositionTimeout);
    savePositionTimeout = setTimeout(saveCurrentPosition, 200);
  }

  function handleScroll(event) {
    if (!isDragging) {
      startY = null;
      startScrollTop = null;
    }
    if (isInitialMounting || isProgrammaticScroll) return;

    userHasScrolled = true;
    queueSavePosition();
    const target = event.currentTarget;
    const distanceFromBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    showScrollDown = !all_loaded_newer || distanceFromBottom > 50;

    if (!updateScheduled) {
      updateScheduled = true;
      requestAnimationFrame(async () => {
        await updateVisibleMessages();
        updateScheduled = false;
      });
    }

    if (target.scrollTop <= 50 && !loading && !all_loaded) {
      if (scrollLoaderTimeout) return;
      scrollLoaderTimeout = setTimeout(async () => {
        await loadHistory();
        await updateVisibleMessages();
        setTimeout(() => scrollLoaderTimeout = null, 500);
      }, 200);
    }

    if (distanceFromBottom <= 100 && !loadingNewer && !all_loaded_newer) {
      if (scrollBottomLoaderTimeout) return;
      scrollBottomLoaderTimeout = setTimeout(async () => {
        await loadNewer();
        await updateVisibleMessages();
        setTimeout(() => scrollBottomLoaderTimeout = null, 500);
      }, 200);
    }
  }

  function getLowestVisibleMessageId() {
    if (!scrollElement) return null;

    let lowest = null;
    let lowestTop = -Infinity;

    for (const key in visibleMessages) {
      const entry = $messages.find(x => String(x.id) === String(key));
      if (!entry || Number(entry.sender) === Number($currentUser)) continue;

      const el = visibleMessages[key];
      if (!el) continue;

      const rect = el.getBoundingClientRect();

      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;

      if (rect.top > lowestTop) {
        lowestTop = rect.top;
        lowest = el;
      }
    }

    return lowest?.id?.replace("m-", "") || null;
  }

  function scheduleRead() {
    if (readTimer) clearTimeout(readTimer);

    readTimer = setTimeout(async () => {
      const readDisabled = !$chatSettings.reader;
      if (readDisabled) return;

      const msgId = getLowestVisibleMessageId();
      if (!msgId) return;

      if (msgId === lastReadMessageId) return;

      const index = $messages.length - $messages.findIndex(x => x.id === msgId)
      if (index > chat.newMessages) return;

      lastReadMessageId = msgId;

      try {
        chat.newMessages = index - 1;
        await $API.readMessage(chat.id, msgId);
      } catch (e) {
        console.error("readMessage failed", e);
      }
    }, 500);
  }

  $: chatCache = getChat(chat?.id ?? chatId);

  let unsubReceivedMessage = null;
  let currentSubscribedChatId = null;
  let lastProcessedMessageKey = null;

  $: targetChatId = chat?.id ?? chatId;
  $: if (targetChatId != null && targetChatId !== currentSubscribedChatId) {
    if (unsubReceivedMessage) {
      unsubReceivedMessage();
      unsubReceivedMessage = null;
    }
    currentSubscribedChatId = targetChatId;
    const currentChatCache = getChat(targetChatId);
    if (currentChatCache?.receivedMessage) {
      unsubReceivedMessage = currentChatCache.receivedMessage.subscribe(async (message) => {
        if (!message || String(message.chatId) !== String(targetChatId)) return;

        const msgKey = `${message.id}_${message.time || message.created_at || ''}_${message.status || ''}`;
        if (msgKey === lastProcessedMessageKey) return;
        lastProcessedMessageKey = msgKey;

        let wasAtBottom = false;
        if (scrollElement) {
          const { scrollTop, scrollHeight, clientHeight } = scrollElement;
          wasAtBottom = scrollHeight - scrollTop - clientHeight < 150;
        }

        if (message.status === "EDITED" || message.edited) {
          messages.update((_messages) => {
            const idx = _messages.findIndex((x) => String(x.id) === String(message.id));
            if (idx !== -1) {
              const old = _messages[idx];
              let newHistory = Array.isArray(old.history) ? [...old.history] : [];
              if (Array.isArray(message.history)) {
                for (const h of message.history) {
                  if (!newHistory.some(existing => existing.at === h.at)) newHistory.push(h);
                }
              }
              if (old.text && message.text && old.text !== message.text && (!Array.isArray(message.history) || !message.history.length)) {
                const textDiff = computeTextDiff(old.text, message.text);
                const at = message.editTime || message.edited_at || Date.now();
                newHistory.push({ at, diff: textDiff });
              }
              const updated = {
                ...old,
                ...message,
                edited: true,
                edited_at: old.edited_at || message.edited_at || Date.now(),
                ...(newHistory.length ? { history: newHistory } : {}),
              };
              _messages[idx] = updated;
            }
            return _messages;
          });
          const decoded = await decode_msg(message);
          decodedMessages.update(d => {
            const next = { ...d };
            if (decoded) next[message.id] = decoded;
            else delete next[message.id];
            return next;
          });
          await tick();
          applyPendingHeights();
          computeCumulativeHeights();
          await updateVisibleMessages(wasAtBottom);
          return;
        }

        if (message.sender === $currentUser) {
          all_loaded_newer = true;
        }

        if (all_loaded_newer) {
          messages.update((_messages) => {
            const idx = _messages.findIndex((x) => String(x.id) === String(message.id));
            if (idx !== -1) {
              const old = _messages[idx];
              _messages[idx] = {
                ...old,
                ...message,
                ...(old.edited || message.status === "EDITED" ? { edited: true } : {}),
                ...(old.history ? { history: old.history } : {}),
              };
            } else {
              return [..._messages, message];
            }
            return _messages;
          });

          const decoded = await decode_msg(message);
          if (decoded) decodedMessages.update(d => ({ ...d, [message.id]: decoded }));

          await tick();
          applyPendingHeights();
          computeCumulativeHeights();

          const isRecentSelfMessage = message.sender === $currentUser && (Date.now() - (message.time || Date.now()) < 5000);
          if (isRecentSelfMessage || wasAtBottom) {
            scrollToBottom(scrollElement, true);
          }

          await updateVisibleMessages(wasAtBottom);
        }

        checkForEncryptionRequest(chat, chatSettings, [message]);
      });
    }
  }

  onDestroy(() => {
    window.removeEventListener("mouseup", stopDrag);
    window.removeEventListener("blur", stopDrag);
    if (unsubReceivedMessage) {
      unsubReceivedMessage();
      unsubReceivedMessage = null;
    }
  });

  $: uniqueMessages = (() => {
    const seen = new Set();
    const result = [];
    const list = $messages || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      const key = m?.id != null ? String(m.id) : null;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      result.unshift(m);
    }
    return result;
  })();

  $: cachedContact = chat.type === "DIALOG" ? getContact(avatarUserId) : writable(undefined);
  $: title = chat.id === 0 ? "Избранное" : (chat.title || $cachedContact?.names?.[0]?.name);
  $: isBot = $cachedContact?.options?.includes("BOT") || chat?.options?.BOT === true || chat?.options?.IS_BOT === true;

  $: otherReadTime = (() => {
    let maxMark = chat?.otherReadTime || 0;
    const myId = Number($currentUser);
    if (chat?.participants) {
      for (const [uid, mark] of Object.entries(chat.participants)) {
        if (Number(uid) !== myId && Number(mark) > maxMark) {
          maxMark = Number(mark);
        }
      }
    }
    return maxMark;
  })();

  let botInfo = null;
  let botCommands = [];
  let botStarting = false;
  let loadedBotTarget = null;

  async function loadBotData(peerId, cId) {
    try {
      if (peerId) {
        const info = await $API.getBotInfo(peerId);
        if (info) {
          botInfo = info;
          if (Array.isArray(info.commands) && info.commands.length > 0) {
            botCommands = info.commands;
          }
        }
      }
      if (botCommands.length === 0 && cId) {
        const chatCmds = await $API.getChatBotCommands(cId);
        if (chatCmds?.commands && Array.isArray(chatCmds.commands)) {
          botCommands = chatCmds.commands;
        }
      }
    } catch (e) {
      console.error("loadBotData error:", e);
    }
  }

  $: if (isBot && avatarUserId && avatarUserId !== loadedBotTarget) {
    loadedBotTarget = avatarUserId;
    loadBotData(avatarUserId, chat?.id);
  } else if (!isBot && (chat?.type === "GROUP" || chat?.type === "CHAT") && chat?.id !== loadedBotTarget) {
    loadedBotTarget = chat?.id;
    loadBotData(null, chat?.id);
  }

  $: showBotStart = isBot && chat?.type === "DIALOG" && allRendered && $messages.length === 0;

  async function handleBotStart() {
    if (botStarting || chat?.id == null) return;
    botStarting = true;
    try {
      const response = await $API.sendBotStart(chat.id, "");
      const message = response?.message;
      if (message) {
        message.status = 1;
        chatCache.receivedMessage.set(message);
        chatCache.updateMessages([message]);
        messages.update((msgs) => {
          if (msgs.some((m) => m.id === message.id)) return msgs;
          return [...msgs, message];
        });
      } else {
        await $API.sendMessage("/start", chat.id, { notify: true });
      }
    } catch (e) {
      console.error("handleBotStart error:", e);
      try {
        await $API.sendMessage("/start", chat.id, { notify: true });
      } catch (err) {
        console.error("fallback /start error:", err);
      }
    } finally {
      botStarting = false;
    }
  }

  onMount(async () => {
    isInitialMounting = true;
    isProgrammaticScroll = true;

    const targetChatId = chat?.id ?? chatId;
    clearChatNotification(targetChatId);

    setupResizeObserver();
    startAutoScrollIfAtBottom();

    const unreadCount = Number(chat?.newMessages || 0);
    const savedPos = getChatScroll(targetChatId);
    const hasSavedScroll = savedPos && !savedPos.wasAtBottom && savedPos.bottomMessageTime;

    let initialFrom = Date.now() + sessionGet("drift");
    if (hasSavedScroll) {
      initialFrom = Number(savedPos.bottomMessageTime) + 1;
      all_loaded_newer = false;
      showScrollDown = true;
      await loadHistory(true, initialFrom, 35, 35);
    } else {
      all_loaded_newer = true;
      await loadHistory(true, initialFrom, 40, 0);
    }

    await tick();

    measureAllHeights();
    computeCumulativeHeights();

    if (hasSavedScroll) {
      let targetId = savedPos.bottomMessageId;
      if (targetId && !document.getElementById("m-" + targetId) && $messages.length > 0) {
        const targetTime = Number(savedPos.bottomMessageTime);
        if (targetTime) {
          let closest = null;
          let minDiff = Infinity;
          for (const m of $messages) {
            const diff = Math.abs(Number(m.time) - targetTime);
            if (diff < minDiff) {
              minDiff = diff;
              closest = m;
            }
          }
          if (closest) {
            targetId = closest.id;
          }
        }
      }
      let restored = false;
      if (targetId) {
        restored = await scrollToMessage(targetId, {
          offset: savedPos.offset || 40,
        });
      }
      if (!restored && !all_loaded_newer) {
        const msgs = $messages;
        if (msgs.length > 0) {
          const mid = msgs[Math.floor(msgs.length / 2)].id;
          await scrollToMessage(mid, { offset: 40 });
        }
      } else if (!restored) {
        await scrollToBottomDirect();
      }
    } else if (unreadCount > 0) {
      const targetId = getFirstUnreadMessageId();
      let anchorId = targetId;
      if (targetId) {
        const idx = $messages.findIndex((m) => String(m.id) === String(targetId));
        if (idx > 0 && $messages[idx - 1]) {
          anchorId = $messages[idx - 1].id;
        }
      }
      let positioned = false;
      if (anchorId) {
        positioned = await scrollToMessage(anchorId, { offset: 40 });
      }
      if (!positioned) {
        await scrollToBottomDirect();
      }
    } else {
      await scrollToBottomDirect();
    }

    await tick();
    await updateVisibleMessages();

    await new Promise((r) => setTimeout(r, 60));
    allRendered = true;
    isInitialMounting = false;
    isProgrammaticScroll = false;
    window.addEventListener("mouseup", stopDrag);
    window.addEventListener("blur", stopDrag);
  });

  async function jumpToBottom() {
    if (!all_loaded_newer) {
      all_loaded_newer = true;
      await loadHistory(true, Date.now() + sessionGet("drift"), 40, 0);
      await tick();
    }
    scrollToBottom(scrollElement, true);
  }

  let isDragging = false;
  let startY = null;
  let startScrollTop = null;

  function startDrag(e) {
    if (isClosingBySwipe || isSwipingChat || currentDragX > 0) return;
    clickStartPos = { x: e.clientX, y: e.clientY };
    if (e.button !== 0) return;
    if (e.target.closest(".message-row, .message-bubble, button, a, input, textarea, .icon-button, .voice-play-btn, .circular-wrapper, .voice-message-bubble, .video-note-bubble, .reaction, .reactions-picker")) return;
    startY = e.pageY;
    startScrollTop = scrollElement ? scrollElement.scrollTop : null;
  }

  function stopDrag() {
    isDragging = false;
    startY = null;
    startScrollTop = null;
    if (scrollElement) scrollElement.style.cursor = "grab";
    document.body.style.userSelect = "";
  }

  async function mouseUp(e) {
    if (currentDragX > 10 || isClosingBySwipe) {
      stopDrag();
      return;
    }
    const currentScroll = scrollElement ? scrollElement.scrollTop : 0;
    const clicked =
      !isDragging ||
      (startScrollTop !== null && Math.abs(startScrollTop - currentScroll) < 5);

    stopDrag();

    if (
      e.target.closest(".reply-block") ||
      e.target.closest(".forward-block") ||
      e.target.closest(".inline-keyboard") ||
      e.target.closest(".inline-btn") ||
      e.target.closest(".avatar-msg-btn") ||
      e.target.closest(".avatar-wrapper") ||
      e.target.closest(".voice-message-bubble") ||
      e.target.closest(".video-note-bubble") ||
      e.target.closest(".transcription-card") ||
      e.target.closest(".transcription-close-btn")
    ) return;

    if (clicked) {
      const messageWrapper = e.target.closest(".message-wrapper");
      if (messageWrapper) {
        const id = messageWrapper.id?.replace("m-", "");
        const msg = $messages.find(x => String(x.id) === String(id));

        if (e.target.closest(".reaction")) {
          const reaction = e.target.childNodes[0]?.nodeValue?.trim();
          if (reaction && msg) {
            await handleReaction(chat, msg, reaction);
            messages.update(x => x);
          }
        }
        else if (msg && !dropoutActiveAt) selectMessage(e, msg);
      }
    }
  }

  function moveDrag(e) {
    if (isSwipingChat || currentDragX > 0 || isClosingBySwipe) {
      stopDrag();
      return;
    }
    if (e.buttons !== 1 || startScrollTop === null || startY === null) {
      if (isDragging) stopDrag();
      return;
    }
    const y = e.pageY;
    const walk = y - startY;
    if (!isDragging) {
      if (Math.abs(walk) > 5) {
        isDragging = true;
        if (scrollElement) scrollElement.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      } else {
        return;
      }
    }
    e.preventDefault();
    if (scrollElement) {
      scrollElement.scrollTop = startScrollTop - walk;
    }
  }

  function handleClick(e) {
    if (currentDragX > 10 || isClosingBySwipe) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (!justOpenedDropout && dropoutActiveAt && !e.target.closest(".message-actions-dropout")) {
      dropoutActiveAt = null;
      delete onBack.dropout;
    }

    if (attachesDropout && !e.target.closest(".attaches-dropout") && !e.target.closest(".input-button") && !e.target.closest(".attach-toggle-btn")) {
      attachesDropout = null;
    }
  }

  let justOpenedDropout = false;

  function selectMessage(e, msg) {
    if (
      e.target.closest(".reply-block") ||
      e.target.closest(".forward-block") ||
      e.target.closest(".inline-keyboard") ||
      e.target.closest(".inline-btn") ||
      e.target.closest(".avatar-msg-btn") ||
      e.target.closest(".avatar-wrapper")
    ) return;

    const dx = Math.abs(e.clientX - clickStartPos.x);
    const dy = Math.abs(e.clientY - clickStartPos.y);
    if (dx > 5 || dy > 5) return;

    if (msg === dropoutActiveAt?.msg) return;

    justOpenedDropout = true;
    requestAnimationFrame(() => (justOpenedDropout = false));

    dropoutActiveAt = { e, msg };
  }

  function handleDropout(e) {
    const msgId = dropoutActiveAt?.msg?.id;
    dropoutActiveAt = null;

    const action = e.detail?.action;

    if (action === "delete") {
      messages.update(x => {
        const idx = x.findIndex(m => String(m.id) === String(msgId));
        if (idx !== -1) {
          x[idx] = {
            ...x[idx],
            deleted: true,
            deleted_at: Date.now(),
          };
        }
        return [...x];
      });

      getChat(chat?.id || chatId).markMessageDeleted?.(msgId);
    } else if (action === "reaction") {
      messages.update(x => x);
    }
  }

  const openSettings = () => {
    settingsShown = !settingsShown;
    if (settingsShown) onBack.chatSettings = () => (settingsShown = false);
    else delete onBack["chatSettings"];
  };

  let dateSeparators = {};

  $: if ($messages.length) {
    const newSeparators = {};
    let lastDateStr = null;
    for (const msg of $messages) {
      const dateStr = new Date(msg.time).toLocaleDateString();
      if (dateStr !== lastDateStr) {
        newSeparators[msg.id] = dateStr;
        lastDateStr = dateStr;
      }
    }
    dateSeparators = newSeparators;
  }

  let scrollResizeObserver;
  let lastClientHeight = 0;

  let prevActiveMediaBool = null;
  let scrollAnchorBeforeMediaChange = null;

  beforeUpdate(() => {
    const isNowActive = Boolean($activeMedia);
    if (scrollElement && isNowActive !== prevActiveMediaBool && prevActiveMediaBool !== null) {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const distFromBottom = scrollHeight - scrollTop - clientHeight;
      scrollAnchorBeforeMediaChange = { scrollTop, distFromBottom };
    } else {
      scrollAnchorBeforeMediaChange = null;
    }
    prevActiveMediaBool = Boolean($activeMedia);
  });

  afterUpdate(() => {
    if (!scrollAnchorBeforeMediaChange || !scrollElement) return;
    const { distFromBottom } = scrollAnchorBeforeMediaChange;
    const { scrollHeight, clientHeight } = scrollElement;
    if (distFromBottom < 60) {
      scrollElement.scrollTop = scrollHeight - clientHeight;
    } else {
      scrollElement.scrollTop = scrollHeight - clientHeight - distFromBottom;
    }
    scrollAnchorBeforeMediaChange = null;
  });

  function startAutoScrollIfAtBottom() {
    if (!scrollElement) return;

    lastClientHeight = scrollElement.clientHeight;

    scrollResizeObserver = new ResizeObserver(() => {
      if (!scrollElement || isInitialMounting || isProgrammaticScroll || !all_loaded_newer) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const heightDelta = clientHeight - lastClientHeight;
      lastClientHeight = clientHeight;

      const atBottom = scrollHeight - scrollTop - clientHeight < Math.max(28, Math.abs(heightDelta) + 8);
      if (atBottom && userHasScrolled) {
        scrollToBottom(scrollElement, false);
      }
    });

    scrollResizeObserver.observe(scrollElement);
  }

  async function scrollToBottomDirect() {
    if (!scrollElement) return;
    isProgrammaticScroll = true;
    scrollElement.scrollTop = scrollElement.scrollHeight;
    await tick();
    await updateVisibleMessages();
    await tick();
    scrollElement.scrollTop = scrollElement.scrollHeight;
    setTimeout(() => {
      isProgrammaticScroll = false;
    }, 150);
  }

  async function scrollToMessage(targetMsgId, options = {}) {
    if (!scrollElement || !targetMsgId) return false;
    await tick();
    let targetEl = document.getElementById("m-" + targetMsgId);
    if (!targetEl) return false;

    isProgrammaticScroll = true;
    const { offset = 40 } = options;
    const containerRect = scrollElement.getBoundingClientRect();
    let elRect = targetEl.getBoundingClientRect();
    let currentScroll = scrollElement.scrollTop;
    scrollElement.scrollTop = Math.max(0, currentScroll + (elRect.top - containerRect.top) - offset);

    await tick();
    await updateVisibleMessages();
    await tick();

    targetEl = document.getElementById("m-" + targetMsgId);
    if (targetEl) {
      elRect = targetEl.getBoundingClientRect();
      const diff = elRect.top - containerRect.top - offset;
      if (Math.abs(diff) > 2) {
        scrollElement.scrollTop = Math.max(0, scrollElement.scrollTop + diff);
      }
    }

    setTimeout(() => {
      isProgrammaticScroll = false;
    }, 150);
    return true;
  }

  function getFirstUnreadMessageId() {
    const unreadCount = Number(chat?.newMessages || 0);
    if (unreadCount <= 0 || !$messages || $messages.length === 0) return null;

    const myId = Number($currentUser);
    const myMark = Number(chat?.participants?.[myId] || 0);

    if (myMark > 0) {
      const found = $messages.find((m) => m.time > myMark && Number(m.sender) !== myId);
      if (found) return found.id;
    }

    const unreadIdx = Math.max(0, $messages.length - unreadCount);
    return $messages[unreadIdx]?.id || null;
  }

  async function makeVisible(id) {
    if (!visibleMessages[id]) {
      visibleMessages[id] = document.getElementById("m-" + id);
      await tick();
    }
  }

  /* media stuff */
  $: allMedia = $messages.flatMap((m) =>
    (m.attaches || [])
      .filter((a) => a._type === "PHOTO" || a._type === "VIDEO")
      .map((a) => ({
        ...a,
        messageId: m.id,
        uid: a.videoId || a.photoId || a.url || a.baseUrl,
      })),
  );

  function openMedia(attach) {
    const targetUid =
      attach.videoId || attach.photoId || attach.url || attach.baseUrl;
    const index = allMedia.findIndex((m) => m.uid === targetUid);

    if (index !== -1) {
      viewerIndex = index;
      viewerOpen = true;
    }
  }

</script>

<div
  class="chat-window"
  class:swiping={isSwipingChat}
  class:animating={!isSwipingChat && (currentDragX > 0 || isClosingBySwipe)}
  style={swipeStyle}
  on:click|capture={handleClick}
  on:mousedown={handleMouseDown}
  on:touchstart={handleTouchStart}
  on:touchmove={handleTouchMove}
  on:touchend={handleTouchEnd}
  on:touchcancel={handleTouchCancel}
>
  <Bubbles />

  {#if viewerOpen}
    <MediaViewer
      chatId={chat.id}
      bind:index={viewerIndex}
      {allMedia}
      on:close={() => (viewerOpen = false)}
    />
  {/if}

  <header>
    <div class="align-left">
      <button
        class="icon-button"
        on:click|stopPropagation={handleCloseChat}
      >
        <img src="icons/arrow.svg" style="transform: scale(-1.7)" />
      </button>
      <div
        class="row"
        on:click={() => {
          if (chat.id === 0) {
            $Session.profile = { userId: $currentUser };
          } else if (chat.type === "DIALOG") {
            $Session.profile = { userId: avatarUserId };
          } else {
            $Session.profile = { chatId: chat.id };
          }
        }}
      >
        <Avatar size={42} {chat} contactId={avatarUserId} style="margin-left: -8px; cursor: pointer;"/>
        <div class="info">
          <a class="title">{title}</a>
          <a class="presence"><Signature {chat} contactId={avatarUserId} /></a>
        </div>
      </div>
    </div>
    <div class="align-right">
      {#if chat.type !== "CHANNEL"}
        <button class="icon-button" on:click|stopPropagation={openSettings}>
          <img src="icons/params.svg" />
        </button>
      {/if}
    </div>
  </header>

  {#if $activeMedia}
    <MediaPlaybackHeader isChatHeader={true} />
  {/if}

  {#if $chatSettings}
    <Settings
      {chat}
      {chatSettings}
      {messages}
      bind:shown={settingsShown}
    />
  {/if}

  <div
    on:scroll={handleScroll}
    on:mousedown={startDrag}
    on:mouseleave={stopDrag}
    on:mouseup={mouseUp}
    on:mousemove={moveDrag}
    bind:this={scrollElement}
    class="message-list-container grab-scroll"
    id="scroll"
  >
    <E2eModal
      {chat}
      {messages}
      {chatSettings}
      {gotSecretChatRequest}
    />

    {#if chat.pinnedMessage}
      <PinnedMessage msg={chat.pinnedMessage} {chat} />
    {/if}

    <div
      class="message-list-inner"
      style={"opacity: " + (allRendered ? "1;" : "0;")}
      bind:this={innerList}
    >

    <div style={"flex-shrink: 0; height: " + (chat.pinnedMessage ? "60px" : "10px")}></div>

    {#each uniqueMessages as msg (msg.id)}
      <div class="message-wrapper" id={"m-" + msg.id}>
        {#if visibleMessages[msg.id] || !$messageHeights[msg.id]}
          <div
            class="observer-area"
            use:observeResize={msg.id}
          >
            {#if dateSeparators[msg.id]}
              <DateSeparator {msg} />
            {/if}
            <Message
              {msg}
              {chat}
              {dropoutActiveAt}
              {scrollElement}
              {otherReadTime}
              makeVisible={makeVisible}
              decoded={$decodedMessages[msg.id]}
              on:openMedia={(e) => openMedia(e.detail.attach)}
              on:openChat={() => openChat(chat.id, msg.id)}
              on:openStickerPack={(e) => handleOpenStickerPack(e.detail.sticker)}
              on:openHistory={(e) => (historyModalMessage = e.detail.msg)}
            />
          </div>
        {:else}
          <div class="placeholder" style="width:100%; height:{($messageHeights[msg.id] || DEFAULT_HEIGHT)}px;"></div>
        {/if}
      </div>
    {/each}

    <div style="height: 20px; flex-shrink: 0;"></div>
    </div>
  </div>

  <Dropout
    activeAt={dropoutActiveAt}
    {chat}
    on:reply={(e) => (replyTo = e.detail.id)}
    on:edit={(e) => (editingMessage = e.detail.msg)}
    on:history={(e) => (historyModalMessage = e.detail.msg)}
    on:close={handleDropout}
  />

  {#if historyModalMessage}
    <EditHistoryModal
      msg={historyModalMessage}
      on:close={() => (historyModalMessage = null)}
    />
  {/if}

  {#if activeStickerPack}
    <StickerPackModal
      setId={activeStickerPack.setId}
      stickerId={activeStickerPack.stickerId}
      on:close={() => (activeStickerPack = null)}
      on:select={(e) => {
        activeStickerPack = null;
        inputComponent?.sendSticker?.(e.detail.sticker);
      }}
    />
  {/if}

  {#if showBotStart}
    <BotStart
      {botInfo}
      contact={$cachedContact}
      contactId={avatarUserId}
      loading={botStarting}
      onStart={handleBotStart}
    />
  {:else if chat.type !== "CHANNEL" && $chatSettings}
    <Input
      bind:this={inputComponent}
      bind:replyTo
      bind:editingMessage
      bind:attachesDropout
      bind:showStickerPanel
      {scrollElement}
      {chat}
      {messages}
      {chatSettings}
      {botCommands}
    />
  {/if}

  {#if showScrollDown}
    <div
      in:fade={{ duration: 100 }}
      out:fade={{ duration: 100 }}
      class="scroll-down-container"
      class:nije={chat.type === "CHANNEL"}
      class:vise={!!replyTo}
      class:with-stickers={showStickerPanel}
    >
      <button
        class="scroll-down-btn"
        on:click={jumpToBottom}
      >
        <svg viewBox="0 0 640 640"
          ><path
            fill="#777"
            d="M297.4 470.6C309.9 483.1 330.2 483.1 342.7 470.6L534.7 278.6C547.2 266.1 547.2 245.8 534.7 233.3C522.2 220.8 501.9 220.8 489.4 233.3L320 402.7L150.6 233.4C138.1 220.9 117.8 220.9 105.3 233.4C92.8 245.9 92.8 266.2 105.3 278.7L297.3 470.7z"
          /></svg
        >
      </button>
      {#if unreadBadgeCount > 0}
        <div class="scroll-down-badge" on:click={jumpToBottom}>
          {unreadBadgeCount > 99 ? "99+" : unreadBadgeCount}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chat-window {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #ccc;
    z-index: 20;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    max-height: 100%;
    background-color: #161621;
    padding-top: env(safe-area-inset-top, 10px);
    padding-bottom: env(safe-area-inset-bottom, 20px);
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45);
    will-change: transform;
  }

  .chat-window.animating {
    transition: transform 0.22s cubic-bezier(0.25, 1, 0.5, 1);
  }

  .chat-window.swiping {
    transition: none;
  }

  header {
    display: flex;
    align-items: center;
    padding: 8px 0;
    cursor: grab;
    flex-shrink: 0;
    background-color: #1e2024;
    z-index: 5;
  }

  .row {
    display: flex;
    gap: 12px;
    cursor: pointer;
    flex: 1;
    min-width: 0;
    width: 100vw;
    padding-left: 15px;
  }

  header .info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  header .info .presence {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    min-width: 0;
  }

  header .title {
    color: white;
    font-size: 18px;
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  header .align-left {
    display: flex;
    flex-direction: row;
    align-items: center;
    min-width: 0;
  }

  header .align-right {
    flex: 0 0 auto;
    margin-left: auto;
    margin-right: 0;
    display: flex;
    align-items: center;
  }

  .icon-button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    height: 40px;
    width: 40px;
    padding: 0;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
  }

  .icon-button img {
    transform: scale(1.1) translateX(-5px);
  }

  .scroll-down-container {
    position: fixed;
    bottom: 80px;
    right: 10px;
    width: 55px;
    height: 55px;
    z-index: 100;
    transition: bottom 0.2s ease;
  }

  .scroll-down-container.nije {
    bottom: 20px;
  }

  .scroll-down-container.vise {
    bottom: 140px;
  }

  .scroll-down-container.with-stickers {
    bottom: 420px;
  }

  .scroll-down-container.with-stickers.vise {
    bottom: 480px;
  }

  .scroll-down-btn {
    width: 55px;
    height: 55px;
    background: #1e2024;
    opacity: 0.9;
    color: white;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.1s;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .scroll-down-btn:hover {
    opacity: 1;
  }

  .scroll-down-btn svg {
    width: 36px;
  }

  .scroll-down-badge {
    position: absolute;
    top: -5px;
    left: -5px;
    min-width: 22px;
    height: 22px;
    box-sizing: border-box;
    padding: 0 5px;
    background: #2b7fc3;
    color: #ffffff;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    text-align: center;
    border-radius: 11px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
  }

  .message-list-container {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    display: block;
    flex-direction: column;
    overflow-anchor: none;
    overflow-x: hidden;
  }

  .message-list-inner {
    width: min(500px, 100%);
    display: flex;
    gap: 8px;
    flex-direction: column;
    transition: opacity 0.15s;
  }

  @media screen and (min-width: 500px) {
    .message-list-container {
      margin-left: 0;
    }
  }

  .message-list-container::-webkit-scrollbar {
    width: 4px;
    display: block;
  }

  .message-list-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .message-list-container::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }

  .message-list-container::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .grab-scroll {
    cursor: grab;
  }

  .grab-scroll:active {
    cursor: grabbing;
  }

  .message-wrapper {
    position: relative;
    width: 100%;
    transition: background 0.3s;
  }

  .observer-area {
    position: relative;
  }
</style>
