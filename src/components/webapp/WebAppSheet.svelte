<script>
  import { Button, IconButton, MenuItem, Modal } from "$components/ui";
  import { onMount, onDestroy } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { openChat, get as sessionGet } from "$lib/stores/session.js";
  import { getCurrentAccount } from "$lib/stores/accounts.js";
  import { currentUser } from "$lib/stores/api.js";
  import API from "$lib/stores/api.js";
  import {
    minimizeMiniApp,
    expandMiniApp,
    collapseMiniApp,
    closeMiniApp,
    reloadMiniApp,
    openMiniApp,
    updateAppMeta,
    resolveWebAppUrl,
  } from "$lib/stores/webapp.js";
  import { createBridgeClient } from "$lib/webapp/bridge.js";
  import { processMaxLink } from "$lib/utils/maxLink.js";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  export let app;

  let iframeElement;
  let linkCounter = 0;
  let openedLinksStack = [];
  $: currentInnerItem = openedLinksStack.length > 0 ? openedLinksStack[openedLinksStack.length - 1] : null;
  $: currentInnerUrl = currentInnerItem?.currentUrl || currentInnerItem?.initialUrl || null;
  $: innerUrlHostname = currentInnerUrl
    ? (() => {
        try {
          return new URL(currentInnerUrl).hostname;
        } catch {
          return currentInnerUrl;
        }
      })()
    : "";
  let showMenu = false;
  let showConfirmClose = false;
  let showPhoneConfirm = false;
  let phoneResolvePromise = null;
  let showSettingsModal = false;
  let showReportModal = false;
  let showShortcutModal = false;

  let reportReason = "spam";
  let reportDetails = "";

  let isDragging = false;
  let startY = 0;
  let currentDragDeltaY = 0;
  let startTime = 0;
  let sheetSurfaceElement;

  const defaultHeightPercent = 82;

  let bridge;

  function postToFrame(message) {
    try {
      if (iframeElement && iframeElement.contentWindow) {
        iframeElement.contentWindow.postMessage(message, "*");
      }
      if (typeof document !== "undefined") {
        const innerFrames = document.querySelectorAll(".inner-app-frame");
        for (const frame of innerFrames) {
          if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage(message, "*");
          }
        }
      }
    } catch {}
  }

  function handleWindowMessage(event) {
    if (event.source === window) return;
    if (!event.data) return;
    let data = event.data;

    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {}
    }

    if (data.type === "web_app_external_callback" && data.url) {
      handleExternalCallbackUrl(data.url);
      return;
    }

    if (data.type === "web_app_open_link" && data.url) {
      if (typeof data.url === "string" && data.url.includes("externalCallback=1")) {
        handleExternalCallbackUrl(data.url);
        return;
      }
      handleOpenTargetUrl(data.url);
      return;
    }

    if (data.type === "web_app_page_navigated" && data.url) {
      if (typeof data.url === "string" && data.url.includes("externalCallback=1")) {
        handleExternalCallbackUrl(data.url);
        return;
      }
      if (openedLinksStack.length > 0) {
        const lastIdx = openedLinksStack.length - 1;
        if (openedLinksStack[lastIdx].currentUrl !== data.url) {
          openedLinksStack[lastIdx] = {
            ...openedLinksStack[lastIdx],
            currentUrl: data.url,
          };
          openedLinksStack = [...openedLinksStack];
        }
      }
      return;
    }

    if (data.type === "web_appEvent") {
      bridge?.handleIncomingMessage(data.name, data.data, !!data.priv);
      return;
    }

    if (data.eventType) {
      bridge?.handleIncomingMessage(data.eventType, data.eventData, false);
      return;
    }

    if (data.type && typeof data.type === "string") {
      bridge?.handleIncomingMessage(data.type, data, false);
      return;
    }

    if (data.name && typeof data.name === "string") {
      bridge?.handleIncomingMessage(data.name, data.data || data, !!data.priv);
      return;
    }
  }

  function normalizeExternalUrl(raw) {
    if (!raw || typeof raw !== "string") return "";
    let clean = raw.trim();
    if (clean.includes("/proxy") || clean.includes("127.0.0.1") || clean.includes("localhost")) {
      try {
        const u = new URL(clean);
        const extracted = u.searchParams.get("url") || u.searchParams.get("target");
        if (extracted) clean = extracted;
      } catch {}
    }
    return clean;
  }

  async function handleExternalCallbackUrl(rawUrl) {
    const url = normalizeExternalUrl(rawUrl);
    if (!url) return;
    try {
      const launch = await $API.processExternalCallback(url);
      if (launch?.url) {
        app.url = launch.url;
        app.reloadKey += 1;
      }
    } catch (err) {
      console.error(err);
    }
    openedLinksStack = [];
  }

  function isExternalAuthUrl(url) {
    if (!url || typeof url !== "string") return false;
    const lower = url.toLowerCase();
    return lower.includes("esia.gosuslugi.ru") || lower.includes("gosuslugi.ru");
  }

  async function handleOpenTargetUrl(rawUrl) {
    const url = normalizeExternalUrl(rawUrl);
    if (!url) return;
    if (url.includes("externalCallback=1")) {
      await handleExternalCallbackUrl(url);
      return;
    }
    const handled = await processMaxLink(url, {
      currentUserId: $currentUser,
      api: $API,
      onOpenChat: async (chatId) => {
        try {
          await openChat(chatId);
          minimizeMiniApp(app.id);
        } catch (err) {
          console.error(err);
        }
      },
      onLaunchApp: async ({ botId, startParam, title }) => {
        await openMiniApp({ botId, startParam, title, entryPoint: "link" });
      },
    });
    if (handled) return;

    if (isExternalAuthUrl(url)) {
      try {
        await openUrl(url);
      } catch {
        window.open(url, "_blank");
      }
      return;
    }

    if (openedLinksStack.length > 0) {
      const top = openedLinksStack[openedLinksStack.length - 1];
      if (top.initialUrl === url || top.currentUrl === url) {
        return;
      }
    }

    linkCounter += 1;
    openedLinksStack = [
      ...openedLinksStack,
      {
        id: `link_${Date.now()}_${linkCounter}`,
        initialUrl: url,
        currentUrl: url,
      },
    ];
  }

  function handleGoBack() {
    if (openedLinksStack.length > 0) {
      openedLinksStack = openedLinksStack.slice(0, -1);
    }
  }

  async function handleOpenPageInBrowser() {
    const target = currentInnerUrl || app.url;
    if (!target) return;
    try {
      await openUrl(target);
    } catch {
      window.open(target, "_blank");
    }
  }

  function cleanupDragListeners() {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
    window.removeEventListener("blur", handlePointerUp);
  }

  let isMinimizing = false;
  let isEntering = true;

  onMount(async () => {
    let deviceId = sessionGet("device")?.deviceId || "";
    if (!deviceId) {
      try {
        const acc = await getCurrentAccount();
        deviceId = acc?.meta?.device?.deviceId || "";
      } catch {}
    }
    if (!deviceId) {
      try {
        const dev = await invoke("common_store_load", { store: "device" });
        if (dev && typeof dev === "object" && dev.deviceId) {
          deviceId = dev.deviceId;
        }
      } catch {}
    }

    bridge = createBridgeClient({
      botId: app.botId,
      entryPoint: app.entryPoint || "web_app",
      userId: $currentUser,
      deviceId,
      getViewportSize: () => {
        if (iframeElement) {
          return {
            width: iframeElement.clientWidth || window.innerWidth,
            height: iframeElement.clientHeight || window.innerHeight,
          };
        }
        return { width: window.innerWidth, height: window.innerHeight };
      },
      onClose: () => handleClose(),
      onExpand: () => expandMiniApp(app.id),
      onBackButtonChange: (visible) => {
        updateAppMeta(app.id, { customBackButton: visible });
      },
      onClosingBehaviorChange: (needed) => {
        updateAppMeta(app.id, { needConfirmation: needed });
      },
      onPhoneRequested: async (botId) => {
        return new Promise((resolve) => {
          phoneResolvePromise = resolve;
          showPhoneConfirm = true;
        });
      },
      onOpenLink: async (url) => {
        await handleOpenTargetUrl(url);
      },
      postToFrame,
    });

    window.addEventListener("message", handleWindowMessage);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isEntering = false;
      });
    });

    const unregisterBack = registerBackHandler(() => {
      if (openedLinksStack.length > 0) {
        handleGoBack();
        return false;
      }
      handleClose();
    });

    return () => {
      unregisterBack();
      window.removeEventListener("message", handleWindowMessage);
      cleanupDragListeners();
    };
  });

  let previousState = app.state;
  $: if (previousState === "minimized" && app.state !== "minimized") {
    isEntering = true;
    previousState = app.state;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        isEntering = false;
      });
    });
  } else {
    previousState = app.state;
  }

  function triggerMinimize() {
    if (isMinimizing) return;
    isMinimizing = true;
    setTimeout(() => {
      minimizeMiniApp(app.id);
      isMinimizing = false;
    }, 280);
  }

  function handlePointerDown(e) {
    if (e.target.closest("button") || e.target.closest(".dropdown-menu")) return;
    isDragging = true;
    startY = e.clientY;
    currentDragDeltaY = 0;
    startTime = Date.now();
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("blur", handlePointerUp);
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    currentDragDeltaY = e.clientY - startY;
  }

  function handlePointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    cleanupDragListeners();
    const deltaY = currentDragDeltaY;
    const elapsed = Math.max(1, Date.now() - startTime);
    const velocity = deltaY / elapsed;
    currentDragDeltaY = 0;

    if (app.state === "sheet") {
      if (deltaY > 100 || velocity > 0.35) {
        triggerMinimize();
      } else if (deltaY < -50 || velocity < -0.35) {
        expandMiniApp(app.id);
      }
    } else if (app.state === "expanded") {
      if (deltaY > 90 || velocity > 0.35) {
        collapseMiniApp(app.id);
      }
    }
  }

  function handleClose() {
    if (app.needConfirmation) {
      showConfirmClose = true;
    } else {
      closeMiniApp(app.id);
    }
  }

  function handleConfirmClose() {
    showConfirmClose = false;
    closeMiniApp(app.id);
  }

  function handleLeftBtnClick() {
    if (currentInnerUrl) {
      handleGoBack();
      return;
    }
    if (app.customBackButton) {
      bridge?.triggerBackPressed();
    } else {
      handleClose();
    }
  }

  async function handleConfirmPhone() {
    showPhoneConfirm = false;
    try {
      const res = await $API.sharePhoneWithBot(app.botId);
      if (phoneResolvePromise) {
        phoneResolvePromise({
          phone: res.phone,
          hash: res.hash,
          authDate: res.authDate || res.auth_date,
        });
      }
    } catch {
      if (phoneResolvePromise) phoneResolvePromise(null);
    } finally {
      phoneResolvePromise = null;
    }
  }

  function handleCancelPhone() {
    showPhoneConfirm = false;
    if (phoneResolvePromise) {
      phoneResolvePromise(null);
      phoneResolvePromise = null;
    }
  }

  function handleShowBot() {
    showMenu = false;
    const botChatId = app.chatId || (Number($currentUser) ^ Number(app.botId));
    openChat(botChatId);
  }

  function handleOpenSettings() {
    showMenu = false;
    showSettingsModal = true;
  }

  function handleRefresh() {
    showMenu = false;
    reloadMiniApp(app.id);
  }

  function handleOpenShortcutModal() {
    showMenu = false;
    showShortcutModal = true;
  }

  async function handleCopyLink() {
    if (app.url) {
      try {
        await navigator.clipboard.writeText(app.url);
        alert("Ссылка на мини-приложение скопирована");
      } catch {
        alert("Не удалось скопировать ссылку");
      }
    }
    showShortcutModal = false;
  }

  function handleDownloadDesktopShortcut() {
    if (!app.url) return;
    const desktopEntry = `[Desktop Entry]\nVersion=1.0\nType=Application\nName=${app.title}\nComment=Mini App in Max\nExec=xdg-open "${app.url}"\nIcon=applications-internet\nTerminal=false\n`;
    const blob = new Blob([desktopEntry], { type: "application/x-desktop" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${app.title}.desktop`;
    a.click();
    URL.revokeObjectURL(a.href);
    showShortcutModal = false;
  }

  async function handleTerms() {
    showMenu = false;
    if (app.termsUrl) {
      try {
        await openUrl(app.termsUrl);
      } catch {
        window.open(app.termsUrl, "_blank");
      }
    }
  }

  function handleOpenReport() {
    showMenu = false;
    reportReason = "spam";
    reportDetails = "";
    showReportModal = true;
  }

  function handleSubmitReport() {
    showReportModal = false;
    alert("Жалоба отправлена на рассмотрение модераторам");
  }

  function closeMenuBackdrop(e) {
    if (!e.target.closest(".menu-container")) {
      showMenu = false;
    }
  }

  $: dynamicHeightPx = (() => {
    if (app.state === "expanded") {
      return typeof window !== "undefined" ? window.innerHeight : 800;
    }
    const basePx = typeof window !== "undefined"
      ? (window.innerHeight * defaultHeightPercent) / 100
      : 600;

    if (isDragging && currentDragDeltaY < 0) {
      const maxH = typeof window !== "undefined" ? window.innerHeight : 800;
      return Math.min(maxH, basePx - currentDragDeltaY);
    }
    return basePx;
  })();

  $: dynamicTranslateY = (() => {
    if (isMinimizing || isEntering) {
      return typeof window !== "undefined" ? window.innerHeight : 800;
    }
    if (isDragging && currentDragDeltaY > 0) {
      return currentDragDeltaY;
    }
    return 0;
  })();
</script>

<svelte:window on:click={closeMenuBackdrop} />

<div
  class="sheet-container"
  class:minimized={app.state === "minimized"}
  class:expanded={app.state === "expanded"}
  class:dragging={isDragging}
>
  <div
    class="sheet-backdrop"
    class:hidden={app.state === "expanded" || isMinimizing || isEntering}
    on:click={handleClose}
  ></div>

  <div
    bind:this={sheetSurfaceElement}
    class="sheet-surface"
    style="height: {dynamicHeightPx}px; transform: translateY({dynamicTranslateY}px);"
  >
    <div
      class="sheet-header"
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={handlePointerUp}
    >
      <div class="drag-pill"></div>

      <div class="header-bar">
        <div class="header-left">
          <IconButton class="webappsheet-header-btn" onclick={(e) => { e.stopPropagation(); (handleLeftBtnClick)(e); }} title={currentInnerUrl ? "Назад" : (app.customBackButton ? "Назад" : "Закрыть")}>
            {#if currentInnerUrl || app.customBackButton}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            {:else}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            {/if}
          </IconButton>
          <span class="sheet-title" title={currentInnerUrl || app.title}>
            {currentInnerUrl ? (innerUrlHostname || currentInnerUrl) : app.title}
          </span>
        </div>

        <div class="header-right">
          <IconButton class="webappsheet-header-btn" onclick={(e) => { e.stopPropagation(); (handleOpenPageInBrowser)(e); }} title="Открыть в браузере">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </IconButton>

          <IconButton class="webappsheet-header-btn" onclick={(e) => { e.stopPropagation(); (triggerMinimize)(e); }} title="Свернуть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </IconButton>

          <div class="menu-container">
            <IconButton class="webappsheet-header-btn" onclick={(e) => { e.stopPropagation(); (() => (showMenu = !showMenu))(e); }} title="Меню">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"></circle>
                <circle cx="12" cy="12" r="2"></circle>
                <circle cx="12" cy="19" r="2"></circle>
              </svg>
            </IconButton>

            {#if showMenu}
              <div class="dropdown-menu">
                <MenuItem class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (() => { showMenu = false; handleOpenPageInBrowser(); })(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>{/snippet}<span>Открыть в браузере</span></MenuItem>
                <MenuItem class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (handleShowBot)(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>{/snippet}<span>Открыть бота</span></MenuItem>
                <MenuItem class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (handleOpenSettings)(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>{/snippet}<span>Настройки</span></MenuItem>
                <MenuItem class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (handleRefresh)(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>{/snippet}<span>Обновить страницу</span></MenuItem>
                <MenuItem class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (handleOpenShortcutModal)(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="12" y1="8" x2="12" y2="16"></line>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                  </svg>{/snippet}<span>Добавить ярлык</span></MenuItem>
                {#if app.termsUrl}
                  <MenuItem class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (handleTerms)(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>{/snippet}<span>Условия использования</span></MenuItem>
                {/if}
                <MenuItem danger class="webappsheet-menu-item" onclick={(e) => { e.stopPropagation(); (handleOpenReport)(e); }}>{#snippet icon()}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>{/snippet}<span>Пожаловаться</span></MenuItem>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <div class="frame-container">
      {#if isDragging}
        <div class="drag-shield" on:pointerup={handlePointerUp}></div>
      {/if}
      {#if app.loading}
        <div class="loader-view">
          <div class="spinner"></div>
          <span>Загрузка...</span>
        </div>
      {:else if app.error}
        <div class="error-view">
          <span class="error-msg">{app.error}</span>
          <Button class="webappsheet-retry-btn" onclick={handleRefresh}>Повторить</Button>
        </div>
      {:else if app.url}
        {#key app.reloadKey}
          <iframe
            bind:this={iframeElement}
            src={resolveWebAppUrl(app.url)}
            title={app.title}
            class="app-frame"
            style:display={currentInnerUrl ? "none" : "block"}
            allow="camera; microphone; geolocation; clipboard-read; clipboard-write; autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          ></iframe>
        {/key}
        {#if currentInnerItem}
          {#key currentInnerItem.id}
            <iframe
              src={resolveWebAppUrl(currentInnerItem.initialUrl)}
              title={innerUrlHostname || currentInnerItem.currentUrl}
              class="app-frame inner-app-frame"
              allow="camera; microphone; geolocation; clipboard-read; clipboard-write; autoplay; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            ></iframe>
          {/key}
        {/if}
      {/if}
    </div>
  </div>
</div>

{#if showConfirmClose}
  <ConfirmModal
    title="Закрыть приложение?"
    message="Несохраненные данные могут быть потеряны."
    confirmText="Закрыть"
    cancelText="Отмена"
    isDangerous={true}
    on:confirm={handleConfirmClose}
    on:cancel={() => (showConfirmClose = false)}
  />
{/if}

{#if showPhoneConfirm}
  <ConfirmModal
    title="Передать номер телефона?"
    message="Мини-приложение запрашивает ваш номер телефона для авторизации."
    confirmText="Поделиться"
    cancelText="Отклонить"
    on:confirm={handleConfirmPhone}
    on:cancel={handleCancelPhone}
  />
{/if}

{#if showSettingsModal}
  <Modal open={true} bare closeOnEsc={true} zIndex={1500} onclose={() => (showSettingsModal = false)}>
    <div class="modal-card">
      <h4>Настройки приложения</h4>
      <p class="modal-subtext">ID бота: {app.botId}</p>
      <div class="modal-actions-col">
        <Button variant="danger" class="webappsheet-modal-btn" onclick={() => {
            bridge?.handleIncomingMessage("WebAppDeviceStorageClear", {});
            bridge?.handleIncomingMessage("WebAppSecureStorageClear", {});
            showSettingsModal = false;
            alert("Данные приложения очищены");
          }}>
          Очистить память приложения
        </Button>
        <Button class="webappsheet-modal-btn" onclick={() => (showSettingsModal = false)}>
          Закрыть
        </Button>
      </div>
    </div>
  </Modal>
{/if}

{#if showShortcutModal}
  <Modal open={true} bare closeOnEsc={true} zIndex={1500} onclose={() => (showShortcutModal = false)}>
    <div class="modal-card">
      <h4>Добавить ярлык</h4>
      <p class="modal-subtext">{app.title}</p>
      <div class="modal-actions-col">
        <Button variant="primary" class="webappsheet-modal-btn" onclick={handleDownloadDesktopShortcut}>
          Скачать файл ярлыка (.desktop)
        </Button>
        <Button class="webappsheet-modal-btn" onclick={handleCopyLink}>
          Скопировать ссылку
        </Button>
        <Button class="webappsheet-modal-btn" onclick={() => (showShortcutModal = false)}>
          Отмена
        </Button>
      </div>
    </div>
  </Modal>
{/if}

{#if showReportModal}
  <Modal open={true} bare closeOnEsc={true} zIndex={1500} onclose={() => (showReportModal = false)}>
    <div class="modal-card">
      <h4>Пожаловаться на приложение</h4>
      <p class="modal-subtext">Выберите причину жалобы:</p>
      <div class="report-reasons">
        <label class="reason-label">
          <input type="radio" bind:group={reportReason} value="spam" />
          <span>Спам и реклама</span>
        </label>
        <label class="reason-label">
          <input type="radio" bind:group={reportReason} value="fraud" />
          <span>Мошенничество или вредоносный код</span>
        </label>
        <label class="reason-label">
          <input type="radio" bind:group={reportReason} value="content" />
          <span>Неприемлемый или опасный контент</span>
        </label>
        <label class="reason-label">
          <input type="radio" bind:group={reportReason} value="copyright" />
          <span>Нарушение авторских прав</span>
        </label>
        <label class="reason-label">
          <input type="radio" bind:group={reportReason} value="other" />
          <span>Другое</span>
        </label>
      </div>

      <textarea
        class="report-textarea"
        bind:value={reportDetails}
        placeholder="Опишите подробнее (необязательно)"
        rows="3"
      ></textarea>

      <div class="modal-actions-row">
        <Button class="webappsheet-modal-btn" onclick={() => (showReportModal = false)}>
          Отмена
        </Button>
        <Button variant="danger" class="webappsheet-modal-btn" onclick={handleSubmitReport}>
          Пожаловаться
        </Button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .sheet-container {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    pointer-events: auto;
  }

  .sheet-container.minimized {
    display: none !important;
  }

  .sheet-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    transition: opacity 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .sheet-backdrop.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .sheet-surface {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-height: 100vh;
    background: #18191b;
    border-top-left-radius: 14px;
    border-top-right-radius: 14px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.5);
    transition: height 0.28s cubic-bezier(0.22, 1, 0.36, 1), transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .sheet-container.expanded .sheet-surface {
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }

  .sheet-container.dragging .sheet-surface {
    transition: none !important;
  }

  .sheet-header {
    position: relative;
    flex-shrink: 0;
    height: 48px;
    width: 100%;
    background: #202225;
    border-bottom: 1px solid var(--border-subtle);
    touch-action: none;
    user-select: none;
  }

  .drag-pill {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    background: rgba(255, 255, 255, 0.28);
    border-radius: 2px;
    pointer-events: none;
  }

  .header-bar {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    box-sizing: border-box;
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sheet-title {
    font-size: 15px;
    font-weight: 600;
    color: #f1f2f4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
    line-height: 1;
  }

  :global(.webappsheet-header-btn)  { width: 34px; }


  .menu-container {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    top: 40px;
    right: 0;
    width: 220px;
    background: #232629;
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    border: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 20;
  }





  .frame-container {
    flex: 1;
    position: relative;
    width: 100%;
    height: calc(100% - 48px);
    background: #0f1011;
  }

  .app-frame {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    background: transparent;
  }

  .loader-view,
  .error-view {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: #888d96;
    font-size: 14px;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }



  .modal-card {
    width: 100%;
    max-width: 380px;
    background: #202225;
    border-radius: 14px;
    padding: 20px;
    color: var(--text-primary);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    border: 1px solid var(--border-subtle);
  }

  .modal-card h4 {
    margin: 0 0 6px 0;
    font-size: 16px;
  }

  .modal-subtext {
    color: var(--text-muted);
    font-size: 13px;
    margin: 0 0 16px 0;
  }

  .modal-actions-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .modal-actions-row {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 16px;
  }









  .report-reasons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .reason-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    padding: 4px 0;
  }

  .report-textarea {
    width: 100%;
    background: #16181a;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 10px;
    color: var(--text-primary);
    font-size: 13px;
    resize: none;
    box-sizing: border-box;
    outline: none;
  }

  .report-textarea:focus {
    border-color: var(--accent-primary);
  }

  .drag-shield {
    position: absolute;
    inset: 0;
    z-index: 1000;
    cursor: grabbing;
    background: transparent;
  }
</style>
