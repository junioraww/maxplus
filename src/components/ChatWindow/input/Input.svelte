<script>
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { platform } from "@tauri-apps/plugin-os";
  import { tick, onMount, onDestroy, createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import { pluginOn, pluginOff } from "$lib/plugins/events";
  import { getMountStore } from "$lib/plugins/mount-registry";

  const dispatch = createEventDispatcher();

  const pluginInputLeft = getMountStore("input:action-left");
  const pluginInputRight = getMountStore("input:action-right");
  const pluginInputAction = getMountStore("input:action");

  import { scrollToBottom } from "$lib/utils/scroll";
  import { registerBackHandler } from "$lib/utils/backButton";
  import { sendMessage, forwardMessages } from "$components/ChatWindow/actions";
  import Reply from "$components/ChatWindow/input/Reply.svelte";
  import ForwardPreview from "$components/ChatWindow/input/ForwardPreview.svelte";
  import { forwardDraft, clearForwardDraft } from "$lib/stores/forwardDraft";
  import { getChatDraft, setChatDraft, clearChatDraft, chatDrafts } from "$lib/stores/drafts";
  import BotCommandsMenu from "$components/ChatWindow/BotCommandsMenu.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { searchStickers } from "$lib/stores/stickers";
  import { keyboardOpen, keyboardHeight } from "$lib/stores/keyboard";
  import { showAlert } from "$lib/utils/alert";
  import StickerSuggestionsDropout from "$components/ChatWindow/Stickers/StickerSuggestionsDropout.svelte";
  import StickerPanel from "$components/ChatWindow/Stickers/StickerPanel.svelte";
  import { generateWaveformFromAmplitudes } from "$lib/utils/waveform";
  import { stopCurrentMedia } from "$lib/stores/mediaPlayback";
  import { computeTextDiff, computeAttachesDiff } from "$lib/utils/diff";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import { openVideoCropModal, closeVideoCropModal } from "$lib/stores/videoCrop";
  import { encodeAudioBufferToOggOpus } from "$lib/utils/audioEncoder";
  import { encryptMediaAttachment } from "$lib/crypto/messages";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { safetyLockouts, isChatSafetyLocked } from "$lib/stores/e2eSafety";

  import SelectedAttaches from "$components/ChatWindow/input/SelectedAttaches.svelte";
  import EditingBanner from "$components/ChatWindow/input/EditingBanner.svelte";
  import AttachesMenu from "$components/ChatWindow/input/AttachesMenu.svelte";
  import PollCreateScreen from "$components/ChatWindow/PollCreateScreen.svelte";
  import LocationPickerScreen from "$components/ChatWindow/LocationPickerScreen.svelte";
  import ContactPickerScreen from "$components/ChatWindow/ContactPickerScreen.svelte";
  import { openScreen } from "$lib/services/layerManager";
  import VoiceReviewPanel from "$components/ChatWindow/input/VoiceReviewPanel.svelte";
  import VideoNoteReviewPanel from "$components/ChatWindow/input/VideoNoteReviewPanel.svelte";
  import VideoRecorderPreview from "$components/ChatWindow/input/VideoRecorderPreview.svelte";
  import RecordingBar from "$components/ChatWindow/input/RecordingBar.svelte";
  import { MediaRecorderSession, extractAudioAmplitudes } from "$components/ChatWindow/input/mediaRecorderManager";
  import InputContextMenu from "$components/ChatWindow/input/InputContextMenu.svelte";
  import ColorPicker from "$components/ChatWindow/input/ColorPicker.svelte";
  import { ComposerFormatState } from "$lib/formatting/composerState";
  import { STYLE_KEYS, COMPOSER_STYLES } from "$lib/formatting/constants";
  import { compileBackdropSpans } from "$lib/formatting/parser";
  import { encodeStegoMessage, parseStegoColors } from "$lib/formatting/colorStego";
  import { lastUsedColor } from "$lib/stores/colorSettings";
  import { composerSelection } from "$lib/stores/composerSelection";

  export let replyTo;
  export let scrollElement;
  export let chat;
  export let messages;
  export let attachesDropout;
  export let chatSettings;
  export let botCommands = [];
  export let editingMessage = null;
  export let decodedMessages = null;
  export let showStickerPanel = false;

  const composerFormat = new ComposerFormatState();
  let previousMessageText = "";
  let activeFormatStyles = [];
  let activeColor = null;
  let showColorPicker = false;
  let showPollModal = false;
  let formatRevision = 0;
  let backdropEl;

  $: backdropSpans = (formatRevision >= 0 && composerFormat.hasAnyFormatting())
    ? compileBackdropSpans(newMessage, composerFormat.getRawElements(newMessage), composerFormat.getRanges(STYLE_KEYS.COLOR))
    : [];
  $: hasFormatting = backdropSpans.length > 0;
  $: isLockedOut = isChatSafetyLocked(chat?.id, $safetyLockouts);

  function syncScroll() {
    if (backdropEl && textareaEl) {
      backdropEl.scrollTop = textareaEl.scrollTop;
      backdropEl.scrollLeft = textareaEl.scrollLeft;
    }
  }

  let prevEditingId = null;
  $: if (editingMessage && editingMessage.id !== prevEditingId) {
    prevEditingId = editingMessage.id;
    const { cleanText, colorSpans, elements: cleanElements } = parseStegoColors(
      editingMessage.text || "",
      editingMessage.elements || []
    );
    newMessage = cleanText;
    previousMessageText = cleanText;
    composerFormat.importData(cleanText, cleanElements);
    for (const cs of colorSpans) {
      composerFormat.setStyle(STYLE_KEYS.COLOR, cs.start, cs.end, { color: cs.color });
    }
    formatRevision++;
    attaches = Array.isArray(editingMessage.attaches) ? [...editingMessage.attaches] : [];
    tick().then(() => {
      autoResize();
      syncScroll();
    });
  } else if (!editingMessage && prevEditingId !== null) {
    prevEditingId = null;
    composerFormat.clear();
    formatRevision++;
  }

  function cancelEdit() {
    editingMessage = null;
    prevEditingId = null;
    newMessage = "";
    previousMessageText = "";
    composerFormat.clear();
    formatRevision++;
    attaches = [];
    tick().then(() => autoResize());
  }

  let newMessage = "";
  let attaches = [];
  let isSending = false;
  let showCommandsMenu = false;
  let stickerSuggestions = [];
  let suggestionTimer = null;

  let previousChatId = null;
  let initialDraftLoadedChatId = null;

  $: if (chat?.id !== previousChatId) {
    if (previousChatId != null && !editingMessage) {
      const trimmed = newMessage?.trim();
      if (trimmed) {
        setChatDraft(previousChatId, newMessage);
      } else {
        clearChatDraft(previousChatId);
      }
    }
    previousChatId = chat?.id;
    initialDraftLoadedChatId = chat?.id;
    if (!editingMessage && chat?.id != null) {
      const draft = getChatDraft(chat.id);
      if (draft) {
        newMessage = draft;
        previousMessageText = draft;
        tick().then(() => autoResize());
      } else {
        newMessage = "";
        previousMessageText = "";
      }
    }
  }

  $: if (!editingMessage && chat?.id != null && $chatDrafts && initialDraftLoadedChatId !== chat.id) {
    const draft = getChatDraft(chat.id);
    if (draft && !newMessage) {
      newMessage = draft;
      previousMessageText = draft;
      tick().then(() => autoResize());
    }
    initialDraftLoadedChatId = chat.id;
  }

  function handleComposerInput() {
    initialDraftLoadedChatId = chat?.id;
    composerFormat.onTextChanged(previousMessageText, newMessage);
    previousMessageText = newMessage;
    formatRevision++;
    autoResize();
    updateSelectionState();
    tick().then(syncScroll);
    if (!editingMessage && chat?.id != null) {
      setChatDraft(chat.id, newMessage);
    }
  }

  function updateSelectionState() {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start != null && end != null && end > start) {
      activeFormatStyles = COMPOSER_STYLES.filter((style) =>
        composerFormat.isStyleActive(style, start, end)
      );
      if (composerFormat.isStyleActive(STYLE_KEYS.LINK, start, end)) {
        activeFormatStyles = [...activeFormatStyles, STYLE_KEYS.LINK];
      }
      const colorRanges = composerFormat.getRanges(STYLE_KEYS.COLOR);
      const matchColor = colorRanges.find((r) => r.start <= start && r.end >= end);
      activeColor = matchColor?.metadata?.color || null;
      if (activeColor) {
        activeFormatStyles = [...activeFormatStyles, STYLE_KEYS.COLOR];
      }
    } else {
      activeFormatStyles = [];
      activeColor = null;
    }
  }

  function handleApplyColor(e) {
    const chosenColor = e.detail?.color;
    showColorPicker = false;
    if (!savedSelectionRange || !chosenColor) return;
    restoreSavedSelection();
    handleContextMenuFormat(STYLE_KEYS.COLOR, { color: chosenColor });
  }

  function handleClearColor() {
    showColorPicker = false;
    if (!savedSelectionRange) return;
    restoreSavedSelection();
    if (composerFormat.isStyleActive(STYLE_KEYS.COLOR, savedSelectionRange.start, savedSelectionRange.end)) {
      handleContextMenuFormat(STYLE_KEYS.COLOR);
    }
  }

  function handleTextareaSelect() {
    updateSelectionState();
    if (textareaEl) {
      const start = textareaEl.selectionStart ?? 0;
      const end = textareaEl.selectionEnd ?? 0;
      if (start < end) {
        savedSelectionRange = { start, end };
        if (currentPlatform === "android") {
          const rect = textareaEl.getBoundingClientRect();
          contextMenuState = {
            clientX: Math.max(16, rect.left + (rect.width - 216) / 2),
            clientY: Math.max(16, rect.top - 240),
            hasSelection: true,
            activeStyles: [...activeFormatStyles],
          };
        }
      }
    }
  }

  function handleDocSelectionChange() {
    if (currentPlatform !== "android" || !textareaEl) return;
    if (document.activeElement === textareaEl) {
      const start = textareaEl.selectionStart ?? 0;
      const end = textareaEl.selectionEnd ?? 0;
      if (start < end) {
        if (!savedSelectionRange || savedSelectionRange.start !== start || savedSelectionRange.end !== end) {
          savedSelectionRange = { start, end };
          updateSelectionState();
          const rect = textareaEl.getBoundingClientRect();
          contextMenuState = {
            clientX: Math.max(16, rect.left + (rect.width - 216) / 2),
            clientY: Math.max(16, rect.top - 240),
            hasSelection: true,
            activeStyles: [...activeFormatStyles],
          };
        }
      }
    }
  }

  function handleFormatToggle(style, metadata = null) {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start == null || end == null || start >= end) return;
    composerFormat.toggleStyle(style, start, end, metadata);
    formatRevision++;
    updateSelectionState();
    tick().then(syncScroll);
  }

  let contextMenuState = null;
  let savedSelectionRange = null;


  function restoreSavedSelection() {
    if (!textareaEl || !savedSelectionRange) return;
    try {
      textareaEl.focus();
      textareaEl.setSelectionRange(savedSelectionRange.start, savedSelectionRange.end);
      updateSelectionState();
    } catch (e) {}
  }

  function handleTextareaContextMenu(e) {
    if (!textareaEl) return;
    let start = textareaEl.selectionStart ?? 0;
    let end = textareaEl.selectionEnd ?? 0;

    if (start === end) {
      const text = textareaEl.value;
      let left = start;
      let right = start;
      while (left > 0 && /\S/.test(text[left - 1])) left--;
      while (right < text.length && /\S/.test(text[right])) right++;
      if (right > left) {
        textareaEl.setSelectionRange(left, right);
        start = left;
        end = right;
      }
    }

    savedSelectionRange = { start, end };
    updateSelectionState();

    contextMenuState = {
      clientX: e.clientX,
      clientY: e.clientY,
      hasSelection: start < end,
      activeStyles: [...activeFormatStyles],
    };
  }

  function handleContextMenuFormat(style, metadata = null) {
    if (!textareaEl || !savedSelectionRange) return;
    const { start, end } = savedSelectionRange;
    if (start >= end) return;
    if (style === STYLE_KEYS.COLOR && metadata?.color) {
      composerFormat.setStyle(style, start, end, metadata);
    } else {
      composerFormat.toggleStyle(style, start, end, metadata);
    }
    formatRevision++;
    textareaEl.focus();
    textareaEl.setSelectionRange(start, end);
    updateSelectionState();
    tick().then(syncScroll);
  }

  function handleContextMenuClear() {
    if (!textareaEl || !savedSelectionRange) return;
    const { start, end } = savedSelectionRange;
    if (start >= end) return;
    for (const style of COMPOSER_STYLES) {
      if (composerFormat.isStyleActive(style, start, end)) {
        composerFormat.toggleStyle(style, start, end);
      }
    }
    if (composerFormat.isStyleActive(STYLE_KEYS.LINK, start, end)) {
      composerFormat.toggleStyle(STYLE_KEYS.LINK, start, end);
    }
    if (composerFormat.isStyleActive(STYLE_KEYS.COLOR, start, end)) {
      composerFormat.toggleStyle(STYLE_KEYS.COLOR, start, end);
    }
    formatRevision++;
    textareaEl.focus();
    textareaEl.setSelectionRange(start, end);
    updateSelectionState();
    tick().then(syncScroll);
  }

  async function copyTextToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function handleContextMenuAction(actionName) {
    if (!textareaEl) return;
    const start = savedSelectionRange ? savedSelectionRange.start : (textareaEl.selectionStart ?? 0);
    const end = savedSelectionRange ? savedSelectionRange.end : (textareaEl.selectionEnd ?? 0);

    if (actionName === "cut") {
      if (start < end) {
        const selected = newMessage.slice(start, end);
        await copyTextToClipboard(selected);
        newMessage = newMessage.slice(0, start) + newMessage.slice(end);
        savedSelectionRange = null;
        handleComposerInput();
        await tick();
        if (textareaEl) {
          textareaEl.focus();
          textareaEl.setSelectionRange(start, start);
        }
      }
    } else if (actionName === "copy") {
      if (start < end) {
        const selected = newMessage.slice(start, end);
        await copyTextToClipboard(selected);
      }
    } else if (actionName === "paste") {
      try {
        let text = "";
        try {
          text = await navigator.clipboard.readText();
        } catch (e) {}
        if (text) {
          newMessage = newMessage.slice(0, start) + text + newMessage.slice(end);
          handleComposerInput();
          await tick();
          if (textareaEl) {
            textareaEl.focus();
            const nextPos = start + text.length;
            textareaEl.setSelectionRange(nextPos, nextPos);
          }
        }
      } catch (err) {
        console.error(err);
      }
    } else if (actionName === "delete") {
      if (start < end) {
        newMessage = newMessage.slice(0, start) + newMessage.slice(end);
        savedSelectionRange = null;
        handleComposerInput();
        await tick();
        if (textareaEl) {
          textareaEl.focus();
          textareaEl.setSelectionRange(start, start);
        }
      }
    } else if (actionName === "selectAll") {
      textareaEl.focus();
      textareaEl.select();
      updateSelectionState();
    }
    contextMenuState = null;
  }

  function handlePluginInsert(payload) {
    const rawText = typeof payload === "string" ? payload : payload?.text || payload?.textToSend || "";
    if (!rawText) return;
    const rawElements = payload?.elements || payload?.elementsToSend || [];
    const { cleanText, colorSpans } = parseStegoColors(rawText, rawElements);
    if (textareaEl) {
      const start = textareaEl.selectionStart ?? newMessage.length;
      const end = textareaEl.selectionEnd ?? newMessage.length;
      newMessage = newMessage.slice(0, start) + cleanText + newMessage.slice(end);
      composerFormat.onTextChanged(previousMessageText, newMessage);
      for (const cs of colorSpans) {
        composerFormat.setStyle(STYLE_KEYS.COLOR, start + cs.start, start + cs.end, { color: cs.color });
      }
      formatRevision++;
      previousMessageText = newMessage;
      tick().then(() => {
        const pos = start + cleanText.length;
        textareaEl.setSelectionRange(pos, pos);
        textareaEl.focus();
        autoResize();
      });
    } else {
      newMessage += cleanText;
    }
  }

  function handlePluginReplaceSelection(payload) {
    const rawText = typeof payload === "string" ? payload : payload?.text || payload?.textToSend || "";
    if (!rawText) return;
    const rawElements = payload?.elements || payload?.elementsToSend || [];
    const { cleanText, colorSpans } = parseStegoColors(rawText, rawElements);

    const start = savedSelectionRange?.start ?? textareaEl?.selectionStart ?? newMessage.length;
    const end = savedSelectionRange?.end ?? textareaEl?.selectionEnd ?? start;

    newMessage = newMessage.slice(0, start) + cleanText + newMessage.slice(end);
    composerFormat.onTextChanged(previousMessageText, newMessage);

    for (const cs of colorSpans) {
      composerFormat.setStyle(STYLE_KEYS.COLOR, start + cs.start, start + cs.end, { color: cs.color });
    }

    formatRevision++;
    previousMessageText = newMessage;
    savedSelectionRange = { start, end: start + cleanText.length };

    tick().then(() => {
      if (textareaEl) {
        textareaEl.setSelectionRange(start, start + cleanText.length);
        textareaEl.focus();
      }
      autoResize();
      syncScroll();
    });
  }

  onMount(() => {
    pluginOn("input:insert", handlePluginInsert);
    pluginOn("input:replace-selection", handlePluginReplaceSelection);
    document.addEventListener("selectionchange", handleDocSelectionChange);
    const handleViewportResize = () => {
      autoResize();
      syncScroll();
    };
    window.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("resize", handleViewportResize);
    window.visualViewport?.addEventListener("scroll", handleViewportResize);
    return () => {
      pluginOff("input:insert", handlePluginInsert);
      pluginOff("input:replace-selection", handlePluginReplaceSelection);
      document.removeEventListener("selectionchange", handleDocSelectionChange);
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("scroll", handleViewportResize);
    };
  });

  $: {
    const start = savedSelectionRange?.start ?? textareaEl?.selectionStart ?? 0;
    const end = savedSelectionRange?.end ?? textareaEl?.selectionEnd ?? 0;
    const hasSelection = end > start && start >= 0 && end <= newMessage.length;
    const selectedText = hasSelection ? newMessage.slice(start, end) : "";
    composerSelection.set({
      text: newMessage,
      selectedText,
      selectionStart: start,
      selectionEnd: end,
      hasSelection,
    });
  }



  $: commandFilter = newMessage.startsWith("/") ? newMessage : "";
  $: hasSlash = newMessage.startsWith("/");
  $: isMenuVisible = (showCommandsMenu || (hasSlash && botCommands.length > 0)) && botCommands.length > 0;

  let activeSearchQuery = "";
  $: {
    const trimmed = newMessage.trim();
    clearTimeout(suggestionTimer);
    activeSearchQuery = trimmed;
    if (!trimmed || trimmed.startsWith("/")) {
      stickerSuggestions = [];
    } else {
      const queryForThisSearch = trimmed;
      suggestionTimer = setTimeout(async () => {
        try {
          const res = await searchStickers(queryForThisSearch, 10);
          if (newMessage.trim() === queryForThisSearch && activeSearchQuery === queryForThisSearch) {
            stickerSuggestions = res || [];
          }
        } catch {
          if (newMessage.trim() === queryForThisSearch) {
            stickerSuggestions = [];
          }
        }
      }, 200);
    }
  }

  function handleSelectCommand(cmd) {
    showCommandsMenu = false;
    const name = (cmd.name || "").replace(/^\//, "");
    newMessage = "/" + name;
    onSend();
  }

  function handleWindowClick(e) {
    if (
      isMenuVisible &&
      !e.target.closest(".bot-commands-menu") &&
      !e.target.closest(".bot-cmd-btn")
    ) {
      showCommandsMenu = false;
    }

    if (
      attachesDropout &&
      !e.target.closest(".attaches-bottom-sheet, .attaches-dropout, .attaches-sheet-backdrop, .portal-sheet-wrapper, .portal-layer-sheet-container") &&
      !e.target.closest(".attach-toggle-btn")
    ) {
      attachesDropout = null;
    }

    if (
      contextMenuState &&
      !e.target.closest(".dropout-container")
    ) {
      contextMenuState = null;
    }
  }

  let textareaEl;
  const currentPlatform = platform();
  const isMobile = currentPlatform === "android" || currentPlatform === "ios";

  export async function sendSticker(sticker) {
    if (sticker?.id == null || chat?.id == null) return;
    const stickerId = Number(sticker.id);
    const chatId = Number(chat.id);
    const now = Date.now();
    const tempId = now;
    const myId = get(currentUser);

    const displayMessageEarlyEntry = {
      id: tempId,
      text: "",
      sender: myId,
      reactionInfo: {},
      attaches: [
        {
          _type: "STICKER",
          stickerId: String(stickerId),
          baseUrl: sticker.url,
          url: sticker.url,
          lottieUrl: sticker.lottieUrl,
          width: sticker.width,
          height: sticker.height,
        }
      ],
      elements: [],
      type: "USER",
      time: now,
      status: 0,
      sending: true,
    };

    const chatCache = getChat(chat.id);
    chatCache.receivedMessage.set(displayMessageEarlyEntry);
    messages.update(msgs => [...msgs, displayMessageEarlyEntry]);

    stickerSuggestions = [];
    await tick();
    scrollToBottom(scrollElement, false);

    try {
      const res = await $API.sendStickerMessage(chatId, stickerId);
      const sentMsg = res?.message;
      if (sentMsg) {
        const fullMsg = {
          ...displayMessageEarlyEntry,
          ...sentMsg,
          id: sentMsg.id || tempId,
          time: sentMsg.time || now,
          status: 1,
          sending: false,
        };
        chatCache.updateMessages([fullMsg]);
        messages.update(msgs => {
          const withoutTemp = msgs.filter(m => String(m.id) !== String(tempId));
          const existingIdx = withoutTemp.findIndex(m => String(m.id) === String(fullMsg.id));
          if (existingIdx !== -1) {
            withoutTemp[existingIdx] = fullMsg;
            return withoutTemp;
          }
          return [...withoutTemp, fullMsg];
        });
      }
    } catch (e) {
      console.error(e);
      messages.update(msgs => {
        const idx = msgs.findIndex(m => String(m.id) === String(tempId));
        if (idx !== -1) {
          msgs[idx].sending = false;
          msgs[idx].deleted = true;
          msgs[idx].status = "failed";
          return [...msgs];
        }
        return msgs;
      });
      showAlert("Не удалось отправить стикер");
    } finally {
      await tick();
      scrollToBottom(scrollElement, false);
    }
  }

  async function prepareAndUploadAttach(attach) {
    const settings = get(chatSettings) || {};
    const hasSession = Boolean(settings?.keys?.current || settings?.session);
    const password = settings?.password;
    const obf = settings?.obfs || (hasSession || password ? "zh" : null);

    if (hasSession || password || obf) {
      const account = await getCurrentAccount();
      const { uploadAttach, mediaDescriptor } = await encryptMediaAttachment({
        account: Number(account?.id || 0),
        chatId: Number(chat.id),
        attach,
        password,
      });
      const result = await $API.uploadAttachment(uploadAttach);
      if (result) {
        result.localPath = attach.path || attach.localPath;
        if (result.fileId) {
          invoke("register_media_cache", {
            account: Number(account?.id || 0),
            chatId: Number(chat.id),
            fileId: Number(result.fileId),
            localPath: result.localPath,
          }).catch(() => {});
        }
      }
      return { uploaded: result, mediaDescriptor };
    } else {
      const result = await $API.uploadAttachment(attach);
      return { uploaded: result, mediaDescriptor: null };
    }
  }

  async function onSend() {
    if (isSending || isLockedOut) return;
    if (!newMessage.trim() && !attaches.length && !($forwardDraft?.messages?.length)) return;
    clearTimeout(suggestionTimer);
    activeSearchQuery = "";
    stickerSuggestions = [];
    isSending = true;
    const formattedPayload = composerFormat.exportData(newMessage);
    const trimmedLen = formattedPayload.text.length;
    const leadSp = newMessage.length - newMessage.trimStart().length;
    const shiftedColorRanges = composerFormat
      .getRanges(STYLE_KEYS.COLOR)
      .map((s) => ({
        start: Math.max(0, s.start - leadSp),
        end: Math.min(trimmedLen, s.end - leadSp),
        metadata: s.metadata,
      }))
      .filter((s) => s.start < s.end);

    const { textToSend, elementsToSend } = encodeStegoMessage(
      formattedPayload.text,
      formattedPayload.elements,
      shiftedColorRanges
    );
    newMessage = "";
    previousMessageText = "";
    composerFormat.clear();
    formatRevision++;

    if (editingMessage) {
      const targetMsgId = editingMessage.id;
      const oldText = editingMessage.text || "";
      const oldAtts = editingMessage.attaches || [];

      const _attaches = [];
      for (const attach of attaches) {
        if (attach._type) {
          _attaches.push(attach);
        } else {
          attach.uploading = true;
          attach.progress = 5;
          attaches = attaches;

          let currentProgress = 5;
          const progressTimer = setInterval(() => {
            if (currentProgress < 90) {
              currentProgress += Math.max(1, (90 - currentProgress) * 0.08);
              attach.progress = Math.round(currentProgress);
              attaches = attaches;
            }
          }, 80);

          try {
            const result = await $API.uploadAttachment(attach);
            clearInterval(progressTimer);
            if (result) {
              attach.progress = 100;
              attach.uploading = false;
              attach.uploaded = true;
              attaches = attaches;
              _attaches.push(result);
            } else {
              attach.uploading = false;
              attach.uploaded = false;
              attaches = attaches;
            }
          } catch (e) {
            clearInterval(progressTimer);
            attach.uploading = false;
            attach.uploaded = false;
            attaches = attaches;
            isSending = false;
            throw e;
          }
        }
      }

      try {
        await $API.editMessage(chat.id, targetMsgId, textToSend, _attaches, elementsToSend);
        const textDiff = computeTextDiff(oldText, textToSend);
        const attsDiff = computeAttachesDiff(oldAtts, _attaches);
        const at = Date.now();

        const chatCache = getChat(chat.id);
        messages.update(msgs => {
          const idx = msgs.findIndex(m => String(m.id) === String(targetMsgId));
          if (idx !== -1) {
            const oldMsg = msgs[idx];
            const prevHistory = Array.isArray(oldMsg.history) ? oldMsg.history : [];
            const newHistory = [
              ...prevHistory,
              { at, diff: textDiff, attaches_diff: attsDiff }
            ];
            const updated = {
              ...oldMsg,
              text: textToSend,
              elements: elementsToSend,
              attaches: _attaches,
              edited: true,
              edited_at: at,
              history: newHistory,
            };
            msgs[idx] = updated;
            chatCache.updateMessages([updated]);
            chatCache.receivedMessage.set(updated);
            return [...msgs];
          }
          return msgs;
        });
      } catch (e) {
        console.error(e);
        showAlert(e?.message || "Не удалось отредактировать сообщение");
      } finally {
        isSending = false;
        cancelEdit();
      }
      return;
    }

    newMessage = "";
    if (chat?.id != null) {
      clearChatDraft(chat.id);
    }
    stickerSuggestions = [];
    await tick();

    if (textareaEl) {
      textareaEl.style.height = "auto";
    }

    const _attaches = [];
    const _elements = [];
    const _replyTo = replyTo;
    replyTo = null;

    let mediaDescriptor = null;
    for (const attach of attaches) {
      const aType = attach._type || attach.type;
      if (aType === "POLL" || aType === "LOCATION" || aType === "CONTACT") {
        _attaches.push(attach);
        continue;
      }

      attach.uploading = true;
      attach.progress = 5;
      attaches = attaches;

      let currentProgress = 5;
      const progressTimer = setInterval(() => {
        if (currentProgress < 90) {
          currentProgress += Math.max(1, (90 - currentProgress) * 0.08);
          attach.progress = Math.round(currentProgress);
          attaches = attaches;
        }
      }, 80);

      try {
        const { uploaded, mediaDescriptor: desc } = await prepareAndUploadAttach(attach);
        clearInterval(progressTimer);

        if (uploaded) {
          attach.progress = 100;
          attach.uploading = false;
          attach.uploaded = true;
          attaches = attaches;

          _attaches.push(uploaded);
          if (desc && !mediaDescriptor) {
            mediaDescriptor = desc;
          }
        } else {
          attach.uploading = false;
          attach.uploaded = false;
          attaches = attaches;
          alert("Не удалось загрузить!\n" + JSON.stringify(attach));
        }
      } catch (err) {
        clearInterval(progressTimer);
        attach.uploading = false;
        attach.uploaded = false;
        attaches = attaches;
        isSending = false;
        throw err;
      }
    }

    const msgsToForward = $forwardDraft?.messages ? [...$forwardDraft.messages] : [];
    if (!textToSend && !_attaches.length && !msgsToForward.length) {
      isSending = false;
      return;
    }

    try {
      if (msgsToForward.length > 0) {
        const ok = await forwardMessages(chat.id, msgsToForward, "", messages);
        if (ok) {
          clearForwardDraft();
        }
      }
      if (textToSend || _attaches.length) {
        await sendMessage(
          chat,
          chatSettings,
          messages,
          textToSend,
          _replyTo,
          _attaches,
          elementsToSend,
          false,
          mediaDescriptor,
          decodedMessages
        );
        attaches = [];
      }
    } catch (e) {
      console.error(e);
    } finally {
      isSending = false;
      await tick();
      scrollToBottom(scrollElement, false);
    }
  }

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + "px";
  }

  let unregisterStickerBack = null;
  let unregisterAttachesBack = null;

  $: if (showStickerPanel) {
    if (!unregisterStickerBack) {
      unregisterStickerBack = registerBackHandler(() => {
        showStickerPanel = false;
        return true;
      });
    }
  } else {
    if (unregisterStickerBack) {
      unregisterStickerBack();
      unregisterStickerBack = null;
    }
  }

  $: if (attachesDropout) {
    if (!unregisterAttachesBack) {
      unregisterAttachesBack = registerBackHandler(() => {
        attachesDropout = null;
        return true;
      });
    }
  } else {
    if (unregisterAttachesBack) {
      unregisterAttachesBack();
      unregisterAttachesBack = null;
    }
  }

  onDestroy(() => {
    if (chat?.id != null && !editingMessage) {
      const trimmed = newMessage?.trim();
      if (trimmed) {
        setChatDraft(chat.id, newMessage);
      } else {
        clearChatDraft(chat.id);
      }
    }
    if (unregisterStickerBack) {
      unregisterStickerBack();
      unregisterStickerBack = null;
    }
    if (unregisterAttachesBack) {
      unregisterAttachesBack();
      unregisterAttachesBack = null;
    }
  });

  function toggleAttachesDropout() {
    attachesDropout = attachesDropout ? null : { active: true };
    if (attachesDropout) {
      showStickerPanel = false;
      showCommandsMenu = false;
      if (isMobile && textareaEl) {
        textareaEl.blur();
      }
    }
  }

  let isTransitioningToKeyboard = false;
  let transitionTimer = null;

  function setTransitioningToKeyboard() {
    isTransitioningToKeyboard = true;
    if (transitionTimer) clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => {
      isTransitioningToKeyboard = false;
    }, 600);
  }

  $: if ($keyboardOpen) {
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    isTransitioningToKeyboard = false;
  }

  $: isKeyboardVisible = $keyboardOpen || isTransitioningToKeyboard;
  $: isBottomOpen = showStickerPanel || isKeyboardVisible;
  $: bottomPaneHeight = isBottomOpen ? $keyboardHeight : 0;

  function toggleStickerPanel() {
    showStickerPanel = !showStickerPanel;
    if (showStickerPanel) {
      attachesDropout = null;
      showCommandsMenu = false;
      if (isMobile && textareaEl) {
        textareaEl.blur();
      }
    } else {
      if (isMobile && textareaEl) {
        setTransitioningToKeyboard();
        textareaEl.focus();
      }
    }
  }

  function handleTextareaFocus() {
    if (isMobile && showStickerPanel) {
      setTransitioningToKeyboard();
      showStickerPanel = false;
    }
  }

  function handleInsertEmoji(event) {
    const emoji = event.detail.emoji;
    if (!emoji) return;
    newMessage += emoji;
    if (textareaEl) {
      if (!isMobile) {
        textareaEl.focus();
      }
      autoResize();
    }
  }

  function handleBackspaceEmoji() {
    if (!newMessage) return;
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      const segments = Array.from(segmenter.segment(newMessage));
      if (segments.length > 0) {
        newMessage = segments.slice(0, -1).map((s) => s.segment).join("");
      }
    } else {
      newMessage = newMessage.slice(0, -1);
    }
    formatRevision++;
    tick().then(() => autoResize());
  }

  let hiddenVoiceInputEl;
  let hiddenVideoInputEl;

  async function loadAudioDataForReview(arrayBuffer, mime) {
    try {
      const { amps, duration } = await extractAudioAmplitudes(arrayBuffer);
      const blob = new Blob([arrayBuffer], { type: mime || 'audio/ogg' });
      reviewAmplitudes = amps;
      reviewAudioBlob = blob;
      if (reviewAudioUrl) URL.revokeObjectURL(reviewAudioUrl);
      reviewAudioUrl = URL.createObjectURL(blob);
      reviewAudioDuration = duration;
      isReviewingVoice = true;
    } catch (err) {
      console.error(err);
    }
  }

  async function importVoiceFromFile() {
    let rawPath = null;
    let mime = 'audio/ogg';

    try {
      const response = await invoke("pick", { type: "AUDIO" });
      if (response && response !== "CANCEL") {
        rawPath = decodeURIComponent(response.uri);
        mime = response.mime_type || 'audio/ogg';
      }
    } catch {
      rawPath = null;
    }

    if (!rawPath) {
      if (hiddenVoiceInputEl) {
        hiddenVoiceInputEl.click();
      }
      return;
    }

    try {
      let arrayBuffer;
      try {
        const fileBytes = await invoke("read_file", { path: rawPath });
        arrayBuffer = new Uint8Array(fileBytes).buffer;
      } catch {
        const res = await fetch(convertFileSrc(rawPath));
        arrayBuffer = await res.arrayBuffer();
      }
      await loadAudioDataForReview(arrayBuffer, mime);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleVoiceFileInputChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      await loadAudioDataForReview(arrayBuffer, file.type || 'audio/ogg');
    } catch (err) {
      console.error(err);
    } finally {
      e.target.value = '';
    }
  }

  async function importVideoNoteFromFile() {
    let rawPath = null;
    try {
      const response = await invoke("pick", { type: "VIDEO" });
      if (response && response !== "CANCEL") {
        rawPath = decodeURIComponent(response.uri);
      }
    } catch {
      rawPath = null;
    }

    if (!rawPath) {
      if (hiddenVideoInputEl) {
        hiddenVideoInputEl.click();
      }
      return;
    }

    let previewPath = rawPath;
    try {
      previewPath = await invoke("prepare_video_for_preview", { sourcePath: rawPath });
    } catch {
      previewPath = rawPath;
    }

    const previewUrl = getProxiedMediaUrl(previewPath);
    openVideoCropModal({
      sourcePath: rawPath,
      previewUrl,
      onConfirm: handleCropVideoConfirm,
      onCancel: closeVideoCropModal,
    });
  }

  async function handleVideoFileInputChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ext = file.name.split('.').pop() || 'mp4';
      const savedPath = await invoke('save_temp_media', {
        bytes: Array.from(new Uint8Array(arrayBuffer)),
        extension: ext,
        isVideo: true,
      });
      let previewPath = savedPath;
      try {
        previewPath = await invoke("prepare_video_for_preview", { sourcePath: savedPath });
      } catch {
        previewPath = savedPath;
      }
      const previewUrl = getProxiedMediaUrl(previewPath);
      openVideoCropModal({
        sourcePath: savedPath,
        previewUrl,
        onConfirm: handleCropVideoConfirm,
        onCancel: closeVideoCropModal,
      });
    } catch {
      const previewUrl = URL.createObjectURL(file);
      openVideoCropModal({
        sourcePath: '',
        previewUrl,
        onConfirm: handleCropVideoConfirm,
        onCancel: closeVideoCropModal,
      });
    } finally {
      e.target.value = '';
    }
  }

  async function handleCropVideoConfirm(cropData) {
    closeVideoCropModal();
    const { croppedPath, durationSec } = cropData;
    if (!croppedPath) return;
    const actualPath = croppedPath;

    const trimmedDuration = Math.round(durationSec * 1000);
    const wave = new Array(80).fill(0);

    const attachItem = {
      type: 'VIDEO',
      videoType: 1,
      path: actualPath,
      duration: trimmedDuration,
      wave,
      mime: 'video/mp4',
    };

    const tempId = -Date.now();
    const myId = get(currentUser);
    messages.update(msgs => [...msgs, {
      id: tempId,
      sending: true,
      attaches: [{ _type: 'VIDEO', videoType: 1, duration: trimmedDuration, loading: true, localPath: actualPath }],
      text: '',
      type: 'USER',
      time: Date.now(),
      reactionInfo: {},
      sender: myId,
    }]);
    scrollToBottom(scrollElement, false);

    try {
      const { uploaded, mediaDescriptor } = await prepareAndUploadAttach(attachItem);
      if (uploaded) {
        messages.update(msgs => msgs.filter(m => m.id !== tempId));
        await sendMessage(
          chat,
          chatSettings,
          messages,
          '',
          replyTo,
          [uploaded],
          [],
          false,
          mediaDescriptor
        );
        replyTo = null;
        await tick();
        scrollToBottom(scrollElement, false);
      } else {
        messages.update(msgs => {
          const target = msgs.find(m => m.id === tempId);
          if (target) {
            target.sending = false;
            target.deleted = true;
            target.status = 'failed';
          }
          return [...msgs];
        });
      }
    } catch (e) {
      messages.update(msgs => {
        const target = msgs.find(m => m.id === tempId);
        if (target) {
          target.sending = false;
          target.deleted = true;
          target.status = 'failed';
        }
        return [...msgs];
      });
    }
  }

  function handleAttachesSelect(detail) {
    attachesDropout = null;
    if (detail?.path) {
      attaches = [
        ...attaches,
        {
          path: detail.path,
          type: detail.type || (detail.is_video ? "VIDEO" : "PHOTO"),
          mime: detail.mime || (detail.is_video ? "video/mp4" : "image/jpeg"),
          name: detail.name,
          size: detail.size,
        },
      ];
      return;
    }
    selectFile(detail?.type || detail);
  }

  async function selectFile(type) {
    attachesDropout = null;

    if (type === "POLL") {
      openScreen(PollCreateScreen, {
        onCreate: (detail) => handleCreatePoll({ detail }),
      });
      return;
    }

    if (type === "LOCATION") {
      openScreen(LocationPickerScreen, {
        onSelect: (loc) => {
          attaches = [
            ...attaches,
            {
              _type: "LOCATION",
              type: "LOCATION",
              latitude: loc.latitude,
              longitude: loc.longitude,
              zoom: loc.zoom || 15,
              address: loc.address,
              livePeriod: loc.livePeriod || 0,
            },
          ];
        },
      });
      return;
    }

    if (type === "CONTACT") {
      openScreen(ContactPickerScreen, {
        onSelect: (contact) => {
          const vcf = `BEGIN:VCARD\nVERSION:3.0\nFN:${contact.name || "Контакт"}\nTEL;TYPE=CELL:${contact.phone || ""}\nEND:VCARD`;
          attaches = [
            ...attaches,
            {
              _type: "CONTACT",
              type: "CONTACT",
              contactId: contact.contactId ? Number(contact.contactId) : undefined,
              name: contact.name,
              phone: contact.phone,
              vcfBody: vcf,
            },
          ];
        },
      });
      return;
    }

    if (type === "VOICE_NOTE") {
      await importVoiceFromFile();
      return;
    }
    if (type === "VIDEO_NOTE") {
      await importVideoNoteFromFile();
      return;
    }

    const response = await invoke("pick", type !== "FILE" ? { type } : null).catch(() => null);

    if (!response || response === "CANCEL") return;
    const { uri, mime_type: mime } = response;
    const path = decodeURIComponent(uri);

    attaches.push({
      path,
      type,
      mime,
    });
    attaches = attaches;
  }

  async function handleCreatePoll(event) {
    showPollModal = false;
    const { title, options, settings, description, cover } = event.detail;

    const pollAttach = {
      _type: "POLL",
      title,
      settings,
      description: description || undefined,
      cover: cover || undefined,
      answers: options.map((text) => ({ text })),
    };

    attaches = [...attaches, pollAttach];
  }

  function removeAttach(index) {
    if (attaches[index]?.uploading || attaches[index]?.uploaded) return;
    attaches.splice(index, 1);
    attaches = attaches;
  }

  let recordMode = 'voice';
  let isRecording = false;
  let isLocked = false;
  let holdTimeout = null;
  let elapsedMs = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let cancelDrag = 0;
  let lockDrag = 0;
  let liveAmplitudes = [];

  let videoPreviewEl = null;
  let fallbackCanvasEl = null;

  const session = new MediaRecorderSession({
    onElapsed: (ms) => { elapsedMs = ms; },
    onAmplitudes: (amps) => { liveAmplitudes = amps; },
    onError: () => {
      isRecording = false;
      showAlert('Ошибка записи');
    },
  });

  let isReviewingVideoNote = false;
  let reviewVideoBlob = null;
  let reviewVideoUrl = null;
  let reviewVideoDuration = 0;

  let isReviewingVoice = false;
  let reviewAudioBlob = null;
  let reviewAudioUrl = null;
  let reviewAudioDuration = 0;
  let reviewAmplitudes = [];
  let pointerDownTime = 0;
  let isHoldStarted = false;

  async function startRecording() {
    if (isRecording) return;
    stopCurrentMedia();
    cancelDrag = 0;
    lockDrag = 0;
    isLocked = false;
    isRecording = true;
    await tick();
    await session.start({ mode: recordMode, videoPreviewEl, fallbackCanvasEl });
  }

  function cancelRecording() {
    isRecording = false;
    isLocked = false;
    session.cancel(videoPreviewEl);
    liveAmplitudes = [];
  }

  async function stopAndSendRecording() {
    if (!isRecording) return;
    const wasLocked = isLocked;
    isLocked = false;

    const res = await session.stop(videoPreviewEl);
    isRecording = false;
    if (!res) return;

    const { finalElapsed, isVoice, finalBlob, ext, finalMime, wave, capturedAmps } = res;

    if (wasLocked && isVoice) {
      reviewAmplitudes = capturedAmps;
      reviewAudioBlob = finalBlob;
      reviewAudioUrl = URL.createObjectURL(finalBlob);
      reviewAudioDuration = Math.max(0.5, finalElapsed / 1000);
      isReviewingVoice = true;
      return;
    }

    const arrayBuffer = await finalBlob.arrayBuffer();
    const savedPath = await invoke('save_temp_media', {
      bytes: Array.from(new Uint8Array(arrayBuffer)),
      extension: ext,
      isVideo: !isVoice,
    });

    const attachItem = isVoice ? {
      type: 'AUDIO',
      path: savedPath,
      duration: finalElapsed,
      wave,
      mime: finalMime,
    } : {
      type: 'VIDEO',
      videoType: 1,
      path: savedPath,
      duration: finalElapsed,
      wave,
      mime: finalMime,
    };

    const tempId = -Date.now();
    const myId = get(currentUser);
    messages.update(msgs => [...msgs, {
      id: tempId,
      sending: true,
      attaches: [{
        _type: isVoice ? 'AUDIO' : 'VIDEO',
        videoType: isVoice ? undefined : 1,
        duration: finalElapsed,
        wave,
        loading: true,
        localPath: savedPath
      }],
      text: '',
      type: 'USER',
      time: Date.now(),
      reactionInfo: {},
      sender: myId,
    }]);
    scrollToBottom(scrollElement, false);

    try {
      const { uploaded, mediaDescriptor } = await prepareAndUploadAttach(attachItem);
      if (uploaded) {
        messages.update(msgs => msgs.filter(m => m.id !== tempId));
        await sendMessage(chat, chatSettings, messages, '', replyTo, [uploaded], [], false, mediaDescriptor);
        replyTo = null;
        await tick();
        scrollToBottom(scrollElement, false);
      } else {
        messages.update(msgs => {
          const target = msgs.find(m => m.id === tempId);
          if (target) {
            target.sending = false;
            target.deleted = true;
            target.status = "failed";
          }
          return [...msgs];
        });
      }
    } catch (e) {
      messages.update(msgs => {
        const target = msgs.find(m => m.id === tempId);
        if (target) {
          target.sending = false;
          target.deleted = true;
          target.status = "failed";
        }
        return [...msgs];
      });
      showAlert(typeof e === 'string' ? e : e?.message || e?.error || 'Ошибка отправки');
    }
  }

  async function stopRecordingForReview() {
    if (!isRecording) return;
    isLocked = false;
    const res = await session.stopForReview(videoPreviewEl);
    isRecording = false;
    if (!res) return;

    reviewAmplitudes = res.capturedAmps;
    reviewVideoBlob = res.vBlob;
    reviewVideoUrl = URL.createObjectURL(reviewVideoBlob);
    reviewVideoDuration = Math.max(0.8, res.finalElapsed / 1000);
    isReviewingVideoNote = true;
  }

  function discardReview() {
    if (reviewVideoUrl) {
      URL.revokeObjectURL(reviewVideoUrl);
      reviewVideoUrl = null;
    }
    reviewVideoBlob = null;
    reviewVideoDuration = 0;
    isReviewingVideoNote = false;
  }

  async function sendReviewedVideoNote(detail) {
    const { reviewVideoBlob: vBlob, reviewTrimStart, reviewTrimEnd, reviewVideoDuration: vDuration, isReviewMuted } = detail;
    if (!vBlob) return;
    const arrayBuffer = await vBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const rawPath = await invoke('save_temp_media', {
      bytes: Array.from(uint8),
      extension: 'mp4',
      isVideo: false,
    });

    const isTrimmed = reviewTrimStart > 0.05 || (vDuration > 0 && reviewTrimEnd < vDuration - 0.05);
    let finalPath = rawPath;
    if (isTrimmed) {
      try {
        finalPath = await invoke('crop_video_note', {
          sourcePath: rawPath,
          cropX: 0,
          cropY: 0,
          cropSize: 480,
          startSec: reviewTrimStart,
          endSec: reviewTrimEnd,
        });
      } catch {
        finalPath = await invoke('save_temp_media', {
          bytes: Array.from(uint8),
          extension: 'mp4',
          isVideo: true,
        });
      }
    } else {
      finalPath = await invoke('save_temp_media', {
        bytes: Array.from(uint8),
        extension: 'mp4',
        isVideo: true,
      });
    }

    const savedPath = finalPath;
    const trimmedDuration = Math.round(Math.max(0.5, reviewTrimEnd - reviewTrimStart) * 1000);
    const wave = isReviewMuted
      ? new Array(80).fill(0)
      : Array.from(generateWaveformFromAmplitudes(reviewAmplitudes, 80));

    const attachItem = {
      type: 'VIDEO',
      videoType: 1,
      path: savedPath,
      duration: trimmedDuration,
      wave,
      mime: 'video/mp4',
    };

    discardReview();

    const tempId2 = -Date.now();
    const myId = get(currentUser);
    messages.update(msgs => [...msgs, {
      id: tempId2,
      sending: true,
      attaches: [{ _type: 'VIDEO', videoType: 1, duration: trimmedDuration, loading: true, localPath: savedPath }],
      text: '',
      type: 'USER',
      time: Date.now(),
      reactionInfo: {},
      sender: myId,
    }]);
    scrollToBottom(scrollElement, false);

    try {
      const { uploaded, mediaDescriptor } = await prepareAndUploadAttach(attachItem);
      if (uploaded) {
        messages.update(msgs => msgs.filter(m => m.id !== tempId2));
        await sendMessage(
          chat,
          chatSettings,
          messages,
          '',
          replyTo,
          [uploaded],
          [],
          false,
          mediaDescriptor
        );
        replyTo = null;
        await tick();
        scrollToBottom(scrollElement, false);
      } else {
        messages.update(msgs => {
          const target = msgs.find(m => m.id === tempId2);
          if (target) {
            target.sending = false;
            target.deleted = true;
            target.status = 'failed';
          }
          return [...msgs];
        });
      }
    } catch (e) {
      messages.update(msgs => {
        const target = msgs.find(m => m.id === tempId2);
        if (target) {
          target.sending = false;
          target.deleted = true;
          target.status = 'failed';
        }
        return [...msgs];
      });
      showAlert(typeof e === 'string' ? e : e?.message || e?.error || 'Ошибка отправки');
    }
  }

  function discardVoiceReview() {
    if (reviewAudioUrl) {
      URL.revokeObjectURL(reviewAudioUrl);
      reviewAudioUrl = null;
    }
    reviewAudioBlob = null;
    reviewAudioDuration = 0;
    isReviewingVoice = false;
  }

  async function sendReviewedVoice(detail) {
    const { reviewAudioBlob: aBlob, reviewAudioTrimStart, reviewAudioTrimEnd, reviewAudioDuration: aDuration, reviewAmplitudes: rAmps } = detail;
    if (!aBlob) return;
    let arrayBuffer;
    const ext = 'ogg';
    const actualMime = 'audio/ogg';
    const isTrimmed = reviewAudioTrimStart > 0.05 || (aDuration > 0 && reviewAudioTrimEnd < aDuration - 0.05);

    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const rawBuffer = await aBlob.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(rawBuffer.slice(0));
      audioCtx.close().catch(() => {});
      const oggBlob = await encodeAudioBufferToOggOpus(
        decoded,
        isTrimmed ? reviewAudioTrimStart : 0,
        isTrimmed ? reviewAudioTrimEnd : aDuration
      );
      arrayBuffer = await oggBlob.arrayBuffer();
    } catch {
      arrayBuffer = await aBlob.arrayBuffer();
    }

    const trimmedDuration = Math.round(Math.max(0.3, reviewAudioTrimEnd - reviewAudioTrimStart) * 1000);
    const wave = Array.from(generateWaveformFromAmplitudes(rAmps, 80));
    const savedPath = await invoke('save_temp_media', {
      bytes: Array.from(new Uint8Array(arrayBuffer)),
      extension: ext,
      isVideo: false,
    });
    const attachItem = {
      type: 'AUDIO',
      path: savedPath,
      duration: trimmedDuration,
      wave,
      mime: actualMime,
    };
    discardVoiceReview();
    const tempId = -Date.now();
    const myId = get(currentUser);
    messages.update(msgs => [...msgs, {
      id: tempId,
      sending: true,
      attaches: [{ _type: 'AUDIO', duration: trimmedDuration, wave, loading: true, localPath: savedPath }],
      text: '',
      type: 'USER',
      time: Date.now(),
      reactionInfo: {},
      sender: myId,
    }]);
    scrollToBottom(scrollElement, false);
    try {
      const { uploaded, mediaDescriptor } = await prepareAndUploadAttach(attachItem);
      if (uploaded) {
        messages.update(msgs => msgs.filter(m => m.id !== tempId));
        await sendMessage(chat, chatSettings, messages, '', replyTo, [uploaded], [], false, mediaDescriptor);
        replyTo = null;
        await tick();
        scrollToBottom(scrollElement, false);
      } else {
        messages.update(msgs => {
          const target = msgs.find(m => m.id === tempId);
          if (target) {
            target.sending = false;
            target.deleted = true;
            target.status = 'failed';
          }
          return [...msgs];
        });
      }
    } catch (e) {
      messages.update(msgs => {
        const target = msgs.find(m => m.id === tempId);
        if (target) {
          target.sending = false;
          target.deleted = true;
          target.status = 'failed';
        }
        return [...msgs];
      });
      showAlert(typeof e === 'string' ? e : e?.message || e?.error || 'Ошибка отправки');
    }
  }

  function handleLockedStop() {
    if (recordMode === 'video') {
      stopRecordingForReview();
    } else {
      stopAndSendRecording();
    }
  }

  function handleSafetyLockoutEvent(e) {
    if (String(e?.detail?.chatId) === String(chat?.id)) {
      if (isRecording || isHoldStarted) {
        clearTimeout(holdTimeout);
        cancelRecording();
        showAlert("Шифрование отключено. Запись отменена в целях безопасности.");
      }
    }
  }

  onMount(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("e2e_safety_lockout", handleSafetyLockoutEvent);
    }
  });

  function handleRecordPointerDown(e) {
    if (isLockedOut) return;
    pointerDownTime = Date.now();
    isHoldStarted = false;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    cancelDrag = 0;
    lockDrag = 0;

    holdTimeout = setTimeout(() => {
      isHoldStarted = true;
      startRecording();
    }, 200);

    window.addEventListener('pointermove', handleRecordPointerMove);
    window.addEventListener('pointerup', handleRecordPointerUp);
  }

  function handleRecordPointerMove(e) {
    if (!isRecording) return;
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    if (dx < 0) {
      cancelDrag = Math.min(100, Math.abs(dx));
      if (cancelDrag >= 80) {
        cancelRecording();
        handleRecordPointerUp();
        return;
      }
    }
    if (dy < 0) {
      lockDrag = Math.min(100, Math.abs(dy));
      if (lockDrag >= 60) {
        isLocked = true;
      }
    }
  }

  function handleRecordPointerUp() {
    const pressDuration = Date.now() - pointerDownTime;
    clearTimeout(holdTimeout);
    window.removeEventListener('pointermove', handleRecordPointerMove);
    window.removeEventListener('pointerup', handleRecordPointerUp);

    if (!isHoldStarted && !isRecording && pressDuration < 200) {
      recordMode = recordMode === 'voice' ? 'video' : 'voice';
      return;
    }

    if (!isLocked && (isRecording || isHoldStarted)) {
      stopAndSendRecording();
    }
  }

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("e2e_safety_lockout", handleSafetyLockoutEvent);
    }
    session.cancel(videoPreviewEl);
  });
