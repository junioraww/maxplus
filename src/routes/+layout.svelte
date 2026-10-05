<script>
  import '../app.css';

  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, onDestroy, setContext } from "svelte";
  import { browser } from '$app/environment';
  import { fade } from "svelte/transition";
  import { page } from "$app/stores";
  import { type } from "@tauri-apps/plugin-os";

  import API from '$lib/stores/api';
  import { add as addLog } from '$lib/stores/logs';
  import { showAlert } from '$lib/utils/alert';
  import Alerts from '$components/main/Alerts.svelte';
    import ProfileModal from "$components/ProfileModal.svelte";
  import AvatarGalleryModal from "$components/main/AvatarGalleryModal.svelte";
  import DevSettings from "$components/main/dev/Settings.svelte";
  import AddContactModal from "$components/main/AddContactModal.svelte";
  import DevicesSettings from "$components/main/devices/Settings.svelte";
  import GlobalMediaPlayer from "$components/media/GlobalMediaPlayer.svelte";
  import MediaPlaylistModal from "$components/media/MediaPlaylistModal.svelte";
  import VideoCropModal from "$components/media/VideoCropModal.svelte";
  import TraceOverlay from "$components/main/dev/TraceOverlay.svelte";
  import { videoCropState, closeVideoCropModal } from "$lib/stores/videoCrop.js";
  import { activeCall, CALL_PHASE } from '$lib/stores/calls.js';
  import CallScreen from '$components/calls/CallScreen.svelte';
  import FloatingCallBadge from '$components/calls/FloatingCallBadge.svelte';

  import Session, { closeAvatarGallery } from "$lib/stores/session";
  import { initDeepLink } from "$lib/utils/deepLink.js";
  import { initProxyConfig } from "$lib/utils/proxyConfig.js";
  import { handleBackButton, registerBackHandler } from "$lib/utils/backButton.js";

  let settings;
  const legacyUnregisterMap = new Map();
  const onBack = new Proxy({}, {
    set(target, prop, fn) {
      if (legacyUnregisterMap.has(prop)) {
        legacyUnregisterMap.get(prop)();
        legacyUnregisterMap.delete(prop);
      }
      if (typeof fn === "function") {
        const unreg = registerBackHandler(fn);
        legacyUnregisterMap.set(prop, unreg);
      }
      target[prop] = fn;
      return true;
    },
    deleteProperty(target, prop) {
      if (legacyUnregisterMap.has(prop)) {
        legacyUnregisterMap.get(prop)();
        legacyUnregisterMap.delete(prop);
      }
      delete target[prop];
      return true;
    },
  });
  let cleanupDeepLink = null;
  let unlistenBackButton = null;
  let unlistenCallAction = null;
  let handleKeydown = null;

  setContext("onBack", onBack);

  onMount(async () => {
    await initProxyConfig();
    cleanupDeepLink = await initDeepLink();

    listen("max", async (event) => {
      addLog(event.payload);
    });

    handleKeydown = (e) => {
      if (e.key === "Escape") {
        handleBackButton();
      }
    };
    window.addEventListener("keydown", handleKeydown);

    const system = type();

    if (system === "ios") {
      try {
        const [{ inset: top }, { inset: bottom }] = await Promise.all([
          invoke("plugin:safe-area-insets-css|get_top_inset"),
          invoke("plugin:safe-area-insets-css|get_bottom_inset"),
        ]);

        document.documentElement.style.setProperty("--safe-area-top", `${top}px`);
        document.documentElement.style.setProperty("--safe-area-bottom", `${bottom}px`);
        document.documentElement.classList.add("ios-safe-area");
      } catch (error) {
        console.warn("Native safe-area insets are unavailable", error);
      }
    }

    if (system === "android" || system === "ios") {
      try {
        unlistenBackButton = await onBackButtonPress(handleBackButton);
      } catch (e) {
        console.warn("BackButton listener unavailable", e);
      }
    }

    try {
      unlistenCallAction = await listen("native_call_action", async (event) => {
        try {
          const payloadObj = typeof event.payload?.payload === 'string'
            ? JSON.parse(event.payload.payload)
            : event.payload?.payload || {};
          const action = event.payload?.action;
          const { CallService } = await import('$lib/services/CallService.js');
          if (action === 'answer') {
            if (payloadObj.vcp || payloadObj.conversationId) {
              await CallService.handleIncomingPush(payloadObj);
            }
            await CallService.acceptIncoming();
          } else if (action === 'dismiss') {
            CallService.declineIncoming();
          } else if (action === 'show_incoming') {
            if (payloadObj.vcp || payloadObj.conversationId) {
              await CallService.handleIncomingPush(payloadObj);
            }
          }
        } catch (err) {
          console.error("native_call_action error:", err);
        }
      });
    } catch {}
  });

  function unmountLoader() {
    const loader = document.getElementById('initial-loader');

    if (loader) {
      loader.classList.add('loaded');

      loader.addEventListener('transitionend', () => loader.remove(), { once: true });

      setTimeout(() => {
        if (loader.isConnected) loader.remove();
      }, 400);
    }
  }

  onDestroy(() => {
    if (handleKeydown) window.removeEventListener("keydown", handleKeydown);
    if (unlistenBackButton) unlistenBackButton();
    if (unlistenCallAction) unlistenCallAction();
    if (cleanupDeepLink) cleanupDeepLink();
    $API.unlisten();
  });

  if (browser) window.alert = showAlert;

  $: if (browser && $Session?.loaded) {
    unmountLoader();
  }
</script>

{#if $Session.devSettings}
  <DevSettings />
{/if}

{#if $Session.devicesPage}
  <DevicesSettings />
{/if}

{#if $Session.profile}
  <ProfileModal on:close={() => ($Session.profile = null)} />
{/if}

{#if $Session.contactModal}
  <AddContactModal on:close={() => ($Session.contactModal = false)} />
{/if}

{#if $Session.avatarGallery}
  <AvatarGalleryModal
    {...$Session.avatarGallery}
    on:close={() => closeAvatarGallery()}
  />
{/if}

{#if $Session.loaded}
  {#key $page.url.pathname}
    <main in:fade={{ duration: 150 }}>
      <slot />
    </main>
  {/key}
{/if}

{#if $activeCall.phase !== CALL_PHASE.IDLE && $activeCall.phase !== CALL_PHASE.ENDING}
  {#if !$activeCall.minimized}
    <CallScreen />
  {:else}
    <FloatingCallBadge />
  {/if}
{/if}

<Alerts />
<GlobalMediaPlayer />
<MediaPlaylistModal />
<TraceOverlay />

{#if $videoCropState.isOpen}
  <VideoCropModal
    isOpen={$videoCropState.isOpen}
    sourcePath={$videoCropState.sourcePath}
    previewUrl={$videoCropState.previewUrl}
    onConfirm={$videoCropState.onConfirm}
    onCancel={() => closeVideoCropModal()}
  />
{/if}

<style>
  main {
    overflow: hidden;
    width: 100%;
    height: 100%;
    position: relative;
  }
</style>
