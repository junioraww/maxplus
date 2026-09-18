<script>
  import {
    getContext,
    onMount,
    onDestroy,
    tick,
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
  import DateSeparator from "$components/ChatWindow/DateSeparator.svelte";
  import Input from "$components/ChatWindow/input/Input.svelte";
  import BotStart from "$components/ChatWindow/BotStart.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import { clearChatNotification } from "$lib/utils/notifications.js";

  export let chatId;

  $: chat = $currentSessionChats?.find((c) => String(c.id) === String(chatId));

  let title;

  let startSecretChatRequest = null;
  let gotSecretChatRequest = null;

  let replyTo = null;

  let settingsShown = false;
  let dropoutActiveAt;
  let attachesDropout = null;

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

  $: chatSettings = getChatSettings(chat?.id || chatId);

  const onBack = getContext("onBack");

  function handleCloseChat() {
    if (savePositionTimeout) {
      clearTimeout(savePositionTimeout);
      savePositionTimeout = null;
    }
    saveCurrentPosition();
    closeChat(chat?.id || chatId);
  }

  let touchStartX = 0;
  let touchStartY = 0;
  let currentDragX = 0;
  let isSwipingChat = false;
  let isScrollingChat = false;
  let isClosingBySwipe = false;
  let chatWindowWidth = 0;

  function handleTouchStart(e) {
    if (e.touches.length !== 1) return;
    if (viewerOpen || settingsShown || dropoutActiveAt || isClosingBySwipe) return;

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    currentDragX = 0;
    isSwipingChat = false;
    isScrollingChat = false;
    chatWindowWidth = window.innerWidth;
  }

  function handleTouchMove(e) {
    if (isScrollingChat || isClosingBySwipe) return;
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
    if (e.target.closest("input, textarea, button, a, .icon-button, .scroll-down-container")) return;

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
    const decoded = {};

    await Promise.all(
      list.map(async msg => {
        const res = await decode_msg(msg);
        if (res) decoded[msg.id] = res;
      })
    );

    decodedMessages.update(old => ({
      ...old,
      ...decoded
    }));
  };

  const mergeMessages = async (
    incoming,
    updateCache = false
  ) => {
    if (!incoming?.length) return;

    const map = new Map(
      get(messages).map(m => [m.id, m])
    );

    const changed = [];

    for (const msg of incoming) {
      const old = map.get(msg.id);

      if (!old || JSON.stringify(old) !== JSON.stringify(msg)) {
        map.set(msg.id, msg);
        changed.push(msg);
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
    const currentChatId = chat?.id || chatId;
    if (loading) return;
    if (all_loaded && !isInitial) return;
    if (!currentChatId) return;

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

        const map = new Map(
          serverMessages.map(m => [String(m.id), m])
        );
        messages.set(
          [...map.values()].sort(
            (a,b) => a.time - b.time
          )
        );

        await decodeMessagesBatch(serverMessages);
        chatCache.updateMessages(serverMessages);

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
    const currentChatId = chat?.id || chatId;
    if (loadingNewer || all_loaded_newer) return;
    if (!currentChatId) return;

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

      if (newerMessages && newerMessages.length > 0) {
        await mergeMessages(newerMessages, true);
        await tick();
        await updateVisibleMessages();
      }
    } catch (e) {
      console.error(e);
    } finally {
      loadingNewer = false;
    }
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
    const targetChatId = chat?.id || chatId;
    if (!scrollElement || !targetChatId || isInitialMounting || isProgrammaticScroll) return;
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

  $: chatCache = getChat(chat.id);

  $: chatCache.receivedMessage.subscribe(async (message) => {
    if (!message || String(message.chatId) !== String(chat?.id)) return;

    let wasAtBottom = false;
    if (scrollElement) {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      wasAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    }

    if (message.sender === $currentUser) {
      all_loaded_newer = true;
    }

    if (all_loaded_newer) {
      messages.update((_messages) => {
        const idx = _messages.findIndex((x) => String(x.id) === String(message.id));
        if (idx !== -1) _messages[idx] = message;
        else return [..._messages, message];
        return _messages;
      });

      const decoded = await decode_msg(message);
      if (decoded) decodedMessages.update(d => ({ ...d, [message.id]: decoded }));

      await tick();
      applyPendingHeights();
      computeCumulativeHeights();

      if (message.sender === $currentUser || wasAtBottom) {
        scrollToBottom(scrollElement, true);
      }

      await updateVisibleMessages(wasAtBottom);
    }

    checkForEncryptionRequest(chat, chatSettings, [message]);
  });

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
    if (botStarting || !chat?.id) return;
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

    const targetChatId = chat?.id || chatId;
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
  });

  async function jumpToBottom() {
    if (!all_loaded_newer) {
      all_loaded_newer = true;
      await loadHistory(true, Date.now() + sessionGet("drift"), 40, 0);
      await tick();
    }
    scrollToBottom(scrollElement, true);
  }

  /*
   * drag & message select
   */

  let isDragging = false;
  let startY, startScrollTop;

  function startDrag(e) {
    if (isClosingBySwipe || isSwipingChat || currentDragX > 0) return;
    clickStartPos = { x: e.clientX, y: e.clientY };
    if (e.button !== 0) return;
    startY = e.pageY;
    startScrollTop = scrollElement.scrollTop;
    scrollElement.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }

  function stopDrag() {
    isDragging = false;
    startScrollTop = 0;
    if (scrollElement) scrollElement.style.cursor = "grab";
    document.body.style.userSelect = "";
  }

  async function mouseUp(e) {
    if (currentDragX > 10 || isClosingBySwipe) {
      stopDrag();
      return;
    }
    const clicked =
      !isDragging ||
      Math.abs(startScrollTop - scrollElement.scrollTop) < 5;

    startScrollTop = 0;
    isDragging = false;

    if (scrollElement) scrollElement.style.cursor = "grab";
    document.body.style.userSelect = "";

    if (
      e.target.closest(".reply-block") ||
      e.target.closest(".forward-block") ||
      e.target.closest(".inline-keyboard") ||
      e.target.closest(".inline-btn")
    ) return;

    if (clicked) {
      const children = Object.values(visibleMessages);

      const nearest = children.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.top < e.clientY && rect.bottom > e.clientY;
      })

      if (nearest) {
        const id = nearest.id.split('-')[1];
        const msg = $messages.find(x => x.id === id);

        if (e.target.closest(".reaction")) {
          const reaction = e.target.childNodes[0].nodeValue.trim();
          await handleReaction(chat, msg, reaction);
          messages.update(x => x);
        }
        else if (msg && !dropoutActiveAt) selectMessage(e, msg);
      }
    }
  }

  function moveDrag(e) {
    if (isSwipingChat || currentDragX > 0 || isClosingBySwipe) {
      isDragging = false;
      return;
    }
    if (startScrollTop && !isDragging) isDragging = true;
    if (!isDragging) return;
    e.preventDefault();
    const y = e.pageY;
    const walk = (y - startY) * 1;
    scrollElement.scrollTop = startScrollTop - walk;
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

    if (attachesDropout && !e.target.closest(".attaches-dropout") && !e.target.closest(".input-button")) {
      attachesDropout = null;
    }
  }

  let justOpenedDropout = false;

  function selectMessage(e, msg) {
    if (
      e.target.closest(".reply-block") ||
      e.target.closest(".forward-block") ||
      e.target.closest(".inline-keyboard") ||
      e.target.closest(".inline-btn")
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
    const msgId = dropoutActiveAt.msg.id;
    dropoutActiveAt = null;

    const action = e.detail?.action

    if (action === "delete") {
      messages.update(x => {
        return x.filter(x => x.id !== msgId);
      });

      if (visibleMessages[msgId]) delete visibleMessages[msgId];

      let wasAtBottom = false;
      if (scrollElement) {
        const { scrollTop, scrollHeight, clientHeight } = scrollElement;
        wasAtBottom = scrollHeight - scrollTop - clientHeight < 150;
      }
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

  function startAutoScrollIfAtBottom() {
    if (!scrollElement) return;

    scrollResizeObserver = new ResizeObserver(() => {
      if (!scrollElement || isInitialMounting || isProgrammaticScroll || !all_loaded_newer) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const atBottom = scrollHeight - scrollTop - clientHeight < 50;
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
          if (chat.type === "DIALOG")
            $Session.profile = { userId: avatarUserId };
          else $Session.profile = { chatId: chat.id };
        }}
      >
        <Avatar size={42} {chat} contactId={avatarUserId} style="margin-left: -8px"/>
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

    {#each $messages as msg (msg.id)}
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
    on:close={handleDropout}
  />

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
      bind:replyTo
      bind:attachesDropout
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
    z-index: 10;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100svh;
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
    padding: 11px 0;
    height: 40px;
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
    height: 452px;
    width: 48px;
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
  }

  .scroll-down-container.nije {
    bottom: 20px;
  }

  .scroll-down-container.vise {
    bottom: 140px;
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
    flex: 1;
    overflow-y: auto;
    display: block;
    flex-direction: column;
    overflow-anchor: none;
    overflow-x: clip
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
