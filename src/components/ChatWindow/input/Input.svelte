<script>
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { platform } from "@tauri-apps/plugin-os";
  import { tick, onDestroy } from "svelte";
  import { get } from "svelte/store";

  import { scrollToBottom } from "$lib/utils/scroll.js";
  import { sendMessage } from "$components/ChatWindow/actions.js";
  import Reply from "$components/ChatWindow/input/Reply.svelte";
  import BotCommandsMenu from "$components/ChatWindow/BotCommandsMenu.svelte";
  import API, { currentUser } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { searchStickers } from "$lib/stores/stickers";
  import { showAlert } from "$lib/utils/alert";
  import StickerSuggestionsDropout from "$components/ChatWindow/Stickers/StickerSuggestionsDropout.svelte";
  import StickerPanel from "$components/ChatWindow/Stickers/StickerPanel.svelte";
  import { generateWaveformFromAmplitudes } from "$lib/utils/waveform.js";
  import { stopCurrentMedia } from "$lib/stores/mediaPlayback.js";
  import { computeTextDiff, computeAttachesDiff } from "$lib/utils/diff.js";
  import { getProxiedMediaUrl } from "$lib/utils/images";
  import { openVideoCropModal, closeVideoCropModal } from "$lib/stores/videoCrop.js";
  import { encodeAudioBufferToOggOpus } from "$lib/utils/audioEncoder.js";
  import { encryptMediaAttachment } from "$lib/crypto/messages.js";
  import { getCurrentAccount } from "$lib/stores/accounts.js";

  import SelectedAttaches from "$components/ChatWindow/input/SelectedAttaches.svelte";
  import EditingBanner from "$components/ChatWindow/input/EditingBanner.svelte";
  import AttachesMenu from "$components/ChatWindow/input/AttachesMenu.svelte";
  import VoiceReviewPanel from "$components/ChatWindow/input/VoiceReviewPanel.svelte";
  import VideoNoteReviewPanel from "$components/ChatWindow/input/VideoNoteReviewPanel.svelte";
  import VideoRecorderPreview from "$components/ChatWindow/input/VideoRecorderPreview.svelte";
  import RecordingBar from "$components/ChatWindow/input/RecordingBar.svelte";
  import { MediaRecorderSession, extractAudioAmplitudes } from "$components/ChatWindow/input/mediaRecorderManager.js";

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

  let prevEditingId = null;
  $: if (editingMessage && editingMessage.id !== prevEditingId) {
    prevEditingId = editingMessage.id;
    newMessage = editingMessage.text || "";
    attaches = Array.isArray(editingMessage.attaches) ? [...editingMessage.attaches] : [];
    tick().then(() => autoResize());
  } else if (!editingMessage && prevEditingId !== null) {
    prevEditingId = null;
  }

  function cancelEdit() {
    editingMessage = null;
    prevEditingId = null;
    newMessage = "";
    attaches = [];
    tick().then(() => autoResize());
  }

  let newMessage = "";
  let attaches = [];
  let elements = [];
  let isSending = false;
  let showCommandsMenu = false;
  let stickerSuggestions = [];
  let suggestionTimer = null;

  $: commandFilter = newMessage.startsWith("/") ? newMessage : "";
  $: hasSlash = newMessage.startsWith("/");
  $: isMenuVisible = (showCommandsMenu || (hasSlash && botCommands.length > 0)) && botCommands.length > 0;

  $: {
    const trimmed = newMessage.trim();
    clearTimeout(suggestionTimer);
    if (!trimmed || trimmed.startsWith("/")) {
      stickerSuggestions = [];
    } else {
      suggestionTimer = setTimeout(async () => {
        try {
          stickerSuggestions = await searchStickers(trimmed, 10);
        } catch {
          stickerSuggestions = [];
        }
      }, 180);
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
      !e.target.closest(".attaches-dropout") &&
      !e.target.closest(".attach-toggle-btn")
    ) {
      attachesDropout = null;
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
    if (isSending) return;
    if (!newMessage.trim() && !attaches.length) return;
    isSending = true;
    const textToSend = newMessage;

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
        await $API.editMessage(chat.id, targetMsgId, textToSend, _attaches, []);
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

    if (!textToSend && !_attaches.length) {
      isSending = false;
      return;
    }

    try {
      await sendMessage(
        chat,
        chatSettings,
        messages,
        textToSend,
        _replyTo,
        _attaches,
        _elements,
        false,
        mediaDescriptor,
        decodedMessages
      );
      attaches = [];
      elements.length = 0;
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
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + "px";
  }

  function toggleAttachesDropout() {
    attachesDropout = attachesDropout ? null : { active: true };
    if (attachesDropout) {
      showStickerPanel = false;
      showCommandsMenu = false;
    }
  }

  function toggleStickerPanel() {
    showStickerPanel = !showStickerPanel;
    if (showStickerPanel) {
      attachesDropout = null;
      showCommandsMenu = false;
    }
  }

  function handleInsertEmoji(event) {
    const emoji = event.detail.emoji;
    if (!emoji) return;
    newMessage += emoji;
    if (textareaEl) {
      textareaEl.focus();
      autoResize();
    }
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

  async function selectFile(type) {
    attachesDropout = null;

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
    await session.start({ mode: recordMode, videoPreviewEl, fallbackCanvasEl });
  }

  function cancelRecording() {
    if (!isRecording) return;
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

  function handleRecordPointerDown(e) {
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
    session.cancel(videoPreviewEl);
  });
</script>

<svelte:window on:click={handleWindowClick} />

<SelectedAttaches {attaches} on:remove={(e) => removeAttach(e.detail.index)} />

<EditingBanner {editingMessage} on:cancel={cancelEdit} />

{#if replyTo}
  <Reply {chat} {messages} bind:replyTo />
{/if}

<div class="input-area">
  {#if stickerSuggestions.length > 0}
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
    <div class="input-controls">
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
          class="button attach-toggle-btn"
          class:active={!!attachesDropout}
          type="button"
          on:click|stopPropagation={toggleAttachesDropout}
          title="Прикрепить"
        >
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path fill="currentColor" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
          </svg>
        </button>

        {#if attachesDropout}
          <AttachesMenu on:select={(e) => selectFile(e.detail.type)} />
        {/if}

        <div class="input-container" class:focused={false}>
          <textarea
            bind:this={textareaEl}
            id="textarea-{chat.id}"
            rows="1"
            placeholder="Сообщение"
            bind:value={newMessage}
            on:input={autoResize}
            on:keydown={async (e) => {
              if (e.key === "Escape") {
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

          {#if botCommands.length > 0}
            <button
              class="bot-cmd-btn"
              class:active={isMenuVisible}
              type="button"
              title="Команды бота"
              on:click={() => (showCommandsMenu = !showCommandsMenu)}
            >
              <span class="slash-icon">/</span>
            </button>
          {/if}

          <button
            class="emoji-btn"
            class:active={showStickerPanel}
            type="button"
            title="Эмодзи и стикеры"
            on:click={toggleStickerPanel}
          >
            <img src="icons/smile.svg" alt="smile" />
          </button>
        </div>

        {#if newMessage.length || attaches.length}
          <button class="button send-button" type="button" on:click={onSend} title="Отправить">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        {:else}
          <button
            class="button voice-button"
            class:video-mode={recordMode === 'video'}
            type="button"
            title={recordMode === 'voice' ? 'Зажмите для записи, нажмите для переключения на видео' : 'Зажмите для записи, нажмите для переключения на голос'}
            on:pointerdown={handleRecordPointerDown}
          >
            {#if recordMode === 'voice'}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
                <path d="M15.5 5.5C15.5 3.567 13.933 2 12 2C10.067 2 8.5 3.567 8.5 5.5V12C8.5 13.933 10.067 15.5 12 15.5C13.933 15.5 15.5 13.933 15.5 12V5.5Z"/>
                <path d="M4.5 11.5C4.5 15.642 7.858 19 12 19M12 19C16.142 19 19.5 15.642 19.5 11.5M12 19V22"/>
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            {/if}
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
    background: #17191d;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    z-index: 10;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .input-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    padding: 8px 12px 10px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .input-container {
    display: flex;
    align-items: flex-end;
    background-color: #1e2025;
    border-radius: 18px;
    flex-grow: 1;
    min-height: 48px;
    box-sizing: border-box;
    border: none;
    transition: background-color 0.15s ease;
  }

  .input-container:focus-within {
    background-color: #23262d;
  }

  textarea {
    box-sizing: border-box;
    flex-grow: 1;
    background-color: transparent;
    color: #edf0f5;
    border: none;
    resize: none;
    overflow-y: auto;
    min-height: 44px;
    max-height: 120px;
    font-size: 15px;
    line-height: 22px;
    padding: 11px 14px;
    outline: none;
    font-family: inherit;
    width: 0;
  }

  textarea::placeholder {
    color: #697282;
  }

  .button {
    border: none;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    color: #8b929e;
    transition: all 0.18s ease;
  }

  .button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.06);
  }

  .button:active {
    transform: scale(0.92);
  }

  .attach-toggle-btn.active {
    color: #248bfe;
    background: rgba(36, 139, 254, 0.12);
  }

  .send-button {
    color: #248bfe;
    background: rgba(36, 139, 254, 0.12);
  }

  .send-button:hover {
    color: #fff;
    background: #248bfe;
  }

  .emoji-btn {
    background: none;
    border: none;
    cursor: pointer;
    width: 38px;
    height: 38px;
    margin-right: 5px;
    margin-bottom: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.65;
    border-radius: 50%;
    transition: all 0.18s ease;
    flex-shrink: 0;
  }

  .emoji-btn img {
    width: 22px;
    height: 22px;
  }

  .emoji-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
  }

  .emoji-btn.active {
    opacity: 1;
    background: rgba(36, 139, 254, 0.2);
    filter: brightness(1.2);
  }

  .bot-cmd-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    width: 38px;
    height: 38px;
    margin-right: 2px;
    margin-bottom: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.65;
    color: #edf0f5;
    border-radius: 50%;
    flex-shrink: 0;
    transition: all 0.18s ease;
  }

  .bot-cmd-btn:hover {
    opacity: 1;
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .bot-cmd-btn.active {
    opacity: 1;
    color: #248bfe;
    background: rgba(36, 139, 254, 0.2);
    filter: brightness(1.2);
  }

  .slash-icon {
    font-size: 19px;
    font-weight: 600;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
