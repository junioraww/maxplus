<script>
  import '$lib/utils/browserShim';
  import '../app.css';

  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, onDestroy, setContext } from "svelte";
  import { browser } from '$app/environment';
  import { fade } from "svelte/transition";
  import { page } from "$app/stores";
  import { type } from "@tauri-apps/plugin-os";

  import { initTheme, activeThemeId } from '$lib/stores/theme';
  import { initClientSettings } from '$lib/stores/clientSettings';
  import { initDrafts } from '$lib/stores/drafts';
  import API from '$lib/stores/api';
  import { add as addLog } from '$lib/stores/logs';
  import { showAlert } from '$lib/utils/alert';
  import Alerts from '$components/main/Alerts.svelte';
  import GlobalMediaPlayer from "$components/media/GlobalMediaPlayer.svelte";
  import MediaPlaylistModal from "$components/media/MediaPlaylistModal.svelte";
  import VideoCropModal from "$components/media/VideoCropModal.svelte";
  import TraceOverlay from "$components/main/dev/TraceOverlay.svelte";
  import StoryViewerModal from "$components/stories/StoryViewerModal.svelte";
  import StoryComposerModal from "$components/stories/StoryComposerModal.svelte";
  import { isStoryComposerOpen, closeStoryComposer, activeStoryViewer } from "$lib/stores/stories";
  import { videoCropState, closeVideoCropModal } from "$lib/stores/videoCrop";
  import { activeCall, CALL_PHASE } from '$lib/stores/calls';
  import CallScreen from '$components/calls/CallScreen.svelte';
  import FloatingCallBadge from '$components/calls/FloatingCallBadge.svelte';
  import AppPortalHost from '$components/portal/AppPortalHost.svelte';
  import { hasActiveLayers } from '$lib/services/layerManager';
  import { MediaPool } from "$lib/services/MediaPool";

  import Session from "$lib/stores/session";
  import { initDeepLink } from "$lib/utils/deepLink";
  import { initProxyConfig } from "$lib/utils/proxyConfig";
  import { handleBackButton, registerBackHandler } from "$lib/utils/backButton";
  import { getMountStore } from "$lib/plugins/mount-registry";
  import { initAutoLockWatcher } from "$lib/stores/autoLock";
  import { initKeyboardTracker } from "$lib/stores/keyboard";
  import { lockScreenState, closeLockScreen } from "$lib/stores/lockScreen";
  import LockScreen from "$components/main/auth/LockScreen.svelte";
  import { isCamouflageLocked, loadCamouflageSettings } from "$lib/camouflage/store";
  import DecoyApp from "$components/camouflage/DecoyApp.svelte";
  import { openVpnWarningSheet, closeVpnWarningSheet } from "$lib/stores/session";
  import { setupFetchProxyInterceptor } from "$lib/utils/network";
  import { loadProxyConfig, checkVpn, vpnStatus, vpnWarningDismissed } from "$lib/stores/proxySettings";

  const pluginGlobalModals = getMountStore("global:modal");
  const pluginGlobalOverlays = getMountStore("global:overlay");

  let settings;
  let isAnyModalActive = false;
  let shouldPauseMedia = false;
  const legacyUnregisterMap = new Map();

  $: isAuthRoute = $page?.url?.pathname?.startsWith('/auth');
  $: if (!isAuthRoute && $vpnStatus.is_vpn && !$vpnWarningDismissed) {
    openVpnWarningSheet(() => vpnWarningDismissed.set(true));
  } else {
    closeVpnWarningSheet();
  }
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
  let cleanupAutoLock = null;
  let unlistenBackButton = null;
  let unlistenCallAction = null;
  let unlistenBgNotify = null;
  let handleKeydown = null;
  let handleSafeAreaChanged = null;

  setContext("onBack", onBack);

  onMount(async () => {
    setupFetchProxyInterceptor();
    loadProxyConfig();
    checkVpn();
    loadCamouflageSettings().catch(() => {});
    initKeyboardTracker();
    initTheme();
    initClientSettings();
    initDrafts();
    cleanupAutoLock = initAutoLockWatcher();
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

        document.documentElement.style.setProperty("--safe-top", `${top}px`);
        document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`);
        document.documentElement.style.setProperty("--safe-area-top", `${top}px`);
        document.documentElement.style.setProperty("--safe-area-bottom", `${bottom}px`);
        document.documentElement.classList.add("ios-safe-area");
      } catch (error) {
        console.warn("Native safe-area insets are unavailable", error);
      }
    } else if (system === "android") {
      try {
        const insets = await invoke("get_system_insets");
        if (insets && (insets.top > 0 || insets.bottom > 0)) {
          document.documentElement.style.setProperty("--safe-top", `${insets.top}px`);
          document.documentElement.style.setProperty("--safe-bottom", `${insets.bottom}px`);
          document.documentElement.style.setProperty("--safe-area-top", `${insets.top}px`);
          document.documentElement.style.setProperty("--safe-area-bottom", `${insets.bottom}px`);
        }
      } catch (error) {
        console.warn("Android safe-area insets are unavailable", error);
      }
    }

    handleSafeAreaChanged = (e) => {
      const { top, bottom } = e.detail || {};
      if (typeof top === "number") {
        document.documentElement.style.setProperty("--safe-top", `${top}px`);
        document.documentElement.style.setProperty("--safe-area-top", `${top}px`);
      }
      if (typeof bottom === "number") {
        document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`);
        document.documentElement.style.setProperty("--safe-area-bottom", `${bottom}px`);
      }
    };
    window.addEventListener("safe-area-changed", handleSafeAreaChanged);

    if (system === "android" || system === "ios") {
      try {
        unlistenBackButton = await onBackButtonPress(handleBackButton);
      } catch (e) {
        console.warn("BackButton listener unavailable", e);
      }
    }

    if (system !== "android") {
      unlistenBgNotify = await listen("session:background-notify", async (event) => {
        try {
          const p = event?.payload;
          if (!p) return;
          const [{ isPermissionGranted, sendNotification }, { isClientNotificationsEnabled }, { getLocalFilePath, getFallbackAvatarLocalPath }] = await Promise.all([
            import("@tauri-apps/plugin-notification"),
            import("$lib/utils/notifications.js"),
            import("$lib/utils/images.js"),
          ]);
          if (!isClientNotificationsEnabled()) return;
          const granted = await isPermissionGranted().catch(() => false);
          if (!granted) return;
          const title = p.title || p.chatTitle || p.senderName || "Новое сообщение";
          const rawBody = p.previewText || p.payload?.message?.text || "Новое сообщение";
          const body = p.isGroup && p.senderName && !rawBody.startsWith(`${p.senderName}:`)
            ? `${p.senderName}: ${rawBody}`
            : rawBody;
          let iconPath = p.avatarPath || null;
          if (!iconPath && !p.isEncrypted) {
            if (p.avatarUrl) {
              iconPath = await getLocalFilePath(p.avatarUrl, p.accountId).catch(() => null);
            }
            if (!iconPath) {
              iconPath = await getFallbackAvatarLocalPath(
                p.chatId || p.senderId || 0,
                title,
                p.isGroup ? "CHAT" : "USER",
                p.accountId
              ).catch(() => null);
            }
          }
          const notifId = Number(((BigInt(p.accountId || 0) * 31n) ^ BigInt(p.chatId || 0)) & 0x7fffffffn) || 1;
          await sendNotification({
            id: notifId,
            title,
            body,
            ...(iconPath ? { icon: iconPath } : {}),
          });
        } catch {}
      }).catch(() => null);
    }

    async function dispatchCallAction(action, payload) {
      try {
        const payloadObj = typeof payload === 'string'
          ? JSON.parse(payload)
          : payload || {};
        const { CallService } = await import('$lib/services/CallService');
        if (action === 'answer') {
          if (payloadObj.vcp || payloadObj.conversationId) {
            await CallService.handleIncomingPush(payloadObj);
          }
          await CallService.acceptIncoming();
        } else if (action === 'dismiss') {
          CallService.declineIncoming(payloadObj);
        } else if (action === 'hangup') {
          CallService.hangup();
        } else if (action === 'show_incoming') {
          if (payloadObj.vcp || payloadObj.conversationId) {
            await CallService.handleIncomingPush(payloadObj);
          }
        }
      } catch (err) {
        console.error("dispatchCallAction error:", err);
      }
    }

    const consumePendingCall = async () => {
      try {
        const pending = await invoke('check_pending_call_action');
        if (pending?.action) {
          await dispatchCallAction(pending.action, pending.payload);
        }
      } catch {}
    };

    try {
      unlistenCallAction = await listen("native_call_action", () => {
        consumePendingCall();
      });
    } catch {}

    await consumePendingCall();
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
    if (cleanupAutoLock) cleanupAutoLock();
    if (handleKeydown) window.removeEventListener("keydown", handleKeydown);
    if (handleSafeAreaChanged) window.removeEventListener("safe-area-changed", handleSafeAreaChanged);
    if (unlistenBackButton) unlistenBackButton();
    if (unlistenCallAction) unlistenCallAction();
    if (unlistenBgNotify) unlistenBgNotify();
    if (cleanupDeepLink) cleanupDeepLink();
    $API.unlisten();
  });

  if (browser) window.alert = showAlert;

  $: isAnyModalActive = Boolean(
    $hasActiveLayers ||
    $isStoryComposerOpen ||
    Boolean($activeStoryViewer) ||
    $videoCropState?.isOpen ||
    $lockScreenState
  );

  $: shouldPauseMedia = Boolean(
    $hasActiveLayers ||
    $lockScreenState ||
    $videoCropState?.isOpen ||
    $isStoryComposerOpen
  );

  $: if (browser) {
    if (shouldPauseMedia) {
      MediaPool.pause();
    } else {
      MediaPool.resume();
    }
  }

  $: if (browser && ($Session?.loaded || $isCamouflageLocked)) {
    unmountLoader();
  }
