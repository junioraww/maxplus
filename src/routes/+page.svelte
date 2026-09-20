<script>
  import { onMount } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import Chats from "./chats/+page.svelte";
  import DigitalId from "./digital_id/+page.svelte";
  import Calls from "./calls/+page.svelte";
  import Settings from "./settings/+page.svelte";
  import Contacts from "./contacts/+page.svelte";
  import SferumTab from "$components/main/SferumTab.svelte";
  import Logs from "./settings/logs/+page.svelte";
  import Notifications from "./settings/notifications/+page.svelte";
  import Panel from "$components/Panel.svelte";
  import Card from "$components/main/Card.svelte";
  import ChatWindow from "$components/ChatWindow.svelte";
  import WebAppManager from "$components/webapp/WebAppManager.svelte";
  import { panelConfig, CATALOG } from "$lib/stores/panel.js";

  import * as Caching from "$lib/utils/caching";
  import Session, { openChat } from "$lib/stores/session";
  import { page } from "$app/stores";

  const COMPONENT_MAP = {
    digital_id: DigitalId,
    calls: Calls,
    chats: Chats,
    settings: Settings,
    contacts: Contacts,
    sferum: SferumTab,
    logs: Logs,
    notifications: Notifications,
  };

  $: pages = ($panelConfig.items || [])
    .filter((id) => CATALOG[id] && COMPONENT_MAP[id])
    .map((id) => ({
      ...CATALOG[id],
      component: COMPONENT_MAP[id],
    }));

  let activeId = null;
  let active = 0;
  let mountedCards = new Set();

  $: {
    if (pages.length > 0) {
      if (activeId) {
        const found = pages.findIndex((p) => p.id === activeId);
        if (found !== -1) {
          active = found;
        } else {
          const defIndex = pages.findIndex((p) => p.id === $panelConfig.defaultItem);
          active = defIndex !== -1 ? defIndex : 0;
          activeId = pages[active]?.id;
        }
      } else {
        const cardParam = $page.url.searchParams.get("card");
        let initialId = null;
        if (cardParam) {
          if (CATALOG[cardParam]) {
            initialId = cardParam;
          } else if (cardParam === "3" && pages.some((p) => p.id === "settings")) {
            initialId = "settings";
          } else if (!isNaN(+cardParam) && pages[+cardParam]) {
            initialId = pages[+cardParam].id;
          }
        }
        if (!initialId) {
          initialId = $panelConfig.defaultItem || "chats";
        }
        const initialIndex = pages.findIndex((p) => p.id === initialId);
        active = initialIndex !== -1 ? initialIndex : 0;
        activeId = pages[active]?.id;
      }

      if (activeId && !mountedCards.has(activeId)) {
        mountedCards.add(activeId);
        mountedCards = new Set(mountedCards);
      }
    }
  }

  const openCard = ({ detail }) => {
    active = detail.index;
    activeId = detail.page?.id || pages[active]?.id;
    if (activeId && !mountedCards.has(activeId)) {
      mountedCards.add(activeId);
      mountedCards = new Set(mountedCards);
    }
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

<div class="container" class:has-chat={$Session.openedChats.length > 0}>
  {#each pages as pageItem, index (pageItem.id)}
    <Card {index} {active}>
      {#if mountedCards.has(pageItem.id)}
        <svelte:component
          this={pageItem.component}
          {...(pageItem.id === "logs" || pageItem.id === "notifications" ? { isTab: true } : {})}
        />
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

  .container.has-chat {
    z-index: 20;
  }
</style>
