<script>
  import { IconButton } from "$components/ui";
  import RoundButton from "$components/ui/RoundButton.svelte";
  import { goto } from "$app/navigation";
  import { writable, derived } from "svelte/store";
  import API, {
    currentRealContacts,
    currentUser,
  } from "$lib/stores/api";
  import {
    getContact,
    getCachedContacts
  } from "$lib/stores/contacts";
  import Session, {
    set as sessionSet
  } from "$lib/stores/session";
  import Search from "$components/main/Search.svelte";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Avatar from "$components/main/Avatar.svelte";


  import "$lib/styles/AnimatedPanel.css";

  export let hideHeader = false;

  let filter = "";
  let showAll = false;
  let showDeleteConfirm = false;

  const contactStores = writable([]);

  $: if (showAll) {
    getCachedContacts().then(contacts => {
      contactStores.set(
        contacts.map(contact => getContact(contact.id))
      );
    });
  } else {
    contactStores.set(
      $currentRealContacts.map(id => getContact(id))
    );
  }

  const contactsStore = derived(
    contactStores,
    ($stores, set) => {
      const values = [];
      const unsubscribers = $stores.map((store, index) => {
        return store.subscribe(value => {
          values[index] = value;
          set([...values]);
        });
      });

      return () => {
        unsubscribers.forEach(unsub => unsub());
      };
    },
    []
  );

  $: contacts = $contactsStore
    .filter(
      (x) =>
        x && x.id !== $currentUser &&
        (!filter || (x.names?.[0]?.name || "").toLowerCase().includes(filter.toLowerCase())) &&
        (showAll || (x.options?.includes("TT") && x.status !== "REMOVED" && x.accountStatus !== undefined))
    )
    .sort((a, b) =>
      (a.names?.[0]?.name || "").localeCompare(b.names?.[0]?.name || "", "ru")
    );

  /** Контакт, который собираемся удалить (через "⋯") */
  let contactToDelete = null;

  const search = (query) => {
    filter = query;
  };

  const filterSwap = (event) => {
    showAll = event?.target?.checked || false;
  };

  const open = (contact) => {
    sessionSet("profile", { userId: contact.id });
  };

  const isRealContact = (contact) =>
    $currentRealContacts.includes(contact.id) && contact.status !== "REMOVED";

  function askDelete(contact) {
    contactToDelete = contact;
    showDeleteConfirm = true;
  }

  async function onConfirmDelete() {
    if (contactToDelete) await $API.removeContact(contactToDelete.id);
    contactToDelete = null;
    showDeleteConfirm = false;
  }
</script>

