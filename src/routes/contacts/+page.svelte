<script>
  import { writable, derived } from "svelte/store";
  import API, { currentRealContacts, currentUser, currentUserDetails } from "$lib/stores/api";
  import { getContact, getContactDisplayName } from "$lib/stores/contacts";
  import { openChat, showConfirm, openContactAdd } from "$lib/stores/session";
  import Session from "$lib/stores/session";
  import Search from "$components/main/Search.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import { showAlert } from "$lib/utils/alert";

  export let hideHeader = false;

  let filter = "";
  const contactStores = writable([]);

  $: contactStores.set(($currentRealContacts || []).map((id) => getContact(id)));

  const contactsStore = derived(
    contactStores,
    ($stores, set) => {
      const values = [];
      const unsubs = $stores.map((s, idx) =>
        s.subscribe((val) => {
          values[idx] = val;
          set([...values]);
        })
      );
      return () => unsubs.forEach((u) => u());
    },
    []
  );

  $: grouped = $contactsStore
    .filter(
      (c) =>
        c &&
        c.id !== $currentUser &&
        c.status !== "REMOVED" &&
        (!filter || getContactDisplayName(c).toLowerCase().includes(filter.toLowerCase()))
    )
    .sort((a, b) =>
      getContactDisplayName(a).localeCompare(getContactDisplayName(b), "ru")
    )
    .reduce((acc, c) => {
      const name = getContactDisplayName(c);
      const letter = (name || "#").charAt(0).toUpperCase();
      (acc[letter] ??= []).push(c);
      return acc;
    }, {});

  function openDirect(contact) {
    const dialogId = Number(BigInt($currentUser) ^ BigInt(contact.id));
    openChat(dialogId);
  }

  async function handleDeleteContact(contact, event) {
    event.stopPropagation();
    const ok = await showConfirm({
      title: "Удалить контакт?",
      message: `Удалить ${getContactDisplayName(contact) || "пользователя"} из контактов?`,
      confirmText: "Удалить",
      isDangerous: true,
    });
    if (ok) {
      await $API.removeContact(contact.id);
      showAlert("Контакт удален");
    }
  }

  function handleInvite() {
    const nick = $currentUserDetails?.nick;
    const link = nick ? `https://max.ru/${nick}` : ($currentUser ? `https://max.ru/u/${$currentUser}` : "https://max.ru");
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(() => {
        showAlert("Ссылка на ваш профиль скопирована");
      });
    } else {
      showAlert(link);
    }
  }
</script>

<div class="contacts-layout" class:modal-mode={hideHeader}>
  {#if !hideHeader}
    <div class="contacts-header">
      <div class="contacts-title-row">
        <h3>Контакты</h3>
        <button
          class="add-contact-btn"
          on:click={openContactAdd}
          aria-label="Добавить контакт"
        >
          <span class="mask-icon" style="-webkit-mask-image: url('/icons/plus.svg'); mask-image: url('/icons/plus.svg'); width: 20px; height: 20px;"></span>
        </button>
      </div>
      <Search input={(q) => (filter = q)} placeholder="Поиск контактов" />
    </div>
  {:else}
    <div class="modal-search-wrapper">
      <Search input={(q) => (filter = q)} placeholder="Поиск контактов" />
    </div>
  {/if}

  <div class="contacts-content">
    {#if !filter}
      <div class="quick-rows">
        <div class="quick-row" on:click={handleInvite}>
          <div class="quick-icon share-icon">
            <img src="/icons/link.svg" alt="" width="18" height="18" />
          </div>
          <span>Пригласить друзей</span>
        </div>

        <div class="quick-row" on:click={openContactAdd}>
          <div class="quick-icon add-icon">
            <img src="/icons/user-plus.svg" alt="" width="18" height="18" />
          </div>
          <span>Добавить контакт</span>
        </div>
      </div>
    {/if}

    <div class="contacts-list">
      {#each Object.keys(grouped) as letter (letter)}
        <div class="letter-separator">{letter}</div>
        {#each grouped[letter] as contact (contact.id)}
          <div class="contact-item" on:click={() => openDirect(contact)}>
            <Avatar contactId={contact.id} size={44} />
            <div class="contact-info">
              <div class="contact-name">{getContactDisplayName(contact) || "Без имени"}</div>
              <div class="contact-status"><Signature contactId={contact.id} /></div>
            </div>
            <button
              class="delete-btn"
              on:click={(e) => handleDeleteContact(contact, e)}
              title="Удалить контакт"
            >
              <img src="/icons/trash.svg" alt="" width="16" height="16" class="theme-icon" />
            </button>
          </div>
        {/each}
      {/each}

      {#if Object.keys(grouped).length === 0}
        <div class="empty-msg">Контакты не найдены</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .contacts-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: #16171b;
  }

  .contacts-header {
    padding: calc(10px + var(--safe-top, 0px)) 16px 10px;
    background: var(--bg-topbar, var(--bg-surface));
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .contacts-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .contacts-title-row h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .add-contact-btn {
    background: none;
    border: none;
    color: var(--accent-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 50%;
  }

  .add-contact-btn:hover {
    background: var(--accent-subtle);
  }

  .modal-search-wrapper {
    padding: 10px 14px 6px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
  }

  .contacts-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .quick-rows {
    display: flex;
    flex-direction: column;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .quick-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 4px;
    cursor: pointer;
    border-radius: 10px;
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 500;
  }

  .quick-row:hover {
    background: var(--bg-hover);
  }

  .quick-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-contrast, #ffffff);
  }

  .quick-icon.share-icon {
    background: var(--accent-primary);
  }

  .quick-icon.add-icon {
    background: var(--accent-primary);
  }

  .contacts-list {
    display: flex;
    flex-direction: column;
    padding: 4px 8px 24px;
  }

  .letter-separator {
    padding: 12px 14px 4px;
    font-size: 13px;
    font-weight: 700;
    color: var(--accent-primary);
  }

  .contact-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 12px;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .contact-item:hover {
    background: var(--bg-hover);
  }

  .contact-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .contact-name {
    font-size: 15px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact-status {
    font-size: 13px;
    color: var(--text-muted);
  }

  .delete-btn {
    background: none;
    border: none;
    color: var(--icon-muted);
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease;
  }

  .contact-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: #ff4d4f;
    background: rgba(255, 77, 79, 0.1);
  }

  .empty-msg {
    padding: 32px 16px;
    text-align: center;
    color: #6d7380;
    font-size: 14px;
  }
</style>
