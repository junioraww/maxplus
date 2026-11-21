<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import API, { currentRealChats, currentRealContacts, currentUser } from "$lib/stores/api";
  import { getChat } from "$lib/stores/messages";
  import { getContact, updateContact } from "$lib/stores/contacts";
  import { openChat } from "$lib/stores/session";
  import Session from "$lib/stores/session";
  import ChatItem from "$components/chats/ChatItem.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import { escapeHtml, normalizePhone } from "$lib/utils/text";
  import { debounce } from "$lib/utils/debounce";
  import { invoke } from "$lib/utils/invoke";
  import { registerBackHandler } from "$lib/utils/backButton";

  const dispatch = createEventDispatcher();

  let searchQuery = "";
  let searchInputEl;
  let isSearching = false;
  let phoneUser = null;
  let isCheckingPhone = false;
  let searchPublic = [];
  let searchMsg = [];

  const unregisterBack = registerBackHandler(() => {
    dispatch("close");
    return false;
  });

  onDestroy(() => unregisterBack());

  onMount(() => {
    setTimeout(() => searchInputEl?.focus(), 60);
  });

  function handleKeyDown(e) {
    if (e.key === "Escape") dispatch("close");
  }

  $: localMatchedChats = ($currentRealChats || [])
    .map((id) => getChat(id).getInfo())
    .filter((chat) => {
      if (!chat || !searchQuery.trim()) return false;
      const q = searchQuery.toLowerCase().trim();
      const title = (chat.title || chat.participants?.[0]?.name || "").toLowerCase();
      return title.includes(q);
    });

  $: localMatchedContacts = ($currentRealContacts || [])
    .map((id) => getContact(id))
    .filter((contact) => {
      if (!contact || contact.id === $currentUser || !searchQuery.trim()) return false;
      const q = searchQuery.toLowerCase().trim();
      const name = (contact.names?.[0]?.name || "").toLowerCase();
      return name.includes(q);
    });

  $: allLocalContacts = ($currentRealContacts || [])
    .map((id) => getContact(id))
    .filter((contact) => contact && contact.id !== $currentUser);

  async function handleInput(e) {
    searchQuery = e.target.value;
    const q = searchQuery.trim();

    if (!q) {
      phoneUser = null;
      searchPublic = [];
      searchMsg = [];
      return;
    }

    const digitsOnly = q.replace(/[^\d+]/g, "");
    if (digitsOnly.length >= 7 && (q.startsWith("+") || /^\d+$/.test(q))) {
      checkPhone(digitsOnly);
    } else {
      phoneUser = null;
    }

    if (await debounce("chats_search", 350)) return;
    if (!searchQuery.trim()) return;

    isSearching = true;

    try {
      const pubRes = await $API.searchPublic(q);
      const list = pubRes?.result;
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item.contact) {
            item.contact = item.contact.contact || item.contact;
          }
        }
        searchPublic = list;
      } else {
        searchPublic = [];
      }
    } catch {
      searchPublic = [];
    }

    try {
      const msgRes = await $API.searchMsg(q);
      searchMsg = Array.isArray(msgRes?.result) ? msgRes.result : [];
    } catch {
      searchMsg = [];
    } finally {
      isSearching = false;
    }
  }

  async function checkPhone(phoneStr) {
    const formatted = normalizePhone(phoneStr);
    isCheckingPhone = true;
    try {
      const res = await invoke("get_by_phone", { phone: formatted });
      if (res?.contact?.id) {
        phoneUser = res.contact;
      } else {
        phoneUser = null;
      }
    } catch {
      phoneUser = null;
    } finally {
      isCheckingPhone = false;
    }
  }

  function clearQuery() {
    searchQuery = "";
    phoneUser = null;
    searchPublic = [];
    searchMsg = [];
    searchInputEl?.focus();
  }

  function openDirectChat(user) {
    const dialogId = Number(BigInt($currentUser) ^ BigInt(user.id));
    openChat(dialogId);
    dispatch("close");
  }

  function openFoundChat(id) {
    openChat(id);
    dispatch("close");
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="search-screen" transition:fade={{ duration: 140 }}>
  <div class="search-topbar">
    <button class="back-btn" on:click={() => dispatch("close")} aria-label="Назад">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </button>

    <div class="search-input-field">
      <input
        bind:this={searchInputEl}
        type="text"
        placeholder="Поиск"
        value={searchQuery}
        on:input={handleInput}
      />
      {#if searchQuery.length > 0}
        <button class="clear-query-btn" on:click={clearQuery} aria-label="Очистить">
          <img src="/icons/close.svg" width="16" height="16" alt="" />
        </button>
      {/if}
    </div>
  </div>

  <div class="search-results-body">
    {#if !searchQuery.trim()}
      {#if allLocalContacts.length > 0}
        <div class="section-header">Все контакты</div>
        {#each allLocalContacts as contact (contact.id)}
          <div class="local-contact-item" on:click={() => openDirectChat(contact)}>
            <Avatar contactId={contact.id} size={44} />
            <div class="local-contact-name">{contact.names?.[0]?.name || "Без имени"}</div>
          </div>
        {/each}
      {/if}
    {:else}
      {#if phoneUser}
        <div class="section-header">Найденный пользователь</div>
        <div class="phone-result-card">
          <Avatar contactId={phoneUser.id} size={48} />
          <div class="phone-result-info">
            <div class="phone-result-name">{phoneUser.names?.[0]?.name || "Пользователь"}</div>
            <div class="phone-result-sub">{phoneUser.phone ? `+${phoneUser.phone}` : "В сети Max"}</div>
          </div>
          <div class="phone-result-actions">
            <button class="action-btn-small" on:click={() => openDirectChat(phoneUser)}>Написать</button>
          </div>
        </div>
      {/if}

      {#if localMatchedChats.length > 0 || localMatchedContacts.length > 0}
        {#if localMatchedContacts.length > 0}
          <div class="section-header">Контакты</div>
          {#each localMatchedContacts as contact (contact.id)}
            <div class="local-contact-item" on:click={() => openDirectChat(contact)}>
              <Avatar contactId={contact.id} size={44} />
              <div class="local-contact-name">{contact.names?.[0]?.name || "Без имени"}</div>
            </div>
          {/each}
        {/if}

        {#if localMatchedChats.length > 0}
          <div class="section-header">Чаты и каналы</div>
          {#each localMatchedChats as chat (chat.id)}
            <ChatItem {chat} on:open={() => openFoundChat(chat.id)} />
          {/each}
        {/if}
      {/if}

      {#if searchPublic.length > 0}
        <div class="section-header">Глобальный поиск</div>
        {#each searchPublic as item, idx ((item.chat || item.contact)?.id ?? idx)}
          <ChatItem
            chat={item.chat || item.contact}
            on:open={async () => {
              let chatId;
              if (item.chat) chatId = item.chat.id;
              else if (item.contact) {
                const c = item.contact;
                chatId = Number(BigInt($currentUser) ^ BigInt(c.id));
                await updateContact(c);
              }
              openFoundChat(chatId);
            }}
          />
        {/each}
      {/if}

      {#if searchMsg.length > 0}
        <div class="section-header">Сообщения</div>
        {#each searchMsg as item, i (item.chatId ? `${item.chatId}_${item.message?.id ?? i}` : i)}
          {@const chat = getChat(item.chatId).getInfo()}
          {#if chat && item.message}
            {@const hl = item.highlights?.[0]}
            <ChatItem
              {chat}
              replace={{
                message: item.message,
                text: hl
                  ? escapeHtml(item.message.text).replace(new RegExp(hl, "gi"), `<b>${hl}</b>`)
                  : escapeHtml(item.message.text),
              }}
              on:open={() => openFoundChat(item.chatId)}
            />
          {/if}
        {/each}
      {/if}

      {#if searchQuery.trim().length > 0 && !isSearching && !phoneUser && !localMatchedChats.length && !localMatchedContacts.length && !searchPublic.length && !searchMsg.length}
        <div class="no-results-msg">Ничего не найдено</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .search-screen {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #16171b;
    z-index: var(--z-modal, 7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search-topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: calc(10px + var(--safe-top, 0px)) 14px 10px;
    background: #1c1d22;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .back-btn {
    background: none;
    border: none;
    color: #8c93a0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 50%;
  }

  .back-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .search-input-field {
    flex: 1;
    height: 40px;
    background: #24262e;
    border-radius: 12px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 8px;
    color: #ffffff;
  }

  .search-input-field input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 15px;
  }

  .search-input-field input::placeholder {
    color: #6d7380;
  }

  .clear-query-btn {
    background: none;
    border: none;
    color: #8c93a0;
    cursor: pointer;
    padding: 2px;
    display: flex;
  }

  .clear-query-btn:hover {
    color: #ffffff;
  }

  .search-results-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-bottom: max(20px, calc(16px + var(--safe-bottom, 0px)));
    -webkit-overflow-scrolling: touch;
  }

  .section-header {
    padding: 14px 16px 6px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #8c93a0;
  }

  .phone-result-card {
    margin: 8px 14px;
    padding: 12px;
    border-radius: 14px;
    background: #202228;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .phone-result-info {
    flex: 1;
    min-width: 0;
  }

  .phone-result-name {
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
  }

  .phone-result-sub {
    font-size: 13px;
    color: #0077ff;
  }

  .action-btn-small {
    background: #0077ff;
    color: #ffffff;
    border: none;
    border-radius: 10px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .local-contact-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    cursor: pointer;
  }

  .local-contact-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .local-contact-name {
    font-size: 15px;
    color: #ffffff;
    font-weight: 500;
  }

  .no-results-msg {
    padding: 40px 20px;
    text-align: center;
    color: #6d7380;
    font-size: 15px;
  }
</style>
