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
  import ProfileSettings from "./settings/profile/+page.svelte";
  import LockSettings from "./settings/lock/+page.svelte";
  import TwoFactorSettings from "./settings/two_factor/+page.svelte";
  import DictionarySettings from "./settings/e2e/dictionary/+page.svelte";
  import AboutSettings from "./settings/about/+page.svelte";
  import SessionsSettings from "./settings/sessions/+page.svelte";
  import PluginsSettings from "./settings/plugins/+page.svelte";
  import AdvancedSettings from "./settings/advanced/+page.svelte";
  import PrivacySettings from "./settings/privacy/+page.svelte";
  import Panel from "$components/Panel.svelte";
  import Card from "$components/main/Card.svelte";
  import ChatWindow from "$components/ChatWindow.svelte";
  import WebAppManager from "$components/webapp/WebAppManager.svelte";
  import PluginImportModal from "$components/plugins/PluginImportModal.svelte";
  import { panelConfig, CATALOG } from "$lib/stores/panel";
  import { setPanelNavigation } from "$lib/utils/backButton";
  import { panelSlider } from "$lib/utils/panelSlider";

  import * as Caching from "$lib/utils/caching";
  import Session, { openChat, closeSettingsPage } from "$lib/stores/session";
  import { currentUser } from "$lib/stores/api";
  import { getCurrentAccount, getAccounts, setCurrentAccount } from "$lib/stores/accounts";
  import { openLockScreen } from "$lib/stores/lockScreen";
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

  const SETTINGS_PAGES = {
    profile: ProfileSettings,
    notifications: Notifications,
    privacy: PrivacySettings,
    lock: LockSettings,
    two_factor: TwoFactorSettings,
    dictionary: DictionarySettings,
    logs: Logs,
    about: AboutSettings,
    sessions: SessionsSettings,
    plugins: PluginsSettings,
    advanced: AdvancedSettings,
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

  let dragOffset = 0;
  let isDragging = false;
  let isSnapping = false;

  function ensureNeighborCardsMounted(idx) {
    let changed = false;
    const targets = [idx - 1, idx, idx + 1];
    for (const t of targets) {
      if (t >= 0 && t < pages.length) {
        const id = pages[t]?.id;
        if (id && !mountedCards.has(id)) {
          mountedCards.add(id);
          changed = true;
        }
      }
    }
    if (changed) {
      mountedCards = new Set(mountedCards);
    }
  }

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

      ensureNeighborCardsMounted(active);
    }
  }

  const openCard = ({ detail }) => {
    active = detail.index;
    activeId = detail.page?.id || pages[active]?.id;
    dragOffset = 0;
    isDragging = false;
    isSnapping = true;
    ensureNeighborCardsMounted(active);
    setTimeout(() => {
      isSnapping = false;
    }, 280);
  };

  function goToDefaultPanel() {
    const defId = $panelConfig.defaultItem || "chats";
    const defIndex = pages.findIndex((p) => p.id === defId);
    active = defIndex !== -1 ? defIndex : 0;
    activeId = pages[active]?.id || defId;
    dragOffset = 0;
    isDragging = false;
    isSnapping = true;
    ensureNeighborCardsMounted(active);
    setTimeout(() => {
      isSnapping = false;
    }, 280);
  }

  function handleDragStart() {
    isDragging = true;
    isSnapping = false;
  }

  function handleDragMove(offset) {
    dragOffset = offset;
  }

  function handleDragEnd(targetIndex, finalOffset, containerWidth) {
    const oldActive = active;
    isDragging = false;

    if (targetIndex === oldActive) {
      if (finalOffset === 0) {
        dragOffset = 0;
        return;
      }
      isSnapping = true;
      dragOffset = 0;
      setTimeout(() => {
        isSnapping = false;
      }, 280);
      return;
    }

    const offsetDelta = (targetIndex - oldActive) * containerWidth;
    const initialSnapOffset = finalOffset + offsetDelta;

    active = targetIndex;
    activeId = pages[targetIndex]?.id;
    ensureNeighborCardsMounted(targetIndex);

    dragOffset = initialSnapOffset;
    isSnapping = false;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isSnapping = true;
        dragOffset = 0;
        setTimeout(() => {
          isSnapping = false;
        }, 280);
      });
    });
  }

  $: visibleIndices = (() => {
    const set = new Set([active]);
    if ((isDragging || isSnapping) && dragOffset !== 0) {
      if (dragOffset < 0) set.add(active + 1);
      if (dragOffset > 0) set.add(active - 1);
    }
    return set;
  })();

  onMount(() => {
    const cleanupNav = setPanelNavigation({
      isMain: () => {
        const defId = $panelConfig.defaultItem || "chats";
        return !activeId || activeId === defId;
      },
      goToMain: () => {
        goToDefaultPanel();
      },
    });

    const handleOpenChatTarget = async (payload) => {
      if (!payload) return;
      const cid = typeof payload === "object" ? payload.chatId : payload;
      const targetAcc = typeof payload === "object" ? payload.accountId : 0;
      if (cid == null || cid === 0) return;

      if (targetAcc && targetAcc !== 0) {
        const cur = await getCurrentAccount().catch(() => null);
        if (cur?.id && Number(cur.id) !== Number(targetAcc)) {
          const accs = await getAccounts().catch(() => []);
          const target = accs.find((a) => Number(a.id) === Number(targetAcc));
          if (target) {
            if (target.encryption) {
              openLockScreen({
                mode: "decrypt",
                account: target,
                onSuccess: async () => {
                  await setCurrentAccount(Number(targetAcc));
                  openChat(Number(cid));
                },
              });
              return;
            } else {
              await setCurrentAccount(Number(targetAcc));
            }
          }
        }
      }
      openChat(Number(cid));
    };

    let unlisten;
    (async () => {
      try {
        unlisten = await listen("open_chat", (event) => {
          handleOpenChatTarget(event.payload);
        });
      } catch (_) {}

      try {
        const pending = await invoke("check_pending_open_chat");
        if (pending != null && pending !== 0) handleOpenChatTarget(pending);
      } catch (_) {}
    })();

    const handleVisibility = async () => {
      if (document.visibilityState === "visible") {
        try {
          const pending = await invoke("check_pending_open_chat");
          if (pending != null && pending !== 0) handleOpenChatTarget(pending);
        } catch (_) {}
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    (async () => {
      try {
        const { pluginStore } = await import("$lib/stores/plugins");
        const { initPluginSystem } = await import("$lib/plugins/runtime");
        await pluginStore.load();
        await initPluginSystem();
      } catch (e) {
        console.error("[plugins] init error:", e);
      }
    })();

    return () => {
      cleanupNav();
      if (unlisten) unlisten();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  });
</script>

{#if $currentUser}
<div
  class="container"
  class:has-chat={$Session.openedChats.length > 0}
  class:has-overlay={!!$Session.settingsPage}
>
  <div
    class="panels-slider"
    use:panelSlider={{
      getPagesCount: () => pages.length,
      getActive: () => active,
      canDrag: () => pages.length > 1 && $Session.openedChats.length === 0 && !$Session.settingsPage,
      onPrepare: () => ensureNeighborCardsMounted(active),
      onDragStart: handleDragStart,
      onDragMove: handleDragMove,
      onDragEnd: handleDragEnd,
    }}
  >
    <div
      class="panels-track"
      class:dragging={isDragging}
      class:snapping={isSnapping}
      style="transform: translate3d(calc({-active * 100}% + {dragOffset}px), 0, 0);"
    >
      {#each pages as pageItem, index (pageItem.id)}
        <Card
          {index}
          {active}
          isVisibleOnScreen={visibleIndices.has(index)}
        >
          {#if mountedCards.has(pageItem.id)}
            <svelte:component
              this={pageItem.component}
              {...(pageItem.id === "calls" ? { isActive: activeId === "calls" } : {})}
              {...(pageItem.id === "logs" || pageItem.id === "notifications" ? { isTab: true } : {})}
            />
          {/if}
        </Card>
      {/each}
    </div>
  </div>

  {#each $Session.openedChats as chatId (chatId)}
    <ChatWindow {chatId}/>
  {/each}

  {#if $Session.settingsPage && SETTINGS_PAGES[$Session.settingsPage]}
    <div class="settings-page-overlay">
      <svelte:component
        this={SETTINGS_PAGES[$Session.settingsPage]}
        onClose={closeSettingsPage}
      />
    </div>
  {/if}
</div>

<Panel on:open={openCard} {pages} {active} />
<WebAppManager />
<PluginImportModal />
{/if}

<style>
  .container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .container.has-chat,
  .container.has-overlay {
    z-index: var(--z-chat, 3);
  }

  .panels-slider {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: calc(100% - 60px - var(--safe-bottom, 0px));
    overflow: hidden;
    touch-action: pan-y;
  }

  .panels-track {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    will-change: transform;
    transition: transform 0.28s cubic-bezier(0.25, 1, 0.5, 1);
  }

  .panels-track.dragging {
    transition: none;
  }

  .panels-track.snapping {
    transition: transform 0.28s cubic-bezier(0.25, 1, 0.5, 1);
  }

  .settings-page-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: var(--z-chat, 3);
    overflow: hidden;
  }
</style>
