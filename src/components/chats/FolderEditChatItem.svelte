<script>
  import { get } from "svelte/store";
  import { currentUser } from "$lib/stores/api";
  import { getContact } from "$lib/stores/contacts";
  import Avatar from "$components/main/Avatar.svelte";

  export let includedChats;
  export let toggleChat;
  export let chat;

  $: peerId =
    chat.type === "DIALOG" || chat.type === "private" || !chat.title
      ? chat.ownerId === $currentUser
        ? chat.id
        : (chat.ownerId || +Object.keys(chat.participants || {}).find((id) => +id !== $currentUser) || chat.id)
      : null;

  $: contact = peerId ? get(getContact(peerId)) : null;

  $: title =
    chat.id === 0
      ? "Избранное"
      : chat.title || contact?.names?.[0]?.name || "Без названия";
</script>

<div class="chat-row" on:click={() => toggleChat(chat.id)}>
  <div class="checkbox" class:checked={includedChats.includes(chat.id)}>
    {#if includedChats.includes(chat.id)}✓{/if}
  </div>
  <div class="avatar-wrap">
    <Avatar {chat} contactId={peerId} size={36} />
  </div>
  <div class="chat-info">
    <span class="chat-name">{title}</span>
    <span class="chat-type">
      {chat.type === "DIALOG" ? "Диалог" : (chat.type === "CHANNEL" ? "Канал" : "Группа")}
    </span>
  </div>
</div>

<style>
  .chat-row {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid #282830;
    gap: 10px;
    transition: background 0.15s;
  }

  .chat-row:last-child {
    border-bottom: none;
  }

  .chat-row:hover {
    background: #282832;
  }

  .checkbox {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid #555;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: bold;
    color: #fff;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s;
  }

  .checkbox.checked {
    background: #007afd;
    border-color: #007afd;
  }

  .avatar-wrap {
    flex-shrink: 0;
  }

  .chat-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .chat-name {
    font-size: 14px;
    font-weight: 500;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chat-type {
    font-size: 11px;
    color: #888;
  }
</style>
