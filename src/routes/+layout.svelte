<script>
  import '../app.css';

  import { onMount, onDestroy, setContext } from "svelte";
  import { browser } from '$app/environment';
  import { fade } from "svelte/transition";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { get } from "svelte/store";

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
  import { theme } from "$lib/stores/theme.js";

  import Session, { closeAvatarGallery } from "$lib/stores/session";
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
  let handleKeydown = null;

  setContext("onBack", onBack);

  onMount(async () => {
    unmountLoader();

    const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

    if (isTauri) {
      const [{ initProxyConfig }] = await Promise.all([
        import("$lib/utils/proxyConfig.js"),
      ]);
      await initProxyConfig();

      const { initDeepLink } = await import("$lib/utils/deepLink.js");
      cleanupDeepLink = await initDeepLink();

      const { listen } = await import("@tauri-apps/api/event");
      listen("max", async (event) => {
        addLog(event.payload);
      });

      const { type: osType } = await import("@tauri-apps/plugin-os");
      const system = osType();

      if (system === "ios") {
        const { invoke } = await import("@tauri-apps/api/core");
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
        const { onBackButtonPress } = await import("@tauri-apps/api/app");
        try {
          unlistenBackButton = await onBackButtonPress(handleBackButton);
        } catch (e) {
          console.warn("BackButton listener unavailable", e);
        }
      }
    }

    handleKeydown = (e) => {
      if (e.key === "Escape") {
        handleBackButton();
      }
    };
    window.addEventListener("keydown", handleKeydown);
  });

  function unmountLoader() {
    const loader = document.getElementById('initial-loader');

    if (loader) {
      loader.classList.add('loaded');

      loader.addEventListener('transitionend', loader.remove, { once: true });

      setTimeout(() => {
        if (loader.isConnected) loader.remove();
      }, 400);
    }
  }

  onDestroy(() => {
    if (handleKeydown) window.removeEventListener("keydown", handleKeydown);
    if (unlistenBackButton) unlistenBackButton();
    if (cleanupDeepLink) cleanupDeepLink();
    $API.unlisten();
  });

  if (browser) window.alert = showAlert;

  $: if (browser && $theme) {
    document.documentElement.setAttribute('data-theme', $theme === 'dark' ? 'dark' : '');
    if ($theme !== 'dark') document.documentElement.removeAttribute('data-theme');
  }

  $: if (browser && $Session?.loaded) {
    const el = document.getElementById("initial-loader");
    if (el) {
      el.classList.add("loaded");
      setTimeout(() => el.remove(), 300);
    }
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
