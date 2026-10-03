<script>
  import { createEventDispatcher } from "svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Session from "$lib/stores/session";
  import { currentUser } from "$lib/stores/api";
  import { getChatSettings } from "$lib/stores/messages";
  import { getContact } from "$lib/stores/contacts";
  import { CallService } from "$lib/services/CallService.js";

  export let chat;
  export let avatarUserId;
  export let title = "";

  const dispatch = createEventDispatcher();

  $: chatSettings = chat?.id != null ? getChatSettings(chat.id) : null;
  $: fingerprint = $chatSettings?.session?.fingerprint;
  $: peerContact = avatarUserId ? getContact(avatarUserId) : null;
  $: canCall = Boolean(
    chat &&
    chat.type === "DIALOG" &&
    avatarUserId &&
    Number(avatarUserId) !== Number($currentUser) &&
    !$peerContact?.bot &&
    !$peerContact?.options?.includes("BOT") &&
    $peerContact?.status !== "REMOVED" &&
    $peerContact?.accountStatus !== "DELETED"
  );

  function getFingerprintEmojis(val) {
    if (!val) return [];
    let raw = [];
    if (Array.isArray(val)) {
      raw = val;
    } else if (typeof Intl !== "undefined" && Intl.Segmenter) {
      raw = Array.from(new Intl.Segmenter().segment(String(val)), (s) => s.segment);
    } else {
      raw = Array.from(String(val));
    }
    return raw.filter((s) => s.trim().length > 0).slice(0, 4);
  }

  function handleClose() {
    dispatch("close");
  }

  function handleOpenSettings() {
    dispatch("openSettings");
  }

  function handleProfileClick() {
    if (!chat) return;
    if (chat.id === 0) {
      $Session.profile = { userId: $currentUser, chatId: 0 };
    } else if (chat.type === "DIALOG") {
      $Session.profile = { userId: avatarUserId, chatId: chat.id };
    } else {
      $Session.profile = { chatId: chat.id };
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpenSettings();
    }
  }
</script>

<header>
  <div class="align-left">
    <button
      class="icon-button"
      on:click|stopPropagation={handleClose}
      aria-label="Back"
    >
      <img src="icons/arrow.svg" alt="back" style="transform: scale(-1.7)" />
    </button>
    <div
      class="row"
      on:click={handleProfileClick}
    >
      <Avatar size={42} {chat} contactId={avatarUserId} style="margin-left: -8px; cursor: pointer;"/>
      <div class="info">
        <a class="title">{title}</a>
        <a class="presence"><Signature {chat} contactId={avatarUserId} /></a>
      </div>
    </div>
  </div>
  <div class="align-right">
    {#if canCall}
      <button
        class="header-call-btn"
        type="button"
        on:click|stopPropagation={() => CallService.placeAudioCall(avatarUserId, title, $peerContact?.avatar || $peerContact?.baseUrl)}
        title="Позвонить"
        aria-label="Позвонить"
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </button>
    {/if}
    {#if chat && chat.type !== "CHANNEL" && chat.type !== "CHAT"}
      {#if fingerprint}
        <div
          class="fingerprint-badge"
          role="button"
          tabindex="0"
          on:click|stopPropagation={handleOpenSettings}
          on:keydown|stopPropagation={handleKeyDown}
          title="Ключ сессии: {fingerprint}"
          aria-label="Ключ сессии"
        >
          <div class="fingerprint-grid">
            {#each getFingerprintEmojis(fingerprint) as emoji}
              <span>{emoji}</span>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    padding: 8px 0;
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
    flex: 1;
    min-width: 0;
  }

  header .align-right {
    flex: 0 0 auto;
    margin-left: auto;
    margin-right: 8px;
    display: flex;
    align-items: center;
  }

  .icon-button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    height: 40px;
    width: 40px;
    padding: 0;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;
  }

  .icon-button img {
    transform: scale(1.1) translateX(-5px);
  }

  .fingerprint-badge {
    border: none;
    background: transparent;
    border-radius: 6px;
    margin-right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    user-select: none;
  }

  .fingerprint-grid {
    display: grid;
    grid-template-columns: 14px 14px;
    grid-template-rows: 14px 14px;
    gap: 2px;
    width: 30px;
    height: 30px;
    box-sizing: border-box;
  }

  .fingerprint-grid span {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    font-size: 11px;
    line-height: 1;
    overflow: hidden;
  }

  .header-call-btn {
    background: none;
    border: none;
    color: #a0a5b1;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background-color 0.15s, transform 0.1s;
    margin-right: 4px;
  }

  .header-call-btn:hover {
    color: var(--accent-primary, #248bfe);
    background-color: rgba(255, 255, 255, 0.06);
  }

  .header-call-btn:active {
    transform: scale(0.92);
  }
</style>
