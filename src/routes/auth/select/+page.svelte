<script>
  import { save } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import {
    onMount,
    onDestroy,
    getContext,
  } from "svelte";
  import { goto } from "$app/navigation";
  import API, { currentUser } from "$lib/stores/api";
  import {
    getAccounts,
    getAccount,
    getAccountMeta,
    setCurrentAccount,
  } from "$lib/stores/accounts";

  import "$lib/styles/AnimatedPanel.css";
  import Avatar from "$components/main/Avatar.svelte";
  import OpenDevSettingsButton from "$components/main/dev/OpenButton.svelte";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  let menu = null;
  let longPressed = false;
  let holdTimer;
  let unregisterMenuBack = null;

  let accountsPromise;
  onMount(() => {
    accountsPromise = updateAccounts();
  });

  async function updateAccounts() {
    const encrypted = await getAccounts();
    return await Promise.all(encrypted.map(entry => getAccount(entry.id)));
  }

  async function select(selected) {
    const account = await getAccount(selected.id);

    if (account.encryption && !account.contact) {
      await setCurrentAccount(account.id);
      return goto("/auth/lock")
    }

    if ($currentUser !== account.contact.id || !$currentUser) {
      await setCurrentAccount(account.id);
      await currentUser.set(account.contact.id);
      await $API.init(true);
    }

    return goto("/")
  }

  async function logout(account) {
    console.log('Logging out', account.id, 'current', $currentUser)

    try {
      await $API.logout(account.uid, false);
    } catch (e) {
      console.error(e);
    }

    await updateAccounts();

    if (!accountsPromise.length) {
      goto("/auth/login")
    }
  }

  async function addNew(e) {
    try {
      await $API.disconnect();
    } catch (e) {
      console.error(e);
    }
    goto("/auth/login");
  }

  /* new: holding */

  function startHold(e, account) {
    clearTimeout(holdTimer);

    longPressed = false;

    const { clientX, clientY } = e.touches?.[0] || e;

    holdTimer = setTimeout(() => {
      longPressed = true;
      openContext(account, clientX, clientY);
    }, 500);
  }

  function cancelHold() {
    clearTimeout(holdTimer);

    setTimeout(() => {
      longPressed = false;
    }, 10);
  }

  function openContext(account, x, y) {
    menu = {
      account, x, y
    };

    if (unregisterMenuBack) {
      unregisterMenuBack();
    }
    unregisterMenuBack = registerBackHandler(() => {
      closeMenu();
    });
  }

  const writeFile = (path, content) => invoke("write_file_string", { path, content });

  async function exportAccount(account) {
    closeMenu();
    let meta;

    try {
      const data = await getAccountMeta(account.id);
      meta = data.meta;
    } catch (e) {
      console.error(e);
      alert("Ошибка!\nВозможно, вы не расшифровали аккаунт.")
      return;
    }

    const dataToSave = {
      version: 1,
      type: "account",
      meta
    };

    const path = await save({
      defaultPath: "account.json",
      filters: [
        {
          name: "Аккаунт с токеном (.json)",
          extensions: ["json"],
        },
      ],
    });

    if (!path) return;

    const json = JSON.stringify(dataToSave, null, 2);
    await writeFile(path, json);
  }

  async function deleteAccount(account) {
    closeMenu();
    await logout(account);
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

  onMount(() => {
    window.addEventListener("pointerdown", handleClick);
  });

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
    {#await accountsPromise}
    {:then accounts}
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
          <Avatar contactId={account.contact?.id} seed={account.id} size=72/>
          <a>{ account.contact?.names[0]?.firstName || "Зашифр." }</a>
        </div>
      {/each}
    {/await}
    <div on:click={addNew} class="account">
      <div class="avatar"><a>+</a></div>
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

    <button
      class="danger"
      on:click={() => deleteAccount(menu.account)}
    >
      Удалить
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

  form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    max-width: 300px;
  }

  input,
  button {
    padding: 0.75rem;
    border-radius: 8px;
    border: 1px solid #333;
    font-size: 1rem;
    background-color: #26262e;
    color: #ccc;
    outline: none;
  }

  button {
    color: white;
    border: none;
    cursor: pointer;
  }

  .accounts {
    display: flex;
    gap: 20px;
    width: 100%;
    justify-content: center;
    overflow-y: scroll;
  }

  .account {
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: white;
    font-weight: 300;
    opacity: 0.8;
    transition: opacity 0.1s;
    position: relative;
  }

  .account:hover {
    opacity: 1;
  }

  .account .avatar {
    background-color: #777;
    border-radius: 100px;
    width: 72px;
    height: 72px;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    display: flex;
  }

  .account .avatar * {
    font-size: 64px;
    font-weight: 500;
    line-height: 0;
    margin: auto auto;
    position: relative;
    bottom: 4px;
  }

  .link {
    margin-top: 2rem;
    font-size: 0.9rem;
    color: #4a90e2;
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }

  .error {
    color: red;
    font-size: 0.9rem;
    height: auto;
    word-break: break-all;
    white-space: nowrap;
    text-align: center;
  }

  .context-menu {
    position: fixed;
    z-index: 1000;

    min-width: 210px;

    display: flex;
    flex-direction: column;

    background: rgba(34, 34, 40, .98);

    border: 1px solid rgba(255,255,255,.08);
    border-radius: 14px;

    overflow: hidden;

    box-shadow:
      0 10px 35px rgba(0,0,0,.45);

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