</script>

<svelte:window on:click={handleWindowClick} />

<SelectedAttaches
  {attaches}
  on:remove={(e) => removeAttach(e.detail.index)}
  on:preview={(e) => dispatch("previewMedia", { attach: e.detail.attach, attaches, originEl: e.detail.originEl })}
/>

<div class="input-area">
  {#if $forwardDraft && $forwardDraft.messages?.length > 0}
    <ForwardPreview />
  {/if}

  <EditingBanner {editingMessage} on:cancel={cancelEdit} />

  {#if replyTo}
    <Reply {chat} {messages} bind:replyTo />
  {/if}
  {#if stickerSuggestions.length > 0 && newMessage.trim().length > 0}
    <StickerSuggestionsDropout
      suggestions={stickerSuggestions}
      on:select={(e) => sendSticker(e.detail.sticker)}
    />
  {/if}

  {#if isMenuVisible}
    <BotCommandsMenu
      commands={botCommands}
      filter={commandFilter}
      onSelect={handleSelectCommand}
      onClose={() => {
        showCommandsMenu = false;
        if (newMessage === "/") newMessage = "";
      }}
    />
  {/if}

  {#if isRecording && recordMode === 'video'}
    <VideoRecorderPreview
      isFallbackVideo={session.isFallbackVideo}
      mediaStream={session.mediaStream}
      bind:videoPreviewEl
      bind:fallbackCanvasEl
      on:flipCamera={() => session.flipCamera(videoPreviewEl)}
    />
  {/if}

  {#if isReviewingVoice}
    <VoiceReviewPanel
      {reviewAudioUrl}
      {reviewAudioDuration}
      {reviewAmplitudes}
      {reviewAudioBlob}
      on:discard={discardVoiceReview}
      on:send={(e) => sendReviewedVoice(e.detail)}
    />
  {:else if isReviewingVideoNote}
    <VideoNoteReviewPanel
      {reviewVideoUrl}
      {reviewVideoDuration}
      {reviewVideoBlob}
      on:discard={discardReview}
      on:send={(e) => sendReviewedVideoNote(e.detail)}
    />
  {:else}
    <div class="input-controls" class:keyboard-open={isBottomOpen}>
      {#if isRecording}
        <RecordingBar
          {recordMode}
          {elapsedMs}
          {liveAmplitudes}
          {isLocked}
          {cancelDrag}
          {lockDrag}
          on:cancel={cancelRecording}
          on:stopLocked={handleLockedStop}
          on:sendLocked={stopAndSendRecording}
        />
      {:else}
        <button
          class="button emoji-btn"
          class:active={showStickerPanel}
          type="button"
          title={showStickerPanel ? "Клавиатура" : "Эмодзи и стикеры"}
          on:click={toggleStickerPanel}
        >
          {#if showStickerPanel}
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/keyboard.svg'); mask-image: url('/icons/keyboard.svg'); width: 22px; height: 22px;"></span>
          {:else}
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/sticker.svg'); mask-image: url('/icons/sticker.svg'); width: 22px; height: 22px;"></span>
          {/if}
        </button>

        {#each $pluginInputLeft as item (item.id)}
          <div class="plugin-mount-inline plugin-input-left" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </div>
        {/each}

        <div class="input-container" class:focused={false}>
          <div class="textarea-wrapper">
            {#if hasFormatting}
              <div class="input-backdrop" bind:this={backdropEl} aria-hidden="true">
                {#each backdropSpans as span}
                  <span
                    class="backdrop-span"
                    class:bold-text={span.styles.has(STYLE_KEYS.BOLD)}
                    class:italic-text={span.styles.has(STYLE_KEYS.ITALIC)}
                    class:underline-text={span.styles.has(STYLE_KEYS.UNDERLINE)}
                    class:strike-text={span.styles.has(STYLE_KEYS.STRIKE)}
                    class:code-text={span.styles.has(STYLE_KEYS.CODE)}
                    class:quote-text={span.styles.has(STYLE_KEYS.QUOTE)}
                    class:link-text={span.styles.has(STYLE_KEYS.LINK) || Boolean(span.linkUrl)}
                    style={span.color ? `color: ${span.color};` : ''}
                  >{span.text}</span>
                {/each}
                {#if newMessage.endsWith("\n")}
                  <span class="backdrop-trailing-break">&#8203;</span>
                {/if}
              </div>
            {/if}

            <textarea
              bind:this={textareaEl}
              class:has-formatting={hasFormatting}
              id="textarea-{chat.id}"
              rows="1"
              placeholder="Сообщение"
              bind:value={newMessage}
              on:focus={handleTextareaFocus}
              on:blur={() => { autoResize(); syncScroll(); }}
              on:input={handleComposerInput}
              on:scroll={syncScroll}
              on:select={handleTextareaSelect}
              on:touchend={handleDocSelectionChange}
              on:mouseup={updateSelectionState}
              on:keyup={updateSelectionState}
              on:contextmenu|preventDefault={handleTextareaContextMenu}
              on:keydown={async (e) => {
                const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
                const modKey = isMac ? e.metaKey : e.ctrlKey;
                if (modKey && !e.altKey) {
                  if (e.key === "b" || e.key === "B") {
                    e.preventDefault();
                    handleFormatToggle(STYLE_KEYS.BOLD);
                    return;
                  }
                  if (e.key === "i" || e.key === "I") {
                    e.preventDefault();
                    handleFormatToggle(STYLE_KEYS.ITALIC);
                    return;
                  }
                  if (e.key === "u" || e.key === "U") {
                    e.preventDefault();
                    handleFormatToggle(STYLE_KEYS.UNDERLINE);
                    return;
                  }
                  if (e.shiftKey && (e.key === "x" || e.key === "X")) {
                    e.preventDefault();
                    handleFormatToggle(STYLE_KEYS.STRIKE);
                    return;
                  }
                  if (e.shiftKey && (e.key === "m" || e.key === "M")) {
                    e.preventDefault();
                    handleFormatToggle(STYLE_KEYS.CODE);
                    return;
                  }
                  if (e.shiftKey && (e.key === "q" || e.key === "Q")) {
                    e.preventDefault();
                    handleFormatToggle(STYLE_KEYS.QUOTE);
                    return;
                  }
                  if (e.key === "k" || e.key === "K") {
                    e.preventDefault();
                    const start = textareaEl.selectionStart ?? 0;
                    const end = textareaEl.selectionEnd ?? 0;
                    if (start < end) {
                      const rect = textareaEl.getBoundingClientRect();
                      contextMenuState = {
                        clientX: Math.max(16, rect.left + 24),
                        clientY: Math.max(16, rect.top - 200),
                        hasSelection: true,
                        activeStyles: [...activeFormatStyles],
                      };
                    }
                    return;
                  }
                }

                if (e.key === "Escape") {
                  if (contextMenuState) {
                    e.preventDefault();
                    contextMenuState = null;
                    return;
                  }
                  if (showStickerPanel) {
                    e.preventDefault();
                    showStickerPanel = false;
                    return;
                  }
                  if (isMenuVisible) {
                    e.preventDefault();
                    showCommandsMenu = false;
                    if (newMessage === "/") newMessage = "";
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                  e.preventDefault();
                  await onSend();
                }
              }}
            ></textarea>
          </div>
        </div>

        {#if botCommands.length > 0}
          <button
            class="button bot-cmd-btn"
            class:active={isMenuVisible}
            type="button"
            title="Команды бота"
            on:click={() => (showCommandsMenu = !showCommandsMenu)}
          >
            <span class="slash-icon">/</span>
          </button>
        {/if}

        <button
          class="button attach-toggle-btn"
          class:active={!!attachesDropout}
          type="button"
          on:click|stopPropagation={toggleAttachesDropout}
          title="Прикрепить"
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/attachment.svg'); mask-image: url('/icons/attachment.svg'); width: 22px; height: 22px;"></span>
        </button>

        {#if attachesDropout}
          <AttachesMenu on:select={(e) => handleAttachesSelect(e.detail)} on:close={() => (attachesDropout = null)} />
        {/if}

        {#each $pluginInputRight as item (item.id)}
          <div class="plugin-mount-inline plugin-input-right" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </div>
        {/each}
        {#each $pluginInputAction as item (item.id)}
          <div class="plugin-mount-inline plugin-input-action" data-plugin-mount={item.pluginId || item.id}>
            {@html item.html}
          </div>
        {/each}

        {#if newMessage.length || attaches.length || ($forwardDraft && $forwardDraft.messages?.length > 0)}
          <button class="button send-button" class:disabled-cooldown={isLockedOut} disabled={isLockedOut} type="button" on:click={onSend} title="Отправить">
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/send.svg'); mask-image: url('/icons/send.svg'); width: 20px; height: 20px;"></span>
          </button>
        {:else}
          <button
            class="button camera-button"
            class:disabled-cooldown={isLockedOut}
            disabled={isLockedOut}
            type="button"
            title="Видеосообщение"
            on:pointerdown={(e) => {
              recordMode = 'video';
              handleRecordPointerDown(e);
            }}
          >
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/camera.svg'); mask-image: url('/icons/camera.svg'); width: 22px; height: 22px;"></span>
          </button>

          <button
            class="button voice-button"
            class:disabled-cooldown={isLockedOut}
            disabled={isLockedOut}
            type="button"
            title="Голосовое сообщение"
            on:pointerdown={(e) => {
              recordMode = 'voice';
              handleRecordPointerDown(e);
            }}
          >
            <span class="mask-icon" style="-webkit-mask-image: url('/icons/mic.svg'); mask-image: url('/icons/mic.svg'); width: 22px; height: 22px;"></span>
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  {#if showStickerPanel}
    <StickerPanel
      on:sendSticker={(e) => {
        sendSticker(e.detail.sticker);
        showStickerPanel = false;
      }}
      on:insertEmoji={handleInsertEmoji}
      on:backspace={handleBackspaceEmoji}
    />
  {:else}
    <div
      class="keyboard-spacer"
      style="height: {bottomPaneHeight}px;"
    ></div>
  {/if}

  {#if contextMenuState}
    <InputContextMenu
      clientX={contextMenuState?.clientX ?? 0}
      clientY={contextMenuState?.clientY ?? 0}
      hasSelection={contextMenuState?.hasSelection ?? false}
      activeStyles={contextMenuState?.activeStyles ?? []}
      currentColor={activeColor}
      anchorEl={textareaEl}
      {isMobile}
      on:format={(e) => handleContextMenuFormat(e.detail.style, e.detail.metadata)}
      on:clearFormat={handleContextMenuClear}
      on:openColorPicker={() => (showColorPicker = true)}
      on:action={(e) => handleContextMenuAction(e.detail.name)}
      on:restoreSelection={restoreSavedSelection}
      on:close={() => (contextMenuState = null)}
    />
  {/if}

  {#if showColorPicker}
    <ColorPicker
      initialColor={activeColor || $lastUsedColor || "#FF5252"}
      on:apply={handleApplyColor}
      on:clear={handleClearColor}
      on:close={() => (showColorPicker = false)}
    />
  {/if}


  <input
    bind:this={hiddenVoiceInputEl}
    type="file"
    accept="audio/*"
    style="display: none;"
    on:change={handleVoiceFileInputChange}
  />
  <input
    bind:this={hiddenVideoInputEl}
    type="file"
    accept="video/*"
    style="display: none;"
    on:change={handleVideoFileInputChange}
  />
</div>

<style>
  .input-area {
    position: relative;
    padding: 0;
    flex-shrink: 0;
    background: var(--bg-topbar, #212126);
    border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.04));
    z-index: var(--z-header, 4);
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .input-controls {
    display: flex;
    align-items: flex-end;
    position: relative;
    padding: 6px 8px calc(6px + var(--safe-bottom, 0px)) 8px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    transition: padding-bottom 0.25s cubic-bezier(0.1, 0.9, 0.2, 1);
  }

  .input-controls.keyboard-open {
    padding-bottom: 6px;
  }

  .input-container {
    display: flex;
    align-items: flex-end;
    background: transparent;
    flex-grow: 1;
    min-width: 0;
    min-height: 36px;
    box-sizing: border-box;
    border: none;
    margin: 0 4px;
  }

  .textarea-wrapper {
    position: relative;
    flex-grow: 1;
    min-width: 0;
    display: flex;
    align-items: flex-end;
  }

  .input-backdrop {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 8px 4px;
    font-size: 16px;
    line-height: 20px;
    font-family: inherit;
    letter-spacing: normal;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: break-word;
    tab-size: 4;
    overflow-y: hidden;
    overflow-x: hidden;
    pointer-events: none;
    color: var(--text-primary, #ffffff);
    user-select: none;
    box-sizing: border-box;
  }

  .backdrop-span.bold-text {
    font-weight: 700;
    color: #ffffff;
  }

  .backdrop-span.italic-text {
    font-style: italic;
  }

  .backdrop-span.underline-text {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .backdrop-span.strike-text {
    text-decoration: line-through;
  }

  .backdrop-span.underline-text.strike-text {
    text-decoration: underline line-through;
  }

  .backdrop-span.code-text {
    background: rgba(255, 255, 255, 0.12);
    color: #f59e0b;
    border-radius: 3px;
  }

  .backdrop-span.quote-text {
    background: rgba(80, 160, 255, 0.15);
    color: #7cb8ff;
  }

  .backdrop-span.link-text {
    color: #50b0f0;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .backdrop-span[style*="color:"] {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  .backdrop-trailing-break {
    display: inline;
    line-height: 20px;
  }

  textarea {
    position: relative;
    box-sizing: border-box;
    flex-grow: 1;
    background-color: transparent;
    color: var(--text-primary, #ffffff);
    border: none;
    resize: none;
    overflow-y: auto;
    min-height: 36px;
    max-height: 160px;
    font-size: 16px;
    line-height: 20px;
    letter-spacing: normal;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: break-word;
    tab-size: 4;
    padding: 8px 4px;
    outline: none;
    font-family: inherit;
    width: 0;
    caret-color: var(--accent-primary, #248bfe);
  }

  textarea.has-formatting {
    color: transparent !important;
    caret-color: var(--text-primary, #ffffff) !important;
  }

  textarea.has-formatting::selection {
    background: rgba(59, 130, 246, 0.4);
    color: #ffffff !important;
  }

  textarea::placeholder {
    color: var(--text-muted, #8e8e93);
    opacity: 0.5;
  }

  .plugin-mount-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .button {
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    color: var(--text-muted, #8e8e93);
    transition: all 0.18s var(--motion-curve, cubic-bezier(0.25, 0.1, 0.25, 1.0));
    padding: 0;
  }

  .button:hover {
    color: var(--text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.08);
  }

  .button:active {
    transform: scale(0.92);
  }

  .emoji-btn {
    width: 28px;
    height: 28px;
    margin: 0 4px 4px 4px;
    color: var(--text-muted, #8e8e93);
    opacity: 0.85;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .emoji-btn:hover {
    opacity: 1;
    color: var(--text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.08);
  }

  .emoji-btn.active {
    opacity: 1;
    color: var(--accent-primary, #248bfe);
    background: var(--accent-subtle, rgba(36, 139, 254, 0.12));
  }

  .attach-toggle-btn {
    width: 36px;
    height: 36px;
    padding: 4px;
    margin-left: 4px;
    color: var(--text-muted, #8e8e93);
  }

  .attach-toggle-btn.active {
    color: var(--accent-primary, #248bfe);
    background: var(--accent-subtle, rgba(36, 139, 254, 0.12));
  }

  .send-button {
    width: 36px;
    height: 36px;
    color: #ffffff;
    background: var(--accent-primary, #248bfe);
    margin-left: 8px;
    box-shadow: 0 2px 6px rgba(36, 139, 254, 0.35);
  }

  .send-button:hover {
    color: #ffffff;
    background: var(--accent-primary-hover, #1b74d9);
  }

  .camera-button,
  .voice-button {
    width: 36px;
    height: 36px;
    margin-left: 4px;
    color: var(--text-muted, #8e8e93);
  }

  .camera-button:hover,
  .voice-button:hover {
    color: var(--accent-primary, #248bfe);
    background: var(--accent-subtle, rgba(36, 139, 254, 0.12));
  }

  .bot-cmd-btn {
    width: 28px;
    height: 28px;
    margin: 0 2px 4px 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #8e8e93);
    border-radius: 50%;
    flex-shrink: 0;
    transition: all 0.18s ease;
  }

  .bot-cmd-btn:hover {
    color: var(--text-primary, #ffffff);
    background: rgba(255, 255, 255, 0.08);
  }

  .bot-cmd-btn.active {
    color: var(--accent-primary, #248bfe);
    background: var(--accent-subtle, rgba(36, 139, 254, 0.12));
  }

  .slash-icon {
    font-size: 19px;
    font-weight: 600;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.button.disabled-cooldown) {
    opacity: 0.35 !important;
    pointer-events: none !important;
    cursor: not-allowed !important;
    filter: grayscale(1) !important;
  }

  .keyboard-spacer {
    height: 0px;
    width: 100%;
    flex-shrink: 0;
    transition: height 0.25s cubic-bezier(0.1, 0.9, 0.2, 1);
  }
</style>
