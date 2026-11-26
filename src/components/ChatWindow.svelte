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
  import { fly, slide } from "svelte/transition";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { parseApiError } from "$lib/utils/errors";
  import { canPinInChat } from "$lib/utils/chatPermissions";
  import { registerDecodedMessagesStore, consumeCallHandshake } from "$lib/crypto/transports";
  import { verifyHandshakePacket } from "$lib/crypto/asymmetric";

  import Message from "$components/ChatWindow/Message.svelte";
  import PinnedMessage from "$components/ChatWindow/PinnedMessage.svelte";
  import MessagePreview from "$components/main/MessagePreview.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import "$lib/styles/AnimatedPanel.css";
  import API, {
    currentUser,
    currentRealChats,
  } from "$lib/stores/api";
  import {
    getChatSettings,
    getChat,
    saveChats,
    isChatInUserList,
  } from "$lib/stores/messages";
  import {
    getContact
  } from "$lib/stores/contacts";
  import Session, {
    openChat,
    closeChat,
    openProfile,
    get as sessionGet,
    pendingChatJump,
    clearPendingChatJump,
  } from "$lib/stores/session";
  import {
    handleReaction,
    retryFailedMessage,
    removeFailedMessage,
  } from "$components/ChatWindow/actions";
  import BottomSheet from "$components/main/BottomSheet.svelte";

  let failedActionMessage = null;

  async function handleRetryFailedMessage() {
    const target = failedActionMessage;
    failedActionMessage = null;
    if (!target) return;
    await retryFailedMessage(chat, chatSettings, messages, target, decodedMessages).catch(() => {});
  }

  async function handleDeleteFailedMessage() {
    const target = failedActionMessage;
    failedActionMessage = null;
    if (!target) return;
    removeFailedMessage(messages, target);
    await tick();
    virtualScroll.applyPendingHeights($messages);
    virtualScroll.computeCumulativeHeights($messages);
    await updateVisibleMessages();
  }
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import { getAttachType } from "$lib/utils/mediaUtils";
  import { scrollToBottom } from "$lib/utils/scroll";
  import { getChatScroll } from "$lib/stores/chatScroll";
  import { openSheet, dismissLayer } from "$lib/services/layerManager";
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
  import SeenByModal from "$components/ChatWindow/SeenByModal.svelte";
  import { computeTextDiff } from "$lib/utils/diff";
  import { clearChatNotification, isChatMuted } from "$lib/utils/notifications";
  import { showAlert } from "$lib/utils/alert";
  import {
    selectionState,
    isSelecting,
    selectedCount,
    startSelection,
    toggleMessageSelection,
    setSelectedMessages,
    clearSelection,
  } from "$lib/stores/messageSelection";
  import { setForwardDraft } from "$lib/stores/forwardDraft";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import ComplaintModal from "$components/ChatWindow/ComplaintModal.svelte";
  import { copyMessageText, forwardMessages } from "$components/ChatWindow/actions";
  import { hideMyDeletedMessages, saveOthersDeletedMessages } from "$lib/stores/deletionSettings";

  import ChatHeader from "$components/ChatWindow/ChatHeader.svelte";
  import ScrollDownButton from "$components/ChatWindow/ScrollDownButton.svelte";
  import { swipeToClose } from "$components/ChatWindow/swipeToClose";
  import { createVirtualScrollManager, DEFAULT_HEIGHT } from "$components/ChatWindow/chatVirtualScroll";
  import { createMessagesLoader, BATCH_SIZE } from "$components/ChatWindow/chatMessagesLoader";
  import { createChatScrollController } from "$components/ChatWindow/chatScrollController";
  import { getMountStore } from "$lib/plugins/mount-registry";

  const pluginChatBackground = getMountStore("chat:background");
  const pluginChatFooter = getMountStore("chat:footer");

  export let chatId;
  let prevActiveChatId = null;
  let e2eLayerId = null;

  $: if (chatId !== prevActiveChatId) {
    prevActiveChatId = chatId;
    clearSelection();
    if (e2eLayerId) {
      dismissLayer(e2eLayerId);
      e2eLayerId = null;
    }
    gotSecretChatRequest = null;
  }

  $: chatStore = chatId != null ? getChat(chatId).chatInfo : null;
  $: chat = chatStore ? $chatStore : null;

  let title;
  let gotSecretChatRequest = null;

  function showE2eSheet(req) {
    if (!req || !chat) return;
    if (e2eLayerId) {
      dismissLayer(e2eLayerId);
      e2eLayerId = null;
    }
    const layer = openSheet(
      E2eModal,
      {
        chat,
        messages,
        chatSettings,
        gotSecretChatRequest: req,
      },
      {
        dim: true,
        dimOpacity: 0.65,
        dismissOnDim: true,
        canSwipe: true,
        closeDelay: 250,
        onClose: () => {
          if (e2eLayerId === layer.id) {
            e2eLayerId = null;
          }
          gotSecretChatRequest = null;
        },
      }
    );
    e2eLayerId = layer.id;
  }

  $: if (gotSecretChatRequest && chat && !e2eLayerId) {
    showE2eSheet(gotSecretChatRequest);
  }

  let replyTo = null;
  let editingMessage = null;
  let historyModalMessage = null;
  let seenByModalData = null;

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

  let unreadAnchorId = null;
  let showUnreadSeparator = false;
  $: unreadBadgeCount = Math.max(0, Number(chat?.newMessages ?? 0));
  $: chatSettings = getChatSettings(chat?.id ?? chatId);
  let lastSessionSecret = null;
  $: {
    const curSecret = $chatSettings?.session?.shared_secret || null;
    if (curSecret && curSecret !== lastSessionSecret) {
      lastSessionSecret = curSecret;
      loader?.retryErroredMessages?.();
    } else if (!curSecret) {
      lastSessionSecret = null;
    }
  }
  $: isChannel = chat?.type === "CHANNEL";
  $: isChannelOwner = Boolean(
    chat &&
    $currentUser != null &&
    (Number(chat.owner) === Number($currentUser) || Number(chat.creator) === Number($currentUser))
  );
  $: channelAdminPerms = (() => {
    if (!chat || !isChannel || $currentUser == null) return 0;
    const uidStr = String($currentUser);
    const uidNum = Number($currentUser);
    const ap = chat.adminParticipants?.[uidStr] || chat.adminParticipants?.[uidNum];
    if (ap != null) {
      if (typeof ap.permissions === "number") return ap.permissions;
      if (Array.isArray(ap.permissions)) {
        let mask = 0;
        if (ap.permissions.includes("POST_MESSAGE")) mask |= 256;
        if (ap.permissions.includes("EDIT_MESSAGE")) mask |= 512;
        if (ap.permissions.includes("DELETE_MESSAGE")) mask |= 1024;
        if (ap.permissions.includes("ADD_REMOVE_MEMBER")) mask |= 2;
        if (ap.permissions.includes("ADD_ADMIN")) mask |= 4;
        if (ap.permissions.includes("CHANGE_CHAT_INFO")) mask |= 8;
        if (ap.permissions.includes("PIN_MESSAGE")) mask |= 16;
        return mask;
      }
    }
    if (chat.admins?.map(Number).includes(uidNum)) {
      return 256 | 512 | 1024 | 16 | 8 | 2 | 4;
    }
    return 0;
  })();
  $: canPostInChannel = Boolean(
    isChannel &&
    (isChannelOwner || (channelAdminPerms & 256) !== 0)
  );
  $: channelMuted = Boolean(chat && isChatMuted(chat));

  let togglingChannelMute = false;
  async function handleToggleChannelMute() {
    if (!chat?.id || togglingChannelMute) return;
    togglingChannelMute = true;
    try {
      const nextDDU = channelMuted ? 0 : -1;
      await $API.setChatMute(chat.id, nextDDU);
    } catch {}
    togglingChannelMute = false;
  }

  $: isChannelMember = Boolean(
    chat?.id &&
    ($currentRealChats || []).includes(chat.id) &&
    isChatInUserList(chat, $currentUser)
  );

  let subscribingChannel = false;
  async function handleChannelSubscribe() {
    if (subscribingChannel || !chat) return;
    subscribingChannel = true;
    try {
      const link = chat.link || (chat.id ? String(chat.id) : null);
      if (link) {
        await $API.joinChannel(link);
      }
    } catch (e) {
      console.error(e);
    } finally {
      subscribingChannel = false;
    }
  }

  function handleCloseChat() {
    scrollController?.saveCurrentPosition();
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
    if (e2eLayerId) {
      dismissLayer(e2eLayerId);
      e2eLayerId = null;
    }
    unregisterBack();
    clearSelection();
    scrollController?.destroy();
    virtualScroll.destroy();
  });

  const virtualScroll = createVirtualScrollManager();
  const { messageHeights, observeResize } = virtualScroll;

  let innerList;
  let visibleMessages = {};
  let containerWidth = 800;

  $: if (scrollElement) {
    containerWidth = scrollElement.clientWidth || containerWidth;
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
    virtualScroll.setDateSeparators(newSeparators);
  }

  let highlightedMessageId = null;
  let highlightTimer = null;

  function highlightMessage(id) {
    if (!id) return;
    highlightedMessageId = String(id);
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedMessageId = null;
      highlightTimer = null;
    }, 2200);
  }

  async function jumpAndHighlightMessage(messageId, messageTime = null) {
    if (!messageId) return false;
    const ok = await scrollController.jumpToMessage(messageId, messageTime, { offset: 80 });
    if (ok) {
      highlightMessage(messageId);
    }
    return ok;
  }

  let isSearchOpen = false;
  let searchQuery = "";
  let searchMatches = [];
  let searchMatchIndex = 0;

  function updateSearchMatches(query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) {
      searchMatches = [];
      searchMatchIndex = 0;
      return;
    }
    const list = $messages || [];
    const matched = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (!m || m.deleted) continue;
      const text = ($decodedMessages[m.id]?.text ?? m.text ?? "").toLowerCase();
      if (text.includes(q)) {
        matched.push({ id: m.id, time: m.time });
      }
    }
    searchMatches = matched;
    searchMatchIndex = 0;
    if (matched.length > 0) {
      jumpAndHighlightMessage(matched[0].id, matched[0].time);
    }
  }

  function handleSearchOpen() {
    isSearchOpen = true;
  }

  function handleSearchClose() {
    isSearchOpen = false;
    searchQuery = "";
    searchMatches = [];
    searchMatchIndex = 0;
  }

  function handleSearchQueryChange(e) {
    searchQuery = e.detail ?? "";
    updateSearchMatches(searchQuery);
  }

  function handleSearchNext() {
    if (!searchMatches.length) return;
    searchMatchIndex = (searchMatchIndex + 1) % searchMatches.length;
    const target = searchMatches[searchMatchIndex];
    jumpAndHighlightMessage(target.id, target.time);
  }

  function handleSearchPrev() {
    if (!searchMatches.length) return;
    searchMatchIndex = (searchMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    const target = searchMatches[searchMatchIndex];
    jumpAndHighlightMessage(target.id, target.time);
  }

  async function makeVisible(id) {
    if (!id) return;
    const key = String(id);
    if (!visibleMessages[key]) {
      visibleMessages = { ...visibleMessages, [key]: true };
      await tick();
    }
  }

  async function updateVisibleMessages() {
    if (scrollElement) {
      containerWidth = scrollElement.clientWidth || 800;
    }

    visibleMessages = virtualScroll.calculateVisibleMessages({
      scrollElement,
      messagesList: uniqueMessages,
      dateSeparatorsMap: dateSeparators,
    });

    if (scrollController?.userHasScrolled) {
      scrollController.checkUnreadMessagesOnScroll();
    }
  }

  let loader = null;

  const scrollController = createChatScrollController({
    getScrollElement: () => scrollElement,
    getInnerList: () => innerList,
    virtualScroll,
    getLoader: () => loader,
    getChat: () => chat,
    getChatId: () => chatId,
    getChatSettings: () => chatSettings,
    getCurrentUser: () => $currentUser,
    getMessages: () => $messages,
    getUniqueMessages: () => uniqueMessages,
    getVisibleMessages: () => visibleMessages,
    getDateSeparators: () => dateSeparators,
    updateVisibleMessages,
    makeVisible,
    getApi: () => $API,
    saveChats,
    getChatFromCache: getChat,
    onShowScrollDownChange: (val) => { showScrollDown = val; },
    onUnreadBadgeCountChange: (val) => { unreadBadgeCount = val; },
    onShowUnreadSeparatorChange: (val) => { showUnreadSeparator = val; },
    onUnreadAnchorIdChange: (val) => { unreadAnchorId = val; },
    onUserScrolled: () => {},
  });

  const decodedMessages = writable({});
  $: chatCache = getChat(chat?.id ?? chatId);
  $: if ((chat?.id ?? chatId) != null) registerDecodedMessagesStore(chat?.id ?? chatId, decodedMessages);

  loader = createMessagesLoader({
    messages,
    decodedMessages,
    getChatObj: () => chat,
    getChatId: () => chatId,
    getChatSettings: () => chatSettings,
    getChatCache: () => chatCache,
    getApi: () => $API,
    onAnchorCapture: () => scrollController.captureAnchor(),
    onAnchorRestore: () => scrollController.restoreAnchor(),
    onSecretChatRequest: (req) => { gotSecretChatRequest = req; },
    onStegoDecoded: async () => {
      await tick();
      virtualScroll.applyPendingHeights($messages);
      virtualScroll.computeCumulativeHeights($messages);
      await updateVisibleMessages();
    },
  });


  let unsubReceivedMessage = null;
  let unsubDeletedMessages = null;
  let unsubReactionUpdate = null;
  let currentSubscribedChatId = null;
  let lastProcessedMessageKey = null;

  $: targetChatId = chat?.id ?? chatId;
  $: if (targetChatId != null && targetChatId !== currentSubscribedChatId) {
    if (unsubReceivedMessage) {
      unsubReceivedMessage();
      unsubReceivedMessage = null;
    }
    if (unsubDeletedMessages) {
      unsubDeletedMessages();
      unsubDeletedMessages = null;
    }
    if (unsubReactionUpdate) {
      unsubReactionUpdate();
      unsubReactionUpdate = null;
    }
    if (unsubReactionUpdate) {
      unsubReactionUpdate();
      unsubReactionUpdate = null;
    }
    currentSubscribedChatId = targetChatId;
    const currentChatCache = getChat(targetChatId);
    if (currentChatCache?.reactionUpdate) {
      unsubReactionUpdate = currentChatCache.reactionUpdate.subscribe((reactionData) => {
        if (!reactionData || String(reactionData.chatId) !== String(targetChatId)) return;
        const { messageId, totalCount, counters, yourReaction } = reactionData;
        messages.update((_messages) => {
          let changed = false;
          const next = _messages.map((m) => {
            if (String(m.id) === String(messageId)) {
              changed = true;
              return {
                ...m,
                reactionInfo: {
                  counters: counters || [],
                  totalCount: Number(totalCount || 0),
                  yourReaction: yourReaction ?? (totalCount === 0 ? null : m.reactionInfo?.yourReaction),
                },
              };
            }
            return m;
          });
          return changed ? next : _messages;
        });
      });
    }
    if (currentChatCache?.deletedMessages) {
      unsubDeletedMessages = currentChatCache.deletedMessages.subscribe(async (delData) => {
        if (!delData || String(delData.chatId) !== String(targetChatId)) return;
        const ids = new Set((delData.messageIds || []).map(String));
        if (ids.size === 0) return;
        messages.update((_messages) => {
          let changed = false;
          const next = _messages.map((m) => {
            if (ids.has(String(m.id)) && !m.deleted) {
              changed = true;
              return {
                ...m,
                deleted: true,
                deleted_at: m.deleted_at || Date.now(),
              };
            }
            return m;
          });
          return changed ? next : _messages;
        });
        await tick();
        virtualScroll.applyPendingHeights($messages);
        virtualScroll.computeCumulativeHeights($messages);
        await updateVisibleMessages();
      });
    }
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

        if (message.status === "REMOVED" || message.deleted) {
          messages.update((_messages) => {
            const idx = _messages.findIndex((x) => String(x.id) === String(message.id));
            if (idx !== -1) {
              const old = _messages[idx];
              _messages[idx] = {
                ...old,
                deleted: true,
                deleted_at: old.deleted_at || Date.now(),
              };
            }
            return _messages;
          });
          await tick();
          virtualScroll.applyPendingHeights($messages);
          virtualScroll.computeCumulativeHeights($messages);
          await updateVisibleMessages();
          return;
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
            const idx = _messages.findIndex(
              (x) =>
                String(x.id) === String(message.id) ||
                (message.cid != null && x.cid != null && String(x.cid) === String(message.cid))
            );
            if (idx !== -1) {
              const old = _messages[idx];
              _messages[idx] = {
                ...old,
                ...message,
                elements: (message?.elements && message.elements.length > 0)
                  ? message.elements
                  : (old.elements || []),
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
        } else {
          await loader.decodeMessagesBatch([message]);
        }
      });
    }
  }

  async function handleCallHandshakeEvent(ev) {
    const detail = ev?.detail;
    const activeId = chatId ?? chat?.id;
    if (!detail?.packetBase64 || activeId == null) return;
    if (detail.chatId != null && Number(detail.chatId) !== Number(activeId) && Number(detail.peerId) !== Number(avatarUserId)) {
      return;
    }
    try {
      const bin = atob(detail.packetBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dto = await verifyHandshakePacket(bytes, activeId).catch(() => null);
      if (!dto || (!dto.is_handshake_request && !dto.is_handshake_accept)) return;
      const syntheticId = `call_hs_${Date.now()}`;
      const syntheticMsg = { id: syntheticId, sender: detail.peerId || avatarUserId, time: Date.now() };
      const req = await checkForEncryptionRequest(
        chat,
        chatSettings,
        { [syntheticId]: dto },
        [syntheticMsg],
        decodedMessages,
        [...($messages || []), syntheticMsg]
      );
      if (req) gotSecretChatRequest = req;
    } catch {}
  }

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("e2e-call-handshake", handleCallHandshakeEvent);
    }
    window.removeEventListener("mouseup", stopDrag);
    window.removeEventListener("blur", stopDrag);
    if (unsubReceivedMessage) {
      unsubReceivedMessage();
      unsubReceivedMessage = null;
    }
    if (unsubDeletedMessages) {
      unsubDeletedMessages();
      unsubDeletedMessages = null;
    }
    if (unsubReactionUpdate) {
      unsubReactionUpdate();
      unsubReactionUpdate = null;
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

  $: messageGroupInfo = (() => {
    const list = uniqueMessages || [];
    const info = {};
    for (let i = 0; i < list.length; i++) {
      const curr = list[i];
      if (!curr) continue;
      const prev = i > 0 ? list[i - 1] : null;
      const next = i < list.length - 1 ? list[i + 1] : null;

      const isCurrSystem = Boolean(curr.attaches?.some((x) => x._type === "CONTROL") || curr.type === "SYSTEM");
      const hasDateSep = Boolean(dateSeparators[curr.id]);

      let isPrevSame = false;
      if (prev && !hasDateSep && !isCurrSystem) {
        const isPrevSystem = Boolean(prev.attaches?.some((x) => x._type === "CONTROL") || prev.type === "SYSTEM");
        if (!isPrevSystem && String(prev.sender) === String(curr.sender)) {
          const diff = Math.abs((curr.time || 0) - (prev.time || 0));
          if (diff <= 300000) {
            isPrevSame = true;
          }
        }
      }

      let isNextSame = false;
      if (next && !isCurrSystem) {
        const nextHasDateSep = Boolean(dateSeparators[next.id]);
        if (!nextHasDateSep) {
          const isNextSystem = Boolean(next.attaches?.some((x) => x._type === "CONTROL") || next.type === "SYSTEM");
          if (!isNextSystem && String(next.sender) === String(curr.sender)) {
            const diff = Math.abs((next.time || 0) - (curr.time || 0));
            if (diff <= 300000) {
              isNextSame = true;
            }
          }
        }
      }

      info[curr.id] = {
        isFirstInGroup: !isPrevSame,
        isLastInGroup: !isNextSame,
        isConsecutive: isPrevSame,
      };
    }
    return info;
  })();

  let dismissedReportBanners = new Set();
  $: isGroupOwner = Boolean(
    chat &&
    $currentUser != null &&
    (Number(chat.owner || chat.ownerId) === Number($currentUser))
  );
  $: showReportLeaveBanner = Boolean(
    chat &&
    (chat.type === "CHAT" || chat.type === "GROUP") &&
    !isGroupOwner &&
    !dismissedReportBanners.has(chat.id)
  );

  function handleReportAndLeave() {
    complaintMessage = { id: 0 };
  }

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
      if (response?.error) {
        showAlert(parseApiError(response));
        return;
      }
      const message = response?.message;
      if (message && typeof message === "object") {
        const msgCopy = { ...message, status: 1 };
        chatCache.receivedMessage.set(msgCopy);
        chatCache.updateMessages([msgCopy]);
        messages.update((msgs) => {
          if (msgs.some((m) => m.id === msgCopy.id)) return msgs;
          return [...msgs, msgCopy];
        });
      } else {
        const sendResp = await $API.sendMessage("/start", chat.id, { notify: true });
        if (sendResp?.error) {
          showAlert(parseApiError(sendResp));
        }
      }
    } catch (e) {
      console.error("handleBotStart error:", e);
      showAlert(parseApiError(e));
    } finally {
      botStarting = false;
    }
  }

  let isMountedReady = false;
  $: if (isMountedReady && $pendingChatJump) {
    const activeId = String(chat?.id ?? chatId ?? "");
    if (activeId && String($pendingChatJump.chatId) === activeId) {
      const jump = $pendingChatJump;
      clearPendingChatJump(activeId);
      jumpAndHighlightMessage(jump.messageId, jump.time);
    }
  }

  onMount(async () => {
    if (typeof window !== "undefined") {
      window.addEventListener("e2e-call-handshake", handleCallHandshakeEvent);
    }
    const queuedHs = consumeCallHandshake(chatId ?? chat?.id, avatarUserId);
    if (queuedHs) {
      handleCallHandshakeEvent({ detail: queuedHs });
    }
    scrollController.isInitialMounting = true;
    scrollController.isProgrammaticScroll = true;

    const targetChatId = chatId ?? chat?.id;
    const currentChat = get(getChat(targetChatId).chatInfo) || chat;
    const unreadCount = Number(currentChat?.newMessages || 0);
    const savedPos = getChatScroll(targetChatId);
    const hasSavedScroll = savedPos && !savedPos.wasAtBottom && savedPos.bottomMessageTime;

    const initialJump = get(pendingChatJump);
    const hasTargetJump = Boolean(
      initialJump &&
      String(initialJump.chatId) === String(targetChatId) &&
      (initialJump.messageId != null || initialJump.time != null)
    );
    if (hasTargetJump) {
      clearPendingChatJump(targetChatId);
    }

    clearChatNotification(targetChatId);

    if (scrollElement) {
      containerWidth = scrollElement.clientWidth || 800;
    }

    virtualScroll.setupResizeObserver(
      () => scrollElement,
      () => !scrollController.isInitialMounting && !scrollController.isProgrammaticScroll && scrollController.userHasScrolled
    );
    scrollController.startAutoScrollIfAtBottom(hasSavedScroll, unreadCount, hasTargetJump);

    let initialFrom = Date.now() + sessionGet("drift");
    if (hasTargetJump && initialJump.time != null) {
      initialFrom = Number(initialJump.time) + 1;
      loader.all_loaded_newer = false;
      showScrollDown = true;
      await loader.loadHistory(true, initialFrom, 20, 20);
    } else if (hasSavedScroll) {
      initialFrom = Number(savedPos.bottomMessageTime) + 1;
      loader.all_loaded_newer = false;
      showScrollDown = true;
      await loader.loadHistory(true, initialFrom, BATCH_SIZE, BATCH_SIZE);
    } else if (unreadCount > 0) {
      const myId = Number($currentUser);
      const myMark = Number(currentChat?.participants?.[myId] || 0);
      if (myMark > 0 && unreadCount >= BATCH_SIZE) {
        initialFrom = myMark + 1;
        loader.all_loaded_newer = false;
        showScrollDown = true;
        await loader.loadHistory(true, initialFrom, BATCH_SIZE, BATCH_SIZE);
      } else {
        loader.all_loaded_newer = true;
        await loader.loadHistory(true, initialFrom, BATCH_SIZE, 0);
      }
    } else {
      loader.all_loaded_newer = true;
      await loader.loadHistory(true, initialFrom, BATCH_SIZE, 0);
    }

    await tick();

    virtualScroll.measureAllHeights(innerList, containerWidth);
    virtualScroll.computeCumulativeHeights($messages, containerWidth, dateSeparators);

    scrollController.resolveUnreadState(unreadCount);

    let positioned = false;
    if (hasTargetJump && initialJump.messageId) {
      positioned = await scrollController.scrollToMessage(initialJump.messageId, { offset: 80 });
      if (positioned) {
        highlightMessage(initialJump.messageId);
      }
    } else if (hasSavedScroll) {
      const isSavedScrollOlderThanUnread = !scrollController.unreadStartTime || Number(savedPos.bottomMessageTime) < scrollController.unreadStartTime;
      if (isSavedScrollOlderThanUnread) {
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
        if (targetId) {
          positioned = await scrollController.scrollToMessage(targetId, {
            offset: savedPos.offset != null ? savedPos.offset : 40,
          });
        }
        if (!positioned && savedPos.scrollTop != null && scrollElement) {
          scrollElement.scrollTop = savedPos.scrollTop;
          positioned = true;
        }
        if (!positioned && !loader.all_loaded_newer) {
          const msgs = $messages;
          if (msgs.length > 0) {
            const mid = msgs[Math.floor(msgs.length / 2)].id;
            await scrollController.scrollToMessage(mid, { offset: 40 });
            positioned = true;
          }
        }
      }
    }

    if (!positioned && unreadCount > 0) {
      positioned = await scrollController.scrollToUnreadBanner();
    }

    if (!positioned) {
      await scrollController.scrollToBottomDirect();
    }

    await tick();
    await updateVisibleMessages();

    await new Promise((r) => setTimeout(r, 60));
    allRendered = true;
    await tick();
    if (!hasSavedScroll && !hasTargetJump && unreadCount === 0 && scrollElement && !scrollController.userHasScrolled) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
      showScrollDown = false;
    }
    scrollController.isInitialMounting = false;
    scrollController.isProgrammaticScroll = false;
    isMountedReady = true;
    window.addEventListener("mouseup", stopDrag);
    window.addEventListener("blur", stopDrag);
  });

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
      lastDropoutClosedAt = Date.now();
    }

    if (attachesDropout && !e.target.closest(".attaches-bottom-sheet, .attaches-dropout, .attaches-sheet-backdrop, .portal-sheet-wrapper, .portal-layer-sheet-container") && !e.target.closest(".input-button") && !e.target.closest(".attach-toggle-btn")) {
      attachesDropout = null;
    }
  }

  let justOpenedDropout = false;
  let lastDropoutClosedAt = 0;

  function selectMessage(e, msg) {
    if (Date.now() - lastDropoutClosedAt < 400) return;
    const isContextOrLongPress = e?.type === "contextmenu" || e?.isLongPress;
    if (
      e?.target?.closest?.("a") ||
      e?.target?.closest?.(".rich-link") ||
      e?.target?.closest?.(".link-dropout-card") ||
      e?.target?.closest?.(".dropout-backdrop") ||
      e?.target?.closest?.(".avatar-msg-btn") ||
      e?.target?.closest?.(".inline-btn") ||
      e?.target?.closest?.(".media-download-badge") ||
      (!isContextOrLongPress && (
        e?.target?.closest?.("img") ||
        e?.target?.closest?.("video") ||
        e?.target?.closest?.(".reply-block") ||
        e?.target?.closest?.(".forward-block") ||
        e?.target?.closest?.(".inline-keyboard") ||
        e?.target?.closest?.(".avatar-wrapper") ||
        e?.target?.closest?.(".media-grid") ||
        e?.target?.closest?.(".grid-item") ||
        e?.target?.closest?.(".attaches") ||
        e?.target?.closest?.(".file-attachment") ||
        e?.target?.closest?.(".file-attach") ||
        e?.target?.closest?.(".attach") ||
        e?.target?.closest?.(".encrypted-media-placeholder")
      ))
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
    lastDropoutClosedAt = Date.now();

    const action = e.detail?.action;
    if (action === "reaction") {
      const target = e.detail?.msg || currentMsg;
      if (target?.id && target.reactionInfo) {
        messages.update((items) => {
          const item = items.find((x) => String(x.id) === String(target.id));
          if (item) {
            item.reactionInfo = target.reactionInfo;
          }
          return [...items];
        });
      } else {
        messages.update((x) => [...x]);
      }
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
    if (Date.now() - lastDropoutClosedAt < 400) return;
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
      isLongPress: true,
    };
    selectMessage(fakeEvent, msg);
  }

  function handleMessageContextMenu(msg, e) {
    if (!msg) return;
    if (e.target.closest("a, .rich-link, .link-dropout-card, .dropout-backdrop, input, textarea")) return;
    if ($isSelecting) {
      toggleMessageSelection(msg.id);
    } else {
      selectMessage(e, msg);
    }
  }

  async function handleCopyMedia(msg) {
    if (!msg) return;
    const photo = msg.attaches?.find(a => (a._type || a.type) === "PHOTO");
    if (photo) {
      try {
        const url = photo.baseUrl || photo.url;
        if (url && navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        }
      } catch (err) {
        console.error("Failed to copy media:", err);
      }
    }
  }

  async function handleSaveMedia(msg) {
    if (!msg) return;
    const media = msg.attaches?.find(a => {
      const t = a._type || a.type;
      return t === "PHOTO" || t === "VIDEO" || t === "FILE" || t === "AUDIO";
    });
    if (media) {
      try {
        const url = media.baseUrl || media.url;
        if (url) {
          const a = document.createElement("a");
          a.href = url;
          a.download = media.name || "media";
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (err) {
        console.error("Failed to save media:", err);
      }
    }
  }

  async function handleShareLink(msg) {
    if (!msg) return;
    try {
      const link = `https://max.im/c/${chat?.id || chatId}/${msg.id}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      }
    } catch (err) {
      console.error("Failed to copy share link:", err);
    }
  }

  function handleOpenComments(msg) {
    if (!msg) return;
    openChat(chat?.id || chatId, msg.id);
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

  let pinnedMessagesList = [];
  let showPinnedListModal = false;
  let lastPinnedFetchKey = "";

  $: {
    const cid = chat?.id ?? chatId;
    const state = chat?.pinnedMessagesState;
    const count = Number(state?.count || 0);
    const key = `${cid}_${count}_${state?.lastMessageId || chat?.pinnedMessage?.id || ""}`;
    if (cid && count > 1 && key !== lastPinnedFetchKey && typeof $API?.getPinnedMessages === "function") {
      lastPinnedFetchKey = key;
      $API.getPinnedMessages(cid).then((res) => {
        if (Array.isArray(res?.pinnedMessages) && res.pinnedMessages.length > 0) {
          pinnedMessagesList = res.pinnedMessages;
        }
      }).catch(() => {});
    } else if (count <= 1) {
      pinnedMessagesList = chat?.pinnedMessage ? [chat.pinnedMessage] : [];
    }
  }

  async function handleUnpinMessage(msgId) {
    try {
      await $API.unpinMessage(chat.id);
      const updatedChat = {
        ...chat,
        pinnedMessage: null,
      };
      getChat(chat.id).chatInfo.set(updatedChat);
      await saveChats([ updatedChat ]);
      showAlert("Сообщение откреплено");
    } catch (e) {
      console.error("Failed to unpin message:", e);
    }
  }

  function openSettings() {
    const targetChatId = chat?.id ?? chatId;
    if (chat?.type === "DIALOG" || (!chat && avatarUserId)) {
      openProfile({ chatId: targetChatId, userId: avatarUserId, view: "settings" });
    } else if (targetChatId) {
      openProfile({ chatId: targetChatId, view: "settings" });
    }
  }

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

  let isUnsentMediaViewer = false;

  $: if (viewerOpen && !isUnsentMediaViewer) {
    allMedia = computeAllMedia();
  }

  function handleUnsentMediaPreview(e) {
    const { attach, attaches, originEl } = e.detail || {};
    if (!attach || !attaches) return;

    const mediaAttaches = attaches.filter((a) => {
      const t = getAttachType(a);
      return t === "PHOTO" || t === "VIDEO";
    });

    if (mediaAttaches.length === 0) return;

    const list = mediaAttaches.map((a, idx) => {
      const type = getAttachType(a);
      const local = a.localPath || a.path || "";
      const base = local || a.baseUrl || a.url || "";
      return {
        _type: type,
        type,
        uid: String(local || base || `unsent_${idx}`),
        localPath: local,
        baseUrl: base,
        path: local,
        name: a.name || (local ? local.split("/").pop() : (type === "PHOTO" ? "photo.jpg" : "video.mp4")),
        time: Date.now() / 1000,
        duration: a.duration || 0,
        width: a.width,
        height: a.height
      };
    });

    const targetKey = String(attach.localPath || attach.path || attach.baseUrl || attach.url || "");
    const targetIdx = list.findIndex((m) => targetKey && (m.localPath === targetKey || m.baseUrl === targetKey || m.uid === targetKey));

    allMedia = list;
    viewerIndex = targetIdx !== -1 ? targetIdx : 0;
    viewerOriginEl = originEl || null;
    isUnsentMediaViewer = true;
    viewerOpen = true;
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
        isUnsentMediaViewer = false;
      }}
    />
  {/if}

  <div class="chat-header-container">
    <ChatHeader
      {chat}
      {avatarUserId}
      {title}
      {isSearchOpen}
      {searchQuery}
      searchMatchCount={searchMatches.length}
      {searchMatchIndex}
      on:close={handleCloseChat}
      on:openSettings={openSettings}
      on:search={handleSearchOpen}
      on:closeSearch={handleSearchClose}
      on:searchQueryChange={handleSearchQueryChange}
      on:searchPrev={handleSearchPrev}
      on:searchNext={handleSearchNext}
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

  {#if chat?.pinnedMessage || pinnedMessagesList.length > 0}
    <PinnedMessage
      msg={chat?.pinnedMessage}
      messages={pinnedMessagesList}
      {chat}
      canUnpin={canPinInChat(chat, $currentUser)}
      on:jump={(e) => jumpAndHighlightMessage(e.detail.id, e.detail.time ?? chat?.pinnedMessage?.time)}
      on:unpin={(e) => handleUnpinMessage(e.detail.id)}
      on:openList={() => (showPinnedListModal = true)}
    />
  {/if}

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

  {#if showReportLeaveBanner}
    <div class="group-report-leave-banner">
      <div class="banner-spacer"></div>
      <button class="group-report-leave-btn" type="button" on:click={handleReportAndLeave}>
        Выйти и пожаловаться
      </button>
      <button
        class="group-report-dismiss-btn"
        type="button"
        on:click={() => {
          dismissedReportBanners.add(chat.id);
          dismissedReportBanners = dismissedReportBanners;
        }}
        aria-label="Скрыть баннер"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  {/if}

  <div
    on:scroll={scrollController.handleScroll}
    on:wheel|passive={() => { scrollController.userHasScrolled = true; }}
    on:touchstart|passive={() => { scrollController.userHasScrolled = true; }}
    on:mousedown={startDrag}
    on:mouseleave={stopDrag}
    on:mouseup={mouseUp}
    on:mousemove={moveDrag}
    bind:this={scrollElement}
    class="message-list-container grab-scroll"
    class:no-input={chat.type === "CHANNEL" || showBotStart}
    id="scroll"
  >
    {#each $pluginChatBackground as item (item.id)}
      <div class="plugin-chat-background" data-plugin-mount={item.pluginId || item.id}>
        {@html item.html}
      </div>
    {/each}

    <div
      class="message-list-inner"
      style={"opacity: " + (allRendered ? "1;" : "0;")}
      bind:this={innerList}
    >
      <div style="flex-shrink: 0; height: 10px;"></div>

      {#if (chat?.type === "CHAT" || chat?.type === "GROUP")}
        <div class="group-hero-card">
          <div class="group-hero-avatar">
            <Avatar {chat} size={71} allowStories={false} showOnline={false} />
          </div>
          <div class="group-hero-title">{chat.title || chat.name || "Группа"}</div>
          <div class="group-hero-subtitle">
            Можно общаться, ставить реакции<br />и делиться файлами
          </div>
        </div>
      {/if}

      {#each uniqueMessages as msg (msg.id)}
        {#if showUnreadSeparator && unreadAnchorId && String(msg.id) === String(unreadAnchorId)}
          <div
            id="unread-separator"
            class="unread-separator"
          >
            <div class="unread-separator-line"></div>
            <span class="unread-separator-text">Непрочитанные сообщения</span>
            <div class="unread-separator-line"></div>
          </div>
        {/if}
        <div
          class="message-wrapper"
          class:is-selected={$selectionState.selected.has(String(msg.id))}
          class:is-highlighted={highlightedMessageId === String(msg.id)}
          id={"m-" + msg.id}
          on:click={() => {
            if (justLongPressed) return;
            if ($isSelecting) toggleMessageSelection(msg.id);
          }}
        >
          {#if visibleMessages[msg.id]}
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
                {isBot}
                {dropoutActiveAt}
                {scrollElement}
                {otherReadTime}
                makeVisible={makeVisible}
                decoded={$decodedMessages[msg.id]}
                selected={$selectionState.selected.has(String(msg.id))}
                selectionMode={$isSelecting}
                isFirstInGroup={messageGroupInfo[msg.id]?.isFirstInGroup ?? true}
                isLastInGroup={messageGroupInfo[msg.id]?.isLastInGroup ?? true}
                isConsecutive={messageGroupInfo[msg.id]?.isConsecutive ?? false}
                on:openMedia={(e) => openMedia(e.detail.attach, e.detail.originEl)}
                on:openChat={() => openChat(chat.id, msg.id)}
                on:openStickerPack={(e) => handleOpenStickerPack(e.detail.sticker)}
                on:openHistory={(e) => (historyModalMessage = e.detail.msg)}
                on:react={handleMessageReact}
                on:toggleSelect={(e) => toggleMessageSelection(e.detail.id)}
                on:messageClick={(e) => handleMessageClick(e.detail.msg, e.detail.e)}
                on:longpress={(e) => handleMessageLongPress(e.detail.msg, e.detail)}
                on:contextmenu={(e) => handleMessageContextMenu(e.detail.msg, e.detail.e)}
                on:openComments={(e) => handleOpenComments(e.detail.msg)}
                on:forward={(e) => handleStartForward([e.detail.msg])}
                on:failedClick={(e) => (failedActionMessage = e.detail)}
              />
            </div>
          {:else}
            <div class="placeholder" style="width:100%; height:{virtualScroll.getHeight(msg, containerWidth, Boolean(dateSeparators[msg.id]))}px;"></div>
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
    on:seenBy={(e) => (seenByModalData = e.detail)}
    on:copyText={(e) => handleCopyText(e.detail.msg)}
    on:copyMedia={(e) => handleCopyMedia(e.detail.msg)}
    on:saveMedia={(e) => handleSaveMedia(e.detail.msg)}
    on:shareLink={(e) => handleShareLink(e.detail.msg)}
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

  {#if seenByModalData}
    <SeenByModal
      chat={chat}
      msg={seenByModalData.msg}
      readers={seenByModalData.readers}
      on:close={() => (seenByModalData = null)}
    />
  {/if}

  {#if failedActionMessage}
    <BottomSheet
      title="Не удалось отправить сообщение"
      maxHeight="40vh"
      on:close={() => (failedActionMessage = null)}
    >
      <div class="failed-msg-sheet">
        {#if failedActionMessage.error}
          <div class="failed-msg-error">{failedActionMessage.error}</div>
        {/if}
        <button type="button" class="failed-msg-btn primary" on:click={handleRetryFailedMessage}>
          Повторить отправку
        </button>
        <button type="button" class="failed-msg-btn danger" on:click={handleDeleteFailedMessage}>
          Удалить
        </button>
      </div>
    </BottomSheet>
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
  {:else if isChannel && !isChannelMember}
    <div class="channel-preview-bar">
      <button
        type="button"
        class="channel-footer-btn channel-subscribe-btn"
        disabled={subscribingChannel}
        on:click={handleChannelSubscribe}
      >
        {subscribingChannel ? "Подписка..." : "Подписаться"}
      </button>
    </div>
  {:else if isChannel && !canPostInChannel}
    <button
      type="button"
      class="channel-mute-fab"
      disabled={togglingChannelMute}
      on:click={handleToggleChannelMute}
      title={channelMuted ? "Включить уведомления" : "Отключить уведомления"}
      aria-label={channelMuted ? "Включить уведомления" : "Отключить уведомления"}
    >
      <span
        class="mask-icon channel-mute-fab-icon"
        style="-webkit-mask-image: url('{channelMuted ? '/icons/mute.svg' : '/icons/bell.svg'}'); mask-image: url('{channelMuted ? '/icons/mute.svg' : '/icons/bell.svg'}');"
      ></span>
    </button>
  {:else if $chatSettings}
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
      on:previewMedia={handleUnsentMediaPreview}
    />
  {/if}

  {#each $pluginChatFooter as item (item.id)}
    <div class="plugin-chat-footer" data-plugin-mount={item.pluginId || item.id}>
      {@html item.html}
    </div>
  {/each}

  <ScrollDownButton
    {showScrollDown}
    chatType={chat.type}
    hasReply={!!replyTo}
    {showStickerPanel}
    {unreadBadgeCount}
    on:click={scrollController.jumpToBottom}
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

  {#if showPinnedListModal}
    <BottomSheet
      title="Закреплённые сообщения ({pinnedMessagesList.length})"
      on:close={() => (showPinnedListModal = false)}
    >
      <div class="pinned-list-sheet">
        {#each pinnedMessagesList as pmsg (pmsg.id)}
          <div
            class="pinned-list-item"
            role="button"
            tabindex="0"
            on:click={() => {
              showPinnedListModal = false;
              jumpAndHighlightMessage(pmsg.id, pmsg.time);
            }}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                showPinnedListModal = false;
                jumpAndHighlightMessage(pmsg.id, pmsg.time);
              }
            }}
          >
            <div class="pinned-list-preview">
              <MessagePreview {chat} msg={pmsg} />
            </div>
            {#if canPinInChat(chat, $currentUser)}
              <button
                type="button"
                class="pinned-list-unpin"
                title="Открепить"
                aria-label="Открепить"
                on:click|stopPropagation={() => handleUnpinMessage(pmsg.id)}
              >
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 16px; height: 16px;"></span>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    </BottomSheet>
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
    z-index: var(--z-chat, 3);
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    max-height: 100%;
    background-color: var(--bg-chat, #161621);
    isolation: isolate;
    padding-top: 0;
    padding-bottom: 0;
  }

  .chat-window::before {
    content: "";
    position: absolute;
    inset: 0;
    background-image: var(--bg-chat-pattern, none);
    background-repeat: repeat;
    background-size: 360px 360px;
    filter: brightness(0) invert(var(--icon-invert, 1));
    opacity: 0.08;
    pointer-events: none;
    z-index: -1;
  }

  .chat-window.is-selecting,
  .chat-window.is-selecting * {
    user-select: none !important;
    -webkit-user-select: none !important;
    -webkit-user-drag: none !important;
  }

  .chat-window.animating {
    transition: transform 0.22s cubic-bezier(0.25, 1, 0.5, 1);
    will-change: transform;
  }

  .chat-window.swiping {
    transition: none;
    will-change: transform;
  }

  .message-list-container {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    display: block;
    overflow-anchor: none;
    overflow-x: hidden;
    contain: content;
  }

  .message-list-container.no-input {
    padding-bottom: calc(16px + var(--safe-bottom, 0px));
  }

  .message-list-inner {
    width: 100%;
    display: flex;
    gap: 0;
    flex-direction: column;
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
    contain: layout style paint;
  }

  .message-wrapper.is-selected {
    background: transparent;
    border-radius: 0;
  }

  .message-wrapper.is-highlighted {
    animation: msgJumpHighlight 2.2s ease-out forwards;
  }

  .pinned-list-sheet {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .pinned-list-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .pinned-list-item:hover {
    background: var(--hover-bg, rgba(255, 255, 255, 0.06));
  }

  .pinned-list-preview {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    color: var(--text-primary, #f4f4f6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pinned-list-unpin {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary, rgba(255, 255, 255, 0.6));
    cursor: pointer;
  }

  .pinned-list-unpin:hover {
    background: var(--hover-bg, rgba(255, 255, 255, 0.1));
    color: var(--text-primary, #ffffff);
  }

  @keyframes msgJumpHighlight {
    0% {
      background: var(--accent-subtle-hover);
    }
    70% {
      background: var(--accent-subtle);
    }
    100% {
      background: transparent;
    }
  }

  .observer-area {
    position: relative;
    width: 100%;
    display: flow-root;
  }

  .chat-header-container {
    position: relative;
    width: 100%;
    z-index: var(--z-header, 4);
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
    padding: var(--safe-top, 0px) 12px 0;
    box-sizing: border-box;
    border-bottom: 1px solid #333;
    z-index: var(--z-floating, 5);
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

  .unread-separator {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--msg-unread-padding, 8px 16px);
    margin: var(--msg-unread-margin, 8px 0);
    width: 100%;
    box-sizing: border-box;
    user-select: none;
    -webkit-user-select: none;
    flex-shrink: 0;
    background: var(--msg-unread-bar-bg, rgba(59, 130, 246, 0.12));
    border-radius: var(--msg-unread-bar-radius, 0px);
  }

  .unread-separator-text {
    font-size: var(--msg-unread-font-size, 13px);
    font-weight: 500;
    color: var(--msg-unread-bar-text, var(--accent-primary, #3b82f6));
    white-space: nowrap;
    text-align: center;
    letter-spacing: 0.15px;
  }

  .channel-preview-bar {
    width: 100%;
    padding: 8px 16px calc(10px + var(--safe-bottom, 0px));
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface, #1e2025);
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    flex-shrink: 0;
  }

  .channel-footer-btn {
    width: 100%;
    max-width: 480px;
    height: 44px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: opacity 0.15s ease, background 0.15s ease, transform 0.1s ease;
  }

  .channel-footer-btn:active {
    transform: scale(0.98);
  }

  .channel-footer-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .channel-subscribe-btn {
    background: var(--accent-primary, #248bfe);
    color: #ffffff;
    border: none;
  }

  .channel-subscribe-btn:hover {
    background: var(--accent-primary-hover, #1b74d9);
  }

  /* Channel Mute FAB (1-to-1 with MAX i3d.java / y7d.java) */
  .channel-mute-fab {
    position: fixed;
    left: 12px;
    bottom: calc(16px + var(--safe-bottom, 0px));
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface-elevated);
    color: var(--icon-primary);
    box-shadow: var(--shadow-card);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: var(--z-floating, 5);
    padding: 0;
    transition: background-color 0.15s ease, transform 0.12s ease;
  }

  .channel-mute-fab:hover:not(:disabled) {
    background: var(--bg-surface-secondary);
  }

  .channel-mute-fab:active:not(:disabled) {
    transform: scale(0.94);
  }

  .channel-mute-fab:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .channel-mute-fab-icon {
    width: 22px;
    height: 22px;
  }

  /* Group Report / Leave Banner (Matching MAX PinBarsWidget & abd.java) */
  .group-report-leave-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px 6px 16px;
    background: var(--bg-surface, #1e2025);
    border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    flex-shrink: 0;
    z-index: var(--z-header, 4);
    min-height: 48px;
    box-sizing: border-box;
  }

  .banner-spacer {
    width: 32px;
    flex-shrink: 0;
  }

  .group-report-leave-btn {
    background: rgba(255, 255, 255, 0.08);
    border: none;
    border-radius: 12px;
    color: #eb5757;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    padding: 8px 18px;
    min-height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    max-width: 280px;
    margin: 0 auto;
    transition: background 0.15s ease, transform 0.1s ease;
  }

  .group-report-leave-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .group-report-leave-btn:active {
    background: rgba(255, 255, 255, 0.16);
    transform: scale(0.98);
  }

  .group-report-dismiss-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .group-report-dismiss-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  /* Group Welcome Hero Card (exact 1-to-1 from zb3.java, fw0.java, he9.java) */
  .group-hero-card {
    background: linear-gradient(135deg, rgba(33, 42, 43, 0.64) 0%, rgba(33, 42, 43, 0.88) 100%);
    border: 2px solid rgba(56, 62, 69, 0.44);
    border-radius: 24px;
    padding: 20px 24px 24px 24px;
    margin: 24px auto;
    min-width: 296px;
    max-width: 320px;
    width: fit-content;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
  }

  .group-hero-avatar {
    margin-bottom: 12px;
  }

  .group-hero-title {
    color: #ffffff;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.25;
    margin-bottom: 8px;
    word-break: break-word;
  }

  .group-hero-subtitle {
    color: rgba(255, 255, 255, 0.65);
    font-size: 13px;
    line-height: 1.35;
    font-weight: 400;
    max-width: 250px;
    margin: 0 auto;
    text-align: center;
  }

  .failed-msg-sheet {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 16px 20px;
  }

  .failed-msg-error {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.65);
    margin-bottom: 4px;
  }

  .failed-msg-btn {
    width: 100%;
    height: 44px;
    border: none;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }

  .failed-msg-btn.primary {
    background: var(--accent-color, #2563eb);
    color: #ffffff;
  }

  .failed-msg-btn.danger {
    background: rgba(239, 68, 68, 0.16);
    color: #ef4444;
  }
</style>
