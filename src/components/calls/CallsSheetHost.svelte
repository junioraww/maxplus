<script>
  import BottomSheet from "$components/main/BottomSheet.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import { closeCallSheet, CALL_MODE } from "$lib/stores/calls";
  import { CallService } from "$lib/services/CallService";
  import { currentRealContacts } from "$lib/stores/api";
  import { getCachedContacts } from "$lib/stores/contacts";
  import { showAlert } from "$lib/utils/alert";

  export let type = "";
  export let link = "";
  export let close = null;
  export let setBackHandler = null;

  let createdRoomLink = "";
  let creatingRoom = false;
  let linkCopied = false;
  let createSecureMode = false;

  let joinLinkInput = "";
  let joinWithVideo = false;
  let joinSecureMode = false;

  let contactSearchQuery = "";
  let availableContacts = [];

  $: activeType = type || "";
  $: activeLink = link || "";

  function handleClose() {
    if (close) {
      close();
    } else {
      closeCallSheet();
    }
  }

  $: if (activeType === "create") {
    if (!createdRoomLink && !creatingRoom) initCreateRoom();
  } else {
    createdRoomLink = "";
    creatingRoom = false;
    linkCopied = false;
  }

  $: if (activeType === "join") {
    joinLinkInput = activeLink || "";
    joinWithVideo = false;
    joinSecureMode = false;
  }

  $: if (activeType === "new_call") {
    contactSearchQuery = "";
    loadContacts();
  }

  async function initCreateRoom() {
    creatingRoom = true;
    linkCopied = false;
    try {
      const res = await CallService.createConferenceRoom();
      createdRoomLink = res.link;
    } catch (e) {
      showAlert("Ошибка создания звонка: " + (e?.message || e));
      handleClose();
    } finally {
      creatingRoom = false;
    }
  }

  async function copyRoomLink() {
    if (!createdRoomLink) return;
    try {
      await navigator.clipboard.writeText(createdRoomLink);
      linkCopied = true;
      setTimeout(() => { linkCopied = false; }, 2500);
    } catch {
      showAlert(createdRoomLink, "Ссылка на звонок скопирована");
    }
  }

  async function startCreatedConference(video) {
    const linkToJoin = createdRoomLink;
    const mode = createSecureMode ? CALL_MODE.SECURE : CALL_MODE.PLAIN;
    handleClose();
    if (linkToJoin) await CallService.joinConferenceByLink(linkToJoin, video, mode);
  }

  async function submitJoinByLink() {
    if (!joinLinkInput.trim()) return;
    const targetLink = joinLinkInput.trim();
    const video = joinWithVideo;
    const mode = joinSecureMode ? CALL_MODE.SECURE : CALL_MODE.PLAIN;
    handleClose();
    await CallService.joinConferenceByLink(targetLink, video, mode);
  }

  function isEligibleContact(c) {
    return Boolean(c && !c.isSelf && !c.self && !c.isBot && !c.bot && c.id);
  }

  async function loadContacts() {
    try {
      const cached = await getCachedContacts();
      if (cached?.length) availableContacts = cached.filter(isEligibleContact);
    } catch {}
  }

  function selectContactForCall(c) {
    handleClose();
    const name = `${c.names?.[0]?.firstName || ''} ${c.names?.[0]?.lastName || ''}`.trim() || c.name || "Собеседник";
    CallService.placeAudioCall(c.id, name, c.baseUrl || c.baseRawUrl);
  }

  $: activeContactsList = $currentRealContacts?.length ? $currentRealContacts : availableContacts;

  $: filteredContacts = activeContactsList.filter(c => {
    if (!isEligibleContact(c)) return false;
    if (!contactSearchQuery.trim()) return true;
    const q = contactSearchQuery.trim().toLowerCase();
    const fn = (c.names?.[0]?.firstName || "").toLowerCase();
    const ln = (c.names?.[0]?.lastName || "").toLowerCase();
    return fn.includes(q) || ln.includes(q) || (c.name || "").toLowerCase().includes(q);
  });
</script>

