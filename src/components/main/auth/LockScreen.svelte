<script>
  import { onDestroy, onMount, createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { goto } from "$app/navigation";
  import {
    getCurrentAccount,
    getAccount,
    setEncryption,
    getDatabaseFilesCount,
    decrypt,
    generateHardwareKey,
    setHardwareEncryption,
    decryptHardware,
  } from "$lib/stores/accounts";
  import {
    authenticateHardware,
    storeHardwareKey,
    retrieveHardwareKey,
    deleteHardwareKey,
  } from "$lib/services/hardwareSecurity";
  import API, {
    currentUser,
    currentUserDetails,
  } from "$lib/stores/api";
  import { get as sessionGet, set as sessionSet } from "$lib/stores/session";
  import { createBlurredAvatarPreview, resetImageCaches } from "$lib/utils/images";
  import { clearCachingUtils } from "$lib/utils/caching";
  import { resetAutoLockActivity } from "$lib/stores/autoLock";
  import BackButton from "$components/main/auth/BackButton.svelte";

  export let mode = "decrypt";
  export let lockType = null;
  export let from = null;
  export let isOverlay = false;
  export let account = null;

  const dispatch = createEventDispatcher();

  let points = [];
  let selected = [];
  let dragPoints = [];

  let drawing = false;
  let cursor = null;

  let hidePattern = false;
  let text = "";
  let repeat = null;

  let migrating = false;
  let migrationPhase = "";
  let migrationCurrent = 0;
  let migrationTotal = 0;
  let migrationPercent = 0;
  let unlistenProgress = null;

  let currentAccount = null;
  let isHardwareLocked = false;
  let authenticatingHardware = false;

  async function buildPreviewData() {
    try {
      const details = get(currentUserDetails);
      const firstName = details?.names?.[0]?.firstName || details?.name || "";
      const rawAvatar = details?.baseRawUrl || details?.avatar || details?.baseUrl || details?.photo || null;
      const avatarBlur = await createBlurredAvatarPreview(rawAvatar);
      return { firstName, avatarBlur };
    } catch {
      return null;
    }
  }

  onMount(async () => {
    unlistenProgress = await listen("encryption-migration-progress", (event) => {
      if (event.payload) {
        migrationCurrent = event.payload.current ?? 0;
        migrationTotal = event.payload.total ?? 0;
        migrationPercent = event.payload.percent ?? 0;
        if (event.payload.phase) {
          migrationPhase = event.payload.phase;
        }
      }
    });

    if (account) {
      currentAccount = account;
    } else {
      currentAccount = await getCurrentAccount();
    }
    if (currentAccount?.encryption?.type === "hardware-1") {
      isHardwareLocked = true;
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityOrFocus);
      window.addEventListener("focus", handleVisibilityOrFocus);
    }

    if (mode === "create" && lockType === "hardware") {
      await setupHardwareLock();
    } else if (mode === "disable" && isHardwareLocked) {
      await disableHardwareLock();
    } else if (mode !== "create" && isHardwareLocked) {
      scheduleHardwareUnlock();
    }
  });

  onDestroy(() => {
    if (unlistenProgress) {
      unlistenProgress();
    }
    if (unlockTimer) {
      clearTimeout(unlockTimer);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
    }
  });

  let hardwareUnlockScheduled = false;
  let unlockTimer = null;

  function scheduleHardwareUnlock() {
    if (hardwareUnlockScheduled || authenticatingHardware || migrating) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    hardwareUnlockScheduled = true;
    if (unlockTimer) clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => {
      hardwareUnlockScheduled = false;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        unlockWithHardware();
      }
    }, 150);
  }

  function handleVisibilityOrFocus() {
    if (typeof document !== "undefined" && document.visibilityState === "visible" && mode !== "create" && isHardwareLocked) {
      scheduleHardwareUnlock();
    }
  }

  async function handleUnlockSuccess(retry) {
    resetAutoLockActivity();
    clearCachingUtils();
    resetImageCaches(currentAccount?.id || retry?.id);
    if (retry?.contact) {
      currentUserDetails.set(retry.contact);
      const isFromAuth = window.location.pathname.startsWith("/auth") || from === "/auth/select";
      if (isFromAuth || get(currentUser) !== retry.contact.id) {
        sessionSet("sync", false);
        sessionSet("connected", false);
        currentUser.set(retry.contact.id);
      } else {
        const api = get(API);
        if (!sessionGet("connected")) {
          api?.init(true).catch(() => {});
        } else if (!sessionGet("sync")) {
          api?.sync().catch(() => {});
        }
      }
      if (!currentAccount?.preview) {
        const firstName = retry.contact?.names?.[0]?.firstName || "";
        const avatarUrl = retry.contact?.avatarUrl || retry.contact?.photo || "";
        let avatarBlur = null;
        if (avatarUrl) {
          avatarBlur = await createBlurredAvatarPreview(avatarUrl).catch(() => null);
        }
        await invoke("account_set_preview", {
          id: currentAccount?.id || retry.id,
          preview: { firstName, avatarBlur }
        }).catch(() => {});
      }
    }
    dispatch("unlocked", retry);
    const targetPath = (from && from !== "/auth/select") ? from : "/";
    if (!isOverlay) {
      goto(targetPath);
    } else {
      if (from && from !== "/auth/select") {
        goto(from);
      } else if (window.location.pathname.startsWith("/auth")) {
        goto("/");
      }
    }
  }

  function goBack() {
    if (isOverlay) {
      dispatch("close");
      if (mode === "decrypt") {
        goto("/auth/select");
      }
    } else {
      if (mode === "decrypt") goto("/auth/select");
      else history.back();
    }
  }

  async function setupHardwareLock() {
    if (!currentAccount) currentAccount = account || await getCurrentAccount();
    if (!currentAccount) {
      text = "Аккаунт не найден";
      return;
    }

    try {
      await authenticateHardware("Подтвердите биометрию для защиты аккаунта");
    } catch {
      text = "Биометрия отменена или не распознана";
      return;
    }

    const totalFiles = await getDatabaseFilesCount(currentAccount.id).catch(() => 0);
    migrationTotal = totalFiles;
    migrationCurrent = 0;
    migrationPercent = 0;
    migrationPhase = "encrypt";
    migrating = true;

    try {
      const preview = await buildPreviewData();
      const rawKey = await generateHardwareKey();
      await storeHardwareKey(currentAccount.id, rawKey);
      await setHardwareEncryption(currentAccount.id, rawKey, true, preview);
      migrationCurrent = migrationTotal;
      migrationPercent = 100;
      await new Promise(r => setTimeout(r, 400));
      goBack();
    } catch (e) {
      migrating = false;
      text = "Ошибка настройки: " + e;
    }
  }

  async function disableHardwareLock() {
    if (!currentAccount) currentAccount = account || await getCurrentAccount();
    if (!currentAccount) return;

    authenticatingHardware = true;
    text = "Подтвердите биометрию...";

    let key;
    try {
      key = await retrieveHardwareKey(currentAccount.id, "Отключение шифрования");
    } catch {
      authenticatingHardware = false;
      text = "Биометрия отменена или не распознана";
      return;
    }

    authenticatingHardware = false;
    const totalFiles = await getDatabaseFilesCount(currentAccount.id).catch(() => 0);
    migrationTotal = totalFiles;
    migrationCurrent = 0;
    migrationPercent = 0;
    migrationPhase = "decrypt";
    migrating = true;

    try {
      await setHardwareEncryption(currentAccount.id, key, false, null);
      await deleteHardwareKey(currentAccount.id);
      migrationCurrent = migrationTotal;
      migrationPercent = 100;
      await new Promise(r => setTimeout(r, 400));
      goBack();
    } catch (e) {
      migrating = false;
      text = "Ошибка отключения: " + e;
    }
  }

  async function unlockWithHardware() {
    if (!currentAccount) currentAccount = account || await getCurrentAccount();
    if (!currentAccount) return;

    authenticatingHardware = true;
    text = "Ожидание биометрии...";

    let key;
    try {
      key = await retrieveHardwareKey(currentAccount.id, "Разблокировка учетной записи");
    } catch {
      authenticatingHardware = false;
      text = "Биометрия не подтверждена";
      return;
    }

    authenticatingHardware = false;

    try {
      await decryptHardware(currentAccount.id, key);
    } catch {
      text = "Неверный ключ шифрования!";
      return;
    }

    const retry = await getAccount(currentAccount.id);
    if (!retry?.contact) {
      text = "Ошибка получения данных!";
      return;
    }

    handleUnlockSuccess(retry);
  }

  function createPoints() {
    points = [];

    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        points.push({
          id: y * 3 + x,
          x: 75 + x * 80,
          y: 75 + y * 80
        });
      }
    }
  }

  createPoints();

  function convert(x, y) {
    const el = document.querySelector(".pattern");
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();

    return {
      x: (x - rect.left) * 300 / rect.width,
      y: (y - rect.top) * 300 / rect.height
    };
  }

  function getPoint(x, y) {
    const p = convert(x, y);

    return points.find(point =>
      Math.hypot(
        point.x - p.x,
        point.y - p.y
      ) < 20
    );
  }

  function addPoint(point) {
    if (!point) return;
    const last = selected[selected.length - 1];
    if (last && last.id === point.id) return;
    if (selected.some(p => p.id === point.id)) return;
    selected = [ ...selected, point ];
  }

  function start(e) {
    if (migrating) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    text = "";
    selected = [];
    dragPoints = [];
    drawing = true;

    const pos = convert(e.clientX, e.clientY);
    dragPoints = [ pos ];
    cursor = pos;

    addPoint(getPoint(e.clientX, e.clientY));
  }

  function move(e) {
    if (!drawing || migrating) return;
    e.preventDefault();

    const pos = convert(e.clientX, e.clientY);
    cursor = pos;

    dragPoints = [ ...dragPoints, pos ];
    addPoint(getPoint(e.clientX, e.clientY));
  }

  async function end() {
    if (!drawing || migrating) return;

    drawing = false;
    cursor = null;

    if (selected.length < 4) {
      text = "Минимум 4 точки";
      return;
    }

    const str = selected.map(x => x.id).join("");

    if (mode === "create") {
      if (!repeat) {
        repeat = str;
        text = "Повторим?";
      } else {
        if (str !== repeat) {
          text = "Попробуйте заново!";
          selected = [];
          dragPoints = [];
          repeat = null;
        } else {
          text = "Подготовка...";
          selected = [];
          dragPoints = [];
          repeat = null;

          const target = account || await getCurrentAccount();
          const totalFiles = await getDatabaseFilesCount(target.id).catch(() => 0);
          migrationTotal = totalFiles;
          migrationCurrent = 0;
          migrationPercent = 0;
          migrationPhase = "encrypt";
          migrating = true;

          try {
            const preview = await buildPreviewData();
            await setEncryption(target.id, str, true, preview);
            migrationCurrent = migrationTotal;
            migrationPercent = 100;
            await new Promise(r => setTimeout(r, 400));
            goBack();
          } catch (e) {
            migrating = false;
            text = "Ошибка шифрования: " + e;
          }
        }
      }
    } else if (mode === "disable") {
      const target = account || await getCurrentAccount();
      const totalFiles = await getDatabaseFilesCount(target.id).catch(() => 0);
      migrationTotal = totalFiles;
      migrationCurrent = 0;
      migrationPercent = 0;
      migrationPhase = "decrypt";
      migrating = true;

      try {
        await setEncryption(target.id, str, false, null);
        migrationCurrent = migrationTotal;
        migrationPercent = 100;
        await new Promise(r => setTimeout(r, 400));
        goBack();
      } catch {
        migrating = false;
        text = "Неверный ключ!";
        selected = [];
        dragPoints = [];
        return;
      }
    } else {
      const target = account || await getCurrentAccount();

      try {
        await decrypt(target.id, str);
      } catch (err) {
        text = "Неверный ключ!";
        return;
      }

      const retry = await getAccount(target.id);

      if (!retry?.contact) {
        text = "Ошибка получения данных!";
        return;
      }

      handleUnlockSuccess(retry);
    }
  }

  const dragPath = () => dragPoints.map(p => `${p.x},${p.y}`).join(" ");
