<script>
  import { createEventDispatcher } from "svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Session from "$lib/stores/session";
  import { currentUser } from "$lib/stores/api";

  export let chat;
  export let avatarUserId;
  export let title = "";

  const dispatch = createEventDispatcher();

  function handleClose() {
    dispatch("close");
  }

  function handleOpenSettings() {
    dispatch("openSettings");
  }

  function handleProfileClick() {
    if (!chat) return;
    if (chat.id === 0) {
      $Session.profile = { userId: $currentUser };
    } else if (chat.type === "DIALOG") {
      $Session.profile = { userId: avatarUserId };
    } else {
      $Session.profile = { chatId: chat.id };
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
    {#if chat && chat.type !== "CHANNEL"}
      <button class="icon-button" on:click|stopPropagation={handleOpenSettings} aria-label="Settings">
        <img src="icons/params.svg" alt="settings" />
      </button>
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
    width: 100vw;
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
    min-width: 0;
  }

  header .align-right {
    flex: 0 0 auto;
    margin-left: auto;
    margin-right: 0;
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
</style>