</script>

{#if isAuthRoute}
  <div class="auth-underlay" class:dark-underlay={$activeThemeId === "dark"}></div>
{/if}

{#if $Session.loaded}
  {#key $page?.url?.pathname || ''}
    <main in:fade={{ duration: 150 }} inert={isAnyModalActive}>
      <slot />
    </main>
  {/key}
{/if}

<AppPortalHost />

{#if $activeCall.phase !== CALL_PHASE.IDLE}
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
{#if $isCamouflageLocked}
  <DecoyApp isPreview={false} />
{:else if $lockScreenState}
  <LockScreen
    isOverlay={true}
    mode={$lockScreenState?.mode || "decrypt"}
    lockType={$lockScreenState?.lockType || null}
    from={$lockScreenState?.from || null}
    account={$lockScreenState?.account || null}
    on:unlocked={(e) => {
      const cb = $lockScreenState?.onSuccess;
      closeLockScreen();
      if (cb) cb(e.detail);
    }}
    on:close={() => {
      const cb = $lockScreenState?.onClose;
      closeLockScreen();
      if (cb) cb();
    }}
  />
{/if}
<StoryViewerModal />
{#if $isStoryComposerOpen}
  <StoryComposerModal isOpen={$isStoryComposerOpen} on:close={() => closeStoryComposer()} />
{/if}

{#if $videoCropState.isOpen}
  <VideoCropModal
    isOpen={$videoCropState.isOpen}
    sourcePath={$videoCropState.sourcePath}
    previewUrl={$videoCropState.previewUrl}
    onConfirm={$videoCropState.onConfirm}
    onCancel={() => closeVideoCropModal()}
  />
{/if}

{#each $pluginGlobalModals as item (item.id)}
  <div class="plugin-global-modal" data-plugin-mount={item.pluginId || item.id}>
    {@html item.html}
  </div>
{/each}

{#each $pluginGlobalOverlays as item (item.id)}
  <div class="plugin-global-overlay" data-plugin-mount={item.pluginId || item.id}>
    {@html item.html}
  </div>
{/each}

<svelte:body
  class:modal-media-active={$isStoryComposerOpen || Boolean($activeStoryViewer)}
  class:modal-open={isAnyModalActive}
  class:auth-light-body={isAuthRoute && $activeThemeId === "light"}
  class:auth-dark-body={isAuthRoute && $activeThemeId === "dark"}
/>

<style>
  main {
    overflow: hidden;
    width: 100%;
    height: 100%;
    position: relative;
    z-index: 1;
  }

  .auth-underlay {
    position: fixed;
    inset: 0;
    background-color: #ffffff;
    z-index: 0;
    pointer-events: none;
  }

  .auth-underlay.dark-underlay {
    background-color: #121316;
  }

  :global(body.modal-open main *) {
    animation-play-state: paused !important;
  }

  :global(body.modal-media-active *) {
    animation-play-state: paused !important;
  }
  :global(body.modal-media-active .composer-overlay *),
  :global(body.modal-media-active .story-viewer-stage *) {
    animation-play-state: running !important;
  }
</style>
