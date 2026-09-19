<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import Chats from "./chats/+page.svelte";
  import DigitalId from "./digital_id/+page.svelte";
  import Calls from "./calls/+page.svelte";
  import Settings from "./settings/+page.svelte";
  import Panel from "$components/Panel.svelte";
  import Card from "$components/main/Card.svelte";
  import ChatWindow from "$components/ChatWindow.svelte";
  import WebAppManager from "$components/webapp/WebAppManager.svelte";

  import * as Caching from "$lib/utils/caching";
  import Session, { openChat } from "$lib/stores/session";
  import { page } from "$app/stores";

  const pages = [
    { name: "Цифровой ID", icon: "digital_id", component: DigitalId },
    { name: "Звонки", icon: "calls", component: Calls },
    { name: "Чаты", icon: "chats", component: Chats },
    { name: "Настройки", icon: "settings", component: Settings },
  ];

  let active = +$page.url.searchParams.get("card") || 2;
  let mountedCards = new Set([active]);

  $: {
    if (!mountedCards.has(active)) {
      mountedCards.add(active);
      mountedCards = new Set(mountedCards);
    }
  }

  const openCard = ({ detail }) => {
    active = detail.index;
  };

  onMount(() => {
    let unlisten;
    (async () => {
      try {
        unlisten = await listen("open_chat", (event) => {
          const chatId = event.payload;
          if (chatId != null && chatId !== 0) openChat(Number(chatId));
        });
      } catch (_) {}

      try {
        const pending = await invoke("check_pending_open_chat");
        if (pending != null && pending !== 0) openChat(Number(pending));
      } catch (_) {}
    })();

    const handleVisibility = async () => {
      if (document.visibilityState === "visible") {
        try {
          const pending = await invoke("check_pending_open_chat");
          if (pending != null && pending !== 0) openChat(Number(pending));
        } catch (_) {}
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (unlisten) unlisten();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });
</script>

<div class="container">
  {#each pages as page, index}
    <Card {index} {active}>
      {#if mountedCards.has(index)}
        <svelte:component this={page.component}/>
      {/if}
    </Card>
  {/each}

  {#each $Session.openedChats as chatId}
    <ChatWindow {chatId}/>
  {/each}
</div>

<Panel on:open={openCard} {pages} {active} />
<WebAppManager />

<style>
  .container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
