<script>
  import { onDestroy } from "svelte";
  import { getContact } from "$lib/stores/contacts";
  import { currentSessionCalls, currentSessionChats, currentUser } from "$lib/stores/api";

  import Avatar from "$components/main/Avatar.svelte";

  let contacts = {}, unsub = {};

  $: $currentSessionCalls?.history.forEach(({ chatId, chatType, message }) => {
    const id = chatType === "CHAT" ? message?.sender : chatId ^ $currentUser;
    if (id && !unsub[id])
      unsub[id] = getContact(id).subscribe(v => (contacts[id] = v, contacts = contacts));
  });

  onDestroy(() => Object.values(unsub).forEach(f => f()));

  $: callsWithInfo = $currentSessionCalls?.history.map(call => {
    const a = call.message.attaches[0], duration = formatSeconds(a.duration);

    if (call.chatType === "CHAT") {
      const chat = $currentSessionChats.find(x => x.id === call.chatId);
      if (!chat) return null;

      const c = contacts[call.message.sender];

      return {
        name: chat.title,
        avatar: chat.avatar || chat.baseUrl || c?.avatar,
        duration
      };
    }

    const c = contacts[call.chatId ^ $currentUser];
    return {
      name: `${a.callType === "AUDIO" ? "Аудиозвонок" : "Видеозвонок"} ${c?.names?.[0]?.firstName ?? ""}`,
      avatar: c?.avatar,
      duration
    };
  })?.filter(x => x) || [];

  const formatSeconds = s => `${`${s / 60 | 0}`.padStart(2, 0)}:${`${s % 60}`.padStart(2, 0)}`;
</script>

<div class="calls">
  <p class="title">Звонки</p>

  <div class="container">
    {#each callsWithInfo as call}
      <div class="call">
        <Avatar size={46} chat={call}/>

        <a>{call.name}</a>

        <a class="duration">{call.duration}</a>
      </div>
    {/each}
  </div>

  <div
    on:click={() =>
      alert("В разработке!\nСледи за новостями:\nt.me/CatBestSoft")}
    class="placeholder-call animated-panel"
  >
    <img src="icons/call.svg" />
  </div>
</div>

<style>
  .calls {
    color: #999;
    height: 100vh;
    height: 100dvh;
    width: 100vw;
    display: flex;
    flex-direction: column;
    margin: 15px;
    overflow-y: none;
    position: relative;
  }

  .calls .title {
    margin: 0;
    margin-bottom: 10px;
    color: #eee;
    font-size: 20px;
    font-weight: 700;
  }

  .container {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-grow: 1;
    min-height: 0;
    flex: 1;
    padding-bottom: 80px;
    margin-left: 5px;
  }

  .call {
    width: 100%;
    min-height: 64px;
    max-height: 64px;
    position: relative;
    display: flex;
    gap: 30px;
    align-items: center;
    color: #ddd;
    font-size: 14px;
  }

  .call::after {
    content: "";
    height: 1px;
    width: 6px;
    background: #333;
    margin-top: 64px;
    margin-left: 58px;
    position: absolute;
  }

  .call::before {
    content: "";
    height: 64px;
    width: 1px;
    background: #333;
    margin-left: 58px;
    position: absolute;
  }

  .call .duration {
    font-size: 13px;
    font-weight: 600;
    color: #555;
    margin-left: auto;
    margin-right: 30px;
  }

  .placeholder-call {
    position: fixed;
    height: 50px;
    width: 50px;
    bottom: calc(20px + env(safe-area-inset-bottom));
    right: 25px;
    border-radius: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .placeholder-call img {
    width: 20px;
  }
</style>
