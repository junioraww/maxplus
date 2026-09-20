<script>
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { platform } from "@tauri-apps/plugin-os";
  import { tick } from "svelte";
  import { fade, scale, slide } from "svelte/transition";
  import { get } from "svelte/store";

  import { scrollToBottom } from "$lib/utils/scroll.js";
  import { sendMessage } from "$components/ChatWindow/actions.js";
  import VideoPreview from "$components/ChatWindow/VideoPreview.svelte";
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
  import Recorder from "opus-recorder";

  export let replyTo;
  export let scrollElement;
  export let chat;
  export let messages;
  export let attachesDropout;
  export let chatSettings;
  export let botCommands = [];
  export let editingMessage = null;

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
  let showCommandsMenu = false;
  export let showStickerPanel = false;
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
  let lines = 0;

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

  async function onSend(event) {
    if (!newMessage.trim() && !attaches.length) return;
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
          const result = await $API.uploadAttachment(attach);
          if (result) _attaches.push(result);
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
        cancelEdit();
      }
      return;
    }

    const tempId = Date.now().toString();

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

    for (const attach of attaches) {
      const result = await $API.uploadAttachment(attach);
      if (result) {
        _attaches.push(result);
        attaches.splice(attaches.indexOf(attach), 1);
      } else alert("Не удалось загрузить!\n" + JSON.stringify(attach));
    }

    if (!textToSend && !_attaches.length) return;

    attaches.length = 0;
    elements.length = 0;

    try {
      await sendMessage(
        chat,
        chatSettings,
        messages,
        textToSend,
        _replyTo,
        _attaches,
        _elements,
      );
    } catch (e) {
      console.error(e);
    } finally {
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

  async function selectFile(type) {
    attachesDropout = null;

    const response = await invoke("pick", type !== "FILE" ? { type } : null);

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
    attaches.splice(index, 1);
    attaches = attaches;
  }

  let recordMode = 'voice';
  let isRecording = false;
  let isLocked = false;
  let recordTimer = null;
  let holdTimeout = null;
  let recordStartTime = 0;
  let elapsedMs = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let cancelDrag = 0;
  let lockDrag = 0;
  let liveAmplitudes = [];
  let mediaStream = null;
  let mediaRecorder = null;
  let opusRecorder = null;
  let opusRecordedBlob = null;
  let recordedChunks = [];
  let audioContext = null;
  let analyserNode = null;
  let animFrameId = null;
  let videoPreviewEl = null;
  let fallbackCanvasEl = null;
  let isFallbackVideo = false;
  let fallbackInterval = null;
  let videoFacingMode = 'user';

  $: if (videoPreviewEl && mediaStream && recordMode === 'video') {
    if (videoPreviewEl.srcObject !== mediaStream) {
      videoPreviewEl.srcObject = mediaStream;
      videoPreviewEl.play().catch(() => {});
    }
  }
  let isReviewingVideoNote = false;
  let reviewVideoBlob = null;
  let reviewVideoUrl = null;
  let reviewVideoDuration = 0;
  let reviewTrimStart = 0;
  let reviewTrimEnd = 0;
  let isReviewMuted = false;
  let reviewVideoEl = null;
  let isReviewPlaying = false;
  let reviewAmplitudes = [];
  let reviewCurrentTime = 0;
  let isReviewingVoice = false;
  let reviewAudioBlob = null;
  let reviewAudioUrl = null;
  let reviewAudioDuration = 0;
  let reviewAudioTrimStart = 0;
  let reviewAudioTrimEnd = 0;
  let reviewAudioEl = null;
  let reviewAudioPlaying = false;
  let reviewAudioCurrentTime = 0;
  let pointerDownTime = 0;
  let isHoldStarted = false;

  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  }

  function createFallbackAudioStream() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    const sampleRate = audioContext.sampleRate || 44100;
    const bufferSize = sampleRate * 2;
    const noiseBuffer = audioContext.createBuffer(1, bufferSize, sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.12;
    }
    const whiteNoise = audioContext.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 64;

    const destination = audioContext.createMediaStreamDestination();
    whiteNoise.connect(analyserNode);
    analyserNode.connect(destination);
    whiteNoise.start(0);

    return destination.stream;
  }

  function createFallbackVideoStream() {
    const audioStream = createFallbackAudioStream();
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const startT = Date.now();
    const imgData = ctx.createImageData(480, 480);
    const buf = new Uint32Array(imgData.data.buffer);

    const drawFrame = () => {
      for (let i = 0; i < buf.length; i++) {
        const v = (Math.random() * 255) | 0;
        buf[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      }
      ctx.putImageData(imgData, 0, 0);

      const sec = ((Date.now() - startT) / 1000).toFixed(1);
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(90, 210, 300, 60);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`TEST NOISE ${sec}s`, 240, 240);
      ctx.restore();

      if (fallbackCanvasEl) {
        const fctx = fallbackCanvasEl.getContext('2d');
        if (fctx) fctx.drawImage(canvas, 0, 0, fallbackCanvasEl.width, fallbackCanvasEl.height);
      }
    };

    drawFrame();
    fallbackInterval = setInterval(drawFrame, 40);

    let canvasStream;
    if (typeof canvas.captureStream === 'function') {
      canvasStream = canvas.captureStream(25);
    } else {
      canvasStream = new MediaStream();
    }

    const videoTrack = canvasStream.getVideoTracks()[0];
    const audioTrack = audioStream.getAudioTracks()[0];
    const combined = new MediaStream();
    if (videoTrack) combined.addTrack(videoTrack);
    if (audioTrack) combined.addTrack(audioTrack);
    return combined;
  }

  async function startRecording() {
    if (isRecording) return;
    stopCurrentMedia();
    recordedChunks = [];
    liveAmplitudes = [];
    elapsedMs = 0;
    cancelDrag = 0;
    lockDrag = 0;
    isLocked = false;
    isFallbackVideo = false;

    try {
      if (recordMode === 'voice') {
        if (!navigator?.mediaDevices?.getUserMedia) throw new Error("No mediaDevices");
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioContext.createMediaStreamSource(mediaStream);
          analyserNode = audioContext.createAnalyser();
          analyserNode.fftSize = 64;
          source.connect(analyserNode);
        } catch {}
      } else {
        if (!navigator?.mediaDevices?.getUserMedia) throw new Error("No mediaDevices");
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 } },
            audio: true,
          });
        } catch {
          try {
            mediaStream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: true,
            });
          } catch {
            const vStream = await navigator.mediaDevices.getUserMedia({ video: true });
            let aStream = null;
            try {
              aStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch {}
            mediaStream = new MediaStream();
            vStream.getVideoTracks().forEach(t => mediaStream.addTrack(t));
            if (aStream && aStream.getAudioTracks().length > 0) {
              aStream.getAudioTracks().forEach(t => mediaStream.addTrack(t));
            } else {
              const fallbackA = createFallbackAudioStream();
              fallbackA.getAudioTracks().forEach(t => mediaStream.addTrack(t));
            }
          }
        }
      }
    } catch (err) {
      if (recordMode === 'voice') {
        mediaStream = createFallbackAudioStream();
      } else {
        isFallbackVideo = true;
        mediaStream = createFallbackVideoStream();
      }
    }

    try {
      opusRecordedBlob = null;
      opusRecorder = null;
      if (recordMode === 'voice' && typeof Recorder !== 'undefined' && Recorder.isRecordingSupported()) {
        try {
          opusRecorder = new Recorder({
            encoderPath: '/encoderWorker.min.js',
            numberOfChannels: 1,
            encoderSampleRate: 48000,
            encoderApplication: 2049,
            streamPages: false,
          });
          opusRecorder.ondataavailable = (typedArray) => {
            opusRecordedBlob = new Blob([typedArray], { type: 'audio/ogg' });
          };
          await opusRecorder.start();
        } catch {
          opusRecorder = null;
        }
      }

      if (!opusRecorder) {
        let mimeType = '';
        if (recordMode === 'voice') {
          if (typeof MediaRecorder !== 'undefined') {
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
            else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';
            else if (MediaRecorder.isTypeSupported('audio/webm')) mimeType = 'audio/webm';
          }
        } else {
          if (typeof MediaRecorder !== 'undefined') {
            if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) mimeType = 'video/webm;codecs=vp8,opus';
            else if (MediaRecorder.isTypeSupported('video/webm')) mimeType = 'video/webm';
            else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
          }
        }

        mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
          }
        };

        mediaRecorder.start(100);
      }
      isRecording = true;
      recordStartTime = Date.now();

      recordTimer = setInterval(() => {
        elapsedMs = Date.now() - recordStartTime;
      }, 100);

      if (analyserNode) {
        const pcmData = new Uint8Array(analyserNode.frequencyBinCount);
        const pollAmp = () => {
          if (!isRecording) return;
          analyserNode.getByteFrequencyData(pcmData);
          let sum = 0;
          for (let i = 0; i < pcmData.length; i++) sum += pcmData[i];
          const avg = sum / pcmData.length;
          liveAmplitudes.push(avg);
          if (liveAmplitudes.length > 50) liveAmplitudes.shift();
          liveAmplitudes = liveAmplitudes;
          animFrameId = requestAnimationFrame(pollAmp);
        };
        pollAmp();
      }

      if (recordMode === 'video' && videoPreviewEl) {
        videoPreviewEl.srcObject = mediaStream;
        videoPreviewEl.play().catch(() => {});
      }
    } catch (recorderErr) {
      isRecording = false;
      stopRecordingTracks();
      showAlert('Ошибка записи');
    }
  }

  function stopRecordingTracks() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (recordTimer) clearInterval(recordTimer);
    if (fallbackInterval) {
      clearInterval(fallbackInterval);
      fallbackInterval = null;
    }
    isFallbackVideo = false;
    if (audioContext) {
      try { audioContext.close(); } catch {}
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    if (videoPreviewEl) {
      videoPreviewEl.srcObject = null;
    }
  }

  function cancelRecording() {
    if (!isRecording) return;
    isRecording = false;
    isLocked = false;
    stopRecordingTracks();
    if (opusRecorder) {
      try { opusRecorder.close(); } catch {}
      opusRecorder = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    opusRecordedBlob = null;
    recordedChunks = [];
    liveAmplitudes = [];
  }

  async function stopAndSendRecording() {
    if (!isRecording) return;
    const finalElapsed = elapsedMs;
    const wasLocked = isLocked;
    isRecording = false;
    isLocked = false;
    if (recordTimer) clearInterval(recordTimer);

    if (opusRecorder) {
      await new Promise((resolve) => {
        opusRecorder.onstop = resolve;
        opusRecorder.stop();
      });
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.requestData(); } catch {}
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        mediaRecorder.onstop = resolve;
        mediaRecorder.stop();
      });
    }

    stopRecordingTracks();

    if (finalElapsed < 800 || (recordedChunks.length === 0 && !opusRecordedBlob)) {
      if (opusRecorder) {
        try { opusRecorder.close(); } catch {}
        opusRecorder = null;
      }
      opusRecordedBlob = null;
      recordedChunks = [];
      liveAmplitudes = [];
      return;
    }

    const isVoice = recordMode === 'voice';
    const actualMime = (isVoice && opusRecordedBlob) ? 'audio/ogg' : (mediaRecorder?.mimeType || (isVoice ? 'audio/webm' : 'video/webm'));
    const ext = isVoice ? 'ogg' : (actualMime.includes('webm') ? 'webm' : 'mp4');
    const blob = (isVoice && opusRecordedBlob) ? opusRecordedBlob : new Blob(recordedChunks, { type: actualMime });

    if (wasLocked && isVoice) {
      reviewAmplitudes = [...liveAmplitudes];
      liveAmplitudes = [];
      recordedChunks = [];
      reviewAudioBlob = blob;
      reviewAudioUrl = URL.createObjectURL(blob);
      reviewAudioDuration = Math.max(0.5, finalElapsed / 1000);
      reviewAudioTrimStart = 0;
      reviewAudioTrimEnd = reviewAudioDuration;
      reviewAudioPlaying = false;
      reviewAudioCurrentTime = 0;
      isReviewingVoice = true;
      return;
    }

    const wave = Array.from(generateWaveformFromAmplitudes(liveAmplitudes, 80));
    liveAmplitudes = [];
    recordedChunks = [];

    const arrayBuffer = await blob.arrayBuffer();
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
      mime: actualMime,
    } : {
      type: 'VIDEO',
      videoType: 1,
      path: savedPath,
      duration: finalElapsed,
      wave,
      mime: actualMime,
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
      const uploaded = await $API.uploadAttachment(attachItem);
      if (uploaded) {
        messages.update(msgs => msgs.filter(m => m.id !== tempId));
        await sendMessage(chat, chatSettings, messages, '', replyTo, [uploaded], []);
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
    const finalElapsed = elapsedMs;
    isRecording = false;
    isLocked = false;
    if (recordTimer) clearInterval(recordTimer);
    reviewAmplitudes = [...liveAmplitudes];

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.requestData(); } catch {}
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      await new Promise((resolve) => {
        mediaRecorder.onstop = resolve;
        mediaRecorder.stop();
      });
    }

    stopRecordingTracks();

    if (finalElapsed < 800 || recordedChunks.length === 0) {
      recordedChunks = [];
      liveAmplitudes = [];
      return;
    }

    const actualMime = mediaRecorder?.mimeType || 'video/webm';
    reviewVideoBlob = new Blob(recordedChunks, { type: actualMime });
    reviewVideoUrl = URL.createObjectURL(reviewVideoBlob);
    reviewVideoDuration = Math.max(0.8, finalElapsed / 1000);
    reviewTrimStart = 0;
    reviewTrimEnd = reviewVideoDuration;
    isReviewMuted = false;
    isReviewingVideoNote = true;
  }

  function handleReviewTimeUpdate() {
    if (!reviewVideoEl) return;
    isReviewPlaying = !reviewVideoEl.paused;
    reviewCurrentTime = reviewVideoEl.currentTime;
    if (reviewVideoEl.currentTime >= reviewTrimEnd) {
      reviewVideoEl.currentTime = reviewTrimStart;
      reviewVideoEl.play().catch(() => {});
    }
  }

  function toggleReviewPlay() {
    if (!reviewVideoEl) return;
    if (reviewVideoEl.paused) {
      reviewVideoEl.play().catch(() => {});
      isReviewPlaying = true;
    } else {
      reviewVideoEl.pause();
      isReviewPlaying = false;
    }
  }

  function handleTrimStartChange(e) {
    let val = parseFloat(e?.currentTarget?.value ?? reviewTrimStart) || 0;
    if (val >= reviewTrimEnd - 0.5) {
      val = Math.max(0, reviewTrimEnd - 0.5);
    }
    reviewTrimStart = val;
    if (reviewVideoEl) {
      reviewVideoEl.currentTime = reviewTrimStart;
    }
  }

  function handleTrimEndChange(e) {
    let val = parseFloat(e?.currentTarget?.value ?? reviewTrimEnd) || 0;
    if (val <= reviewTrimStart + 0.5) {
      val = Math.min(reviewVideoDuration, reviewTrimStart + 0.5);
    }
    reviewTrimEnd = val;
    if (reviewVideoEl) {
      reviewVideoEl.currentTime = reviewTrimEnd;
    }
  }

  function discardReview() {
    if (reviewVideoUrl) {
      URL.revokeObjectURL(reviewVideoUrl);
      reviewVideoUrl = null;
    }
    reviewVideoBlob = null;
    isReviewingVideoNote = false;
    isReviewPlaying = false;
  }

  async function sendReviewedVideoNote() {
    if (!reviewVideoBlob) return;
    const arrayBuffer = await reviewVideoBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const actualMime = reviewVideoBlob.type || 'video/webm';
    const ext = actualMime.includes('webm') ? 'webm' : 'mp4';
    const savedPath = await invoke('save_temp_media', {
      bytes: Array.from(uint8),
      extension: ext,
      isVideo: true,
    });

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
      mime: actualMime,
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
      const uploaded = await $API.uploadAttachment(attachItem);
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
    isReviewingVoice = false;
    reviewAudioPlaying = false;
    reviewAudioCurrentTime = 0;
  }

  function toggleVoiceReviewPlay() {
    if (!reviewAudioEl) return;
    if (reviewAudioEl.paused) {
      reviewAudioEl.play().catch(() => {});
      reviewAudioPlaying = true;
    } else {
      reviewAudioEl.pause();
      reviewAudioPlaying = false;
    }
  }

  function handleVoiceReviewTimeUpdate() {
    if (!reviewAudioEl) return;
    reviewAudioCurrentTime = reviewAudioEl.currentTime;
    reviewAudioPlaying = !reviewAudioEl.paused;
    if (reviewAudioEl.currentTime >= reviewAudioTrimEnd) {
      reviewAudioEl.currentTime = reviewAudioTrimStart;
      reviewAudioEl.play().catch(() => {});
    }
  }

  function handleVoiceTrimStartChange(e) {
    let val = parseFloat(e?.currentTarget?.value ?? reviewAudioTrimStart) || 0;
    if (val >= reviewAudioTrimEnd - 0.3) {
      val = Math.max(0, reviewAudioTrimEnd - 0.3);
    }
    reviewAudioTrimStart = val;
    if (reviewAudioEl) reviewAudioEl.currentTime = reviewAudioTrimStart;
  }

  function handleVoiceTrimEndChange(e) {
    let val = parseFloat(e?.currentTarget?.value ?? reviewAudioTrimEnd) || 0;
    if (val <= reviewAudioTrimStart + 0.3) {
      val = Math.min(reviewAudioDuration, reviewAudioTrimStart + 0.3);
    }
    reviewAudioTrimEnd = val;
    if (reviewAudioEl) reviewAudioEl.currentTime = reviewAudioTrimEnd;
  }

  async function sendReviewedVoice() {
    if (!reviewAudioBlob) return;
    const arrayBuffer = await reviewAudioBlob.arrayBuffer();
    const trimmedDuration = Math.round(Math.max(0.3, reviewAudioTrimEnd - reviewAudioTrimStart) * 1000);
    const wave = Array.from(generateWaveformFromAmplitudes(reviewAmplitudes, 80));
    const actualMime = reviewAudioBlob.type || 'audio/webm';
    const ext = actualMime.includes('ogg') ? 'ogg' : 'webm';
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
      const uploaded = await $API.uploadAttachment(attachItem);
      if (uploaded) {
        messages.update(msgs => msgs.filter(m => m.id !== tempId));
        await sendMessage(chat, chatSettings, messages, '', replyTo, [uploaded], []);
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

  async function flipCamera() {
    videoFacingMode = videoFacingMode === 'user' ? 'environment' : 'user';
    if (!mediaStream) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: videoFacingMode, width: { ideal: 480 }, height: { ideal: 480 } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      const oldTrack = mediaStream.getVideoTracks()[0];
      if (oldTrack) {
        mediaStream.removeTrack(oldTrack);
        oldTrack.stop();
      }
      if (newTrack) {
        mediaStream.addTrack(newTrack);
      }
      if (videoPreviewEl) {
        videoPreviewEl.srcObject = mediaStream;
        videoPreviewEl.play().catch(() => {});
      }
    } catch {}
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
</script>

{#if attaches.length}
  <div class="selected-attaches">
    {#each attaches as attach, i}
      {@const attachType = attach.type || attach._type}
      <div class="attach-card">
        <button class="remove" on:click={() => removeAttach(i)}>✕</button>

        {#if attachType === "PHOTO"}
          <img src={attach.path ? convertFileSrc(attach.path) : (attach.url || attach.baseUrl)} alt="preview" />
        {:else if attachType === "VIDEO"}
          {#if attach.path}
            <VideoPreview {attach} />
          {:else}
            <div class="file-preview"><div class="file-icon">🎥</div><div class="file-name">Видео</div></div>
          {/if}
        {:else if attachType === "AUDIO"}
          <div class="file-preview"><div class="file-icon">🎵</div><div class="file-name">Голосовое</div></div>
        {:else}
          <div class="file-preview">
            <div class="file-icon">📄</div>
            <div class="file-name">
              {attach.name || (attach.path ? attach.path.split("/").pop() : "Файл")}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

{#if editingMessage}
  <div class="editing-banner">
    <div class="editing-icon">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
      </svg>
    </div>
    <div class="editing-details">
      <div class="editing-title">Редактирование сообщения</div>
      <div class="editing-snippet">{editingMessage.text || 'Вложения'}</div>
    </div>
    <button class="editing-cancel-btn" type="button" on:click={cancelEdit} title="Отменить">✕</button>
  </div>
{/if}

{#if replyTo}
  <Reply {chat} {messages} bind:replyTo />
{/if}

<svelte:window on:click={handleWindowClick} />

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
    <div class="video-recorder-preview-wrap">
      {#if isFallbackVideo}
        <canvas
          bind:this={fallbackCanvasEl}
          width="480"
          height="480"
          class="video-recorder-circle"
        ></canvas>
      {:else}
        <video
          bind:this={videoPreviewEl}
          class="video-recorder-circle"
          autoplay
          playsinline
          muted
        ></video>
      {/if}
      <button class="flip-camera-btn" type="button" on:click={flipCamera} title="Сменить камеру">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>
          <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/>
          <circle cx="12" cy="12" r="3"/>
          <path d="m18 22-3-3 3-3"/>
          <path d="m6 2 3 3-3 3"/>
        </svg>
      </button>
    </div>
  {/if}

  {#if isReviewingVoice}
    {@const voiceReviewBars = Array.from(generateWaveformFromAmplitudes(reviewAmplitudes, 60))}
    {@const voiceProgress = reviewAudioDuration > 0 ? Math.min(1, Math.max(0, (reviewAudioCurrentTime - reviewAudioTrimStart) / (reviewAudioTrimEnd - reviewAudioTrimStart))) : 0}
    <div class="voice-review-panel" transition:fade={{ duration: 180 }}>
      <audio
        bind:this={reviewAudioEl}
        src={reviewAudioUrl}
        on:loadedmetadata={() => {
          if (reviewAudioEl && isFinite(reviewAudioEl.duration) && reviewAudioEl.duration > 0) {
            const d = reviewAudioEl.duration;
            if (d > reviewAudioDuration) {
              reviewAudioDuration = d;
              if (reviewAudioTrimEnd >= d - 0.5) reviewAudioTrimEnd = d;
            }
          }
        }}
        on:timeupdate={handleVoiceReviewTimeUpdate}
        on:ended={() => { reviewAudioPlaying = false; }}
        preload="auto"
      ></audio>

      <button class="review-action-btn trash" type="button" on:click={discardVoiceReview} title="Удалить">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      </button>

      <div class="voice-review-content">
        <button class="voice-review-play-btn" type="button" on:click={toggleVoiceReviewPlay}>
          {#if reviewAudioPlaying}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {/if}
        </button>

        <div class="voice-review-wave-wrap">
          <svg class="voice-review-wave-svg" viewBox="0 0 {Math.max(1, voiceReviewBars.length * 3)} 24" preserveAspectRatio="none">
            {#each voiceReviewBars as bar, i}
              {@const h = Math.max(2, Math.round(bar * 22))}
              {@const played = (i + 0.5) / voiceReviewBars.length <= voiceProgress}
              <rect x={i * 3} y={(24 - h) / 2} width="2" height={h} rx="1" fill={played ? '#38bdf8' : 'rgba(255,255,255,0.3)'} />
            {/each}
          </svg>
          <div class="trim-sliders" style="position:relative;height:20px;margin-top:4px;">
            <input type="range" min="0" max={reviewAudioDuration} step="0.05"
              bind:value={reviewAudioTrimStart} on:input={handleVoiceTrimStartChange}
              class="trim-slider trim-slider-start" aria-label="Начало" />
            <input type="range" min="0" max={reviewAudioDuration} step="0.05"
              bind:value={reviewAudioTrimEnd} on:input={handleVoiceTrimEndChange}
              class="trim-slider trim-slider-end" aria-label="Конец" />
          </div>
          <div class="review-trim-times" style="font-size:10px;display:flex;justify-content:space-between;color:rgba(255,255,255,0.5);margin-top:2px;">
            <span>{formatSeconds(reviewAudioTrimStart)}</span>
            <span style="color:#248bfe;font-weight:600;">{(reviewAudioTrimEnd - reviewAudioTrimStart).toFixed(1)}s</span>
            <span>{formatSeconds(reviewAudioTrimEnd)}</span>
          </div>
        </div>
      </div>

      <button class="review-action-btn send" type="button" on:click={sendReviewedVoice} title="Отправить">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  {:else if isReviewingVideoNote}
    {@const reviewDur = reviewTrimEnd - reviewTrimStart}
    {@const reviewProgress = reviewDur > 0 ? Math.min(1, Math.max(0, (reviewCurrentTime - reviewTrimStart) / reviewDur)) : 0}
    {@const ringSize = 200}
    {@const ringStroke = 4}
    {@const ringRadius = (ringSize - ringStroke) / 2}
    {@const ringCirc = 2 * Math.PI * ringRadius}
    <div class="video-review-circle-wrap" transition:scale={{ duration: 220, start: 0.85 }}>
      <svg class="review-progress-ring" width={ringSize} height={ringSize} style="position:absolute;top:0;left:0;z-index:10;transform:rotate(-90deg);pointer-events:none;">
        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} stroke="rgba(255,255,255,0.15)" stroke-width={ringStroke} fill="none" />
        <circle cx={ringSize/2} cy={ringSize/2} r={ringRadius} stroke="#38bdf8" stroke-width={ringStroke} fill="none"
          stroke-linecap="round"
          stroke-dasharray={ringCirc}
          stroke-dashoffset={ringCirc - reviewProgress * ringCirc}
        />
      </svg>
      <div class="video-review-circle-container" on:click={toggleReviewPlay} role="button" tabindex="0" on:keydown={(e) => { if (e.key === ' ' || e.key === 'Enter') toggleReviewPlay(); }}>
        <video
          bind:this={reviewVideoEl}
          src={reviewVideoUrl}
          autoplay
          playsinline
          muted={isReviewMuted}
          on:loadedmetadata={() => {
            if (reviewVideoEl && isFinite(reviewVideoEl.duration) && reviewVideoEl.duration > 0) {
              const d = reviewVideoEl.duration;
              if (d > reviewVideoDuration) {
                reviewVideoDuration = d;
                if (reviewTrimEnd >= d - 0.5) reviewTrimEnd = d;
              }
            }
          }}
          on:timeupdate={handleReviewTimeUpdate}
          on:ended={() => {
            if (reviewVideoEl) {
              reviewVideoEl.currentTime = reviewTrimStart;
              reviewVideoEl.play().catch(() => {});
            }
          }}
          class="video-review-circle"
        ></video>
        {#if !isReviewPlaying}
          <div class="video-review-play-overlay">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor">
              <polygon points="8,5 19,12 8,19"/>
            </svg>
          </div>
        {/if}
      </div>
    </div>

    <div class="video-review-controls-bar" transition:fade={{ duration: 180 }}>
      <button class="review-action-btn trash" type="button" on:click={discardReview} title="Удалить">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      </button>

      <div class="review-trim-container">
        <div class="review-trim-times">
          <span>{formatSeconds(reviewTrimStart)}</span>
          <span class="review-trim-duration">{(reviewTrimEnd - reviewTrimStart).toFixed(1)}s</span>
          <span>{formatSeconds(reviewTrimEnd)}</span>
        </div>
        <div class="trim-sliders">
          <input
            type="range"
            min="0"
            max={reviewVideoDuration}
            step="0.05"
            bind:value={reviewTrimStart}
            on:input={handleTrimStartChange}
            class="trim-slider trim-slider-start"
            aria-label="Начало обрезки"
          />
          <input
            type="range"
            min="0"
            max={reviewVideoDuration}
            step="0.05"
            bind:value={reviewTrimEnd}
            on:input={handleTrimEndChange}
            class="trim-slider trim-slider-end"
            aria-label="Конец обрезки"
          />
        </div>
      </div>

      <button class="review-action-btn mute" type="button" on:click={() => (isReviewMuted = !isReviewMuted)} title={isReviewMuted ? "Включить звук" : "Выключить звук"}>
        {#if isReviewMuted}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.78 4.78H4v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        {/if}
      </button>

      <button class="review-action-btn send" type="button" on:click={sendReviewedVideoNote} title="Отправить">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  {:else}
    <div class="input-controls">
      {#if isRecording}
        <div class="recording-bar">
          <div class="rec-dot"></div>
          <span class="rec-timer">{formatElapsed(elapsedMs)}</span>
          {#if recordMode === 'voice'}
            <svg class="rec-wave-svg" viewBox="0 0 {Math.max(1, liveAmplitudes.length * 3)} 24" preserveAspectRatio="none">
              {#each liveAmplitudes as amp, i}
                {@const h = Math.max(2, Math.round((amp / 255) * 22))}
                <rect x={i * 3} y={(24 - h) / 2} width="2" height={h} rx="1" fill="#248bfe" />
              {/each}
            </svg>
          {:else}
            <span class="rec-video-label">Запись видеосообщения</span>
          {/if}
          {#if !isLocked}
            <div class="rec-cancel-slide" style="transform: translateX(-{cancelDrag * 0.3}px)">
              <span class="rec-slide-chevron">‹</span>
              <span>Проведите для отмены</span>
            </div>
            <div class="rec-lock-slide" class:reached={lockDrag >= 60}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
              </svg>
            </div>
          {:else}
            <button class="rec-trash-btn" type="button" on:click={cancelRecording} title="Удалить">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
            {#if recordMode === 'video'}
              <button class="rec-stop-btn" type="button" on:click={handleLockedStop} title="Остановить и просмотреть">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" ry="2"/>
                </svg>
              </button>
            {/if}
          {/if}
        </div>

      {#if isLocked}
        <button class="button send-button" type="button" on:click={stopAndSendRecording} title="Отправить">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      {:else}
        <div class="button recording-pulse-btn">
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
        </div>
      {/if}
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
        <div class="attaches-dropout">
          <button type="button" class="dropout-item" on:click={() => selectFile("PHOTO")}>
            <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span>Изображение</span>
          </button>
          <button type="button" class="dropout-item" on:click={() => selectFile("VIDEO")}>
            <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="23 7 16 12 23 17 23 7"/>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
            <span>Видео</span>
          </button>
          <button type="button" class="dropout-item" on:click={() => selectFile("FILE")}>
            <svg class="dropout-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
            <span>Файл</span>
          </button>
        </div>
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
</div>

<style>
  .input-area {
    position: relative;
    padding: 0;
    flex-shrink: 0;
    background: #17191d;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    z-index: 10;
  }

  .input-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
    padding: 8px 12px 10px;
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

  .attaches-dropout {
    position: absolute;
    bottom: 54px;
    left: 0;
    background: #1e2025;
    border: none;
    border-radius: 14px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 40;
    min-width: 165px;
    animation: dropout-fade 0.12s ease-out;
  }

  @keyframes dropout-fade {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .dropout-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: transparent;
    border: none;
    color: #e1e4ea;
    padding: 9px 12px;
    border-radius: 10px;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background-color 0.12s ease;
  }

  .dropout-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .dropout-svg {
    color: #e1e4ea;
    flex-shrink: 0;
  }

  .selected-attaches {
    width: 100%;
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    flex-shrink: 0;
    overflow-x: auto;
    background-color: #17191d;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .attach-card {
    position: relative;
    width: 70px;
    height: 70px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .attach-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .attach-card .remove {
    position: absolute;
    top: 3px;
    right: 3px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    cursor: pointer;
    z-index: 2;
  }

  .file-preview {
    text-align: center;
    padding: 4px;
  }

  .file-icon {
    font-size: 18px;
  }

  .file-name {
    font-size: 10px;
    color: #aaa;
    max-width: 60px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .video-recorder-preview-wrap {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 200px;
    z-index: 50;
    pointer-events: none;
  }

  .flip-camera-btn {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    pointer-events: auto;
    transition: transform 0.15s ease, background 0.15s ease;
  }

  .flip-camera-btn:hover {
    background: rgba(0, 0, 0, 0.85);
    transform: scale(1.08);
  }

  .video-recorder-circle {
    width: 200px;
    height: 200px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #248bfe;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    background: #000;
  }

  .video-review-circle-wrap {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 200px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .voice-review-panel {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 10px;
    min-height: 48px;
    box-sizing: border-box;
  }

  .voice-review-content {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .voice-review-play-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: #3b82f6;
    border: none;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
  }

  .voice-review-wave-wrap {
    flex: 1;
    min-width: 0;
  }

  .voice-review-wave-svg {
    width: 100%;
    height: 24px;
    display: block;
  }

  .video-review-circle-container {
    position: relative;
    width: 200px;
    height: 200px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    border: 3px solid #248bfe;
    cursor: pointer;
    background: #000;
  }

  .video-review-circle {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }

  .video-review-play-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    border: none;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .video-review-controls-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px 10px;
    background-color: #17191d;
    box-sizing: border-box;
  }

  .review-action-btn {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, background-color 0.15s;
    flex-shrink: 0;
  }

  .review-action-btn:hover {
    transform: scale(1.08);
  }

  .review-action-btn.trash {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .review-action-btn.trash:hover {
    background: rgba(239, 68, 68, 0.3);
  }

  .review-action-btn.mute {
    background: #262930;
    color: #94a3b8;
  }

  .review-action-btn.mute:hover {
    background: #323640;
    color: #edf0f5;
  }

  .review-action-btn.send {
    background: #248bfe;
    color: #fff;
  }

  .review-action-btn.send:hover {
    background: #1b7cf0;
  }

  .review-trim-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .review-trim-times {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }

  .review-trim-duration {
    font-weight: 600;
    color: #248bfe;
  }

  .trim-sliders {
    position: relative;
    height: 20px;
    display: flex;
    align-items: center;
  }

  .trim-slider {
    position: absolute;
    width: 100%;
    pointer-events: none;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    height: 6px;
    margin: 0;
  }

  .trim-slider::-webkit-slider-runnable-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .trim-slider::-webkit-slider-thumb {
    pointer-events: auto;
    appearance: none;
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #248bfe;
    cursor: ew-resize;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.4);
    margin-top: -5px;
  }

  .trim-slider-end {
    z-index: 2;
  }

  .trim-slider-end::-webkit-slider-runnable-track {
    background: transparent;
  }

  .recording-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background-color: #1e2025;
    border-radius: 18px;
    flex-grow: 1;
    min-height: 48px;
    padding: 0 16px;
    box-sizing: border-box;
  }

  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
    animation: rec-blink 1s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes rec-blink {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  .rec-timer {
    font-size: 14px;
    font-weight: 600;
    color: #edf0f5;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .rec-wave-svg {
    flex: 1;
    height: 24px;
    min-width: 0;
    overflow: visible;
  }

  .rec-video-label {
    font-size: 13px;
    color: #94a3b8;
    flex: 1;
  }

  .rec-cancel-slide {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: #64748b;
    white-space: nowrap;
    transition: transform 0.05s linear;
  }

  .rec-slide-chevron {
    font-size: 16px;
    animation: slide-chevron 1.2s infinite;
  }

  @keyframes slide-chevron {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(-4px); }
  }

  .rec-lock-slide {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    color: #94a3b8;
    transition: all 0.2s ease;
    flex-shrink: 0;
  }

  .rec-lock-slide.reached {
    background: #248bfe;
    color: #fff;
  }

  .rec-trash-btn {
    background: transparent;
    border: none;
    color: #ef4444;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
  }

  .rec-trash-btn:hover {
    background: rgba(239, 68, 68, 0.15);
  }

  .rec-stop-btn {
    background: transparent;
    border: none;
    color: #edf0f5;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
  }

  .rec-stop-btn:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .recording-pulse-btn {
    background: #248bfe;
    color: #fff;
    animation: rec-btn-pulse 1.5s infinite;
  }

  @keyframes rec-btn-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  .editing-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: #17191d;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid #248bfe;
  }

  .editing-icon {
    color: #248bfe;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .editing-details {
    flex: 1;
    min-width: 0;
  }

  .editing-title {
    font-size: 13px;
    font-weight: 600;
    color: #248bfe;
  }

  .editing-snippet {
    font-size: 12px;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .editing-cancel-btn {
    background: transparent;
    border: none;
    color: #8b929e;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: color 0.15s ease;
  }

  .editing-cancel-btn:hover {
    color: #fff;
  }
</style>
