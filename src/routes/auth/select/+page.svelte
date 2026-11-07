<script>
  import { save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import {
    onMount,
    onDestroy,
  } from "svelte";
  import { get } from "svelte/store";
  import { goto } from "$app/navigation";
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

  import "$lib/styles/AnimatedPanel.css";
  import Avatar from "$components/main/Avatar.svelte";
  import OpenDevSettingsButton from "$components/main/dev/OpenButton.svelte";
  import { registerBackHandler } from "$lib/utils/backButton";

  let menu = null;
  let longPressed = false;
  let holdTimer;
  let unregisterMenuBack = null;

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

    if (accounts.length === 0) {
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
      if (menu) {
        closeMenu();
        return true;
      }
      return false;
    });
  }

  async function exportAccount(account) {
    closeMenu();

    const dataToSave = {
      id: account.id,
      token: account.meta?.token,
      device: account.meta?.device,
      encryption: account.encryption || null,
      preview: account.preview || null,
      exportedAt: new Date().toISOString(),
    };

    const path = await save({
      defaultPath: `account_${account.contact?.names?.[0]?.firstName || account.id}.json`,
      filters: [
        {
          name: "JSON",
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
    window.removeEventListener("pointerdown", handleClick);
  });
</script>

<div class="page" on:click={handleClick}>
  <h1>Выберите аккаунт</h1>
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

<style>
  .page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 98vh;
    text-align: center;
    color: #ddd;
  }

  h1 {
    margin: 0;
    font-size: 23px;
  }

  .hint {
    font-size: 14px;
    color: #777;
    margin: 5px 0 20px 0;
  }

  .accounts {
    display: flex;
    gap: 20px;
    width: 100%;
    justify-content: center;
    overflow-y: scroll;
  }

  .account {
    width: 76px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: white;
    font-weight: 300;
    opacity: 0.8;
    transition: opacity 0.1s;
    position: relative;
    cursor: pointer;
  }

  .account:hover {
    opacity: 1;
  }

  .account > a {
    max-width: 76px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
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
    background: #24242d;
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
    background: #24242d;
    border: 1px dashed #444;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .account .avatar {
    background-color: #777;
    border-radius: 50%;
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
  }

  .context-menu {
    position: fixed;
    z-index: var(--z-dropdown, 5);
    min-width: 210px;
    display: flex;
    flex-direction: column;
    background: rgba(34, 34, 40, .98);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 10px 35px rgba(0,0,0,.45);
    animation: menuAppear .15s ease;
  }

  .context-menu button {
    border: none;
    background: transparent;
    color: #eee;
    padding: 13px 16px;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: background .15s;
  }

  .context-menu button:hover {
    background: rgba(255,255,255,.06);
  }

  .context-menu button:active {
    background: rgba(255,255,255,.1);
  }

  .context-menu .danger {
    color: #ff5b5b;
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
