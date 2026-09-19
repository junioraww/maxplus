<script>
  import { onDestroy, onMount } from "svelte";
  import { writable } from "svelte/store";
  import {
    currentPresence,
    currentSessionChats,
    currentUser,
  } from "$lib/stores/api";
  import {
    getContact
  } from "$lib/stores/contacts";
  import { get as sessionGet } from "$lib/stores/session";

  import Timestamp from "$components/main/Timestamp.svelte";

  export let contactId;
  export let contact = getContact(contactId);
  export let chat = {};

  if (!chat) {
    chat = $currentSessionChats.find(
      x => x.id === ($currentUser ^ (contactId))
    );
  }
</script>

{#if $contact?.id && $contact?.id !== $currentUser}
  {#if $currentPresence[$contact.id]}
    {#if $currentPresence[$contact.id]?.status === 1}
      <span class="online-text">в сети</span>
    {:else if $currentPresence[$contact.id]?.seen}
      {$contact.gender === 2 ? "Была" : "Был"}
      <Timestamp
        gender={$contact.gender || 1}
        unixTime={
          $currentPresence[$contact.id]?.seen - sessionGet("drift") / 1000
        }
      />
    {:else}
      {$contact.gender === 2 ? "Была" : "Был"} недавно
    {/if}
  {:else if $contact.options}
    {(() => {
      const list = [];
      const opts = $contact.options;
      if (opts.includes("SERVICE_ACCOUNT")) list.push("сервисный аккаунт");
      if (opts.includes("BOT")) list.push("бот");
      if (opts.includes("OFFICIAL")) list.push("официальный");
      if (!list.length) list.push(`Был${$contact.gender === 2 ? 'а' : ''} недавно`)
      const joined = list.join(", ");
      return joined.charAt(0).toUpperCase() + joined.slice(1);
    })()}
  {/if}
{:else if chat.type === "DIALOG"}
  Личный чат
{:else if chat.type === "CHANNEL"}
  {chat.participantsCount} подписчиков
{:else if chat.type === "CHAT"}
  Групповой чат
{:else}
  Это вообще чё?
{/if}

<style>
  .online-text {
    color: #4fc3f7;
  }
</style>
