<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import API, { currentRealContacts, currentUser, currentUserDetails } from "$lib/stores/api";
  import { getCachedContacts, getContact, getContactDisplayName } from "$lib/stores/contacts";
  import { openChat, openSafeAvatarPicker, openContactsImport } from "$lib/stores/session";
  import { openCallSheet } from "$lib/stores/calls";
  import { installSafeAvatar } from "$lib/services/AvatarInstallService";
  import { isMobileAddressBookSupported } from "$lib/services/addressBook";
  import Avatar from "$components/main/Avatar.svelte";
  import CircleCheckbox from "$components/common/CircleCheckbox.svelte";
  import Signature from "$components/main/Signature.svelte";
  import { showAlert } from "$lib/utils/alert";
  import { registerBackHandler } from "$lib/utils/backButton";

  export let close = null;
  export let setBackHandler = null;

  const dispatch = createEventDispatcher();

  let view = "main";
  let isSearching = false;
  let searchQuery = "";
  let searchInputEl;

  let loadedContacts = [];
  let canImportAddressBook = false;

  let groupTitle = "";
  let groupAvatar = null;
  let channelTitle = "";
  let channelDescription = "";
  let channelAvatar = null;
  let selectedContactIds = [];
  let createdChannel = null;
  let isSubmitting = false;
  let unregisterBack = null;

  function handleClose() {
    dispatch("close");
    if (close) close();
  }

  $: if (setBackHandler) {
    setBackHandler(() => {
      if (isSearching) {
        isSearching = false;
        searchQuery = "";
        return false;
      }
      if (view === "group_profile") {
        view = "group_members";
        return false;
      }
      if (view === "group_members" || view === "channel_profile") {
        view = "main";
        searchQuery = "";
        return false;
      }
      if (view === "channel_subscribers") {
        view = "channel_profile";
        return false;
      }
      handleClose();
      return true;
    });
  }

  onMount(async () => {
    if (!setBackHandler) {
      unregisterBack = registerBackHandler(() => {
        if (isSearching) {
          isSearching = false;
          searchQuery = "";
          return false;
        }
        if (view === "group_profile") {
          view = "group_members";
          return false;
        }
        if (view === "group_members" || view === "channel_profile") {
          view = "main";
          searchQuery = "";
          return false;
        }
        if (view === "channel_subscribers") {
          view = "channel_profile";
          return false;
        }
        handleClose();
        return true;
      });
    }

    await refreshContacts();
    canImportAddressBook = await isMobileAddressBookSupported();
  });

  async function refreshContacts() {
    try {
      const cached = await getCachedContacts();
      if (Array.isArray(cached) && cached.length > 0) {
        loadedContacts = cached;
      } else {
        const ids = $currentRealContacts || [];
        loadedContacts = ids.map((id) => get(getContact(id))).filter(Boolean);
      }
    } catch {
      const ids = $currentRealContacts || [];
      loadedContacts = ids.map((id) => get(getContact(id))).filter(Boolean);
    }
  }

  async function handleImportContacts() {
    const res = await openContactsImport();
    if (res?.imported) {
      await refreshContacts();
    }
  }

  onDestroy(() => {
    if (unregisterBack) unregisterBack();
  });

  function getName(c) {
    if (!c) return "Без имени";
    return getContactDisplayName(c) || c.phone || "Без имени";
  }

  $: realIds = $currentRealContacts || [];
  $: contacts = (loadedContacts.length > 0 ? loadedContacts : realIds.map((id) => get(getContact(id))).filter(Boolean))
    .filter((c) => c && Number(c.id) !== Number($currentUser) && c.status !== "REMOVED");

  $: filteredContacts = contacts.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = getName(c).toLowerCase();
    const phone = (c.phone || "").replace(/\D/g, "");
    return name.includes(q) || phone.includes(q);
  });

  $: groupedContacts = filteredContacts
    .slice()
    .sort((a, b) => getName(a).localeCompare(getName(b), "ru"))
    .reduce((acc, c) => {
      const letter = (getName(c) || "#").charAt(0).toUpperCase();
      (acc[letter] ??= []).push(c);
      return acc;
    }, {});

  $: selectedObjects = contacts.filter((c) => selectedContactIds.includes(c.id));

  function toggleSearch() {
    isSearching = !isSearching;
    if (isSearching) {
      setTimeout(() => searchInputEl?.focus(), 60);
    } else {
      searchQuery = "";
    }
  }

  function goBack() {
    if (isSearching) {
      isSearching = false;
      searchQuery = "";
      return;
    }
    if (view === "group_members" || view === "channel_profile") {
      view = "main";
      searchQuery = "";
    } else if (view === "group_profile") {
      view = "group_members";
    } else if (view === "channel_subscribers") {
      view = "channel_profile";
    } else {
      handleClose();
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      goBack();
    }
  }

  function toggleSelect(id) {
    if (selectedContactIds.includes(id)) {
      selectedContactIds = selectedContactIds.filter((item) => item !== id);
    } else {
      selectedContactIds = [...selectedContactIds, id];
    }
  }

  function handleOpenDirect(contact) {
    const dialogId = Number(BigInt($currentUser) ^ BigInt(contact.id));
    openChat(dialogId);
    handleClose();
  }

  function handleCreateCall() {
    openCallSheet("create");
  }

  function handleInviteLink() {
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

  function openAvatarSelector(target) {
    openSafeAvatarPicker({
      initialTab: "catalog",
      onSelectAvatar: (selected) => {
        if (target === "group") {
          groupAvatar = selected;
        } else {
          channelAvatar = selected;
        }
      }
    });
  }

  async function handleCreateGroupSubmit() {
    if (!groupTitle.trim() || isSubmitting) return;
    isSubmitting = true;
    try {
      const chat = await $API.createGroup(groupTitle.trim(), selectedContactIds);
      if (chat?.id) {
        if (groupAvatar?.photoToken) {
          await invoke("set_chat_photo", {
            chatId: Number(chat.id),
            photoToken: groupAvatar.photoToken,
          }).catch(() => {});
        } else if (groupAvatar?.uid) {
          await installSafeAvatar(groupAvatar.uid, chat.id).catch(() => {});
        }
        showAlert("Группа создана");
        openChat(chat.id);
        handleClose();
      } else {
        showAlert("Не удалось создать группу");
      }
    } catch {
      showAlert("Ошибка при создании группы");
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCreateChannelStep1() {
    if (!channelTitle.trim() || isSubmitting) return;
    isSubmitting = true;
    try {
      const desc = channelDescription.trim() || null;
      const chat = await $API.createChannel(channelTitle.trim(), [], desc);
      if (chat?.id) {
        if (channelAvatar?.photoToken) {
          await invoke("set_chat_photo", {
            chatId: Number(chat.id),
            photoToken: channelAvatar.photoToken,
          }).catch(() => {});
        } else if (channelAvatar?.uid) {
          await installSafeAvatar(channelAvatar.uid, chat.id).catch(() => {});
        }
        createdChannel = chat;
        selectedContactIds = [];
        searchQuery = "";
        view = "channel_subscribers";
      } else {
        showAlert("Не удалось создать канал");
      }
    } catch {
      showAlert("Ошибка при создании канала");
    } finally {
      isSubmitting = false;
    }
  }

  async function handleFinishChannel() {
    if (!createdChannel?.id) return;
    if (selectedContactIds.length > 0) {
      isSubmitting = true;
      try {
        await $API.addGroupMembers(createdChannel.id, selectedContactIds);
      } catch {}
      isSubmitting = false;
    }
    showAlert("Канал создан");
    openChat(createdChannel.id);
    handleClose();
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="start-conv-screen">
  {#if view === "main"}
    <div class="toolbar" in:fade={{ duration: 150 }}>
      {#if isSearching}
        <button class="icon-btn" on:click={toggleSearch} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-search-input-wrap">
          <input
            type="text"
            placeholder="Поиск..."
            bind:this={searchInputEl}
            bind:value={searchQuery}
          />
        </div>
        {#if searchQuery}
          <button class="icon-btn" on:click={() => (searchQuery = "")} aria-label="Очистить">
            <img src="/icons/close.svg" alt="" width="18" height="18" class="theme-icon" />
          </button>
        {/if}
      {:else}
        <button class="icon-btn" on:click={goBack} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-title">Начать общение</div>
        <button class="icon-btn" on:click={toggleSearch} aria-label="Поиск">
          <img src="/icons/search.svg" alt="" width="20" height="20" class="theme-icon" />
        </button>
      {/if}
    </div>

    <div class="content-scroll">
      {#if !isSearching && !searchQuery}
        <div class="actions-list">
          <div class="action-item" on:click={() => (view = "group_members")} role="button" tabindex="0">
            <div class="action-icon action-icon--blue">
              <img src="/icons/users.svg" alt="" width="22" height="22" />
            </div>
            <div class="action-text">Создать чат</div>
          </div>

          <div class="action-item" on:click={() => (view = "channel_profile")} role="button" tabindex="0">
            <div class="action-icon action-icon--orange">
              <img src="/icons/edit.svg" alt="" width="20" height="20" />
            </div>
            <div class="action-text">Создать канал</div>
          </div>

          <div class="action-item" on:click={handleCreateCall} role="button" tabindex="0">
            <div class="action-icon action-icon--green">
              <img src="/icons/call.svg" alt="" width="20" height="20" />
            </div>
            <div class="action-text">Создать звонок</div>
          </div>

          <div class="action-item" on:click={handleInviteLink} role="button" tabindex="0">
            <div class="action-icon action-icon--purple">
              <img src="/icons/link.svg" alt="" width="20" height="20" />
            </div>
            <div class="action-text">Пригласить по ссылке</div>
          </div>

          {#if canImportAddressBook}
            <div class="action-item" on:click={handleImportContacts} role="button" tabindex="0">
              <div class="action-icon action-icon--teal">
                <img src="/icons/user-plus.svg" alt="" width="20" height="20" />
              </div>
              <div class="action-text">Импортировать контакты</div>
            </div>
          {/if}
        </div>
      {/if}

      <div class="contacts-container">
        {#each Object.entries(groupedContacts) as [letter, items] (letter)}
          <div class="section-letter">{letter}</div>
          {#each items as contact (contact.id)}
            <div class="contact-row" on:click={() => handleOpenDirect(contact)} role="button" tabindex="0">
              <Avatar contactId={contact.id} size={44} />
              <div class="contact-info">
                <div class="contact-name">{getName(contact)}</div>
                <div class="contact-status"><Signature contactId={contact.id} /></div>
              </div>
            </div>
          {/each}
        {/each}
      </div>
    </div>

  {:else if view === "group_members"}
    <div class="view-stage" in:fly={{ x: 40, duration: 200, easing: cubicOut }}>
      <div class="toolbar">
        <button class="icon-btn" on:click={goBack} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-title-box">
          <div class="toolbar-title">Новый чат</div>
          <div class="toolbar-sub">{selectedContactIds.length ? `${selectedContactIds.length} выбрано` : "до 20 000 участников"}</div>
        </div>
      </div>

      <div class="sub-search-wrap">
        <div class="sub-search-box">
          <img src="/icons/search.svg" alt="" width="16" height="16" class="sub-search-icon" />
          <input type="text" placeholder="Поиск участников" bind:value={searchQuery} />
        </div>
      </div>

      {#if selectedObjects.length > 0}
        <div class="chips-scroll" in:fade={{ duration: 150 }}>
          {#each selectedObjects as sel (sel.id)}
            <div class="chip" on:click={() => toggleSelect(sel.id)} role="button" tabindex="0">
              <Avatar contactId={sel.id} size={24} />
              <span class="chip-name">{getName(sel)}</span>
              <img src="/icons/close.svg" alt="" width="12" height="12" class="chip-x" />
            </div>
          {/each}
        </div>
      {/if}

      <div class="content-scroll">
        {#each filteredContacts as contact (contact.id)}
          {@const checked = selectedContactIds.includes(contact.id)}
          <div class="contact-row selectable" on:click={() => toggleSelect(contact.id)} role="button" tabindex="0">
            <Avatar contactId={contact.id} size={44} />
            <div class="contact-info">
              <div class="contact-name">{getName(contact)}</div>
              <div class="contact-status"><Signature contactId={contact.id} /></div>
            </div>
            <CircleCheckbox {checked} size={22} />
          </div>
        {/each}
      </div>

      <div class="bottom-action-bar">
        <button class="main-action-btn" on:click={() => (view = "group_profile")}>
          {selectedContactIds.length === 0 ? "Создать без участников" : `Продолжить (${selectedContactIds.length})`}
        </button>
      </div>
    </div>

  {:else if view === "group_profile"}
    <div class="view-stage" in:fly={{ x: 40, duration: 200, easing: cubicOut }}>
      <div class="toolbar">
        <button class="icon-btn" on:click={goBack} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-title">Новый чат</div>
      </div>

      <div class="content-scroll form-content">
        <div class="step-hint">Введите название чата и при желании загрузите аватар</div>

        <div class="avatar-center-wrap">
          <button type="button" class="avatar-picker-circle" on:click={() => openAvatarSelector("group")}>
            {#if groupAvatar?.previewUrl}
              <img src={groupAvatar.previewUrl} alt="" class="avatar-preview-img" />
            {:else}
              <img src="/icons/flip-camera.svg" alt="" width="34" height="34" />
            {/if}
          </button>
        </div>

        <div class="form-input-card">
          <input type="text" placeholder="Название чата" bind:value={groupTitle} autofocus />
        </div>
      </div>

      <div class="bottom-action-bar">
        <button class="main-action-btn" disabled={!groupTitle.trim() || isSubmitting} on:click={handleCreateGroupSubmit}>
          {isSubmitting ? "Создание..." : "Создать чат"}
        </button>
      </div>
    </div>

  {:else if view === "channel_profile"}
    <div class="view-stage" in:fly={{ x: 40, duration: 200, easing: cubicOut }}>
      <div class="toolbar">
        <button class="icon-btn" on:click={goBack} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-title">Новый канал</div>
      </div>

      <div class="content-scroll form-content">
        <div class="step-hint">Укажите название и описание вашего канала</div>

        <div class="avatar-center-wrap">
          <button type="button" class="avatar-picker-circle" on:click={() => openAvatarSelector("channel")}>
            {#if channelAvatar?.previewUrl}
              <img src={channelAvatar.previewUrl} alt="" class="avatar-preview-img" />
            {:else}
              <img src="/icons/flip-camera.svg" alt="" width="34" height="34" />
            {/if}
          </button>
        </div>

        <div class="form-input-card">
          <input type="text" placeholder="Название канала" bind:value={channelTitle} autofocus />
        </div>

        <div class="form-input-card">
          <textarea rows="3" placeholder="Описание канала" bind:value={channelDescription}></textarea>
        </div>
      </div>

      <div class="bottom-action-bar">
        <button class="main-action-btn" disabled={!channelTitle.trim() || isSubmitting} on:click={handleCreateChannelStep1}>
          {isSubmitting ? "Создание..." : "Создать канал"}
        </button>
      </div>
    </div>

  {:else if view === "channel_subscribers"}
    <div class="view-stage" in:fly={{ x: 40, duration: 200, easing: cubicOut }}>
      <div class="toolbar">
        <button class="icon-btn" on:click={goBack} aria-label="Назад">
          <img src="/icons/arrow.svg" alt="" class="back-arrow" />
        </button>
        <div class="toolbar-title-box">
          <div class="toolbar-title">Подписчики</div>
          <div class="toolbar-sub">{selectedContactIds.length ? `${selectedContactIds.length} выбрано` : "Добавьте подписчиков"}</div>
        </div>
      </div>

      <div class="content-scroll">
        {#each filteredContacts as contact (contact.id)}
          {@const checked = selectedContactIds.includes(contact.id)}
          <div class="contact-row selectable" on:click={() => toggleSelect(contact.id)} role="button" tabindex="0">
            <Avatar contactId={contact.id} size={44} />
            <div class="contact-info">
              <div class="contact-name">{getName(contact)}</div>
              <div class="contact-status"><Signature contactId={contact.id} /></div>
            </div>
            <CircleCheckbox {checked} size={22} />
          </div>
        {/each}
      </div>

      <div class="bottom-action-bar">
        <button class="main-action-btn" on:click={handleFinishChannel}>
          {selectedContactIds.length === 0 ? "Пропустить" : `Добавить подписчиков (${selectedContactIds.length})`}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .start-conv-screen { position: fixed; inset: 0; background: var(--bg-app, #101114); z-index: var(--z-modal, 7); display: flex; flex-direction: column; color: var(--text-primary, #fff); user-select: none; overflow: hidden; }
  .view-stage, .content-scroll, .contacts-container { display: flex; flex-direction: column; }
  .view-stage { width: 100%; height: 100%; }
  .content-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }

  .toolbar { height: calc(56px + var(--safe-top, 0px)); display: flex; align-items: center; padding: var(--safe-top, 0px) 12px 0; gap: 12px; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); flex-shrink: 0; background: var(--bg-surface, #18191e); box-sizing: border-box; }
  .toolbar-title { font-size: 18px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .toolbar-title-box { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .toolbar-sub { font-size: 13px; color: var(--text-muted, #8b929e); }
  .toolbar-search-input-wrap { flex: 1; }
  .toolbar-search-input-wrap input { width: 100%; border: none; background: transparent; color: var(--text-primary, #fff); font-size: 16px; outline: none; }

  .icon-btn { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 50%; cursor: pointer; color: inherit; transition: background 0.15s ease; }
  .icon-btn:hover { background: var(--border-subtle, rgba(255, 255, 255, 0.08)); }
  .back-arrow { width: 14px; height: 14px; transform: scaleX(-1); filter: brightness(0) invert(var(--icon-invert, 1)); }

  .actions-list { display: flex; flex-direction: column; padding: 8px 0; border-bottom: 8px solid var(--border-card, rgba(0, 0, 0, 0.25)); }
  .action-item, .contact-row { display: flex; align-items: center; cursor: pointer; transition: background 0.15s ease; }
  .action-item { padding: 10px 16px; gap: 16px; }
  .action-item:hover, .contact-row:hover { background: var(--border-card, rgba(255, 255, 255, 0.04)); }
  .action-text { font-size: 15px; font-weight: 500; }
  .action-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .action-icon--blue { background: #3478f6; }
  .action-icon--orange { background: #e67e22; }
  .action-icon--green { background: #27ae60; }
  .action-icon--purple { background: #9b59b6; }
  .action-icon--teal { background: var(--accent-primary, #248bfe); }

  .contacts-container { padding-bottom: max(24px, calc(16px + var(--safe-bottom, 0px))); }
  .section-letter { padding: 10px 16px 4px; font-size: 13px; font-weight: 600; color: var(--accent-primary, #3478f6); text-transform: uppercase; }
  .contact-row { padding: 8px 16px; gap: 14px; }
  .contact-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .contact-name { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .contact-status { font-size: 13px; color: var(--text-muted, #8b929e); }

  .sub-search-wrap { padding: 10px 16px; background: var(--bg-surface, #18191e); }
  .sub-search-box { display: flex; align-items: center; background: var(--bg-input, rgba(255, 255, 255, 0.06)); border-radius: 10px; padding: 0 12px; height: 38px; gap: 8px; }
  .sub-search-icon { opacity: 0.6; filter: brightness(0) invert(var(--icon-invert, 1)); }
  .sub-search-box input { flex: 1; background: transparent; border: none; outline: none; color: var(--text-primary, #fff); font-size: 14px; }

  .chips-scroll { display: flex; gap: 8px; padding: 8px 16px; overflow-x: auto; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.05)); }
  .chip { display: flex; align-items: center; gap: 6px; background: var(--bg-surface-secondary, rgba(255, 255, 255, 0.08)); border-radius: 16px; padding: 4px 10px 4px 4px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .chip-x { opacity: 0.7; margin-left: 2px; }

  .form-content { padding: 24px 16px; gap: 16px; }
  .step-hint { font-size: 14px; color: var(--text-muted, #8b929e); text-align: center; padding: 0 16px; }
  .avatar-center-wrap { display: flex; justify-content: center; padding: 12px 0; }
  .avatar-picker-circle { width: 96px; height: 96px; border-radius: 50%; background: var(--bg-input, rgba(255, 255, 255, 0.08)); border: 2px dashed var(--border-subtle, rgba(255, 255, 255, 0.25)); display: flex; align-items: center; justify-content: center; cursor: pointer; overflow: hidden; padding: 0; transition: border-color 0.15s ease, background 0.15s ease; }
  .avatar-picker-circle:hover { border-color: var(--accent-primary, #0077ff); background: var(--accent-subtle, rgba(0, 119, 255, 0.1)); }
  .avatar-preview-img { width: 100%; height: 100%; object-fit: cover; }

  .form-input-card { background: var(--bg-input, rgba(255, 255, 255, 0.06)); border-radius: 14px; padding: 4px 14px; border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); }
  .form-input-card input, .form-input-card textarea { width: 100%; background: transparent; border: none; outline: none; color: var(--text-primary, #fff); font-size: 15px; padding: 10px 0; resize: none; box-sizing: border-box; }

  .bottom-action-bar { padding: 16px 16px calc(16px + var(--safe-bottom, 0px)); background: var(--bg-surface, #18191e); border-top: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08)); flex-shrink: 0; box-sizing: border-box; }
  .main-action-btn { width: 100%; border-radius: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s ease, opacity 0.15s ease; height: 48px; border: none; background: var(--accent-primary, #0077ff); color: #fff; font-size: 15px; }
  .main-action-btn:hover:not(:disabled) { background: var(--accent-primary-hover, #0066dd); }
  .main-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
