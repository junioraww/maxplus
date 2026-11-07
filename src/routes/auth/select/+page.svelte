<script>
  import { save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import {
    onMount,
    onDestroy,
  } from "svelte";
  import { get } from "svelte/store";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import API, { currentUser, currentUserDetails } from "$lib/stores/api";
  import { set as sessionSet } from "$lib/stores/session";
  import {
    getAccounts,
    getAccount,
    getCurrentAccount,
    setCurrentAccount,
  } from "$lib/stores/accounts";
  import { openLockScreen } from "$lib/stores/lockScreen";
  import { resetImageCaches } from "$lib/utils/images";
  import { clearCachingUtils } from "$lib/utils/caching";
  import { activeThemeId } from "$lib/stores/theme";

  import "$lib/styles/AnimatedPanel.css";
  import Avatar from "$components/main/Avatar.svelte";
  import OpenDevSettingsButton from "$components/main/dev/OpenButton.svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  let menu = null;
  let longPressed = false;
  let holdTimer;
  let unregisterMenuBack = null;
  let unregisterGeneralBack = null;

  let accounts = [];
  let loadingAccounts = true;

  onMount(() => {
    clearCachingUtils();
    resetImageCaches(0);
    currentUser.set(null);
    currentUserDetails.set(null);
    invoke("lock_crypto_session").catch(() => {});
    refreshAccounts();
    window.addEventListener("pointerdown", handleClick);

    unregisterGeneralBack = registerBackHandler(() => {
      goBack();
      return true;
    });
  });

  async function refreshAccounts() {
    loadingAccounts = true;
    try {
      const encrypted = await getAccounts();
      accounts = await Promise.all(encrypted.map(entry => getAccount(entry.id)));
    } catch {
      accounts = [];
    } finally {
      loadingAccounts = false;
    }
  }

  async function goBack() {
    const from = $page?.url?.searchParams?.get("from");
    if (from === "login") {
      goto("/auth/login");
      return;
    }
    if (from === "account" || from === "settings") {
      goto("/");
      return;
    }

    const current = await getCurrentAccount().catch(() => null);
    if (current?.id) {
      goto("/");
    } else if (typeof window !== "undefined" && window.history?.length > 1) {
      window.history.back();
    } else {
      goto("/auth/login");
    }
  }

  async function select(selected) {
    const current = await getCurrentAccount().catch(() => null);
    if (current?.id === selected.id && (!selected.encryption || selected.unlocked)) {
      return goto("/");
    }
    clearCachingUtils();
    resetImageCaches(selected.id);
    const account = await getAccount(selected.id);

    if (account.encryption && (!account.unlocked || !account.meta?.device)) {
      await setCurrentAccount(account.id);
      openLockScreen({
        mode: "decrypt",
        account,
        from: "/"
      });
      return;
    }

    sessionSet("sync", false);
    sessionSet("connected", false);
    await setCurrentAccount(account.id);
    if (account.contact) {
      currentUserDetails.set(account.contact);
      currentUser.set(account.contact.id);
    } else {
      currentUser.set(account.id);
    }
    $API.latest_init = 0;
    await $API.init(true, true);
    return goto("/");
  }

  async function removeAccountLocally(account) {
    closeMenu();
    try {
      await $API.removeAccountOnly(account);
    } catch {}
    await refreshAccounts();
  }

  async function logoutAndRemoveAccount(account) {
    closeMenu();
    try {
      await $API.logoutAccount(account);
    } catch {}
    await refreshAccounts();
  }

  function addNew() {
    goto("/auth/login");
  }

  function startHold(e, account) {
    longPressed = false;
    clearTimeout(holdTimer);

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    holdTimer = setTimeout(() => {
      longPressed = true;
      openContext(account, clientX, clientY);
    }, 450);
  }

  function cancelHold() {
    clearTimeout(holdTimer);
  }

  function openContext(account, x, y) {
    const maxX = window.innerWidth - 220;
    const maxY = window.innerHeight - 200;

    menu = {
      account,
      x: Math.min(x, maxX),
      y: Math.min(y, maxY)
    };

    if (unregisterMenuBack) {
      unregisterMenuBack();
    }
    unregisterMenuBack = registerBackHandler(() => {
      closeMenu();
      return true;
    });
  }

  async function exportAccount(account) {
    closeMenu();

    const dataToSave = {
      version: 1,
      type: "account",
      meta: account.meta || {},
      token: account.token,
      seed: account.seed || null,
      id: account.id,
      timestamp: Date.now()
    };

    const path = await save({
      defaultPath: `${account.meta?.firstName || account.id}.json`,
      filters: [
        {
          name: "Файл аккаунта (.json)",
          extensions: ["json"],
        },
      ],
    });

    if (!path) return;

    const json = JSON.stringify(dataToSave, null, 2);
    await invoke("data_save", { id: account.id, file: path, value: json }).catch(() => {});
  }

  function closeMenu() {
    menu = null;
    if (unregisterMenuBack) {
      unregisterMenuBack();
      unregisterMenuBack = null;
    }
  }

  function handleClick(e) {
    if (menu && !longPressed && !e.target.closest(".context-menu")) {
      closeMenu();
    }
  }

  onDestroy(() => {
    if (unregisterMenuBack) {
      unregisterMenuBack();
      unregisterMenuBack = null;
    }
    if (unregisterGeneralBack) {
      unregisterGeneralBack();
      unregisterGeneralBack = null;
    }
    window.removeEventListener("pointerdown", handleClick);
  });
</script>

<div
  class="page"
  class:dark-theme={$activeThemeId === "dark"}
  on:click={handleClick}
>
  <button
    type="button"
    class="back-button"
    on:click={goBack}
    aria-label="Назад"
  >
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
  </button>

  <h1 class="title">Выберите аккаунт</h1>
  <a class="hint">Зажми для открытия меню действий.</a>

  <div class="accounts">
    {#if !loadingAccounts}
      {#each accounts as account}
        <div
          class="account"
          on:click={() => {
            if (longPressed) return;
            if (!menu) select(account);
          }}
          on:contextmenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setTimeout(() => {
              openContext(account, e.clientX, e.clientY);
            }, 0);
          }}
          on:touchstart={(e) => startHold(e, account)}
          on:touchend={cancelHold}
          on:touchmove={cancelHold}
          on:mousedown={(e) => e.button === 0 && startHold(e, account)}
          on:mouseup={cancelHold}
          on:mouseleave={cancelHold}
        >
          <div class="account-avatar-wrapper">
            {#if account.encryption && !account.unlocked}
              {#if account.preview?.avatarBlur}
                <img
                  class="blurred-avatar"
                  src={account.preview.avatarBlur}
                  alt=""
                  width="72"
                  height="72"
                />
              {:else}
                <div class="empty-encrypted-avatar">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
              {/if}
            {:else}
              <Avatar
                accountId={account.id}
                contactId={account.contact?.id}
                src={account.contact?.baseRawUrl || account.contact?.baseUrl || account.contact?.avatar || account.contact?.photo}
                title={account.contact?.names?.[0]?.firstName || account.meta?.firstName || "Аккаунт"}
                seed={account.id}
                size=72
              />
            {/if}
          </div>
          <a>{ (account.encryption && !account.unlocked ? (account.preview?.firstName || "Locked") : (account.contact?.names?.[0]?.firstName || account.meta?.firstName || "Аккаунт")) }</a>
        </div>
      {/each}
    {/if}

    <div on:click={addNew} class="account">
      <div class="avatar">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>
      <a>Новый</a>
    </div>
  </div>

  {#if menu}
    <div
      class="context-menu"
      style="left:{menu.x}px; top:{menu.y}px"
      on:click|stopPropagation
    >
      <button on:click={() => exportAccount(menu.account)}>
        Экспортировать
      </button>

      <button on:click={() => removeAccountLocally(menu.account)}>
        Удалить с устройства
      </button>

      <button
        class="danger"
        on:click={() => logoutAndRemoveAccount(menu.account)}
      >
        Выйти из аккаунта
      </button>
    </div>
  {/if}
</div>

<OpenDevSettingsButton />

<div on:click={() => sessionSet("devicesPage", true)} class="open-devices">
  <a>Настройки устройства</a>
</div>

<style>
  .page {
    --select-bg: #ffffff;
    --select-text: #000000;
    --select-hint: #8e8e93;
    --select-card-bg: #eff0f4;
    --select-avatar-bg: #eff0f4;
    --select-avatar-border: #e5e5ea;
    --select-menu-bg: #ffffff;
    --select-menu-border: #efeff4;

    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100%;
    width: 100%;
    text-align: center;
    background-color: var(--select-bg);
    color: var(--select-text);
    box-sizing: border-box;
    padding: calc(30px + var(--safe-top, 0px)) 16px calc(24px + var(--safe-bottom, 0px)) 16px;
    overflow-y: auto;
  }

  .page.dark-theme {
    --select-bg: #17181c;
    --select-text: #ffffff;
    --select-hint: #8b929e;
    --select-card-bg: #24242d;
    --select-avatar-bg: #24242d;
    --select-avatar-border: rgba(255, 255, 255, 0.08);
    --select-menu-bg: #212128;
    --select-menu-border: rgba(255, 255, 255, 0.08);
  }

  .back-button {
    position: absolute;
    top: calc(16px + var(--safe-top, 0px));
    left: 16px;
    z-index: 100;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--select-text);
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .back-button:active {
    background-color: rgba(127, 127, 127, 0.15);
  }

  .title {
    margin: 0;
    font-size: 23px;
    font-weight: 700;
    color: var(--select-text);
  }

  .hint {
    font-size: 14px;
    color: var(--select-hint);
    margin: 6px 0 24px 0;
  }

  .accounts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: flex-start;
    gap: 24px 20px;
    width: 100%;
    max-width: 380px;
    margin: 0 auto;
    padding: 8px 12px;
    box-sizing: border-box;
  }

  @media (min-width: 520px) {
    .accounts {
      max-width: 520px;
      gap: 28px 24px;
    }
  }

  .account {
    width: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--select-text);
    opacity: 0.9;
    transition: opacity 0.15s ease, transform 0.1s ease;
    position: relative;
    cursor: pointer;
  }

  .account:hover {
    opacity: 1;
  }

  .account:active {
    transform: scale(0.95);
  }

  .account > a {
    width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--select-text);
  }

  .account-avatar-wrapper {
    position: relative;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--select-avatar-bg);
    border: 1.5px solid var(--select-avatar-border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .blurred-avatar {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 50%;
  }

  .empty-encrypted-avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: var(--select-avatar-bg);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .account .avatar {
    background-color: var(--select-avatar-bg);
    border: 1.5px solid var(--select-avatar-border);
    border-radius: 50%;
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #007aff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .open-devices {
    position: absolute;
    z-index: 100;
    color: white;
    width: 200px;
    height: 40px;
    top: calc(70px + var(--safe-top, 0px));
    right: 0;
    background: linear-gradient(270deg, #333, #444), #333;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 100px 0 0 100px;
    cursor: pointer;
    transition: padding 0.1s;
    font-size: 15px;
    font-weight: 500;
  }

  .open-devices:hover {
    padding-right: 5px;
  }

  .context-menu {
    position: fixed;
    z-index: var(--z-dropdown, 5);
    min-width: 210px;
    display: flex;
    flex-direction: column;
    background: var(--select-menu-bg);
    border: 1px solid var(--select-menu-border);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 10px 35px rgba(0, 0, 0, 0.2);
    animation: menuAppear .15s ease;
  }

  .context-menu button {
    border: none;
    background: transparent;
    color: var(--select-text);
    padding: 13px 16px;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: background .15s;
    font-family: inherit;
  }

  .page.dark-theme .context-menu button:hover {
    background: rgba(255, 255, 255, .08);
  }

  .page:not(.dark-theme) .context-menu button:hover {
    background: #f2f2f7;
  }

  .context-menu .danger {
    color: #ff3b30;
  }

  @keyframes menuAppear {
    from {
      opacity: 0;
      transform: scale(.96) translateY(6px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
