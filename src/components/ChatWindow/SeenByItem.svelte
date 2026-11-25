<script>
  import Avatar from "$components/main/Avatar.svelte";
  import { getContact } from "$lib/utils/caching";

  export let userId;
  export let readTime;
  export let reaction = null;
  export let compact = false;

  $: contactStore = userId ? getContact(userId) : null;
  $: contact = $contactStore;
  $: displayName =
    contact?.names?.[0]?.name ||
    contact?.name ||
    (contact?.firstName ? `${contact.firstName} ${contact.lastName || ""}`.trim() : "") ||
    `Пользователь ${userId}`;

  function formatTime(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return `сегодня в ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `вчера в ${date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    }
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
</script>

<div class="seen-by-item" class:compact on:click>
  <div class="avatar-wrap">
    <Avatar {userId} size={compact ? 36 : 38} />
  </div>
  <div class="user-meta">
    <div class="user-name">{displayName}</div>
    {#if !compact}
      <div class="user-read-time">{formatTime(readTime)}</div>
    {/if}
  </div>
  {#if reaction}
    <div class="reaction-badge">{reaction}</div>
  {/if}
</div>

<style>
  .seen-by-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 10px;
    transition: background 0.15s ease;
  }

  .seen-by-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .seen-by-item.compact {
    padding: 7px 10px;
    border-radius: 10px;
    cursor: pointer;
  }

  .seen-by-item.compact .user-name {
    font-size: 15px;
    font-weight: 500;
    color: #ffffff;
  }

  .avatar-wrap {
    flex-shrink: 0;
  }

  .user-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .user-name {
    font-size: 14px;
    font-weight: 500;
    color: #edf0f5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-read-time {
    font-size: 12px;
    color: #8b98a5;
  }

  .reaction-badge {
    flex-shrink: 0;
    font-size: 18px;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