<div class="container" class:modal-mode={hideHeader}>
  {#if !hideHeader}
    <div class="header">
      <div class="info">
        <h2 class="title" id="aside-header-title">Контакты</h2>
      </div>
      <div class="actions">
        <RoundButton label="Добавить контакт" aria-haspopup="dialog" onclick={() => ($Session.contactModal = true)} />
      </div>
      <div class="search">
        <Search input={search} placeholder="Найти" />
      </div>
    </div>
  {:else}
    <div class="search search--modal">
      <Search input={search} placeholder="Найти" />
    </div>
  {/if}

  {#if showDeleteConfirm}
    <ConfirmModal
      title="Удалить контакт?"
      message={`Удалить «${contactToDelete?.names?.[0]?.name || ""}» из контактов?`}
      confirmText="Удалить"
      isDangerous={true}
      on:cancel={() => { showDeleteConfirm = false; contactToDelete = null; }}
      on:confirm={onConfirmDelete}
    />
  {/if}

  <main class="list">
    {#each contacts as contact (contact.id)}
      <div class="wrapper" role="presentation">
        <button class="cell" type="button" on:click={() => open(contact)}>
          <span class="before">
            <Avatar contactId={contact.id} size={40} />
          </span>
          <span class="content">
            <span class="name">{contact.names?.[0]?.name || ""}</span>
            <span class="description"><Signature contactId={contact.id} /></span>
          </span>
        </button>
        {#if isRealContact(contact)}
          <span class="more">
            <IconButton class="pg-contacts-moreButton" aria-label="Удалить контакт" title="Удалить контакт" onclick={(e) => { e.stopPropagation(); (() => askDelete(contact))(e); }}>
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="18" cy="12" r="1.75" /></svg>
            </IconButton>
          </span>
        {/if}
      </div>
    {:else}
      <p class="empty">Ничего не найдено</p>
    {/each}

    <label class="showAll">
      <input type="checkbox" checked={showAll} on:change={filterSwap} />
      Показать весь кеш контактов
    </label>
  </main>
</div>

<style>
  .container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-app, var(--background-primary));
    font-family: var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
  }

  /* === Header — Max svelte-pu1tym === */
  .header {
    display: grid;
    grid-template: "info . actions" minmax(min-content, 0px) "search search search" / auto 1fr auto;
    align-items: center;
    width: 100%;
    padding-top: 22px;
    flex-shrink: 0;
  }

  .info {
    grid-area: info;
    display: flex;
    flex-flow: column;
    justify-content: center;
    height: 36px;
    padding: 16px 0 12px 16px;
    box-sizing: content-box;
  }

  .title {
    margin: 0;
    font: 600 var(--font-header-size, 24px) / var(--font-header-line-height, 28px) var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);
    letter-spacing: var(--font-header-letter-spacing, 0px);
    color: var(--bubbles-text-action, var(--text-primary));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    grid-area: actions;
    padding: 16px 16px 12px 0;
    box-sizing: content-box;
  }

  .search {
    grid-area: search;
    padding: 0 16px 8px;
  }

  .search--modal {
    padding-top: 8px;
  }

  /* круглая кнопка "+" — Max svelte-1snxxha */

  @media (hover: hover) {
  }





  /* === Список — Max svelte-110mc9a / svelte-1203pys === */
  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden auto;
    padding-bottom: 8px;
  }

  .wrapper {
    position: relative;
    display: flex;
    align-items: center;
    margin: 0;
  }

  @media (hover: hover) {
    .wrapper:hover {
      background: var(--background-secondary, #0d0d0d0a);
    }
  }

  .wrapper:active {
    background: var(--states-background-card-pressed, #0d0d0d14);
  }

  .cell {
    display: flex;
    flex: 1 1 0%;
    align-items: center;
    gap: 12px;
    min-width: 0;
    min-height: 56px;
    padding: 8px 16px;
    border: 0;
    background: none;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    user-select: none;
    font: inherit;
  }

  .before {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    min-width: 40px;
  }

  .content {
    display: flex;
    flex-direction: column;
    flex-grow: 1;
    gap: 2px;
    min-width: 0;
  }

  .name,
  .description {
    display: block;
    width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .name {
    font-size: var(--font-body-size, 16px);
    line-height: var(--font-body-line-height, 20px);
    letter-spacing: var(--font-body-letter-spacing, 0.15px);
    font-weight: var(--font-weight-medium, 500);
    color: currentColor;
  }

  .description {
    font-size: var(--font-description-size, 14px);
    line-height: var(--font-description-line-height, 18px);
    letter-spacing: var(--font-description-letter-spacing, 0.2px);
    font-weight: var(--font-weight-regular, 400);
    color: var(--text-tertiary, var(--text-muted));
  }

  /* кнопка "⋯" при наведении */
  .more {
    position: absolute;
    right: 16px;
    z-index: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }

  .wrapper:hover .more,
  .wrapper:focus-within .more {
    opacity: 1;
    pointer-events: auto;
  }

  :global(.pg-contacts-moreButton)  { width: 32px; }


  .empty {
    margin: 24px 16px;
    text-align: center;
    font-size: 15px;
    color: var(--text-tertiary, var(--text-muted));
  }

  .showAll {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 16px 0;
    font-size: 13px;
    line-height: 16px;
    color: var(--text-tertiary, var(--text-muted));
    cursor: pointer;
  }

  .showAll input {
    margin: 0;
    accent-color: var(--icon-themed, #007aff);
  }
</style>
