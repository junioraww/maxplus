<script>
  import {
    currentPresence,
    currentSessionChats,
    currentUser,
    currentRealContacts,
  } from "$lib/stores/api";
  import { getContact } from "$lib/stores/contacts";
  import { get as sessionGet } from "$lib/stores/session";
  import Timestamp from "$components/main/Timestamp.svelte";

  export let contactId = undefined;
  export let contact = undefined;
  export let chat = undefined;
  export let presence = undefined;

  $: targetContactId = contactId ?? ($contact?.id);
  $: resolvedContactStore = contact ?? (targetContactId ? getContact(targetContactId) : null);
  $: c = resolvedContactStore ? $resolvedContactStore : null;

  $: activeChat = chat ?? (targetContactId && $currentUser != null
    ? $currentSessionChats?.find(x => x.id === ($currentUser ^ targetContactId))
    : null);

  $: resolvedPresence = presence ?? (targetContactId ? $currentPresence[targetContactId] : (c?.id ? $currentPresence[c.id] : null));

  function formatMembersCount(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${count} участников`;
    if (mod10 === 1) return `${count} участник`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} участника`;
    return `${count} участников`;
  }

  function formatOnlineCount(count) {
    if (count <= 0) return "";
    return `${count} в сети`;
  }

  $: groupCounts = (() => {
    if (activeChat?.type !== "CHAT") return null;
    const parts = activeChat.participants || {};
    const total = activeChat.participantsCount || Object.keys(parts).length || 0;
    const online = Object.keys(parts).filter(id => {
      const p = $currentPresence[id];
      return p?.status === 1 || p?.on === "ON" || Boolean($currentRealContacts?.[id]?.online);
    }).length;
    return { total, online };
  })();
</script>

{#if activeChat?.type === "CHAT"}
  {#if groupCounts}
    {formatMembersCount(groupCounts.total)}{#if groupCounts.online > 0}, {formatOnlineCount(groupCounts.online)}{/if}
  {:else}
    групповой чат
  {/if}
{:else if activeChat?.type === "CHANNEL"}
  {activeChat.participantsCount || 0} подписчиков
{:else if targetContactId && Number(targetContactId) === Number($currentUser)}
  Вы
{:else if resolvedPresence?.status === 1 || resolvedPresence?.on === "ON" || Boolean(c?.online)}
  <span class="online-text">в сети</span>
{:else if resolvedPresence?.seen}
  {c?.gender === 2 ? "была" : "был"}
  <Timestamp
    gender={c?.gender || 1}
    unixTime={resolvedPresence.seen - (sessionGet("drift") || 0) / 1000}
  />
{:else if c?.options && c.options.length > 0}
  {(() => {
    const list = [];
    const opts = c.options;
    if (opts.includes("SERVICE_ACCOUNT")) list.push("сервисный аккаунт");
    if (opts.includes("BOT")) list.push("бот");
    if (opts.includes("OFFICIAL")) list.push("официальный");
    if (!list.length) list.push(`Был${c?.gender === 2 ? 'а' : ''} недавно`);
    const joined = list.join(", ");
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  })()}
{:else if c}
  {c.gender === 2 ? "Была" : "Был"} недавно
{:else if activeChat?.type === "DIALOG"}
  личный чат
{:else}
  не в сети
{/if}

<style>
  .online-text {
    color: #4fc3f7;
  }
</style>
