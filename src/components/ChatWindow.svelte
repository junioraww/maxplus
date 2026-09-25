<script>
  import {
    getContext,
    onMount,
    onDestroy,
    tick,
    beforeUpdate,
    afterUpdate,
  } from "svelte";
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
  import {
    openChat,
    closeChat,
    get as sessionGet,
  } from "$lib/stores/session";
  import { handleReaction } from "$components/ChatWindow/actions.js";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { getProxiedMediaUrl } from "$lib/utils/images.js";
  import { scrollToBottom } from "$lib/utils/scroll.js";
  import { getChatScroll } from "$lib/stores/chatScroll.js";
  import Settings from "$components/ChatWindow/Settings.svelte";
  import E2eModal from "$components/ChatWindow/E2eModal.svelte";
  import Dropout from "$components/ChatWindow/Dropout.svelte";
  import MediaViewer from "$components/ChatWindow/MediaViewer.svelte";
  import MediaPlaybackHeader from "$components/media/MediaPlaybackHeader.svelte";
  import { activeMedia, activeChatMessages } from "$lib/stores/mediaPlayback";
  import DateSeparator from "$components/ChatWindow/DateSeparator.svelte";
  import Input from "$components/ChatWindow/input/Input.svelte";
  import BotStart from "$components/ChatWindow/BotStart.svelte";
  import StickerPackModal from "$components/ChatWindow/Stickers/StickerPackModal.svelte";
  import EditHistoryModal from "$components/ChatWindow/EditHistoryModal.svelte";
  import { computeTextDiff } from "$lib/utils/diff.js";
  import { clearChatNotification } from "$lib/utils/notifications.js";

  import ChatHeader from "$components/ChatWindow/ChatHeader.svelte";
  import ScrollDownButton from "$components/ChatWindow/ScrollDownButton.svelte";
  import { swipeToClose } from "$components/ChatWindow/swipeToClose.js";
  import { createVirtualScrollManager, DEFAULT_HEIGHT } from "$components/ChatWindow/chatVirtualScroll.js";
  import { createMessagesLoader, BATCH_SIZE } from "$components/ChatWindow/chatMessagesLoader.js";

  export let chatId;

  $: chat = $currentSessionChats?.find((c) => String(c.id) === String(chatId));

  let title;
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

  let allRendered = false;
  let scrollElement;
  let scrollLoaderTimeout;
  let scrollBottomLoaderTimeout;
  let showScrollDown = false;

  let viewerOpen = false;
  let viewerIndex = 0;
  let clickStartPos = { x: 0, y: 0 };

  const messages = writable([]);
  $: if ($messages) {
    activeChatMessages.set($messages);
  }

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

  let currentDragX = 0;
  let isSwipingChat = false;
  let isClosingBySwipe = false;

  $: swipeStyle = currentDragX > 0 ? `transform: translate3d(${currentDragX}px, 0, 0);` : "";

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
    virtualScroll.destroy();
  });

  const virtualScroll = createVirtualScrollManager();
  const { messageHeights, observeResize } = virtualScroll;

  let innerList;
  let visibleMessages = {};
  let currentScrollAnchor = null;

  function handleAnchorCapture() {
    currentScrollAnchor = virtualScroll.captureScrollAnchor(scrollElement, visibleMessages);
  }

  function handleAnchorRestore() {
    virtualScroll.restoreScrollAnchor(scrollElement, currentScrollAnchor);
  }

  const decodedMessages = writable({});
  $: chatCache = getChat(chat?.id ?? chatId);

  const loader = createMessagesLoader({
    messages,
    decodedMessages,
    getChatObj: () => chat,
    getChatId: () => chatId,
    getChatSettings: () => chatSettings,
    getChatCache: () => chatCache,
    getApi: () => $API,
    onAnchorCapture: handleAnchorCapture,
    onAnchorRestore: handleAnchorRestore,
    onSecretChatRequest: (req) => { gotSecretChatRequest = req; },
  });

  let scrollTimeout = null;
  let updateScheduled = false;
  let userHasScrolled = false;
  let savePositionTimeout = null;
  let isInitialMounting = true;
  let isProgrammaticScroll = false;
  let readTimer = null;
  let lastReadMessageId = null;

  async function updateVisibleMessages() {
    visibleMessages = virtualScroll.calculateVisibleMessages({
      scrollElement,
      messagesList: $messages,
    });
    if (userHasScrolled) {
      await scheduleRead();
    }
  }

  function saveCurrentPosition() {
    virtualScroll.savePosition({
      targetChatId: chat?.id ?? chatId,
      scrollElement,
      all_loaded_newer: loader.all_loaded_newer,
      visibleMessages,
      messagesList: $messages,
      isInitialMounting,
      isProgrammaticScroll,
    });
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
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    showScrollDown = !loader.all_loaded_newer || distanceFromBottom > 50;

    if (!updateScheduled) {
      updateScheduled = true;
      requestAnimationFrame(async () => {
        await updateVisibleMessages();
        updateScheduled = false;
      });
    }

    if (target.scrollTop <= 50 && !loader.loading && !loader.all_loaded) {
      if (scrollLoaderTimeout) return;
      scrollLoaderTimeout = setTimeout(async () => {
        await loader.loadHistory();
        await updateVisibleMessages();
        setTimeout(() => (scrollLoaderTimeout = null), 500);
      }, 200);
    }

    if (distanceFromBottom <= 100 && !loader.loadingNewer && !loader.all_loaded_newer) {
      if (scrollBottomLoaderTimeout) return;
      scrollBottomLoaderTimeout = setTimeout(async () => {
        await loader.loadNewer();
        await updateVisibleMessages();
        setTimeout(() => (scrollBottomLoaderTimeout = null), 500);
      }, 200);
    }
  }

  function getLowestVisibleMessageId() {
    if (!scrollElement) return null;
    let lowest = null;
    let lowestTop = -Infinity;

    for (const key in visibleMessages) {
      const entry = $messages.find((x) => String(x.id) === String(key));
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
      const readDisabled = !$chatSettings?.reader;
      if (readDisabled) return;

      const msgId = getLowestVisibleMessageId();
      if (!msgId) return;

      if (msgId === lastReadMessageId) return;

      const index = $messages.length - $messages.findIndex((x) => x.id === msgId);
      if (index > chat?.newMessages) return;

      lastReadMessageId = msgId;

      try {
        if (chat) chat.newMessages = index - 1;
        await $API.readMessage(chat.id, msgId);
      } catch (e) {
        console.error("readMessage failed", e);
      }
    }, 500);
  }

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

        const msgKey = `${message.id}_${message.time || message.created_at || ""}_${message.status || ""}`;
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
                  if (!newHistory.some((existing) => existing.at === h.at)) newHistory.push(h);
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
          await loader.decodeMessagesBatch([message]);
          await tick();
          virtualScroll.applyPendingHeights($messages);
          virtualScroll.computeCumulativeHeights($messages);
          await updateVisibleMessages();
          return;
        }

        if (message.sender === $currentUser) {
          loader.all_loaded_newer = true;
        }

        if (loader.all_loaded_newer) {
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

          await loader.decodeMessagesBatch([message]);
          await tick();
          virtualScroll.applyPendingHeights($messages);
          virtualScroll.computeCumulativeHeights($messages);

          const isRecentSelfMessage = message.sender === $currentUser && (Date.now() - (message.time || Date.now()) < 5000);
          if (isRecentSelfMessage || wasAtBottom) {
            scrollToBottom(scrollElement, true);
          }

          await updateVisibleMessages();
        }
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
      result.push(m);
    }
    result.reverse();
    return result;
  })();

  $: cachedContact = chat?.type === "DIALOG" ? getContact(avatarUserId) : writable(undefined);
  $: title = chat?.id === 0 ? "Избранное" : (chat?.title || $cachedContact?.names?.[0]?.name);
  $: isBot = $cachedContact?.options?.includes("BOT") || chat?.options?.BOT === true || chat?.options?.IS_BOT === true;

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

    virtualScroll.setupResizeObserver();
    startAutoScrollIfAtBottom();

    const unreadCount = Number(chat?.newMessages || 0);
    const savedPos = getChatScroll(targetChatId);
    const hasSavedScroll = savedPos && !savedPos.wasAtBottom && savedPos.bottomMessageTime;

    let initialFrom = Date.now() + sessionGet("drift");
    if (hasSavedScroll) {
      initialFrom = Number(savedPos.bottomMessageTime) + 1;
      loader.all_loaded_newer = false;
      showScrollDown = true;
      await loader.loadHistory(true, initialFrom, 35, 35);
    } else {
      loader.all_loaded_newer = true;
      await loader.loadHistory(true, initialFrom, 40, 0);
    }

    await tick();

    virtualScroll.measureAllHeights(innerList);
    virtualScroll.computeCumulativeHeights($messages);

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
      if (!restored && !loader.all_loaded_newer) {
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
    if (!loader.all_loaded_newer) {
      loader.all_loaded_newer = true;
      await loader.loadHistory(true, Date.now() + sessionGet("drift"), 40, 0);
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
      e.target.closest(".transcription-close-btn") ||
      e.target.closest(".media-grid") ||
      e.target.closest(".grid-item") ||
      e.target.closest(".attaches") ||
      e.target.closest(".media-download-badge") ||
      e.target.closest(".file-attachment") ||
      e.target.closest(".file-attach") ||
      e.target.closest(".attach") ||
      e.target.closest(".encrypted-media-placeholder")
    ) return;

    if (clicked) {
      const messageWrapper = e.target.closest(".message-wrapper");
      if (messageWrapper) {
        const id = messageWrapper.id?.replace("m-", "");
        const msg = $messages.find((x) => String(x.id) === String(id));

        if (e.target.closest(".reaction")) {
          const reaction = e.target.childNodes[0]?.nodeValue?.trim();
          if (reaction && msg) {
            await handleReaction(chat, msg, reaction);
            messages.update((x) => x);
          }
        } else if (msg && !dropoutActiveAt) {
          selectMessage(e, msg);
        }
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
      e.target.closest(".avatar-wrapper") ||
      e.target.closest(".media-grid") ||
      e.target.closest(".grid-item") ||
      e.target.closest(".attaches") ||
      e.target.closest(".media-download-badge") ||
      e.target.closest(".file-attachment") ||
      e.target.closest(".file-attach") ||
      e.target.closest(".attach") ||
      e.target.closest(".encrypted-media-placeholder")
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
      messages.update((x) => {
        const idx = x.findIndex((m) => String(m.id) === String(msgId));
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
      messages.update((x) => x);
    }
  }

  function openSettings() {
    settingsShown = !settingsShown;
    if (settingsShown) onBack.chatSettings = () => (settingsShown = false);
    else delete onBack["chatSettings"];
  }

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
      if (!scrollElement || isInitialMounting || isProgrammaticScroll || !loader.all_loaded_newer) return;
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

  let allMedia = [];

  function computeAllMedia() {
    const list = $messages || [];
    const decodedMap = $decodedMessages || {};
    const myId = Number($currentUser);
    return list.flatMap((m) => {
      const decoded = decodedMap[String(m.id)];
      const media = decoded?.media;
      const isMe = Number(m.sender) === myId;
      const attaches = (m.attaches || []).map((att, idx) => {
        if (media && idx === (media.attach_index ?? 0)) {
          const resolvedType = media.media_type || att._type || "FILE";
          const localPath = att.localPath || (isMe ? att.path : null);
          return {
            ...att,
            _type: resolvedType,
            type: resolvedType,
            originalType: media.media_type,
            name: media.name || att.name,
            size: media.size || att.size,
            mime: media.mime || att.mime,
            width: media.width ?? att.width,
            height: media.height ?? att.height,
            duration: media.duration ?? att.duration,
            wave: media.wave ?? att.wave,
            videoType: media.video_type ?? att.videoType,
            color: media.color || null,
            isEncryptedMedia: true,
            encryptedAttach: att,
            localPath,
            baseUrl: att.baseUrl || (localPath ? getProxiedMediaUrl(localPath) : null),
          };
        }
        return att;
      });

      return attaches
        .filter((a) => a._type === "PHOTO" || a._type === "VIDEO")
        .map((a) => {
          const fid = a.fileId || a.encryptedAttach?.fileId;
          const uid = a.videoId || a.photoId || fid || a.url || a.baseUrl || a.localPath || `${m.id}_${a.name || 'media'}`;
          return {
            ...a,
            messageId: m.id,
            uid: String(uid),
          };
        });
    });
  }

  $: if (viewerOpen) {
    allMedia = computeAllMedia();
  }

  function openMedia(attach) {
    allMedia = computeAllMedia();
    const fid = attach.fileId || attach.encryptedAttach?.fileId;
    const targetUid = String(attach.videoId || attach.photoId || fid || attach.url || attach.baseUrl || attach.localPath || "");
    const index = allMedia.findIndex((m) =>
      (targetUid && m.uid === targetUid) ||
      (attach.baseUrl && m.baseUrl === attach.baseUrl) ||
      (attach.localPath && m.localPath === attach.localPath) ||
      (fid && (m.fileId === fid || m.encryptedAttach?.fileId === fid))
    );

    if (index !== -1) {
      if (attach.baseUrl) allMedia[index].baseUrl = attach.baseUrl;
      if (attach.localPath) allMedia[index].localPath = attach.localPath;
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
  use:swipeToClose={{
    canSwipe: () => !viewerOpen && !settingsShown && !dropoutActiveAt && !isClosingBySwipe,
    onClose: handleCloseChat,
    onStateChange: (state) => {
      currentDragX = state.currentDragX;
      isSwipingChat = state.isSwipingChat;
      isClosingBySwipe = state.isClosingBySwipe;
    },
  }}
  on:click|capture={handleClick}
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

  <ChatHeader
    {chat}
    {avatarUserId}
    {title}
    on:close={handleCloseChat}
    on:openSettings={openSettings}
  />

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
      {decodedMessages}
    />
  {/if}

  <ScrollDownButton
    {showScrollDown}
    chatType={chat.type}
    hasReply={!!replyTo}
    {showStickerPanel}
    {unreadBadgeCount}
    on:click={jumpToBottom}
  />
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
