<script>
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { platform } from "@tauri-apps/plugin-os";
  import { tick } from "svelte";
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

  export let replyTo;
  export let scrollElement;
  export let chat;
  export let messages;
  export let attachesDropout;
  export let chatSettings;
  export let botCommands = [];

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
    chatCache.updateMessages([displayMessageEarlyEntry]);

    messages.update(msgs => [...msgs, displayMessageEarlyEntry]);

    newMessage = "";
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

    let newLines = (textareaEl.value.match(/\n/g) || []).length + 1;
    if (newLines < lines) textareaEl.style.height = "auto";
    else textareaEl.style.height = textareaEl.scrollHeight + "px";

    lines = newLines;
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
  let recordedChunks = [];
  let audioContext = null;
  let analyserNode = null;
  let animFrameId = null;
  let videoPreviewEl = null;

  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
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

    try {
      if (recordMode === 'voice') {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioContext.createMediaStreamSource(mediaStream);
          analyserNode = audioContext.createAnalyser();
          analyserNode.fftSize = 64;
          source.connect(analyserNode);
        } catch {}
      } else {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
          audio: true,
        });
      }

      const mimeType = recordMode === 'voice'
        ? (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : 'audio/webm'))
        : (MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'));

      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.start(100);
      isRecording = true;
      recordStartTime = Date.now();

      recordTimer = setInterval(() => {
        elapsedMs = Date.now() - recordStartTime;
      }, 100);

      if (recordMode === 'voice' && analyserNode) {
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
    } catch (err) {
      isRecording = false;
      showAlert('Нет доступа к микрофону или камере');
    }
  }

  function stopRecordingTracks() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (recordTimer) clearInterval(recordTimer);
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
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    recordedChunks = [];
    liveAmplitudes = [];
  }

  async function stopAndSendRecording() {
    if (!isRecording) return;
    const finalElapsed = elapsedMs;
    isRecording = false;
    isLocked = false;
    stopRecordingTracks();

    if (finalElapsed < 800) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      return;
    }

    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    await new Promise((resolve) => {
      mediaRecorder.onstop = resolve;
      mediaRecorder.stop();
    });

    const isVoice = recordMode === 'voice';
    const blob = new Blob(recordedChunks, { type: isVoice ? 'audio/ogg' : 'video/mp4' });
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    let thumbnail = null;
    if (!isVoice && videoPreviewEl) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 240;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoPreviewEl, 0, 0, 240, 240);
        thumbnail = canvas.toDataURL('image/jpeg', 0.7);
      } catch {}
    }

    const ext = isVoice ? 'ogg' : 'mp4';
    const savedPath = await invoke('save_temp_media', {
      bytes: Array.from(uint8),
      extension: ext,
    });

    const wave = isVoice ? Array.from(generateWaveformFromAmplitudes(liveAmplitudes, 80)) : null;

    const attachItem = isVoice
      ? {
          type: 'AUDIO',
          path: savedPath,
          duration: finalElapsed,
          wave,
          mime: 'audio/ogg',
        }
      : {
          type: 'VIDEO',
          videoType: 1,
          path: savedPath,
          duration: finalElapsed,
          thumbnail,
          mime: 'video/mp4',
        };

    const uploaded = await $API.uploadAttachment(attachItem);
    if (uploaded) {
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
    }
  }

  function handleRecordPointerDown(e) {
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    cancelDrag = 0;
    lockDrag = 0;

    holdTimeout = setTimeout(() => {
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
    clearTimeout(holdTimeout);
    window.removeEventListener('pointermove', handleRecordPointerMove);
    window.removeEventListener('pointerup', handleRecordPointerUp);

    if (!isRecording) {
      recordMode = recordMode === 'voice' ? 'video' : 'voice';
      return;
    }

    if (!isLocked) {
      stopAndSendRecording();
    }
  }
</script>

{#if attaches.length}
  <div class="selected-attaches">
    {#each attaches as attach, i}
      <div class="attach-card">
        <button class="remove" on:click={() => removeAttach(i)}>✕</button>

        {#if attach.type === "PHOTO"}
          <img src={convertFileSrc(attach.path)} alt="preview" />
        {:else if attach.type === "VIDEO"}
          <VideoPreview {attach} />
        {:else}
          <div class="file-preview">
            <div class="file-icon">📄</div>
            <div class="file-name">
              {attach.path.split("/").pop()}
            </div>
          </div>
        {/if}
      </div>
    {/each}
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
      <video
        bind:this={videoPreviewEl}
        class="video-recorder-circle"
        autoplay
        playsinline
        muted
      ></video>
    </div>
  {/if}

  <div class="input-controls">
    {#if isRecording}
      <div class="recording-bar">
        <div class="rec-dot"></div>
        <span class="rec-timer">{formatElapsed(elapsedMs)}</span>
        {#if recordMode === 'voice'}
          <div class="rec-wave">
            {#each liveAmplitudes.slice(-24) as amp}
              <div class="rec-wave-bar" style="height: {Math.max(4, Math.min(22, (amp / 255) * 22))}px;"></div>
            {/each}
          </div>
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
        on:click={toggleAttachesDropout}
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
    overflow-y: hidden;
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

  .video-recorder-circle {
    width: 200px;
    height: 200px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #248bfe;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    background: #000;
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

  .rec-wave {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 24px;
    flex: 1;
    overflow: hidden;
  }

  .rec-wave-bar {
    width: 2px;
    background: #248bfe;
    border-radius: 1px;
    min-height: 4px;
    transition: height 0.05s ease;
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

  .recording-pulse-btn {
    background: #248bfe;
    color: #fff;
    animation: rec-btn-pulse 1.5s infinite;
  }

  @keyframes rec-btn-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
</style>
