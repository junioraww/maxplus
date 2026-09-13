<script>
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { platform } from "@tauri-apps/plugin-os";
  import { tick } from "svelte";

  import { scrollToBottom } from "$lib/utils/scroll.js";
  import { sendMessage } from "$components/ChatWindow/actions.js";
  import VideoPreview from "$components/ChatWindow/VideoPreview.svelte";
  import Reply from "$components/ChatWindow/input/Reply.svelte";
  import API from "$lib/stores/api";

  export let replyTo;
  export let scrollElement;
  export let chat;
  export let messages;
  export let attachesDropout;
  export let chatSettings;

  let newMessage = "";
  let attaches = [];
  let elements = [];

  let textareaEl;
  let lines = 0;

  const currentPlatform = platform();
  const isMobile = currentPlatform === "android" || currentPlatform === "ios";

  async function onSend(event) {
    if (!newMessage.trim() && !attaches.length) return;
    const textToSend = newMessage;
    const tempId = Date.now().toString();

    newMessage = "";
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
  }

  async function selectFile(type) {
    attachesDropout = null;

    const response = await invoke("pick", type !== "FILE" ? { type } : null);

    console.log("Selected", JSON.stringify(response));

    if (!response || response === "CANCEL") return;
    const { uri, mime_type: mime } = response;

    const path = decodeURIComponent(uri);

    let scrollAfter =
      scrollElement.scrollHeight -
        scrollElement.scrollTop -
        scrollElement.clientHeight ===
        0 && !attaches.length;

    attaches.push({
      path,
      type,
      mime,
    });
    attaches = attaches;

    //if (scrollAfter) scrollToBottom(scrollElement);
  }

  function removeAttach(index) {
    attaches.splice(index, 1);
    attaches = attaches;
  }

  function getVideoFrame(fileUrl) {
    return new Promise((resolve) => {
      const video = document.createElement("video");

      video.src = fileUrl;
      video.muted = true;
      video.playsInline = true;

      video.addEventListener("loadeddata", async () => {
        video.currentTime = 0.1;
      });

      video.addEventListener("seeked", () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);

        resolve(canvas.toDataURL("image/jpeg", 0.8));
      });
    });
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

<div class="input-area">
  <div class="input-controls">
    <button class="button input-button" on:click={toggleAttachesDropout}>
      <img
        src="icons/attachment.png"
        style="transform: scale(0.6) rotate(70deg)"
        class="icon"
      />
    </button>

    {#if attachesDropout}
      <div class="attaches-dropout">
        <button on:click={() => selectFile("PHOTO")}>Изображение</button>
        <button on:click={() => selectFile("VIDEO")}>Видео</button>
        <button on:click={() => selectFile("FILE")}>Файл</button>
      </div>
    {/if}

    <div class="input-container">
      <textarea
        bind:this={textareaEl}
        id="textarea-{chat.id}"
        rows="1"
        placeholder="Сообщение"
        bind:value={newMessage}
        on:input={autoResize}
        on:keydown={async (e) => {
          if (e.key === "Enter" && !e.shiftKey && !isMobile) {
            e.preventDefault();
            await onSend();
          }
        }}
      ></textarea>

      <button class="emoji-btn" type="button" on:click={() => {}}>
        <img src="icons/smile.svg" alt="smile" />
      </button>
    </div>

    {#if newMessage.length || attaches.length}
      <button class="button" on:click={onSend}>
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
    {:else}
      <button class="button">
        <img src="icons/voice.svg" style="transform: scale(1.1, 1)" />
      </button>
    {/if}
  </div>
</div>

<style>
  .input-area {
    padding: 8px 0;
    flex-shrink: 0;
    background-color: #1e2024;
    z-index: 5;
  }

  .input-controls {
    display: flex;
    align-items: flex-end;
  }

  .input-container {
    display: flex;
    align-items: flex-end;
    background-color: #17191d;
    border-radius: 12px;
    flex-grow: 1;
    min-height: 50px;
    box-sizing: border-box;
    border: 1px solid transparent;
  }

  .attaches-dropout {
    position: absolute;
    bottom: 60px;
    left: 0px;
    background-color: #17191d;
    border: 1px solid #333;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    z-index: 10;
  }

  .attaches-dropout button {
    background: none;
    border: none;
    color: #fff;
    padding: 16px 32px;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
  }

  .attaches-dropout button:hover {
    background-color: #2a2c31;
  }

  textarea {
    box-sizing: border-box;
    flex-grow: 1;
    background-color: transparent;
    color: #ddd;
    border: none;
    resize: none;
    overflow-y: hidden;
    min-height: 45px;
    max-height: 120px;
    font-size: 17px;
    line-height: 24px;
    padding: 8px 12px;
    outline: none;
    font-family: inherit;
    width: 0;
  }

  textarea::placeholder {
    color: #555;
  }

  .emoji-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
    transition:
      opacity 0.2s,
      transform 0.2s;
    flex-shrink: 0;
  }

  .emoji-btn img {
    width: 22px;
    height: 25px;
    transform: scale(1.2);
    margin-right: 2px;
  }

  .emoji-btn:active {
    transform: scale(0.9);
  }

  .button {
    border: none;
    width: 60px;
    height: 50px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.2s;
    background: none;
    opacity: 0.6;
  }

  .button:active {
    transform: scale(0.9);
  }

  .button svg {
    fill: white;
    width: 24px;
    height: 24px;
  }

  .selected-attaches {
    width: 100vw;
    display: flex;
    gap: 8px;
    padding: 8px;
    flex-shrink: 0;
    overflow-x: auto;
    background-color: #1e2024;
    z-index: 5;
  }

  .attach-card {
    position: relative;
    width: 75px;
    height: 75px;
    border-radius: 12px;
    background: #2a2c31aa;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .attach-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .file-preview {
    text-align: center;
    padding: 6px;
  }

  .file-icon {
    font-size: 16px;
  }

  .file-name {
    font-size: 8px;
    color: #ccc;
    word-break: break-word;
  }

  .remove {
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.3);
    border: none;
    color: white;
    border-radius: 50%;
    width: 18px;
    height: 18px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
  }
</style>
