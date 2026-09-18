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
  let showStickerPanel = false;
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
          const idx = msgs.findIndex(m => String(m.id) === String(tempId));
          if (idx !== -1) {
            msgs[idx] = fullMsg;
            return [...msgs];
          }
          return [...msgs, fullMsg];
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

  <div class="input-controls">
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
      <button class="button voice-button" type="button" title="Голосовое сообщение">
        <img src="icons/voice.svg" alt="voice" style="transform: scale(1.1, 1)" />
      </button>
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
    padding: 8px 12px 10px;
    flex-shrink: 0;
    background: #17191d;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    z-index: 10;
  }

  .input-controls {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    position: relative;
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
    width: 40px;
    height: 40px;
    margin-right: 4px;
    margin-bottom: 4px;
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
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.65;
    color: #aaa;
    margin-bottom: 6px;
    border-radius: 8px;
    flex-shrink: 0;
    transition: opacity 0.2s, color 0.15s, background-color 0.15s;
  }

  .bot-cmd-btn:hover {
    opacity: 1;
    color: #248bfe;
    background: rgba(36, 139, 254, 0.1);
  }

  .bot-cmd-btn.active {
    opacity: 1;
    color: #248bfe;
  }

  .slash-icon {
    font-size: 18px;
    font-weight: 700;
    font-family: monospace, sans-serif;
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
</style>