{#if activeType}
  {#if activeType === "create"}
    <BottomSheet title="Ссылка на видеовстречу" {close} {setBackHandler} on:close={handleClose}>
      <p class="sheet-desc">Отправьте эту ссылку участникам, чтобы они могли присоединиться</p>

      {#if creatingRoom}
        <div class="loading-box"><div class="spinner"></div><span>Создание комнаты...</span></div>
      {:else}
        <div class="row">
          <input type="text" readonly value={createdRoomLink} class="field" />
          <button class="btn copy-btn" class:copied={linkCopied} on:click={copyRoomLink}>
            {linkCopied ? "Скопировано!" : "Копировать"}
          </button>
        </div>

        <label class="check-row">
          <input type="checkbox" bind:checked={createSecureMode} />
          <span>Сквозное шифрование (E2E)</span>
        </label>

        <div class="row btn-group">
          <button class="btn primary-btn" on:click={() => startCreatedConference(false)}>
            Начать аудио
          </button>
          <button class="btn primary-btn video-btn" on:click={() => startCreatedConference(true)}>
            Начать с видео
          </button>
        </div>
      {/if}
    </BottomSheet>
  {:else if activeType === "join"}
    <BottomSheet title="Присоединиться к звонку" {close} {setBackHandler} on:close={handleClose}>
      <p class="sheet-desc">Вставьте полученную ссылку или идентификатор конференции</p>

      <input type="text" placeholder="https://max.ru/joincall/..." bind:value={joinLinkInput} class="field mb" />

      <label class="check-row">
        <input type="checkbox" bind:checked={joinWithVideo} />
        <span>Включить камеру при входе</span>
      </label>

      <label class="check-row">
        <input type="checkbox" bind:checked={joinSecureMode} />
        <span>Сквозное шифрование (E2E)</span>
      </label>

      <button class="btn primary-btn full-btn" disabled={!joinLinkInput.trim()} on:click={submitJoinByLink}>
        Присоединиться
      </button>
    </BottomSheet>
  {:else if activeType === "new_call"}
    <BottomSheet title="Новый звонок" maxHeight="85vh" {close} {setBackHandler} on:close={handleClose}>
      <div class="search-box">
        <img src="/icons/search.svg" alt="" width="18" height="18" class="theme-icon" />
        <input type="text" placeholder="Поиск по контактам..." bind:value={contactSearchQuery} class="search-input" />
      </div>

      <div class="contacts-list">
        {#if filteredContacts.length === 0}
          <div class="empty">Контакты не найдены</div>
        {:else}
          {#each filteredContacts as c (c.id)}
            <div class="contact-item" on:click={() => selectContactForCall(c)} role="button" tabindex="0">
              <Avatar size={42} contactId={c.id} title={c.name} src={c.baseUrl || c.baseRawUrl} />
              <div class="contact-info">
                <span class="contact-name">
                  {c.names?.[0]?.firstName ? `${c.names[0].firstName} ${c.names[0].lastName || ''}`.trim() : (c.name || 'Контакт')}
                </span>
                {#if c.phone}
                  <span class="contact-phone">{c.phone.startsWith?.('+') ? c.phone : `+${c.phone}`}</span>
                {/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </BottomSheet>
  {/if}
{/if}

<style>
  .sheet-desc { margin: 0 0 16px; font-size: 13px; color: var(--text-muted, #8b929e); text-align: center; }
  .row { display: flex; align-items: center; flex-wrap: nowrap; gap: 8px; width: 100%; box-sizing: border-box; }
  .btn-group { margin-top: 16px; }
  .mb { margin-bottom: 12px; }
  .field {
    width: 100%; min-width: 0; box-sizing: border-box;
    background: var(--bg-app, #17181c); border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 14px; padding: 12px 14px; color: #fff; font-size: 15px; outline: none;
    user-select: text; -webkit-user-select: text;
  }
  .row .field {
    flex: 1 1 auto;
    width: auto;
  }
  .btn {
    height: 44px; border: none; border-radius: 22px; font-size: 14px; font-weight: 600;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, opacity 0.15s;
  }
  .copy-btn {
    flex: 0 0 auto; width: auto; min-width: 110px; white-space: nowrap;
    padding: 0 16px; background: var(--accent-primary, #248bfe); color: #fff;
  }
  .copy-btn.copied { background: var(--status-success, #4ade80); color: #0b2413; }
  .primary-btn { flex: 1; background: var(--accent-primary, #248bfe); color: #fff; }
  .primary-btn:hover { background: var(--accent-primary-hover, #1b74d9); }
  .video-btn { background: #6366f1; }
  .video-btn:hover { background: #4f46e5; }
  .full-btn { width: 100%; margin-top: 16px; }
  .primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .check-row {
    display: flex; align-items: center; gap: 10px; padding: 10px 0;
    cursor: pointer; font-size: 14px; color: #fff;
  }
  .check-row input[type="checkbox"] {
    -webkit-appearance: none; appearance: none; margin: 0;
    width: 20px; height: 20px; border-radius: 6px;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.05); cursor: pointer; flex-shrink: 0;
  }
  .check-row input[type="checkbox"]:checked {
    background-color: var(--accent-primary, #248bfe);
    border-color: var(--accent-primary, #248bfe);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E");
    background-size: 13px; background-position: center; background-repeat: no-repeat;
  }
  .search-box {
    display: flex; align-items: center; gap: 10px; background: var(--bg-app, #17181c);
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;
    padding: 8px 12px; margin-bottom: 12px;
  }
  .search-input { flex: 1; background: transparent; border: none; outline: none; color: #fff; font-size: 14px; }
  .contacts-list { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .contact-item {
    display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 10px;
    cursor: pointer; transition: background 0.12s;
  }
  .contact-item:hover { background: rgba(255, 255, 255, 0.05); }
  .contact-info { display: flex; flex-direction: column; min-width: 0; }
  .contact-name { font-size: 15px; font-weight: 500; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .contact-phone { font-size: 12px; color: var(--text-muted, #8b929e); }
  .empty { text-align: center; padding: 32px 0; color: var(--text-muted, #8b929e); font-size: 14px; }
  .loading-box { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px 0; color: var(--text-muted, #8b929e); }
  .spinner {
    width: 28px; height: 28px; border: 2px solid rgba(255, 255, 255, 0.15);
    border-top-color: var(--accent-primary, #248bfe); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