</script>

<div class={isOverlay ? "lock-overlay-backdrop" : "auth-page"}>
  {#if isOverlay}
    <div class="overlay-nav">
      {#if mode === "decrypt"}
        <button type="button" class="nav-text-btn" on:click={goBack}>
          Сменить аккаунт
        </button>
      {:else}
        <button type="button" class="nav-text-btn" on:click={goBack}>
          Отмена
        </button>
      {/if}
    </div>
  {/if}

  {#if migrating}
    <div class="migration-card">
      <div class="migration-icon">
        {#if migrationPhase === "encrypt"}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        {:else}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
          </svg>
        {/if}
      </div>
      <h2>
        {migrationPhase === "encrypt" ? "Шифрование данных" : "Расшифровка данных"}
      </h2>
      <p class="migration-subtitle">
        {migrationCurrent} из {migrationTotal} файлов ({migrationPercent}%)
      </p>
      <div class="progress-track">
        <div class="progress-bar" style="width: {migrationPercent}%"></div>
      </div>
    </div>
  {:else if isHardwareLocked}
    <div class="hardware-card">
      <div class="hardware-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04A12.003 12.003 0 0 1 3 11c0-4.97 4.03-9 9-9s9 4.03 9 9a11.96 11.96 0 0 1-1.5 5.73m-3.8-3.93A5.996 5.996 0 0 0 12 8c-2.485 0-4.5 2.015-4.5 4.5 0 1.948.928 3.68 2.37 4.784"/>
          <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
        </svg>
      </div>
      <h2>Вход по биометрии</h2>
      <p class="hardware-subtitle">
        {text || (authenticatingHardware ? "Ожидание подтверждения..." : "Используйте сканер отпечатка пальца или лица")}
      </p>
      {#if !authenticatingHardware}
        <button type="button" class="retry-btn" on:click={unlockWithHardware}>
          Повторить
        </button>
      {/if}
    </div>
  {:else}
    <div class="lock-header">
      <div class="lock-header-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h1>
        {
          mode === "create" ? "Нарисуйте графический ключ" :
          mode === "decrypt" ? "Помните рисунок?" :
          "Повторите графический ключ"
        }
      </h1>
    </div>

    {#if mode === "check"}
      <label class="hide-pattern-label">
        <input
          type="checkbox"
          bind:checked={hidePattern}
        >
        Не отображать рисунок
      </label>
    {/if}

    <div
      class="pattern"
      on:pointerdown={start}
      on:pointermove={move}
      on:pointerup={end}
    >
      <svg viewBox="0 0 300 300">
        {#if !hidePattern}
          <polyline
            points={dragPath()}
            class="drag-line"
          />

          <polyline
            points={selected.map(p => `${p.x},${p.y}`).join(" ")}
            class="draw-line"
          />

          {#if cursor && selected.length}
            <line
              class="cursor-line"
              x1={selected[selected.length - 1].x}
              y1={selected[selected.length - 1].y}
              x2={cursor.x}
              y2={cursor.y}
            />
          {/if}
        {/if}
      </svg>

      {#each points as p}
        <div
          class="point"
          class:selected={ selected.some(x => x.id === p.id) }
          style="left: {(p.x / 300) * 100}%; top: {(p.y / 300) * 100}%;"
        ></div>
      {/each}
    </div>

    <div class="text">{text}</div>

    {#if !isOverlay}
      <BackButton top={10} path={from}/>
    {/if}
  {/if}
</div>

<style>
  .lock-overlay-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 99999;
    background: #0e0e12;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 20px;
    color: #ddd;
    user-select: none;
    text-align: center;
    padding: calc(var(--safe-top, 0px) + 24px) 24px calc(var(--safe-bottom, 0px) + 24px);
    box-sizing: border-box;
    overflow-y: auto;
  }

  .auth-page {
    min-height: 98vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 20px;
    color: #ddd;
    user-select: none;
    text-align: center;
    padding: calc(var(--safe-top, 0px) + 24px) 24px calc(var(--safe-bottom, 0px) + 24px);
    box-sizing: border-box;
    width: 100%;
    max-width: 100vw;
  }

  .overlay-nav {
    position: absolute;
    top: calc(var(--safe-top, 0px) + 16px);
    right: calc(var(--safe-right, 0px) + 16px);
    z-index: 10;
  }

  .nav-text-btn {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 8px;
    transition: background 0.15s, color 0.15s;
  }

  .nav-text-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  .lock-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .lock-header-icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(99, 102, 241, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lock-header-icon svg {
    width: 28px;
    height: 28px;
    position: static;
  }

  .lock-header h1 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 600;
    color: #f3f4f6;
  }

  .hide-pattern-label {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #9ca3af;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .pattern {
    width: 300px;
    height: 300px;
    max-width: min(300px, calc(100vw - 48px));
    max-height: min(300px, calc(100vw - 48px));
    aspect-ratio: 1 / 1;
    position: relative;
    touch-action: none;
    margin: 0 auto;
  }

  .pattern svg {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    z-index: 5;
    pointer-events: none;
    overflow: visible;
  }

  .drag-line {
    fill: none;
    stroke: #ef4444;
    stroke-width: 4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .draw-line {
    fill: none;
    stroke: white;
    stroke-width: 10;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .cursor-line {
    stroke: white;
    stroke-width: 10;
    opacity: .5;
  }

  .point {
    position: absolute;
    width: 26px;
    height: 26px;
    margin-left: -13px;
    margin-top: -13px;
    border-radius: 50%;
    background: #555;
    z-index: 1;
    pointer-events: none;
    transition: transform 0.15s, background 0.15s;
  }

  .point.selected {
    background: white;
    transform: scale(1.15);
  }

  .text {
    height: 24px;
    font-size: 16px;
    color: #f87171;
  }

  .migration-card,
  .hardware-card {
    width: 320px;
    max-width: 90vw;
    background: #24242d;
    border: 1px solid #32323d;
    border-radius: 18px;
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    box-sizing: border-box;
  }

  .migration-icon,
  .hardware-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(99, 102, 241, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .migration-icon svg,
  .hardware-icon svg {
    width: 28px;
    height: 28px;
    position: static;
  }

  .migration-card h2,
  .hardware-card h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: #fff;
  }

  .migration-subtitle,
  .hardware-subtitle {
    margin: 0;
    color: #9ca3af;
    font-size: 0.92rem;
    line-height: 1.4;
  }

  .retry-btn {
    background: #6366f1;
    border: none;
    color: #fff;
    padding: 10px 24px;
    border-radius: 10px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .retry-btn:hover {
    background: #4f46e5;
  }

  .progress-track {
    width: 100%;
    height: 8px;
    background: #1a1a22;
    border-radius: 999px;
    overflow: hidden;
  }

  .progress-bar {
    height: 100%;
    background: #6366f1;
    border-radius: 999px;
    transition: width 0.15s ease-out;
  }
</style>
