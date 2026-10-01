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
  import { fly } from "svelte/transition";
  import { registerBackHandler } from "$lib/utils/backButton.js";

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
    getChat,
    saveChats,
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
  import { showAlert } from "$lib/utils/alert.js";
  import {
    selectionState,
    isSelecting,
    selectedCount,
    startSelection,
    toggleMessageSelection,
    setSelectedMessages,
    clearSelection,
  } from "$lib/stores/messageSelection.js";
  import { setForwardDraft } from "$lib/stores/forwardDraft.js";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import ComplaintModal from "$components/ChatWindow/ComplaintModal.svelte";
  import { copyMessageText, forwardMessages } from "$components/ChatWindow/actions.js";
  import { hideMyDeletedMessages, saveOthersDeletedMessages } from "$lib/stores/deletionSettings.js";

  import ChatHeader from "$components/ChatWindow/ChatHeader.svelte";
  import ScrollDownButton from "$components/ChatWindow/ScrollDownButton.svelte";
  import { swipeToClose } from "$components/ChatWindow/swipeToClose.js";
  import { createVirtualScrollManager, DEFAULT_HEIGHT } from "$components/ChatWindow/chatVirtualScroll.js";
  import { createMessagesLoader, BATCH_SIZE } from "$components/ChatWindow/chatMessagesLoader.js";

  export let chatId;
  let prevActiveChatId = null;
  $: if (chatId !== prevActiveChatId) {
    prevActiveChatId = chatId;
    clearSelection();
  }

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

  let deleteConfirmActive = false;
  let deleteForEveryone = false;
  let pendingDeleteIds = [];
  $: canDeleteForEveryone = pendingDeleteIds.some((id) => {
    const m = $messages?.find((x) => String(x.id) === String(id));
    return m && Number(m.sender) === Number($currentUser);
  }) || (chat?.owner && Number(chat.owner) === Number($currentUser));
  let complaintMessage = null;
  let isDragSelecting = false;
  let dragSelectStartY = null;
  let dragSelectStartX = null;
  let dragInitialSelected = new Set();

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
  $: {
    const rawMsgs = $messages || [];
    const decMap = $decodedMessages || {};
    const effectiveMsgs = rawMsgs.map(msg => {
      const dec = decMap[msg.id];
      if (!dec?.media || !msg.attaches?.length) return msg;
      const media = dec.media;
      const targetIdx = media.attach_index ?? 0;
      const effectiveAttaches = msg.attaches.map((att, idx) => {
        if (idx === targetIdx) {
          const resolvedType = media.media_type || att._type || "FILE";
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
          };
        }
        return att;
      });
      return { ...msg, attaches: effectiveAttaches };
    });
    activeChatMessages.set(effectiveMsgs);
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

  const unregisterBack = registerBackHandler(() => {
    handleCloseChat();
  });

  onDestroy(() => {
    unregisterBack();
    clearSelection();
    if (savePositionTimeout) {
      clearTimeout(savePositionTimeout);
      savePositionTimeout = null;
    }
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
      if (!$chatSettings?.reader) return;

      const msgId = getLowestVisibleMessageId();
      if (!msgId) return;
      if (msgId === lastReadMessageId) return;

      const myId = Number($currentUser);
      const myMark = Number(chat?.participants?.[myId] || 0);
      const msg = $messages.find((x) => String(x.id) === String(msgId));
      if (!msg) return;

      if (myMark > 0 && Number(msg.time || 0) <= myMark) return;

      if (!chat?.newMessages || chat.newMessages <= 0) return;

      lastReadMessageId = msgId;

      try {
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

        if (message.type === "CLEAR_HISTORY" || message.action === "CLEAR") {
          messages.set([]);
          activeChatMessages.set([]);
          decodedMessages.set({});
          loader.all_loaded = true;
          loader.all_loaded_newer = true;
          await tick();
          virtualScroll.applyPendingHeights([]);
          virtualScroll.computeCumulativeHeights([]);
          await updateVisibleMessages();
          return;
        }

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
    const myId = Number($currentUser);
    const hideMine = $hideMyDeletedMessages;
    const saveOthers = $saveOthersDeletedMessages;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m) continue;
      const isMine = Number(m.sender) === myId;
      if (m.deleted) {
        if (isMine && hideMine) continue;
        if (!isMine && !saveOthers) continue;
      }
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
    userHasScrolled = true;
    showScrollDown = false;
    await tick();
    await updateVisibleMessages();
  }

  let holdSelectTimer = null;
  let isHoldSelectTriggered = false;
  let justLongPressed = false;
  let justLongPressedTimer = null;

  function markLongPressOccurred() {
    justLongPressed = true;
    clearTimeout(justLongPressedTimer);
    justLongPressedTimer = setTimeout(() => {
      justLongPressed = false;
    }, 450);
  }

  function startDrag(e) {
    if (isClosingBySwipe || isSwipingChat || currentDragX > 0) return;
    clickStartPos = { x: e.clientX, y: e.clientY };
    clearTimeout(holdSelectTimer);
    isHoldSelectTriggered = false;
    if (e.button !== 0) return;
    if (e.target.closest("button, a, input, textarea, .avatar-msg-btn, .reply-block, .forward-block, .inline-keyboard, .sticker-wrapper, .media-grid, .file-attachment, .voice-play-btn, .circular-wrapper, .voice-message-bubble, .video-note-bubble, .reaction, .reactions-picker, .reaction-bubble")) return;
    dragSelectStartY = e.clientY;
    dragSelectStartX = e.clientX;
    isDragSelecting = false;
    dragInitialSelected = new Set($selectionState.selected);

    const messageWrapper = e.target.closest(".message-wrapper");
    if (messageWrapper) {
      const id = messageWrapper.id?.replace("m-", "");
      if (id) {
        holdSelectTimer = setTimeout(() => {
          isHoldSelectTriggered = true;
          markLongPressOccurred();
          if (!$isSelecting) {
            startSelection(chat?.id || chatId, id);
          } else {
            toggleMessageSelection(id);
          }
          if (navigator?.vibrate) navigator.vibrate(40);
        }, 1000);
      }
    }
  }

  function stopDrag() {
    clearTimeout(holdSelectTimer);
    isDragSelecting = false;
    dragSelectStartY = null;
    dragSelectStartX = null;
  }

  function moveDrag(e) {
    if (isSwipingChat || currentDragX > 0 || isClosingBySwipe) {
      stopDrag();
      return;
    }
    if (dragSelectStartX !== null && dragSelectStartY !== null) {
      if (Math.abs(e.clientX - dragSelectStartX) > 6 || Math.abs(e.clientY - dragSelectStartY) > 6) {
        clearTimeout(holdSelectTimer);
      }
    }
    if (e.buttons !== 1 || dragSelectStartY === null) {
      if (isDragSelecting) stopDrag();
      return;
    }
    const dy = e.clientY - dragSelectStartY;
    if (!isDragSelecting) {
      if (Math.abs(dy) > 10 || ($isSelecting && Math.abs(dy) > 4)) {
        isDragSelecting = true;
        if (!$isSelecting) {
          startSelection(chat?.id || chatId);
        }
      } else {
        return;
      }
    }

    const topY = Math.min(dragSelectStartY, e.clientY);
    const bottomY = Math.max(dragSelectStartY, e.clientY);

    const nextSelected = new Set(dragInitialSelected);
    const wrappers = scrollElement?.querySelectorAll(".message-wrapper");
    if (wrappers) {
      for (const wrapper of wrappers) {
        const rect = wrapper.getBoundingClientRect();
        const id = wrapper.id?.replace("m-", "");
        if (!id) continue;
        if (rect.bottom >= topY && rect.top <= bottomY) {
          nextSelected.add(String(id));
        }
      }
    }
    setSelectedMessages(chat?.id || chatId, Array.from(nextSelected));

    if (scrollElement) {
      const containerRect = scrollElement.getBoundingClientRect();
      if (e.clientY < containerRect.top + 40) {
        scrollElement.scrollTop -= 10;
      } else if (e.clientY > containerRect.bottom - 40) {
        scrollElement.scrollTop += 10;
      }
    }
  }

  async function mouseUp(e) {
    clearTimeout(holdSelectTimer);
    if (isHoldSelectTriggered) {
      isHoldSelectTriggered = false;
      stopDrag();
      return;
    }
    if (currentDragX > 10 || isClosingBySwipe) {
      stopDrag();
      return;
    }
    if (isDragSelecting) {
      stopDrag();
      return;
    }
    if (justLongPressed || isHoldSelectTriggered) {
      stopDrag();
      return;
    }
    stopDrag();
  }

  function handleClick(e) {
    if (currentDragX > 10 || isClosingBySwipe) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (!justOpenedDropout && dropoutActiveAt && !e.target.closest(".dropout-container, .dropout-backdrop, .message-actions-dropout")) {
      dropoutActiveAt = null;
    }

    if (attachesDropout && !e.target.closest(".attaches-dropout") && !e.target.closest(".input-button") && !e.target.closest(".attach-toggle-btn")) {
      attachesDropout = null;
    }
  }

  let justOpenedDropout = false;

  function selectMessage(e, msg) {
    if (
      e?.target?.closest?.("a") ||
      e?.target?.closest?.(".rich-link") ||
      e?.target?.closest?.(".link-dropout-card") ||
      e?.target?.closest?.(".dropout-backdrop") ||
      e?.target?.closest?.("img") ||
      e?.target?.closest?.("video") ||
      e?.target?.closest?.(".reply-block") ||
      e?.target?.closest?.(".forward-block") ||
      e?.target?.closest?.(".inline-keyboard") ||
      e?.target?.closest?.(".inline-btn") ||
      e?.target?.closest?.(".avatar-msg-btn") ||
      e?.target?.closest?.(".avatar-wrapper") ||
      e?.target?.closest?.(".media-grid") ||
      e?.target?.closest?.(".grid-item") ||
      e?.target?.closest?.(".attaches") ||
      e?.target?.closest?.(".media-download-badge") ||
      e?.target?.closest?.(".file-attachment") ||
      e?.target?.closest?.(".file-attach") ||
      e?.target?.closest?.(".attach") ||
      e?.target?.closest?.(".encrypted-media-placeholder")
    ) return;

    if (msg === dropoutActiveAt?.msg) return;

    justOpenedDropout = true;
    requestAnimationFrame(() => (justOpenedDropout = false));
    dropoutActiveAt = { e, msg };
  }

  function handleDropout(e) {
    const msgId = dropoutActiveAt?.msg?.id;
    const currentMsg = dropoutActiveAt?.msg;
    dropoutActiveAt = null;

    const action = e.detail?.action;
    if (action === "reaction") {
      messages.update((x) => [...x]);
    }
  }

  async function handleMessageReact(e) {
    const { reaction, msgId } = e.detail || {};
    if (!reaction || !msgId) return;
    const msg = $messages.find((x) => String(x.id) === String(msgId));
    if (msg) {
      await handleReaction(chat, msg, reaction);
      messages.update((x) => [...x]);
    }
  }

  function getSelectedMessagesText() {
    if (typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return null;
    const rawSelected = selection.toString();
    if (!rawSelected || !rawSelected.trim()) return null;

    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rows = document.querySelectorAll(".message-row");
      const matched = [];

      for (const row of rows) {
        if (selection.containsNode(row, true)) {
          const contentEl = row.querySelector(".rich-content");
          if (contentEl && selection.containsNode(contentEl, true)) {
            const contentRange = document.createRange();
            contentRange.selectNodeContents(contentEl);

            const intersectionRange = document.createRange();
            if (range.compareBoundaryPoints(Range.START_TO_START, contentRange) < 0) {
              intersectionRange.setStart(contentRange.startContainer, contentRange.startOffset);
            } else {
              intersectionRange.setStart(range.startContainer, range.startOffset);
            }

            if (range.compareBoundaryPoints(Range.END_TO_END, contentRange) > 0) {
              intersectionRange.setEnd(contentRange.endContainer, contentRange.endOffset);
            } else {
              intersectionRange.setEnd(range.endContainer, range.endOffset);
            }

            const text = intersectionRange.toString().trim();
            if (text) {
              matched.push(text);
            }
          }
        }
      }

      if (matched.length > 1) {
        return matched.join("\n");
      } else if (matched.length === 1) {
        return matched[0];
      }
    }

    return rawSelected.trim();
  }

  function handleWindowCopy(e) {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
      return;
    }
    const multiText = getSelectedMessagesText();
    if (multiText) {
      e.preventDefault();
      e.clipboardData.setData("text/plain", multiText);
    }
  }

  async function handleCopyText(msg) {
    const selectedText = getSelectedMessagesText();
    if (selectedText) {
      await navigator.clipboard.writeText(selectedText);
      showAlert("Текст скопирован");
      return;
    }
    const decoded = $decodedMessages?.[msg?.id];
    const success = await copyMessageText(msg, decoded);
    if (success) {
      showAlert("Текст скопирован");
    }
  }

  async function handleCopySelected() {
    const selectedText = getSelectedMessagesText();
    if (selectedText) {
      await navigator.clipboard.writeText(selectedText);
      showAlert("Текст скопирован");
      clearSelection();
      return;
    }
    const selectedMsgs = $messages.filter((m) => $selectionState.selected.has(String(m.id)));
    if (!selectedMsgs.length) return;
    const texts = selectedMsgs.map((m) => m.text).filter(Boolean);
    if (texts.length > 0) {
      await navigator.clipboard.writeText(texts.join("\n"));
      showAlert("Текст скопирован");
    } else {
      showAlert("Нет текста для копирования");
    }
    clearSelection();
  }

  function handleForwardSelected() {
    const selectedMsgs = $messages.filter((m) => $selectionState.selected.has(String(m.id)));
    if (!selectedMsgs.length) return;
    handleStartForward(selectedMsgs);
  }

  function handleDeleteSelected() {
    const ids = Array.from($selectionState.selected);
    if (!ids.length) return;
    promptDelete(ids);
  }

  function handleMessageClick(msg, e) {
    if (!msg) return;
    if ($isSelecting) {
      toggleMessageSelection(msg.id);
      return;
    }
    selectMessage(e, msg);
  }

  function handleMessageLongPress(msg, detail) {
    if (!msg) return;
    markLongPressOccurred();
    if ($isSelecting) {
      toggleMessageSelection(msg.id);
      return;
    }
    const fakeEvent = {
      clientX: detail?.clientX ?? (typeof window !== "undefined" ? window.innerWidth / 2 : 0),
      clientY: detail?.clientY ?? (typeof window !== "undefined" ? window.innerHeight / 2 : 0),
      target: detail?.target,
    };
    selectMessage(fakeEvent, msg);
  }

  function handleMessageContextMenu(msg, e) {
    if (!msg) return;
    if (e.target.closest("a, .rich-link, .link-dropout-card, .dropout-backdrop")) return;
    if ($isSelecting) {
      toggleMessageSelection(msg.id);
    } else {
      selectMessage(e, msg);
    }
  }

  function handleStartForward(msgs) {
    if (!msgs || !msgs.length) return;
    setForwardDraft(msgs, chat?.id || chatId);
    clearSelection();
    dropoutActiveAt = null;
    handleCloseChat();
  }

  function promptDelete(messageIds) {
    if (!messageIds || !messageIds.length) return;
    pendingDeleteIds = messageIds.map(String);
    deleteForEveryone = false;
    deleteConfirmActive = true;
  }

  async function handleConfirmDelete() {
    deleteConfirmActive = false;
    const ids = [...pendingDeleteIds];
    const forMe = !deleteForEveryone;
    pendingDeleteIds = [];
    if (!ids.length) return;

    try {
      if (ids.length === 1) {
        await $API.deleteMessage(chat.id, ids[0], forMe);
      } else {
        await $API.deleteMessages(chat.id, ids, forMe);
      }

      const shouldHide = get(hideMyDeletedMessages);
      messages.update((msgs) => {
        const idSet = new Set(ids);
        if (shouldHide) {
          return msgs.filter((m) => !idSet.has(String(m.id)));
        }
        return msgs.map((m) => {
          if (idSet.has(String(m.id))) {
            return {
              ...m,
              deleted: true,
              deleted_at: Date.now(),
            };
          }
          return m;
        });
      });

      const chatStore = getChat(chat?.id || chatId);
      chatStore.markMessagesDeleted?.(ids);
      clearSelection();
    } catch (err) {
      console.error("Delete failed:", err);
      showAlert("Ошибка удаления сообщений");
    }
  }

  async function handleUnpinMessage(msgId) {
    try {
      await $API.unpinMessage(chat.id);
      const updatedChat = {
        ...chat,
        pinnedMessage: null,
      };
      currentSessionChats.update(chats => {
        const idx = chats.findIndex(x => x.id === chat.id);
        if (idx !== -1) chats[idx] = updatedChat;
        return [...chats];
      });
      await saveChats([ updatedChat ]);
      showAlert("Сообщение откреплено");
    } catch (e) {
      console.error("Failed to unpin message:", e);
    }
  }

  function openSettings() {
    const targetChatId = chat?.id ?? chatId;
    if (chat?.type === "DIALOG" || (!chat && avatarUserId)) {
      $Session.profile = { chatId: targetChatId, userId: avatarUserId, view: "settings" };
    } else if (targetChatId) {
      $Session.profile = { chatId: targetChatId, view: "settings" };
    }
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

    function extractMediaFromAttaches(attaches, msgObj, decoded) {
      const messageId = msgObj?.id;
      const media = decoded?.media;
      const isMe = Number(decoded?.sender ?? 0) === myId;
      const resolved = (attaches || []).map((att, idx) => {
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

      return resolved
        .filter((a) => a._type === "PHOTO" || (a._type === "VIDEO" && a.videoType !== 1 && !a.isNote))
        .map((a) => {
          const fid = a.fileId || a.encryptedAttach?.fileId;
          const uid = a.videoId || a.photoId || fid || a.url || a.baseUrl || a.localPath || `${messageId}_${a.name || 'media'}`;
          return {
            ...a,
            messageId,
            uid: String(uid),
            time: msgObj?.time || msgObj?.created || Date.now(),
            senderId: msgObj?.sender,
            senderName: msgObj?.senderName || msgObj?.sender_name || "",
            chatId: chat?.id,
            token: a.videoToken || a.token,
            videoToken: a.videoToken || a.token,
          };
        });
    }

    return list.flatMap((m) => {
      const decoded = decodedMap[String(m.id)];
      const direct = extractMediaFromAttaches(m.attaches, m, decoded);

      const forwarded = (() => {
        const link = m.link;
        if (!link || link.type !== "FORWARD") return [];
        const fwdMsg = link.message;
        if (!fwdMsg?.attaches?.length) return [];
        return extractMediaFromAttaches(fwdMsg.attaches, fwdMsg, null);
      })();

      return [...direct, ...forwarded];
    });
  }

  let viewerOriginEl = null;

  $: if (viewerOpen) {
    allMedia = computeAllMedia();
  }

  function openMedia(attach, originEl = null) {
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
      viewerOriginEl = originEl || null;
      viewerIndex = index;
      viewerOpen = true;
    }
  }
</script>

<svelte:window on:copy={handleWindowCopy} />

<div
  class="chat-window"
  class:swiping={isSwipingChat}
  class:animating={!isSwipingChat && (currentDragX > 0 || isClosingBySwipe)}
  class:is-selecting={$isSelecting || isDragSelecting}
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
      originEl={viewerOriginEl}
      originRadius={12}
      on:close={() => {
        viewerOpen = false;
        viewerOriginEl = null;
      }}
    />
  {/if}

  <div class="chat-header-container">
    <ChatHeader
      {chat}
      {avatarUserId}
      {title}
      on:close={handleCloseChat}
      on:openSettings={openSettings}
    />
    {#if $isSelecting}
      <div class="action-header" transition:fly={{ y: -56, duration: 180 }}>
        <div class="action-left">
          <button class="icon-btn" on:click={clearSelection} aria-label="Отменить выбор">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <span class="selection-count">{$selectedCount}</span>
        </div>

        <div class="action-right">
          <button class="icon-btn" on:click={handleCopySelected} title="Копировать">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="icon-btn" on:click={handleForwardSelected} title="Переслать">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="15 14 20 9 15 4"></polyline>
              <path d="M4 20v-7a4 4 0 0 1 4-4h12"></path>
            </svg>
          </button>
          <button class="icon-btn" on:click={handleDeleteSelected} title="Удалить">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    {/if}
  </div>

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
      <PinnedMessage msg={chat.pinnedMessage} {chat} on:unpin={(e) => handleUnpinMessage(e.detail.id)} />
    {/if}

    <div
      class="message-list-inner"
      style={"opacity: " + (allRendered ? "1;" : "0;")}
      bind:this={innerList}
    >
      <div style={"flex-shrink: 0; height: " + (chat.pinnedMessage ? "60px" : "10px")}></div>

      {#each uniqueMessages as msg (msg.id)}
        <div
          class="message-wrapper"
          class:is-selected={$selectionState.selected.has(String(msg.id))}
          id={"m-" + msg.id}
          on:click={() => {
            if (justLongPressed) return;
            if ($isSelecting) toggleMessageSelection(msg.id);
          }}
        >
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
                selected={$selectionState.selected.has(String(msg.id))}
                selectionMode={$isSelecting}
                on:openMedia={(e) => openMedia(e.detail.attach, e.detail.originEl)}
                on:openChat={() => openChat(chat.id, msg.id)}
                on:openStickerPack={(e) => handleOpenStickerPack(e.detail.sticker)}
                on:openHistory={(e) => (historyModalMessage = e.detail.msg)}
                on:react={handleMessageReact}
                on:toggleSelect={(e) => toggleMessageSelection(e.detail.id)}
                on:messageClick={(e) => handleMessageClick(e.detail.msg, e.detail.e)}
                on:longpress={(e) => handleMessageLongPress(e.detail.msg, e.detail)}
                on:contextmenu={(e) => handleMessageContextMenu(e.detail.msg, e.detail.e)}
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
    on:copyText={(e) => handleCopyText(e.detail.msg)}
    on:forward={(e) => handleStartForward([e.detail.msg])}
    on:select={(e) => startSelection(chat?.id || chatId, e.detail.msg?.id)}
    on:report={(e) => (complaintMessage = e.detail.msg)}
    on:delete={(e) => promptDelete([e.detail.msg?.id])}
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

  {#if complaintMessage}
    <ComplaintModal
      messageId={complaintMessage.id}
      chatId={chat?.id || chatId}
      on:close={() => (complaintMessage = null)}
      on:success={() => {
        complaintMessage = null;
        showAlert("Жалоба отправлена");
      }}
      on:error={() => {
        showAlert("Не удалось отправить жалобу");
      }}
    />
  {/if}

  {#if deleteConfirmActive}
    <ConfirmModal
      title="Удалить {pendingDeleteIds.length > 1 ? `${pendingDeleteIds.length} сообщений` : 'сообщение'}?"
      message="Вы уверены?"
      confirmText="Удалить"
      isDangerous={true}
      on:cancel={() => {
        deleteConfirmActive = false;
        pendingDeleteIds = [];
      }}
      on:confirm={handleConfirmDelete}
    >
      {#if canDeleteForEveryone}
        <label class="delete-everyone-label">
          <input type="checkbox" bind:checked={deleteForEveryone} />
          <span>Удалить для всех</span>
        </label>
      {/if}
    </ConfirmModal>
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
    background-color: var(--bg-chat);
    padding-top: env(safe-area-inset-top, 10px);
    padding-bottom: env(safe-area-inset-bottom, 20px);
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45);
    will-change: transform;
  }

  .chat-window.is-selecting,
  .chat-window.is-selecting * {
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-user-drag: none !important;
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
    width: 100%;
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
    cursor: default;
  }

  .message-wrapper {
    position: relative;
    width: 100%;
    border-radius: 0;
    box-sizing: border-box;
    transition: background 0.15s ease;
  }

  .message-wrapper.is-selected {
    background: rgba(123, 76, 214, 0.22);
    border-radius: 0;
  }

  .observer-area {
    position: relative;
    width: 100%;
  }

  .chat-header-container {
    position: relative;
    width: 100%;
    z-index: 25;
    flex-shrink: 0;
  }

  .action-header {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: #252525;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    box-sizing: border-box;
    border-bottom: 1px solid #333;
    z-index: 30;
  }

  .action-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .selection-count {
    font-size: 17px;
    font-weight: 600;
    color: #fff;
  }

  .action-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .icon-btn {
    background: none;
    border: none;
    color: #eee;
    padding: 8px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .icon-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .icon-btn:active {
    transform: scale(0.95);
  }

  .delete-everyone-label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    font-size: 14px;
    color: #e0e0e0;
    cursor: pointer;
    user-select: none;
  }

  .delete-everyone-label input[type="checkbox"] {
    accent-color: #8b5cf6;
    width: 16px;
    height: 16px;
    cursor: pointer;
  }
</style>
