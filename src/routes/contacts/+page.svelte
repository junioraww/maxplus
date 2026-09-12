<script>
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
  import {
    set as sessionSet
  } from "$lib/stores/session";
  import Search from "$components/main/Search.svelte";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Avatar from "$components/main/Avatar.svelte";

  import AddContactBtn from "$components/main/AddContactBtn.svelte";

  import "$lib/styles/AnimatedPanel.css";

  let grouped = {};
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

  $: grouped = $contactsStore
    .filter(
      (x) =>
        x && x.id !== $currentUser &&
        (!filter || x.names?.[0]?.name.match(new RegExp(filter, "i"))) &&
        (showAll || (x.options?.includes("TT") && x.status !== "REMOVED" && x.accountStatus !== undefined))
    )
    .sort((a, b) =>
      (a.names?.[0]?.name || "").localeCompare(b.names?.[0]?.name || "", "ru")
    )
    .reduce((acc, c) => {
      const letter = (c.names?.[0]?.name || "").charAt(0).toUpperCase();
      (acc[letter] ??= []).push(c);
      return acc;
    }, {});

  async function removeContact(id) {
    await $API.removeContact(id);
  }

  const search = (query) => {
    filter = query;
  };

  const filterSwap = (event) => {
    showAll = event?.target?.checked || false;
  };

  const open = (e, contact) => {
    const toDelete = [".delete"].some((x) => e.target.closest(x));
    if (toDelete) {
      removeContact(contact.id);
    } else {
      sessionSet("profile", { userId: contact.id });
    }
  };

  function deleteSelected() {
    if (selectedChats.size === 0) return;
    showDeleteConfirm = true;
  }

  async function onConfirmDelete() {
    await $API.removeContact(id);

    clearSelection();
    showDeleteConfirm = false;
  }
</script>

<div class="container">
  <header>
    <div class="row">
      <h3 style="margin-left: 15px;">Контакты</h3>
      <div style="margin-right: 15px;" class="flex-end">
        <AddContactBtn />
      </div>
    </div>
    <Search input={search} placeholder="Имя, фамилия или ник" />
  </header>

  {#if showDeleteConfirm}
    <ConfirmModal
      title="Удалить чаты?"
      message={`Вы точно хотите удалить выбранные чаты (${selectedChats.size})? Это действие нельзя отменить.`}
      confirmText="Удалить"
      isDangerous={true}
      on:cancel={() => (showDeleteConfirm = false)}
      on:confirm={onConfirmDelete}
    />
  {/if}

  <label class="showAll" style="margin-left: -15px;">
    <input
      type="checkbox"
      id="only-added"
      name="only-added"
      on:click={filterSwap}
    />
    <span class="checkmark"></span>
    Отобразить полный кеш
  </label>

  <main class="content">
    {#each Object.keys(grouped) as letter}
      <a>{letter}</a>
      {#each grouped[letter] as contact}
        <div class="contact" on:click={(e) => open(e, contact)}>
          <Avatar contactId={contact.id} size={44} />
          <div class="column">
            <div class="name">
              {contact.names[0].name}
            </div>
            <a><Signature contactId={contact.id} /></a>
          </div>
          <div class="action">
            {#if $currentRealContacts.includes(contact.id) && contact.status !== "REMOVED"}
              <a class="delete">Удалить</a>
            {:else}
              <a>Не контакт</a>
            {/if}
          </div>
        </div>
      {/each}
    {/each}
    {#if Object.keys(grouped).length === 0}
      <a style="font-size:14px">Ничего не найдено!</a>
    {/if}
  </main>
</div>

<style>
  .container {
    overflow: hidden;
  }

  header {
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 5px 0;
    margin-top: 10px;
    margin-bottom: 5px;
  }

  header h3 {
    margin: 0;
    font-size: 18px;
    color: #ccc;
  }

  .row {
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .flex-end {
    display: flex;
    gap: 15px;
  }

  .showAll {
    color: #999;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  .showAll input {
    display: none;
  }

  .checkmark {
    width: 18px;
    height: 18px;
    border: 2px solid #ccc;
    border-radius: 6px;
    position: relative;
    transition: all 0.2s ease;
  }

  .checkmark::after {
    content: "";
    position: absolute;
    left: 7px;
    top: 2px;
    width: 4px;
    height: 10px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg) scale(0);
    transition: transform 0.1s ease;
  }

  .showAll input:checked + .checkmark {
    background-color: #4f46e5;
    border-color: #4f46e5;
  }

  .showAll input:checked + .checkmark::after {
    transform: rotate(45deg) scale(1);
  }

  .showAll:hover .checkmark {
    border-color: #4f46e5;
  }

  .content {
    height: calc(100% - 140px);
    color: #ccc;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: scroll;
    overflow-x: hidden;
  }

  .contact {
    position: relative;
    height: 40px;
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    cursor: pointer;
    gap: 16px;
  }

  .contact .column {
    display: flex;
    flex-direction: column;
  }

  .contact .name {
    font-size: 14px;
    display: flex;
  }

  .contact a {
    font-size: 12px;
    color: #999;
    position: relative;
  }

  .contact .delete {
    color: #f88;
  }

  .contact .action {
    position: absolute;
    right: 10px;
    margin-bottom: 10px;
  }
</style>
