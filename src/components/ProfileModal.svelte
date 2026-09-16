<script>
  import { fly, fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import {
    createEventDispatcher,
    getContext,
    onDestroy
  } from "svelte";
  import { get } from "svelte/store";

  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import InputModal from "$components/main/InputModal.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Avatar from "$components/main/Avatar.svelte";

  import { getContact } from "$lib/utils/caching";
  import { formatMs } from "$lib/utils/time";
  import Session, {
    openChat as _openChat,
    closeChat as _closeChat,
  } from "$lib/stores/session";
  import API, {
    currentUser,
    currentUserDetails,
    currentSessionChats,
    currentPresence,
    currentRealContacts,
    currentRealChats,
  } from "$lib/stores/api";

  const onBack = getContext("onBack");

  onBack.profileModal = () => {
    if (showDeleteConfirm) showDeleteConfirm = false;
    else if (showInputs) showInputs = false;
    else if (showMenu) showMenu = false;
    else closeModal();
  }

  onDestroy(() => {
    delete onBack["profileModal"];
  })

  $: userId = (() => {
    const value = $Session.profile.userId;
    return value || $currentUser ^ $Session.profile.chatId;
  })();

  $: chatId = (() => {
    const value = $Session.profile.chatId;
    return value || $currentUser ^ $Session.profile.userId;
  })();

  $: chat = $currentSessionChats.find(x => x.id === chatId);
  $: contact = getContact(chat.type === "DIALOG" ? userId : undefined);

  let showMenu = false;
  let showDeleteConfirm = false;
  let showInputs = false;

  $: title = $contact?.names?.[0]?.firstName || chat.title;

  $: avatar = chat.avatar || $contact?.avatar;
  $: chatLink = chat.link;

  $: infoFields = [
    info(chat.description || $contact?.description, "about", "Описание", chat.description || $contact?.description),
    info(chat.phone, "about", "Мобильный", chat.phone),
    info(chat.created > 1, "about", "Дата создания", formatMs(chat.created)),
    info($contact?.registrationTime, "about", "Дата регистрации", formatMs($contact?.registrationTime)),
  ].filter(Boolean);

  const info = (k, icon, label, value) => k && { icon, label, value };

  const toggleMenu = () => showMenu = !showMenu;

  function handleAction(action) {
    showMenu = false;
    if (action === "delete") return showDeleteConfirm = true;
    if (action === "quit")   return leaveChat();
    if (action === "invite") return refreshInvite();
  }

  const closeModal = () => $Session.profile = null;
  const closeChat = () => _closeChat(chat.id);

  function handleWindowClick(e) {
    if (showMenu && !e.target.closest(".menu-container")) showMenu = false;
  }

  function formatId(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  async function joinChannel() {
    const response = await $API.joinChannel(chat.link);

    Object.keys(response)
      .forEach(key => chat[key] = response[key]);
  }

  async function quitChannel() {
    await $API.leaveChannel(chat);
  }

  async function deleteChat() {
    closeChat();
    closeModal();
    $API.deleteChatForAll(chat);
  }

  async function leaveChat() {
    closeChat();
    closeModal();
    $API.leaveChat(chat);
  }

  async function updateChatProfile({ detail }) {
    showInputs = false;
    const { title, description } = detail;

    chat.title = title;
    chat.description = description.length ? description : undefined;

    await $API.updateChatProfile(chat);
  }

  const openChat = () => _openChat(chatId);

  const copyLink = () => navigator.clipboard.writeText(chat.link);

  async function refreshInvite() {
    const { chat: updated } = await $API.refreshInviteLink(chat.id);
    chatLink = updated.link;
  }

  function selectMember(memberId) {
    Session.update(entry => ({
      ...entry,
      profile: { history: [
        ...(entry.profile.history || []),
        { chatId, userId }
      ], userId: memberId }
    }));
  }

  function goBack() {
    if ($Session.profile.history?.length) {
      const length = $Session.profile.history.length;
      const last = $Session.profile.history[length - 1];
      $Session.profile = {
        history: $Session.profile.history.slice(length),
        ...last
      };
    } else $Session.profile = null;
  }
</script>

<svelte:window on:click={handleWindowClick} />

<div
  class="profile-backdrop"
  transition:fade={{ duration: 300 }}
  on:click|self={closeModal}
>
  <div
    class="profile-panel"
    transition:fly={{ x: 380, duration: 300, opacity: 1, easing: cubicOut }}
  >
    <div class="peer-id">
      ID {formatId(userId || chatId)}
    </div>

    <div class="header-controls">
      <button class="icon-btn" on:click={goBack}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          ><line x1="19" y1="12" x2="5" y2="12"></line><polyline
            points="12 19 5 12 12 5"
          ></polyline></svg
        >
      </button>

      <div class="menu-container">
        {#if chat && (chat.type === "CHAT" || chat.type === "DIALOG")}
          <button class="icon-btn" on:click|stopPropagation={toggleMenu}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              ><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"
              ></circle><circle cx="12" cy="19" r="1"></circle></svg
            >
          </button>
        {/if}

        {#if showMenu}
          <div
            class="dropdown"
            transition:scale={{ duration: 150, start: 0.9 }}
          >
            {#if chat?.type === "CHAT" || chat.type === "DIALOG"}
              {#if chat.admins?.includes($currentUser)}
                <div
                  class="menu-item"
                  on:click={() => showInputs = true}
                >
                  Изменить название
                </div>
                {#if chat.link}
                <div
                  class="menu-item"
                  on:click={() => handleAction("invite")}
                >
                  Обновить ссылку
                </div>
                {/if}
              {/if}
              {#if chat.owner === $currentUser || chat.type === "DIALOG"}
                <div
                  class="menu-item danger"
                  on:click={() => handleAction("delete")}
                >
                  Удалить для всех
                </div>
              {/if}
              {#if chat.type === "CHAT"}
                <div
                  class="menu-item danger"
                  on:click={() => handleAction("quit")}
                >
                  Выйти из группы
                </div>
              {/if}
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="hero">
      <Avatar
        chat={chat}
        contactId={$contact?.id}
        size={100}
        style="margin-bottom: 10px;"/>
      <div class="hero-info">
        <h2>{title}</h2>
        <a
          class:online={$currentPresence[$contact?.id]?.on === "ON"}
          class="status"
        >
        <Signature contact={contact} chat={chat} />
        </a>
      </div>
      {#if chatLink}
        <div
          class="tag"
          on:click={copyLink}
        >
          {#if chatLink.includes("join/")}
            {chatLink.slice(0, 24)}...{chatLink.slice(chatLink.length - 4)}
          {:else}
            @{chatLink.replace("https://max.ru/", "")}
          {/if}
        </div>
      {:else}
        <div style="height:10px;"></div>
      {/if}
    </div>

    <div class="info-list">
      {#if chat.type === "CHANNEL"}
        <div class="info-item hoverable" on:click={openChat}>
          <div class="icon-wrap">✨</div>
          <div class="button">
            <span class="label">Перейти в канал</span>
          </div>
        </div>

        {#if $currentRealChats.includes(chat.id)}
          <div class="info-item hoverable" on:click={quitChannel}>
            <div class="icon-wrap">❌</div>
            <div class="button">
              <span class="label">Отписаться</span>
            </div>
          </div>
        {:else}
          <div class="info-item hoverable" on:click={joinChannel}>
            <div class="icon-wrap">✅</div>
            <div class="button">
              <span class="label">Подписаться</span>
            </div>
          </div>
        {/if}
      {:else if chat.type === "CHAT"}
        <div class="info-item hoverable" on:click={openChat}>
          <div class="icon-wrap">💭</div>
          <div class="button">
            <span class="label">Открыть группу</span>
          </div>
        </div>
      {:else}
        <div class="info-item hoverable" on:click={openChat}>
          <div class="icon-wrap">✨</div>
          <div class="button">
            <span class="label">Перейти в чат</span>
          </div>
        </div>
      {/if}

      <hr />

      {#each infoFields as field}
        <div class="info-item">
          <img src={"icons/" + field.icon + ".svg"} class="icon-wrap">
          <div class="info-content">
            <span class="value selectable">{field.value}</span>
            <span class="label">{field.label}</span>
          </div>
        </div>
      {/each}

      {#if chat.type === "CHAT"}
      <hr />
        <div class="members">
          {#each Object.keys(chat.participants) as userId}
            {#await getContact(userId)}
            {:then member}
              <div
                class="member"
                on:click={() => selectMember(get(member).id)}
              >
                <div class="row">
                  <Avatar contactId={userId} size={44} />
                  <div class="column">
                    <div class="name">
                      {get(member)?.names[0].name}
                    </div>
                    <a><Signature {member} /></a>
                  </div>
                </div>
                <svg
                  width="24" height="24"
                  viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  ><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"
                  ></circle><circle cx="12" cy="19" r="1"></circle></svg>
              </div>
            {/await}
          {/each}
        </div>
        <div
          class="invite"
          on:click={_ => alert("В разработке!")}
        >
          <b>+</b> Пригласить контакты
        </div>
      {/if}
    </div>
  </div>
</div>

{#if showDeleteConfirm}
  <ConfirmModal
    title="Удалить чат?"
    message="Вы уверены?"
    confirmText="Выйти"
    on:confirm={deleteChat}
    on:cancel={() => (showDeleteConfirm = false)}
  />
{/if}

{#if showInputs}
  <InputModal
    title="Настройки чата"
    fields={[
      {
        key: "title",
        label: "Название",
        placeholder: "Введите название",
        value: chat.title
      }, {
        key: "description",
        label: "Описание",
        placeholder: "Введите описание",
        value: chat.description || "",
        multiline: true
      },
    ]}
    on:submit={updateChatProfile}
    on:cancel={() => showInputs = false}
  />
{/if}

<style>
  .profile-backdrop {
    position: fixed;
    top: 0;
    right: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 100;
    display: flex;
    justify-content: flex-end;
    will-change: opacity;
  }

  .profile-panel {
    width: 100%;
    max-width: 380px;
    height: 100%;
    background: #1c1c1c;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    position: relative;
    will-change: transform;
    transform: translate3d(0, 0, 0);
  }

  hr {
    color: #3333;
  }

  .peer-id {
    position: absolute;
    width: 100%;
    display: flex;
    justify-content: center;
    top: 22px;
    color: #fff2;
    font-size: 14px;
    font-weight: 1000;
  }

  .hero {
    padding: 80px 20px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    background: linear-gradient(to bottom, #2a2a2a, #1c1c1c);
    border-bottom: 1px solid #333;
  }

  .hero-info {
    text-align: center;
  }

  .hero-info h2 {
    margin: 0;
    color: #fff;
    font-size: 22px;
  }

  .url {
    margin-top: 10px;
    color: #0bf;
    font-size: 14px;
    cursor: pointer;
  }

  .url:active {
    cursor: default;
  }

  .tag {
    margin-top: 10px;
    color: #0bf;
    font-size: 15px;
    cursor: pointer;
  }

  .tag:active {
    cursor: default;
  }

  .status {
    color: #666;
    font-size: 14px;
  }

  .status.online {
    color: #4ade80;
  }

  .info-list {
    background: #1c1c1c;
    padding: 10px 0;
  }

  .info-item {
    display: flex;
    padding: 15px 20px;
    gap: 20px;
    word-break: break-word;
    white-space: pre-line;
  }

  .info-content {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .info-content .value {
    color: #eee;
  }

  .info-content .label {
    color: #777;
    font-size: 13px;
  }

  .info-item .button {
    color: white;
  }

  .hoverable {
    cursor: pointer;
  }

  .menu-container {
    position: relative;
  }

  .dropdown {
    position: absolute;
    top: 40px;
    right: 0;
    background: #252525;
    width: 180px;
    border-radius: 12px;
    padding: 5px;
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 20;
    border: 1px solid #333;
  }

  .menu-item {
    padding: 10px;
    color: #eee;
    font-size: 14px;
    cursor: pointer;
    border-radius: 6px;
  }

  .menu-item:hover {
    background: #333;
  }

  .menu-item.danger {
    color: #ff4b4b;
  }

  .header-controls {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    padding: 15px;
    display: flex;
    justify-content: space-between;
    z-index: 10;
    box-sizing: border-box;
  }

  .icon-btn {
    background: rgba(0, 0, 0, 0.4);
    border: none;
    color: #fff;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .members {
    display: flex;
    margin-top: 20px;
    justify-content: center;
    flex: 1;
    width: 100%;
  }

  .member {
    position: relative;
    height: 40px;
    flex: 1;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    color: white;
    margin: 0 20px;
  }

  .member .row {
    display: flex;
    flex-direction: row;
    gap: 16px;
  }

  .member .column {
    display: flex;
    flex-direction: column;
  }

  .member .name {
    font-size: 16px;
    display: flex;
  }

  .member a {
    font-size: 14px;
    color: #999;
    position: relative;
  }

  .invite {
    margin: 30px 0 10px 0;
    flex: 1;
    cursor: pointer;
    text-align: center;
    color: #66f6;
  }
</style>
