<script>
  import { fly, fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import {
    createEventDispatcher,
    onDestroy
  } from "svelte";
  import { get } from "svelte/store";
  import { registerBackHandler } from "$lib/utils/backButton.js";

  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import InputModal from "$components/main/InputModal.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import GroupAddMembersModal from "$components/chats/GroupAddMembersModal.svelte";
  import GroupAdminModal from "$components/chats/GroupAdminModal.svelte";
  import GroupSharedMedia from "$components/chats/GroupSharedMedia.svelte";
  import GroupJoinRequestsModal from "$components/chats/GroupJoinRequestsModal.svelte";

  import { getContact } from "$lib/utils/caching";
  import { formatMs } from "$lib/utils/time";
  import { dict } from "$lib/crypto/text-codec";
  import { isChatMuted } from "$lib/utils/notifications";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings.js";
  import { switchEnc } from "$components/ChatWindow/e2e";
  import { getChatSettings, getChat } from "$lib/stores/messages";
  import Session, {
    openChat as _openChat,
    closeChat as _closeChat,
    openAvatarGallery as _openAvatarGallery,
  } from "$lib/stores/session";
  import API, {
    currentUser,
    currentUserDetails,
    currentSessionChats,
    currentPresence,
    currentRealContacts,
    currentRealChats,
  } from "$lib/stores/api";

  const unregisterBack = registerBackHandler(() => {
    if (showDeleteConfirm) { showDeleteConfirm = false; return false; }
    if (showPurgeConfirm) { showPurgeConfirm = false; return false; }
    if (showRemoveMemberConfirm) { showRemoveMemberConfirm = false; return false; }
    if (showAddMembersModal) { showAddMembersModal = false; return false; }
    if (showAdminModal) { showAdminModal = false; return false; }
    if (showJoinRequestsModal) { showJoinRequestsModal = false; return false; }
    if (showInputs) { showInputs = false; return false; }
    if (showMenu) { showMenu = false; return false; }
    if (selectedMemberMenuId) { selectedMemberMenuId = null; return false; }
    if ((activeTab === "settings" || activeTab === "media") && $Session.profile?.view !== "settings") {
      selectTab("info");
      return false;
    }
    closeModal();
  });

  onDestroy(() => {
    unregisterBack();
    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    if (scrollEndTimer) clearTimeout(scrollEndTimer);
    if (scrollTimeout) clearTimeout(scrollTimeout);
  });

  let fetchedChat = null;
  let fetchingChatId = null;

  $: chatId = (() => {
    const cid = $Session.profile?.chatId;
    if (cid != null) return cid;
    const uid = $Session.profile?.userId;
    if (uid != null && $currentUser != null) {
      const match = $currentSessionChats?.find(x =>
        x.type === "DIALOG" && (
          (x.participants && Object.keys(x.participants).some(p => String(p) === String(uid))) ||
          String(x.owner) === String(uid)
        )
      );
      if (match?.id != null) return match.id;
      try {
        return Number(BigInt(uid) ^ BigInt($currentUser));
      } catch (e) {}
    }
    return undefined;
  })();

  $: if (chatId != null && fetchingChatId !== chatId) {
    const existing = $currentSessionChats?.find(x => String(x.id) === String(chatId));
    if (!existing) {
      fetchingChatId = chatId;
      $API.getChat(chatId).then(res => {
        if (res?.chats?.length) {
          fetchedChat = res.chats[0];
        }
      }).catch(() => {});
    }
  }

  $: chat = (() => {
    if (chatId != null) {
      const byId = $currentSessionChats?.find(x => String(x.id) === String(chatId));
      if (byId) return byId;
    }
    const uid = $Session.profile?.userId;
    if (uid != null) {
      const byParticipant = $currentSessionChats?.find(x =>
        x.type === "DIALOG" && (
          (x.participants && Object.keys(x.participants).some(p => String(p) === String(uid))) ||
          String(x.owner) === String(uid)
        )
      );
      if (byParticipant) return byParticipant;
    }
    return fetchedChat;
  })();

  $: userId = (() => {
    const uid = $Session.profile?.userId;
    if (uid != null) return uid;
    if (chat?.type === "DIALOG" && chat?.participants) {
      const other = Object.keys(chat.participants).find(id => String(id) !== String($currentUser));
      if (other) return Number(other);
    }
    const cid = chatId ?? $Session.profile?.chatId;
    if (cid && $currentUser) {
      try {
        return Number(BigInt(cid) ^ BigInt($currentUser));
      } catch (e) {}
    }
    return undefined;
  })();
  $: contact = getContact(chat?.type === "DIALOG" || (!chat && userId) ? userId : undefined);
  $: chatSettings = chat?.id != null ? getChatSettings(chat.id) : null;
  $: muted = chat ? isChatMuted(chat) : false;
  $: isChannel = chat?.type === "CHANNEL";
  $: hasSettings = Boolean(chat && !isChannel);

  let activeTab = "info";
  let previousProfile = null;
  let didInitialSelect = false;

  $: if ($Session.profile !== previousProfile) {
    previousProfile = $Session.profile;
    didInitialSelect = false;
  }

  $: if (!didInitialSelect && previousProfile) {
    if ($Session.profile?.view === "settings" && hasSettings) {
      activeTab = "settings";
      didInitialSelect = true;
    } else if ($Session.profile?.view !== "settings") {
      activeTab = "info";
      didInitialSelect = true;
    }
  }

  $: availableTabs = chat
    ? (hasSettings ? ["info", "media", "settings"] : ["info", "media"])
    : ["info"];

  const tabLabels = {
    info: "Информация",
    media: "Медиа",
    settings: "Настройки",
  };

  $: activeTabIndex = Math.max(0, availableTabs.indexOf(activeTab));

  let swipeContainer;
  let isProgrammaticScroll = false;
  let scrollTimeout = null;
  let scrollRafId = null;
  let scrollEndTimer = null;
  let indicatorProgress = 0;

  $: if (!swipeContainer || isProgrammaticScroll) {
    indicatorProgress = activeTabIndex;
  }

  let isMouseDragging = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseStartScrollLeft = 0;
  let mouseHasMoved = false;

  function scrollToTabIndex(index) {
    const tabId = availableTabs[index];
    if (!tabId) return;
    activeTab = tabId;
    indicatorProgress = index;
    if (!swipeContainer) return;

    isProgrammaticScroll = true;
    swipeContainer.scrollTo({
      left: index * swipeContainer.clientWidth,
      behavior: "smooth",
    });

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isProgrammaticScroll = false;
    }, 350);
  }

  function selectTab(tabId) {
    const idx = availableTabs.indexOf(tabId);
    if (idx !== -1) {
      scrollToTabIndex(idx);
    }
  }

  function handlePagerScroll() {
    if (!swipeContainer) return;
    const width = swipeContainer.clientWidth;
    if (width === 0) return;

    if (!isProgrammaticScroll) {
      indicatorProgress = swipeContainer.scrollLeft / width;
    }

    if (isProgrammaticScroll) return;

    if (scrollRafId) cancelAnimationFrame(scrollRafId);
    scrollRafId = requestAnimationFrame(() => {
      const rawIndex = swipeContainer.scrollLeft / width;
      const newIndex = Math.round(rawIndex);
      if (Math.abs(rawIndex - newIndex) < 0.15 && newIndex !== activeTabIndex && availableTabs[newIndex]) {
        activeTab = availableTabs[newIndex];
      }
    });

    clearTimeout(scrollEndTimer);
    scrollEndTimer = setTimeout(() => {
      if (!swipeContainer || isProgrammaticScroll) return;
      const width = swipeContainer.clientWidth;
      if (width === 0) return;
      const finalIndex = Math.max(0, Math.min(availableTabs.length - 1, Math.round(swipeContainer.scrollLeft / width)));
      if (availableTabs[finalIndex] && activeTab !== availableTabs[finalIndex]) {
        activeTab = availableTabs[finalIndex];
      }
    }, 60);
  }

  function isInteractiveTarget(target) {
    return Boolean(
      target.closest(
        "button, a, input, textarea, select, .tg-card, .clickable, .tg-btn, .tg-btn-action, .tg-row-clickable, .tg-switch, .tg-seg-btn, .tg-eye-btn, .tg-copy-btn, .tg-icon-btn, .tg-menu-item, .media-grid-item, .media-list-row, .btn-more, .tg-topbar, .tg-tabs, [role='button']"
      )
    );
  }

  function handleSwipeMouseDown(e) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    if (!swipeContainer) return;

    isMouseDragging = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    mouseStartScrollLeft = swipeContainer.scrollLeft;
    mouseHasMoved = false;
  }

  function handleWindowMouseMove(e) {
    if (!isMouseDragging || !swipeContainer) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;

    if (!mouseHasMoved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 6) {
      isMouseDragging = false;
      return;
    }

    if (Math.abs(dx) > 4) {
      mouseHasMoved = true;
    }

    if (mouseHasMoved) {
      e.preventDefault();
      swipeContainer.scrollLeft = mouseStartScrollLeft - dx;
      indicatorProgress = swipeContainer.scrollLeft / swipeContainer.clientWidth;
    }
  }

  function handleWindowMouseUp(e) {
    if (!isMouseDragging) return;
    isMouseDragging = false;
    if (!swipeContainer || !mouseHasMoved) return;

    const width = swipeContainer.clientWidth;
    if (width === 0) return;

    const dx = e.clientX - mouseStartX;
    let targetIndex = activeTabIndex;

    if (Math.abs(dx) > width * 0.15 || Math.abs(dx) > 50) {
      targetIndex = dx > 0 ? activeTabIndex - 1 : activeTabIndex + 1;
    } else {
      targetIndex = Math.round(swipeContainer.scrollLeft / width);
    }

    targetIndex = Math.max(0, Math.min(availableTabs.length - 1, targetIndex));
    scrollToTabIndex(targetIndex);
  }

  function handleResize() {
    if (!swipeContainer) return;
    const idx = availableTabs.indexOf(activeTab);
    if (idx !== -1) {
      swipeContainer.scrollLeft = idx * swipeContainer.clientWidth;
      indicatorProgress = idx;
    }
  }

  $: {
    if (swipeContainer && !isMouseDragging && !isProgrammaticScroll && availableTabs.length > 0) {
      const idx = availableTabs.indexOf(activeTab);
      if (idx !== -1) {
        const targetLeft = idx * swipeContainer.clientWidth;
        if (Math.abs(swipeContainer.scrollLeft - targetLeft) > 10) {
          isProgrammaticScroll = true;
          swipeContainer.scrollTo({
            left: targetLeft,
            behavior: "smooth"
          });
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            isProgrammaticScroll = false;
          }, 350);
        }
      }
    }
  }

  let showMenu = false;
  let showDeleteConfirm = false;
  let showInputs = false;
  let memberSearch = "";

  $: isGroupAdmin = chat?.type === "CHAT" && (chat?.admins?.includes(Number($currentUser)) || chat?.admins?.includes($currentUser) || Number(chat?.owner) === Number($currentUser));
  $: isGroupOwner = chat?.type === "CHAT" && Number(chat?.owner) === Number($currentUser);

  let groupMembers = [];
  let groupMembersMarker = null;
  let groupMembersLoading = false;
  let groupMembersEnd = false;
  let memberSearchResults = [];
  let isSearchingMembers = false;
  let searchDebounceTimer;

  let showAddMembersModal = false;
  let showAdminModal = false;
  let adminModalMember = null;
  let showJoinRequestsModal = false;
  let joinRequests = [];
  let showRemoveMemberConfirm = false;
  let memberToRemove = null;
  let showPurgeConfirm = false;
  let showRefreshInviteConfirm = false;
  let purgeForAll = false;
  let selectedMemberMenuId = null;

  let loadedGroupChatId = null;
  $: if (chatId && chat?.type === "CHAT" && loadedGroupChatId !== chatId) {
    loadedGroupChatId = chatId;
    loadInitialMembers();
  }

  $: {
    clearTimeout(searchDebounceTimer);
    if (!memberSearch.trim()) {
      memberSearchResults = [];
      isSearchingMembers = false;
    } else if (chat?.type === "CHAT") {
      isSearchingMembers = true;
      searchDebounceTimer = setTimeout(async () => {
        try {
          const res = await $API.searchGroupMembers(chatId, memberSearch.trim());
          memberSearchResults = res?.members || res || [];
        } catch (e) {
          memberSearchResults = [];
        } finally {
          isSearchingMembers = false;
        }
      }, 300);
    }
  }

  $: displayedMembers = memberSearch.trim()
    ? (memberSearchResults.length > 0
        ? memberSearchResults
        : groupMembers.filter(m => {
            const id = m.contact?.id || m.userId || m.id || m;
            const c = get(getContact(id));
            const name = m.contact?.names?.[0]?.name || c?.names?.[0]?.name || m.contact?.name || c?.name || "";
            return name.toLowerCase().includes(memberSearch.toLowerCase().trim());
          })
      )
    : (groupMembers.length > 0
        ? groupMembers
        : Object.keys(chat?.participants || {}).map(id => ({ contact: { id: Number(id) } })));

  $: onlineCount = (() => {
    if (chat?.type !== "CHAT") return 0;
    const ids = groupMembers.length > 0
      ? groupMembers.map(m => m.contact?.id || m.userId || m.id || m)
      : Object.keys(chat?.participants || {});
    return ids.filter(id => $currentPresence[id]?.status === 1 || $currentPresence[id]?.on === "ON" || Boolean($currentRealContacts?.[id]?.online)).length;
  })();

  $: totalMemberCount = chat?.participantsCount || Object.keys(chat?.participants || {}).length || groupMembers.length;

  let saveTimeout;
  let showPassword = false;
  let hasDictionary = (async() => !!(await dict.getDictionary()))();

  let toastMessage = "";
  let toastTimer;

  function showToast(text) {
    toastMessage = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage = "";
    }, 2200);
  }

  function copyText(val, label) {
    if (!val) return;
    navigator.clipboard.writeText(String(val));
    if (label === "Описание") {
      showToast("Описание скопировано");
    } else if (label === "Телефон" || label === "Мобильный") {
      showToast("Номер телефона скопирован");
    } else if (label === "Дата создания") {
      showToast("Дата создания скопирована");
    } else if (label === "Дата регистрации") {
      showToast("Дата регистрации скопирована");
    } else if (label === "ID") {
      showToast("ID скопирован");
    } else if (label === "Ссылка") {
      showToast("Ссылка скопирована");
    } else {
      showToast("Скопировано в буфер");
    }
  }

  $: title = $contact?.names?.[0]?.firstName || chat?.title || ($contact ? "Пользователь" : "");
  $: avatar = chat?.avatar || chat?.baseRawIconUrl || chat?.baseIconUrl || chat?.iconUrl || chat?.baseUrl || $contact?.baseRawUrl || $contact?.avatar || $contact?.baseUrl || null;
  $: chatLink = chat?.link;

  $: isOwnProfile = Boolean(!chat || chat.type === "DIALOG") && userId != null && Number(userId) === Number($currentUser);
  $: canEditChatPhoto = Boolean(
    chat &&
    (chat.type === "CHAT" || chat.type === "CHANNEL") &&
    (
      Number(chat.owner) === Number($currentUser) ||
      (
        (chat.admins?.includes(Number($currentUser)) || chat.admins?.includes($currentUser)) &&
        !Boolean(chat.options?.ONLY_OWNER_CAN_CHANGE_ICON_TITLE ?? chat.options?.onlyOwnerCanChangeIconTitle ?? chat.onlyOwnerCanChangeIconTitle)
      )
    )
  );
  $: canUploadAvatar = isOwnProfile || canEditChatPhoto;
  $: ownPhotoId = $currentUserDetails?.photoId || $contact?.photoId || null;
  $: canDeleteOwnAvatar = Boolean(isOwnProfile && (ownPhotoId || avatar));

  let isUploadingAvatar = false;
  let isDeletingAvatar = false;
  let avatarWrapEl;

  function openAvatarGallery(e) {
    if (avatar || (userId && (!chat || chat.type === "DIALOG"))) {
      const targetEl = avatarWrapEl || e?.currentTarget;
      const rect = targetEl?.getBoundingClientRect?.();
      _openAvatarGallery({
        initialUrl: avatar,
        initialPhotoId: ownPhotoId,
        userId: !chat || chat.type === "DIALOG" ? ($contact?.id ?? userId) : null,
        isOwnProfile,
        canUpload: canUploadAvatar,
        originEl: targetEl,
        originRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        originRadius: 50,
        onUpload: handleAvatarUpload,
        onDelete: handleAvatarDelete,
        onDownloaded: () => showToast("Фото сохранено"),
        onError: (msg) => showToast(msg || "Ошибка"),
      });
    } else if (canUploadAvatar) {
      handleAvatarUpload();
    }
  }

  async function handleAvatarUpload() {
    if (isUploadingAvatar) return null;
    isUploadingAvatar = true;
    try {
      if (isOwnProfile) {
        const res = await $API.uploadProfilePhoto();
        if (res) {
          showToast("Аватарка обновлена");
        }
        return res;
      } else if (canEditChatPhoto && chat?.id != null) {
        const res = await $API.uploadChatPhoto(chat.id);
        if (res) {
          showToast("Фото чата обновлено");
        }
        return res;
      }
      return null;
    } catch (e) {
      showToast(e?.message || "Не удалось обновить фото");
      throw e;
    } finally {
      isUploadingAvatar = false;
    }
  }

  async function handleAvatarDelete(targetPhotoId = null, targetUrl = null) {
    if (!isOwnProfile || isDeletingAvatar) return;
    isDeletingAvatar = true;
    try {
      await $API.deleteProfilePhoto(targetPhotoId || ownPhotoId, targetUrl || avatar);
      showToast("Аватарка удалена");
    } catch (e) {
      showToast(e?.message || "Не удалось удалить аватарку");
      throw e;
    } finally {
      isDeletingAvatar = false;
    }
  }

  $: infoFields = [
    info(chat?.description || $contact?.description, "about", "Описание", chat?.description || $contact?.description),
    info(chat?.phone || $contact?.phone, "phone", "Телефон", chat?.phone || $contact?.phone),
    info(chat?.created > 1, "calendar", "Дата создания", formatMs(chat?.created)),
    info($contact?.registrationTime, "calendar", "Дата регистрации", formatMs($contact?.registrationTime)),
  ].filter(Boolean);

  const info = (k, icon, label, value) => k && { icon, label, value };

  const toggleMenu = () => showMenu = !showMenu;

  async function toggleMute() {
    if (!chat) return;
    const nextDDU = muted ? 0 : -1;
    await $API.setChatMute(chat.id, nextDDU);
    showToast(muted ? "Уведомления включены" : "Уведомления отключены");
  }

  function toggleAutoDownload() {
    autoDownloadEncryptedMedia.toggle();
    showToast($autoDownloadEncryptedMedia ? "Автозагрузка включена" : "Автозагрузка отключена");
  }

  function swapReader() {
    if (!$chatSettings) return;
    $chatSettings.reader = !$chatSettings.reader;
    showToast($chatSettings.reader ? "Отчеты о прочтении включены" : "Отчеты о прочтении выключены");
  }

  function triggerSwitchEnc() {
    if (!chat || !chatSettings) return;
    switchEnc(chat, chatSettings, null);
  }

  function copyFingerprint() {
    if ($chatSettings?.session?.fingerprint) {
      navigator.clipboard.writeText($chatSettings.session.fingerprint);
      showToast("Ключ сессии скопирован");
    }
  }

  function onPasswordInput(event) {
    if (!$chatSettings) return;
    const password = event.target.value;

    if (password.length) {
      if (!$chatSettings.obfuscation) setObfuscation("zh");
    } else {
      if ($chatSettings.obfuscation) setObfuscation(null);
    }

    clearTimeout(saveTimeout);

    saveTimeout = setTimeout(() => {
      $chatSettings.password = password;
      showToast("Пароль сохранен");
    }, 500);
  }

  async function setObfuscation(type) {
    if (!$chatSettings) return;
    if (type === "words") {
      hasDictionary = !!(await dict.getDictionary());
    }
    $chatSettings.obfuscation = type;
    $chatSettings.obfs = type;
    showToast(type === "zh" ? "Маскировка: Китайский" : type === "words" ? "Маскировка: Книжные слова" : "Маскировка отключена");
  }

  function handleAction(action) {
    showMenu = false;
    if (action === "edit")     return showInputs = true;
    if (action === "mute")     return toggleMute();
    if (action === "copy")     return copyLink();
    if (action === "settings") {
      activeTab = "settings";
      return;
    }
    if (action === "delete")   return showDeleteConfirm = true;
    if (action === "quit")     return leaveChat();
    if (action === "invite")   return refreshInvite();
  }

  const closeModal = () => $Session.profile = null;
  const closeChat = () => chat?.id != null && _closeChat(chat.id);

  function handleWindowClick(e) {
    if (showMenu && !e.target.closest(".tg-menu-container")) showMenu = false;
    if (selectedMemberMenuId && !e.target.closest(".tg-member-more-container")) selectedMemberMenuId = null;
  }

  function formatId(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function formatMembersCount(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${count} участников`;
    if (mod10 === 1) return `${count} участник`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} участника`;
    return `${count} участников`;
  }

  function formatOnlineCount(count) {
    if (count <= 0) return "";
    return `${count} в сети`;
  }

  function getMemberName(memberItem) {
    const id = memberItem?.contact?.id || memberItem?.userId || memberItem?.id || memberItem;
    if (id && Number(id) === Number($currentUser)) {
      return "Вы";
    }
    if (memberItem?.contact?.names?.[0]?.name) return memberItem.contact.names[0].name;
    if (memberItem?.contact?.name) return memberItem.contact.name;
    if (memberItem?.contact?.names?.[0]?.firstName) {
      const n = memberItem.contact.names[0];
      return [n.firstName, n.lastName].filter(Boolean).join(" ");
    }
    if (id) {
      try {
        const c = get(getContact(Number(id)));
        if (c?.names?.[0]?.name) return c.names[0].name;
        if (c?.name) return c.name;
        if (c?.names?.[0]?.firstName) {
          const n = c.names[0];
          return [n.firstName, n.lastName].filter(Boolean).join(" ");
        }
      } catch (e) {}
    }
    return "Пользователь";
  }

  async function loadInitialMembers() {
    if (!chatId || chat?.type !== "CHAT") return;
    groupMembersLoading = true;
    try {
      const res = await $API.fetchGroupMembers(chatId, null, 50);
      groupMembers = res?.members || [];
      groupMembersMarker = res?.marker || null;
      groupMembersEnd = !res?.marker || (res?.members?.length || 0) < 50;
      if (isGroupAdmin) {
        loadJoinRequests();
      }
    } catch (e) {
      groupMembers = [];
    } finally {
      groupMembersLoading = false;
    }
  }

  async function loadMoreMembers() {
    if (groupMembersLoading || groupMembersEnd || !chatId) return;
    groupMembersLoading = true;
    try {
      const res = await $API.fetchGroupMembers(chatId, groupMembersMarker, 50);
      const newMembers = res?.members || [];
      groupMembers = [...groupMembers, ...newMembers];
      groupMembersMarker = res?.marker || null;
      if (!res?.marker || newMembers.length < 50) {
        groupMembersEnd = true;
      }
    } catch (e) {
      groupMembersEnd = true;
    } finally {
      groupMembersLoading = false;
    }
  }

  async function loadJoinRequests() {
    if (!chatId || !isGroupAdmin) return;
    try {
      const reqs = await $API.fetchJoinRequests(chatId);
      joinRequests = Array.isArray(reqs) ? reqs : [];
    } catch (e) {
      joinRequests = [];
    }
  }

  function toggleMemberMenu(memberId) {
    selectedMemberMenuId = selectedMemberMenuId === memberId ? null : memberId;
  }

  function canManageMember(mId) {
    if (!isGroupAdmin) return false;
    if (Number(mId) === Number($currentUser)) return false;
    if (Number(mId) === Number(chat?.owner)) return false;
    if (chat?.admins?.includes(Number(mId)) || chat?.admins?.includes(mId)) {
      return isGroupOwner;
    }
    return true;
  }

  function promptKickMember(member) {
    memberToRemove = member;
    showRemoveMemberConfirm = true;
  }

  async function kickConfirmedMember() {
    if (!memberToRemove || !chatId) return;
    const uId = memberToRemove.contact?.id || memberToRemove.userId || memberToRemove.id || memberToRemove;
    try {
      await $API.kickGroupMember(chatId, uId);
      groupMembers = groupMembers.filter(m => {
        const id = m.contact?.id || m.userId || m.id || m;
        return Number(id) !== Number(uId);
      });
      if (chat?.participants) {
        delete chat.participants[uId];
        delete chat.participants[String(uId)];
      }
      showToast("Участник удален");
    } catch (e) {
      showToast("Не удалось удалить участника");
    } finally {
      showRemoveMemberConfirm = false;
      memberToRemove = null;
    }
  }

  function openAdminModal(member) {
    adminModalMember = member;
    showAdminModal = true;
  }

  async function demoteAdmin(memberId) {
    if (!chatId) return;
    try {
      await $API.revokeGroupAdmin(chatId, memberId);
      if (chat?.admins) {
        chat.admins = chat.admins.filter(id => Number(id) !== Number(memberId));
      }
      groupMembers = groupMembers.map(m => {
        const id = m.contact?.id || m.userId || m.id || m;
        if (Number(id) === Number(memberId)) {
          return { ...m, permissions: [], alias: null };
        }
        return m;
      });
      showToast("Права администратора сняты");
    } catch (e) {
      showToast("Ошибка при снятии прав");
    }
  }

  function onAdminSaved(event) {
    const { userId, alias, permissions } = event.detail;
    if (chat) {
      if (!chat.admins) chat.admins = [];
      if (!chat.admins.some(id => Number(id) === Number(userId))) {
        chat.admins = [...chat.admins, Number(userId)];
      }
    }
    groupMembers = groupMembers.map(m => {
      const id = m.contact?.id || m.userId || m.id || m;
      if (Number(id) === Number(userId)) {
        return { ...m, permissions, alias };
      }
      return m;
    });
    showAdminModal = false;
    adminModalMember = null;
    showToast("Права администратора обновлены");
  }

  function onAdminRevoked(event) {
    const { userId } = event.detail;
    if (chat?.admins) {
      chat.admins = chat.admins.filter(id => Number(id) !== Number(userId));
    }
    groupMembers = groupMembers.map(m => {
      const id = m.contact?.id || m.userId || m.id || m;
      if (Number(id) === Number(userId)) {
        return { ...m, permissions: [], alias: null };
      }
      return m;
    });
    showAdminModal = false;
    adminModalMember = null;
    showToast("Права администратора сняты");
  }

  function onMembersAdded(event) {
    const { userIds } = event.detail;
    showAddMembersModal = false;
    showToast(`Добавлено участников: ${userIds.length}`);
    loadInitialMembers();
  }

  function onJoinRequestsUpdated() {
    loadJoinRequests();
    loadInitialMembers();
  }

  const OPTION_SERVER_KEYS = {
    allCanPinMessage: "ALL_CAN_PIN_MESSAGE",
    onlyAdminCanAddMember: "ONLY_ADMIN_CAN_ADD_MEMBER",
    onlyAdminCanCall: "ONLY_ADMIN_CAN_CALL",
    membersCanSeePrivateLink: "MEMBERS_CAN_SEE_PRIVATE_LINK",
    onlyOwnerCanChangeIconTitle: "ONLY_OWNER_CAN_CHANGE_ICON_TITLE",
  };

  function getGroupOption(key) {
    if (!chat) return false;
    const serverKey = OPTION_SERVER_KEYS[key] || key;
    return Boolean(
      chat?.options?.[serverKey] ??
      chat?.options?.[key] ??
      chat?.[key]
    );
  }

  async function toggleGroupOption(key) {
    if (!chatId || !isGroupAdmin) return;
    const serverKey = OPTION_SERVER_KEYS[key] || key;
    const currentVal = getGroupOption(key);
    const nextVal = !currentVal;
    try {
      await $API.setGroupOptions(chatId, {
        [key]: nextVal,
        [serverKey]: nextVal,
      });
      if (!chat.options) chat.options = {};
      chat.options[key] = nextVal;
      chat.options[serverKey] = nextVal;
      chat[key] = nextVal;
      showToast("Настройки обновлены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }

  async function confirmPurgeHistory() {
    if (!chatId) return;
    try {
      await $API.purgeChatHistory(chatId, purgeForAll);
      const c = getChat(chatId);
      c?.receivedMessage?.set({ chatId: Number(chatId), type: "CLEAR_HISTORY" });
      showToast(purgeForAll ? "История очищена для всех" : "История очищена");
    } catch (e) {
      showToast("Ошибка при очистке истории");
    } finally {
      showPurgeConfirm = false;
    }
  }

  async function joinChannel() {
    const response = await $API.joinChannel(chat.link);
    Object.keys(response).forEach(key => chat[key] = response[key]);
    showToast("Вы подписались на канал");
  }

  async function quitChannel() {
    await $API.leaveChannel(chat);
    showToast("Вы отписались от канала");
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
    showToast("Профиль чата обновлен");
  }

  const openChat = () => _openChat(chatId);

  const copyLink = () => {
    if (!chat?.link) return;
    navigator.clipboard.writeText(chat.link);
    showToast("Ссылка скопирована");
  };

  async function refreshInvite() {
    if (!chat?.id) return;
    try {
      const res = await $API.refreshInviteLink(chat.id);
      const updatedLink = res?.chat?.link || res?.link;
      if (updatedLink) {
        chat.link = updatedLink;
        chatLink = updatedLink;
      }
      showToast("Ссылка приглашения обновлена");
    } catch (e) {
      showToast("Ошибка при обновлении ссылки");
    }
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
    if ((activeTab === "settings" || activeTab === "media") && $Session.profile?.view !== "settings") {
      selectTab("info");
      return;
    }
    if ($Session.profile?.history?.length) {
      const length = $Session.profile.history.length;
      const last = $Session.profile.history[length - 1];
      $Session.profile = {
        history: $Session.profile.history.slice(length),
        ...last
      };
    } else {
      closeModal();
    }
  }
</script>

<svelte:window
  on:click={handleWindowClick}
  on:mousemove={handleWindowMouseMove}
  on:mouseup={handleWindowMouseUp}
  on:resize={handleResize}
/>

<div
  class="tg-profile-backdrop"
  transition:fade={{ duration: 250 }}
  on:click|self={closeModal}
>
  <div
    class="tg-profile-panel"
    transition:fly={{ x: 380, duration: 280, opacity: 1, easing: cubicOut }}
  >
    <div class="tg-topbar">
      <button class="tg-icon-btn" on:click={goBack} aria-label="Назад">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>

      <div class="tg-topbar-title">
        {#if activeTab === "settings"}
          Настройки чата
        {:else if chat?.type === "CHANNEL"}
          Канал
        {:else if chat?.type === "CHAT"}
          Информация о группе
        {:else if chat?.type === "DIALOG"}
          Информация
        {:else}
          Профиль
        {/if}
      </div>

      <div class="tg-menu-container">
        {#if chat}
          <button class="tg-icon-btn" on:click|stopPropagation={toggleMenu} aria-label="Меню">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1.5"></circle>
              <circle cx="12" cy="5" r="1.5"></circle>
              <circle cx="12" cy="19" r="1.5"></circle>
            </svg>
          </button>
        {/if}

        {#if showMenu}
          <div
            class="tg-dropdown"
            transition:scale={{ duration: 140, start: 0.92 }}
          >
            {#if chat?.admins?.includes($currentUser)}
              <div class="tg-menu-item" on:click={() => handleAction("edit")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                <span>Изменить</span>
              </div>
              {#if chat.link}
                <div class="tg-menu-item" on:click={() => handleAction("invite")}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  <span>Обновить ссылку</span>
                </div>
              {/if}
            {/if}

            {#if hasSettings}
              <div class="tg-menu-item" on:click={() => handleAction("mute")}>
                {#if muted}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  <span>Включить звук</span>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
                    <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  <span>Отключить звук</span>
                {/if}
              </div>
            {/if}

            {#if chatLink}
              <div class="tg-menu-item" on:click={() => handleAction("copy")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span>Скопировать ссылку</span>
              </div>
            {/if}

            {#if chat?.type === "CHAT" && (isGroupAdmin || chat.owner === $currentUser)}
              <div class="tg-menu-item" on:click={() => { showMenu = false; showRefreshInviteConfirm = true; }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                <span>Обновить ссылку</span>
              </div>
            {/if}

            {#if chat?.type === "CHAT" && isGroupAdmin}
              <div class="tg-menu-item" on:click={() => { showMenu = false; showJoinRequestsModal = true; }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span>Заявки на вступление</span>
                {#if joinRequests.length > 0}
                  <span class="tg-menu-badge">{joinRequests.length}</span>
                {/if}
              </div>
            {/if}

            {#if chat.owner === $currentUser || chat.type === "DIALOG"}
              <div class="tg-menu-divider"></div>
              <div class="tg-menu-item danger" on:click={() => handleAction("delete")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                <span>Удалить для всех</span>
              </div>
            {/if}

            {#if chat.type === "CHAT"}
              <div class="tg-menu-divider"></div>
              <div class="tg-menu-item danger" on:click={() => handleAction("quit")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                <span>Выйти из группы</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if chat}
      <div class="tg-tabs">
        {#each availableTabs as tabId}
          <button
            type="button"
            class="tg-tab"
            class:active={activeTab === tabId}
            on:click={() => selectTab(tabId)}
          >
            <span>{tabLabels[tabId] || tabId}</span>
          </button>
        {/each}
        <div
          class="tg-tab-indicator"
          class:animating={isProgrammaticScroll}
          style="width: {100 / availableTabs.length}%; transform: translateX({indicatorProgress * 100}%);"
        />
      </div>
    {/if}

    {#key (userId || chatId)}
      <div
        class="tg-swipe-container"
        class:dragging={isMouseDragging}
        bind:this={swipeContainer}
        on:scroll={handlePagerScroll}
        on:mousedown={handleSwipeMouseDown}
      >
        <div class="tg-tab-page">
          <div class="tg-tab-page-content">
                    <div class="tg-hero">
          <div
            class="tg-avatar-wrap"
            bind:this={avatarWrapEl}
            class:clickable={Boolean(avatar || canUploadAvatar || (userId && (!chat || chat.type === "DIALOG")))}
            on:click={openAvatarGallery}
          >
            <Avatar
              chat={chat}
              contactId={$contact?.id ?? userId}
              size={96}
            />
            {#if canUploadAvatar}
              <button
                type="button"
                class="tg-avatar-edit-badge"
                title="Обновить фото"
                disabled={isUploadingAvatar}
                on:click|stopPropagation={handleAvatarUpload}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            {/if}
          </div>

          <h2 class="tg-hero-name">{title}</h2>

          <div class="tg-hero-status" class:online={$currentPresence[$contact?.id]?.status === 1 || $currentPresence[$contact?.id]?.on === "ON" || Boolean($contact?.online)}>
            {#if chat?.type === "CHAT"}
              {formatMembersCount(totalMemberCount)}{#if onlineCount > 0}, {formatOnlineCount(onlineCount)}{/if}
            {:else if chat?.type === "CHANNEL"}
              канал
            {:else}
              <Signature contact={contact} chat={chat} />
            {/if}
          </div>

          <div class="tg-actions-row">
            <button type="button" class="tg-action-btn" on:click={openChat}>
              <div class="tg-action-circle">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span class="tg-action-label">Чат</span>
            </button>

            {#if hasSettings}
              <button type="button" class="tg-action-btn" on:click={toggleMute}>
                <div class="tg-action-circle">
                  {#if muted}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                      <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
                      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
                      <path d="M18 8a6 6 0 0 0-9.33-5"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  {:else}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                  {/if}
                </div>
                <span class="tg-action-label">{muted ? "Звук вкл." : "Без звука"}</span>
              </button>
            {/if}

            {#if chatLink}
              <button type="button" class="tg-action-btn" on:click={copyLink}>
                <div class="tg-action-circle">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>
                <span class="tg-action-label">Ссылка</span>
              </button>
            {/if}
          </div>
        </div>

        {#if infoFields.length || chatLink || userId || chatId}
          <div class="tg-section-header">Информация</div>
          <div class="tg-card">
            {#if chatLink}
              <div class="tg-row tg-row-clickable" on:click={copyLink}>
                <div class="tg-row-icon tg-icon-link">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="4"/>
                    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
                  </svg>
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title tg-link-text">
                    {#if chatLink.includes("join/")}
                      {chatLink.slice(0, 26)}...{chatLink.slice(-4)}
                    {:else}
                      @{chatLink.replace("https://max.ru/", "")}
                    {/if}
                  </div>
                  <div class="tg-row-subtitle">Имя пользователя / Ссылка</div>
                </div>
                <button type="button" class="tg-copy-btn" title="Скопировать ссылку" on:click|stopPropagation={copyLink}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
                {#if chat?.type === "CHAT" && (isGroupAdmin || chat?.owner === $currentUser)}
                  <button type="button" class="tg-copy-btn" title="Отозвать и создать новую ссылку" on:click|stopPropagation={() => (showRefreshInviteConfirm = true)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                  </button>
                {/if}
              </div>
            {/if}

            {#each infoFields as field}
              <div class="tg-row tg-row-clickable" on:click={() => copyText(field.value, field.label)}>
                <div class="tg-row-icon tg-icon-info">
                  {#if field.icon === "phone"}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                    </svg>
                  {:else if field.icon === "calendar"}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                  {:else}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="16" x2="12" y2="12"/>
                      <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                  {/if}
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title selectable">{field.value}</div>
                  <div class="tg-row-subtitle">{field.label}</div>
                </div>
                <button type="button" class="tg-copy-btn" title="Скопировать">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            {/each}

            {#if userId || chatId}
              <div class="tg-row tg-row-clickable" on:click={() => copyText(userId || chatId, "ID")}>
                <div class="tg-row-icon tg-icon-hash">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="4" y1="9" x2="20" y2="9"/>
                    <line x1="4" y1="15" x2="20" y2="15"/>
                    <line x1="10" y1="3" x2="8" y2="21"/>
                    <line x1="16" y1="3" x2="14" y2="21"/>
                  </svg>
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title">{formatId(userId || chatId)}</div>
                  <div class="tg-row-subtitle">Идентификатор (ID)</div>
                </div>
                <button type="button" class="tg-copy-btn" title="Скопировать ID">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            {/if}
          </div>
        {/if}

        {#if chat?.type === "CHAT"}
          <div class="tg-section-header">
            Участники · {totalMemberCount}
          </div>

          {#if totalMemberCount > 4 || memberSearch}
            <div class="tg-search-bar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                bind:value={memberSearch}
                placeholder="Поиск участников..."
                class="tg-search-input"
              />
            </div>
          {/if}

          <div class="tg-card tg-members-card">
            {#if isGroupAdmin && joinRequests.length > 0}
              <div
                class="tg-row tg-requests-row"
                on:click={() => (showJoinRequestsModal = true)}
              >
                <div class="tg-row-icon tg-icon-requests">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title tg-requests-title">Заявки на вступление</div>
                  <div class="tg-row-subtitle">Ожидают подтверждения: {joinRequests.length}</div>
                </div>
                <span class="tg-requests-badge">{joinRequests.length}</span>
              </div>
            {/if}

            <div
              class="tg-row tg-row-clickable tg-invite-row"
              on:click={() => (showAddMembersModal = true)}
            >
              <div class="tg-row-icon tg-icon-invite">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7.5" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title tg-link-text">Добавить участников</div>
              </div>
            </div>

            {#each displayedMembers as memberItem, memberIdx (memberItem.contact?.id || memberItem.userId || memberItem.id || memberItem)}
              {@const memberId = Number(memberItem.contact?.id || memberItem.userId || memberItem.id || memberItem)}
              {@const isMemberOwner = Number(memberId) === Number(chat.owner)}
              {@const isMemberAdmin = isMemberOwner || Boolean(chat.admins?.some(a => Number(a) === Number(memberId)))}
              {@const memberAlias = memberItem.alias || (isMemberOwner ? "владелец" : isMemberAdmin ? "админ" : null)}
              {@const canManage = canManageMember(memberId)}
              <div
                class="tg-row tg-member-row"
                on:click={() => selectMember(memberId)}
              >
                <Avatar contactId={memberId} size={42} />
                <div class="tg-row-main">
                  <div class="tg-member-name-row">
                    <span class="tg-row-title">
                      {getMemberName(memberItem)}
                    </span>
                    {#if memberAlias}
                      <span class="tg-role-badge" class:admin={isMemberAdmin && !isMemberOwner}>{memberAlias}</span>
                    {/if}
                  </div>
                  <div class="tg-row-subtitle">
                    <Signature contactId={memberId} presence={memberItem.presence} />
                  </div>
                </div>

                {#if canManage}
                  <div class="tg-member-more-container" on:click|stopPropagation>
                    <button
                      type="button"
                      class="tg-btn-member-more"
                      on:click={() => toggleMemberMenu(memberId)}
                      aria-label="Опции участника"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="1.5"/>
                        <circle cx="12" cy="5" r="1.5"/>
                        <circle cx="12" cy="19" r="1.5"/>
                      </svg>
                    </button>

                    {#if selectedMemberMenuId === memberId}
                      <div class="tg-dropdown tg-member-dropdown" class:bottom-up={memberIdx >= displayedMembers.length - 2 && displayedMembers.length > 2} transition:scale={{ duration: 120, start: 0.94 }}>
                        <div class="tg-menu-item" on:click={() => { selectedMemberMenuId = null; selectMember(memberId); }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          <span>Профиль</span>
                        </div>
                        {#if isGroupOwner || (isGroupAdmin && !isMemberAdmin)}
                          <div class="tg-menu-item" on:click={() => { selectedMemberMenuId = null; openAdminModal(memberItem); }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                            </svg>
                            <span>{isMemberAdmin ? "Настроить права" : "Назначить админом"}</span>
                          </div>
                        {/if}
                        {#if isMemberAdmin && isGroupOwner && !isMemberOwner}
                          <div class="tg-menu-item danger" on:click={() => { selectedMemberMenuId = null; demoteAdmin(memberId); }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/>
                              <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                            <span>Разжаловать</span>
                          </div>
                        {/if}
                        <div class="tg-menu-item danger" on:click={() => { selectedMemberMenuId = null; promptKickMember(memberItem); }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                          <span>Исключить</span>
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tg-chevron">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                {/if}
              </div>
            {/each}

            {#if !groupMembersEnd && !memberSearch.trim()}
              <button
                type="button"
                class="tg-load-more-members"
                disabled={groupMembersLoading}
                on:click={loadMoreMembers}
              >
                {groupMembersLoading ? "Загрузка..." : "Показать еще"}
              </button>
            {/if}
          </div>
        {/if}

        <div class="tg-section-header">Действия</div>
        <div class="tg-card">
          {#if chat}
            <div class="tg-row tg-row-clickable tg-danger-row" on:click={() => (showPurgeConfirm = true)}>
              <div class="tg-row-icon tg-icon-danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title danger">Очистить историю</div>
              </div>
            </div>
          {/if}
          {#if chat?.type === "CHANNEL"}
            {#if chat?.id && $currentRealChats.includes(chat.id)}
              <div class="tg-row tg-row-clickable tg-danger-row" on:click={quitChannel}>
                <div class="tg-row-icon tg-icon-danger">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title danger">Отписаться от канала</div>
                </div>
              </div>
            {:else if chat?.link}
              <div class="tg-row tg-row-clickable" on:click={joinChannel}>
                <div class="tg-row-icon tg-icon-check">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title tg-link-text">Подписаться на канал</div>
                </div>
              </div>
            {/if}
          {/if}

          {#if chat?.type === "CHAT"}
            <div class="tg-row tg-row-clickable tg-danger-row" on:click={() => handleAction("quit")}>
              <div class="tg-row-icon tg-icon-danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title danger">Выйти из группы</div>
              </div>
            </div>
          {/if}

          {#if chat?.owner === $currentUser || chat?.type === "DIALOG"}
            <div class="tg-row tg-row-clickable tg-danger-row" on:click={() => handleAction("delete")}>
              <div class="tg-row-icon tg-icon-danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title danger">Удалить чат для всех</div>
              </div>
            </div>
          {/if}
        </div>
          </div>
        </div>

        {#if chat}
          <div class="tg-tab-page">
            <div class="tg-tab-page-content">
              <GroupSharedMedia {chat} />
            </div>
          </div>
        {/if}

        {#if hasSettings}
          <div class="tg-tab-page">
            <div class="tg-tab-page-content">
                      {#if chat?.type !== "CHAT"}
          <div class="tg-section-header">Шифрование и безопасность</div>
          <div class="tg-card">
            <div class="tg-row">
              <div class="tg-row-icon tg-icon-shield">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title">Сквозное шифрование</div>
                <div class="tg-row-subtitle">
                  {#if $chatSettings?.keys?.current || $chatSettings?.session}
                    <span class="tg-badge tg-badge-success">Активно</span>
                  {:else if $chatSettings?.pending}
                    <span class="tg-badge tg-badge-warning">Запрос отправлен</span>
                  {:else}
                    <span class="tg-badge tg-badge-muted">Отключено</span>
                  {/if}
                </div>
              </div>
              <button
                type="button"
                class="tg-btn-action"
                class:danger={$chatSettings?.keys?.current || $chatSettings?.session}
                on:click={triggerSwitchEnc}
              >
                { !($chatSettings?.keys?.current || $chatSettings?.session) ? "Новая сессия" : "Отключить" }
              </button>
            </div>

            {#if $chatSettings?.session?.fingerprint}
              <div class="tg-row tg-row-clickable" on:click={copyFingerprint}>
                <div class="tg-row-icon tg-icon-key">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="7.5" cy="15.5" r="4.5"/>
                    <path d="M21 2l-9.6 9.6M15.5 7.5l3 3M18.5 4.5l3 3"/>
                  </svg>
                </div>
                <div class="tg-row-main">
                  <div class="tg-row-title">Ключ сессии</div>
                  <div class="tg-fingerprint-emojis">
                    {$chatSettings.session.fingerprint}
                  </div>
                </div>
                <button type="button" class="tg-copy-btn" title="Скопировать ключ">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            {/if}
          </div>

          <div class="tg-caption">
            {#if $chatSettings?.session?.fingerprint}
              Сравните эти 4 эмодзи с собеседником для проверки безопасности соединения.
            {:else}
              При включении переписка шифруется на устройстве, прочитать её можете только вы и собеседник.
            {/if}
            <div class="tg-caption-tag">Шифрование доступно между пользователями Max+</div>
          </div>
        {/if}

        <div class="tg-section-header">Симметричный ключ (XOR)</div>
        <div class="tg-card">
          <div class="tg-row tg-input-row">
            <div class="tg-row-icon tg-icon-lock">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div class="tg-row-main">
              <input
                type={showPassword ? "text" : "password"}
                value={$chatSettings?.password || ""}
                on:input={onPasswordInput}
                class="tg-input"
                placeholder="Введите общий секрет чата"
              />
            </div>
            <button
              type="button"
              class="tg-eye-btn"
              on:click={() => (showPassword = !showPassword)}
              aria-label="Показать пароль"
            >
              {#if showPassword}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              {:else}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              {/if}
            </button>
          </div>
        </div>
        <div class="tg-caption">Дополнительный общий пароль для симметричного шифрования.</div>

        <div class="tg-section-header">Обфускация трафика</div>
        <div class="tg-segmented">
          <button
            type="button"
            class="tg-seg-btn"
            class:active={!$chatSettings?.obfuscation}
            on:click={() => setObfuscation(null)}
          >
            <span class="tg-seg-title">Без маскировки</span>
            <span class="tg-seg-sub">OFF</span>
          </button>

          <button
            type="button"
            class="tg-seg-btn"
            class:active={$chatSettings?.obfuscation === "zh"}
            on:click={() => setObfuscation("zh")}
          >
            <span class="tg-seg-title">Китайский</span>
            <span class="tg-seg-sub">Zh</span>
          </button>

          <button
            type="button"
            class="tg-seg-btn"
            class:active={$chatSettings?.obfuscation === "words"}
            on:click={() => setObfuscation("words")}
          >
            <span class="tg-seg-title">Книжные слова</span>
            <span class="tg-seg-sub">Tol</span>
          </button>
        </div>

        <div class="tg-caption">
          {#if $chatSettings?.obfuscation === "zh"}
            Зашифрованный текст визуально маскируется иероглифами.
          {:else if $chatSettings?.obfuscation === "words"}
            {#await hasDictionary}
              Проверка словаря...
            {:then has}
              {#if has}
                Зашифрованный текст превращается в поток литературных слов.
              {:else}
                <span class="tg-warn-text">Словарь не найден. Загрузите список слов в настройках приложения.</span>
              {/if}
            {/await}
          {:else}
            Символы передаются в стандартном зашифрованном виде.
          {/if}
        </div>

        <div class="tg-section-header">Параметры чата</div>
        <div class="tg-card">
          <div class="tg-row tg-row-clickable" on:click={toggleMute}>
            <div class="tg-row-icon tg-icon-bell">
              {#if muted}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  <path d="M18.63 13A17.89 17.89 0 0 1 18 8"/>
                  <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/>
                  <path d="M18 8a6 6 0 0 0-9.33-5"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              {:else}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
              {/if}
            </div>
            <div class="tg-row-main">
              <div class="tg-row-title">Уведомления</div>
              <div class="tg-row-subtitle">{muted ? "Отключены" : "Включены"}</div>
            </div>
            <div class="tg-switch" class:active={!muted}>
              <div class="tg-switch-thumb"></div>
            </div>
          </div>

          <div class="tg-row tg-row-clickable" on:click={swapReader}>
            <div class="tg-row-icon tg-icon-check">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
            <div class="tg-row-main">
              <div class="tg-row-title">Помечать прочитанным</div>
              <div class="tg-row-subtitle">{$chatSettings?.reader ? "Автоматически" : "Вручную"}</div>
            </div>
            <div class="tg-switch" class:active={$chatSettings?.reader}>
              <div class="tg-switch-thumb"></div>
            </div>
          </div>

          <div class="tg-row tg-row-clickable" on:click={toggleAutoDownload}>
            <div class="tg-row-icon tg-icon-download">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </div>
            <div class="tg-row-main">
              <div class="tg-row-title">Автозагрузка зашифрованных медиа</div>
              <div class="tg-row-subtitle">{$autoDownloadEncryptedMedia ? "Разрешена" : "Выключена"}</div>
            </div>
            <div class="tg-switch" class:active={$autoDownloadEncryptedMedia}>
              <div class="tg-switch-thumb"></div>
            </div>
          </div>

          <div class="tg-row tg-disabled-row">
            <div class="tg-row-icon tg-icon-save">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
            </div>
            <div class="tg-row-main">
              <div class="tg-row-title">Сохранить переписку</div>
              <div class="tg-row-subtitle">Экспорт сообщений и файлов</div>
            </div>
            <span class="tg-badge tg-badge-soon">Скоро</span>
          </div>
        </div>

        {#if chat?.type === "CHAT" && isGroupAdmin}
          <div class="tg-section-header">Разрешения группы</div>
          <div class="tg-card">
            <div class="tg-row tg-row-clickable" on:click={() => toggleGroupOption("allCanPinMessage")}>
              <div class="tg-row-icon tg-icon-pin">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="17" x2="12" y2="22"/>
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title">Закреплять сообщения</div>
                <div class="tg-row-subtitle">Все участники могут закреплять</div>
              </div>
              <div class="tg-switch" class:active={getGroupOption("allCanPinMessage")}>
                <div class="tg-switch-thumb"></div>
              </div>
            </div>

            <div class="tg-row tg-row-clickable" on:click={() => toggleGroupOption("onlyAdminCanAddMember")}>
              <div class="tg-row-icon tg-icon-invite">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="8.5" cy="7.5" r="4"/>
                  <line x1="20" y1="8" x2="20" y2="14"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title">Добавление участников</div>
                <div class="tg-row-subtitle">Только администраторы</div>
              </div>
              <div class="tg-switch" class:active={getGroupOption("onlyAdminCanAddMember")}>
                <div class="tg-switch-thumb"></div>
              </div>
            </div>

            <div class="tg-row tg-row-clickable" on:click={() => toggleGroupOption("onlyAdminCanCall")}>
              <div class="tg-row-icon tg-icon-phone">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title">Звонки в группе</div>
                <div class="tg-row-subtitle">Только администраторы могут звонить</div>
              </div>
              <div class="tg-switch" class:active={getGroupOption("onlyAdminCanCall")}>
                <div class="tg-switch-thumb"></div>
              </div>
            </div>

            <div class="tg-row tg-row-clickable" on:click={() => toggleGroupOption("membersCanSeePrivateLink")}>
              <div class="tg-row-icon tg-icon-link">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </div>
              <div class="tg-row-main">
                <div class="tg-row-title">Видимость ссылки приглашения</div>
                <div class="tg-row-subtitle">Участники видят ссылку</div>
              </div>
              <div class="tg-switch" class:active={getGroupOption("membersCanSeePrivateLink")}>
                <div class="tg-switch-thumb"></div>
              </div>
            </div>
          </div>
        {/if}
            </div>
          </div>
        {/if}
      </div>
    {/key}

    {#if toastMessage}
      <div class="tg-toast" in:fly={{ y: 20, duration: 180 }} out:fade={{ duration: 150 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>{toastMessage}</span>
      </div>
    {/if}
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

{#if showAddMembersModal}
  <GroupAddMembersModal
    {chat}
    existingMemberIds={new Set(groupMembers.map(m => Number(m.contact?.id || m.userId || m.id || m)))}
    on:close={() => (showAddMembersModal = false)}
    on:added={onMembersAdded}
  />
{/if}

{#if showAdminModal}
  <GroupAdminModal
    {chat}
    member={adminModalMember}
    on:close={() => (showAdminModal = false)}
    on:saved={onAdminSaved}
    on:revoked={onAdminRevoked}
  />
{/if}

{#if showJoinRequestsModal}
  <GroupJoinRequestsModal
    {chat}
    on:close={() => (showJoinRequestsModal = false)}
    on:updated={onJoinRequestsUpdated}
  />
{/if}

{#if showRemoveMemberConfirm}
  <ConfirmModal
    title="Исключить участника?"
    message="Вы действительно хотите удалить этого участника из группы?"
    confirmText="Исключить"
    on:confirm={kickConfirmedMember}
    on:cancel={() => { showRemoveMemberConfirm = false; memberToRemove = null; }}
  />
{/if}

{#if showPurgeConfirm}
  <ConfirmModal
    title="Очистить историю сообщений?"
    message="Все сообщения в этом чате будут удалены."
    confirmText="Очистить"
    on:confirm={confirmPurgeHistory}
    on:cancel={() => (showPurgeConfirm = false)}
  />
{/if}

{#if showRefreshInviteConfirm}
  <ConfirmModal
    title="Отозвать ссылку приглашения?"
    message="Предыдущая ссылка станет недействительной, и будет создана новая ссылка для приглашения."
    confirmText="Отозвать и создать"
    on:confirm={() => { showRefreshInviteConfirm = false; refreshInvite(); }}
    on:cancel={() => (showRefreshInviteConfirm = false)}
  />
{/if}

<style>
  .tg-profile-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    z-index: 100;
    display: flex;
    justify-content: flex-end;
  }

  .tg-profile-panel {
    position: relative;
    width: 100%;
    max-width: 420px;
    height: 100%;
    background: #212121;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    box-shadow: -10px 0 30px rgba(0, 0, 0, 0.5);
    box-sizing: border-box;
  }

  .tg-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #212121;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    z-index: 10;
  }

  .tg-tabs {
    display: flex;
    background: #212121;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-shrink: 0;
    position: relative;
    user-select: none;
  }

  .tg-tab {
    flex: 1;
    height: 44px;
    background: transparent;
    border: none;
    color: #707579;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
  }

  .tg-tab:hover {
    color: #ffffff;
  }

  .tg-tab.active {
    color: #3390ec;
    font-weight: 600;
  }

  .tg-tab-indicator {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: #3390ec;
    border-radius: 2px 2px 0 0;
    pointer-events: none;
    will-change: transform;
    z-index: 2;
  }

  .tg-tab-indicator.animating {
    transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
  }

  .tg-topbar-title {
    color: #ffffff;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.2px;
    flex: 1;
    margin: 0 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tg-icon-btn {
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #aaaaaa;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, transform 0.12s;
  }

  .tg-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .tg-icon-btn:active {
    transform: scale(0.92);
  }

  .tg-menu-container {
    position: relative;
  }

  .tg-dropdown {
    position: absolute;
    top: 42px;
    right: 0;
    background: #2b2b2b;
    width: 210px;
    border-radius: 12px;
    padding: 6px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 30;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .tg-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 12px;
    color: #ffffff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 8px;
    transition: background 0.12s;
  }

  .tg-menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .tg-menu-item.danger {
    color: #ff595a;
  }

  .tg-menu-item.danger:hover {
    background: rgba(229, 57, 53, 0.15);
  }

  .tg-menu-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 4px 6px;
  }

  .tg-swipe-container {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -ms-overflow-style: none;
    cursor: grab;
    will-change: scroll-position;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
  }

  .tg-swipe-container.dragging {
    cursor: grabbing;
    scroll-snap-type: none;
    user-select: none;
  }

  .tg-swipe-container::-webkit-scrollbar {
    display: none;
  }

  .tg-tab-page {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    min-height: 0;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    box-sizing: border-box;
    cursor: default;
  }

  .tg-tab-page-content {
    padding: 14px 14px calc(24px + env(safe-area-inset-bottom));
  }

  .tg-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 10px 0 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }

  .tg-avatar-wrap {
    margin-bottom: 12px;
    position: relative;
  }

  .tg-avatar-wrap.clickable {
    cursor: pointer;
    transition: transform 0.14s;
  }

  .tg-avatar-wrap.clickable:active {
    transform: scale(0.96);
  }

  .tg-avatar-edit-badge {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid #212121;
    background: #3390ec;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
    transition: background 0.15s, transform 0.12s, opacity 0.15s;
  }

  .tg-avatar-edit-badge:hover {
    background: #4ea4f6;
  }

  .tg-avatar-edit-badge:active {
    transform: scale(0.9);
  }

  .tg-avatar-edit-badge:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tg-hero-name {
    margin: 0;
    color: #ffffff;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.3px;
    word-break: break-word;
  }

  .tg-hero-status {
    margin-top: 4px;
    color: #707579;
    font-size: 14px;
  }

  .tg-hero-status.online {
    color: #2ecc71;
  }

  .tg-actions-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 20px;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    flex-wrap: wrap;
  }

  .tg-action-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: transform 0.12s, opacity 0.15s;
    min-width: 56px;
    max-width: 80px;
    text-align: center;
    flex-shrink: 0;
  }

  .tg-action-btn:active {
    transform: scale(0.92);
  }

  .tg-action-circle {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #2b2b2b;
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: #3390ec;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .tg-action-btn:hover .tg-action-circle {
    background: #3390ec;
    color: #ffffff;
  }

  .tg-action-label {
    color: #aaaaaa;
    font-size: 12px;
    font-weight: 500;
  }

  .tg-section-header {
    color: #707579;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 18px 6px 8px;
    flex-shrink: 0;
  }

  .tg-card {
    background: #2b2b2b;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .tg-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    min-height: 52px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .tg-row:last-child {
    border-bottom: none;
  }

  .tg-row-clickable {
    cursor: pointer;
    transition: background 0.15s;
  }

  .tg-row-clickable:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .tg-row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tg-icon-link {
    background: rgba(51, 144, 236, 0.15);
    color: #3390ec;
  }

  .tg-icon-info {
    background: rgba(135, 116, 225, 0.15);
    color: #8774e1;
  }

  .tg-icon-hash {
    background: rgba(255, 255, 255, 0.08);
    color: #aaaaaa;
  }

  .tg-icon-bell {
    background: rgba(255, 160, 0, 0.15);
    color: #ffa000;
  }

  .tg-icon-shield {
    background: rgba(51, 144, 236, 0.15);
    color: #3390ec;
  }

  .tg-icon-key {
    background: rgba(250, 173, 20, 0.15);
    color: #faad14;
  }

  .tg-icon-download {
    background: rgba(0, 188, 212, 0.15);
    color: #00bcd4;
  }

  .tg-icon-check {
    background: rgba(46, 201, 113, 0.15);
    color: #2ecc71;
  }

  .tg-icon-invite {
    background: rgba(51, 144, 236, 0.15);
    color: #3390ec;
  }

  .tg-icon-phone {
    background: rgba(46, 201, 113, 0.15);
    color: #2ecc71;
  }

  .tg-icon-danger {
    background: rgba(229, 57, 53, 0.15);
    color: #ff595a;
  }

  .tg-row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tg-row-title {
    color: #ffffff;
    font-size: 15px;
    font-weight: 500;
    line-height: 1.35;
    word-break: break-word;
  }

  .tg-row-title.danger {
    color: #ff595a;
  }

  .tg-row-title.selectable {
    user-select: text;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tg-row-subtitle {
    color: #707579;
    font-size: 13px;
    line-height: 1.3;
    word-break: break-word;
  }

  .tg-link-text {
    color: #3390ec;
    word-break: break-all;
  }

  .tg-member-name-row .tg-row-title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tg-copy-btn {
    border: none;
    background: transparent;
    color: #707579;
    padding: 6px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, background 0.15s;
  }

  .tg-copy-btn:hover {
    color: #3390ec;
    background: rgba(51, 144, 236, 0.1);
  }

  .tg-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
  }

  .tg-badge-success {
    background: rgba(46, 201, 113, 0.18);
    color: #2ecc71;
  }

  .tg-badge-warning {
    background: rgba(255, 160, 0, 0.18);
    color: #ffa000;
  }

  .tg-badge-muted {
    background: rgba(255, 255, 255, 0.08);
    color: #aaaaaa;
  }

  .tg-btn-action {
    border: none;
    border-radius: 8px;
    padding: 7px 12px;
    background: #3390ec;
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .tg-btn-action:hover {
    background: #4ea4f6;
  }

  .tg-btn-action:active {
    transform: scale(0.96);
  }

  .tg-btn-action.danger {
    background: rgba(229, 57, 53, 0.18);
    color: #ff595a;
  }

  .tg-btn-action.danger:hover {
    background: rgba(229, 57, 53, 0.28);
  }

  .tg-switch {
    width: 44px;
    height: 24px;
    border-radius: 12px;
    background: #3d3d3d;
    position: relative;
    transition: background 0.22s ease;
    flex-shrink: 0;
  }

  .tg-switch.active {
    background: #3390ec;
  }

  .tg-switch-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #ffffff;
    position: absolute;
    top: 2px;
    left: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: transform 0.22s cubic-bezier(0.3, 0, 0.1, 1);
  }

  .tg-switch.active .tg-switch-thumb {
    transform: translateX(20px);
  }

  .tg-fingerprint-emojis {
    font-size: 18px;
    letter-spacing: 4px;
    margin-top: 2px;
  }

  .tg-search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #2b2b2b;
    border-radius: 10px;
    padding: 8px 12px;
    margin-bottom: 8px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    color: #707579;
  }

  .tg-search-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 14px;
    outline: none;
  }

  .tg-search-input::placeholder {
    color: #707579;
  }

  .tg-member-row {
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
  }

  .tg-member-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tg-role-badge {
    font-size: 11px;
    color: #3390ec;
    background: rgba(51, 144, 236, 0.12);
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 500;
  }

  .tg-role-badge.admin {
    color: #8774e1;
    background: rgba(135, 116, 225, 0.12);
  }

  .tg-chevron {
    color: #707579;
    flex-shrink: 0;
  }

  .tg-danger-row:hover {
    background: rgba(229, 57, 53, 0.08);
  }

  .tg-toast {
    position: absolute;
    bottom: calc(20px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 16px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 50;
    pointer-events: none;
  }

  .tg-toast svg {
    color: #2ecc71;
  }

  .tg-icon-lock {
    background: rgba(156, 39, 176, 0.15);
    color: #ba68c8;
  }

  .tg-icon-save {
    background: rgba(255, 255, 255, 0.08);
    color: #aaaaaa;
  }

  .tg-caption {
    font-size: 13px;
    color: #707579;
    margin: 8px 14px 0;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .tg-caption-tag {
    margin-top: 4px;
    color: #555555;
    font-size: 11px;
  }

  .tg-warn-text {
    color: #ffa000;
  }

  .tg-segmented {
    display: flex;
    gap: 8px;
    background: #2b2b2b;
    border-radius: 12px;
    padding: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    flex-shrink: 0;
  }

  .tg-seg-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 8px 4px;
    border: none;
    background: transparent;
    color: #707579;
    border-radius: 9px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .tg-seg-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.04);
  }

  .tg-seg-btn.active {
    background: #3390ec;
    color: #ffffff;
  }

  .tg-seg-title {
    font-size: 12px;
    font-weight: 600;
  }

  .tg-seg-sub {
    font-size: 10px;
    opacity: 0.7;
    text-transform: uppercase;
  }

  .tg-input-row {
    padding-right: 8px;
  }

  .tg-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 14px;
    font-family: inherit;
  }

  .tg-input::placeholder {
    color: #707579;
  }

  .tg-eye-btn {
    border: none;
    background: transparent;
    color: #707579;
    padding: 6px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: color 0.15s;
    flex-shrink: 0;
  }

  .tg-eye-btn:hover {
    color: #ffffff;
  }

  .tg-badge-soon {
    background: rgba(255, 255, 255, 0.06);
    color: #707579;
  }

  .tg-disabled-row {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .tg-member-more-container {
    position: relative;
    display: flex;
    align-items: center;
  }

  .tg-btn-member-more {
    background: none;
    border: none;
    color: #8e8e93;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .tg-btn-member-more:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
  }

  .tg-card.tg-members-card {
    overflow: visible;
  }

  .tg-member-dropdown {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 50;
    min-width: 180px;
    margin-top: 4px;
  }

  .tg-member-dropdown.bottom-up {
    top: auto;
    bottom: 100%;
    margin-top: 0;
    margin-bottom: 4px;
  }

  .tg-load-more-members {
    width: 100%;
    padding: 12px;
    background: none;
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    color: #5288c1;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
    transition: background 0.15s;
  }

  .tg-load-more-members:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .tg-load-more-members:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .tg-requests-row {
    cursor: pointer;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .tg-icon-requests {
    background: rgba(82, 136, 193, 0.15);
    color: #5288c1;
  }

  .tg-requests-title {
    font-weight: 600;
  }

  .tg-requests-badge {
    background: #5288c1;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 10px;
    margin-left: auto;
  }

  .tg-menu-badge {
    background: #5288c1;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 10px;
    margin-left: auto;
  }

  .tg-icon-pin {
    background: rgba(255, 179, 0, 0.15);
    color: #ffb300;
  }

  .tg-content-transition {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .tg-invite-row {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .tg-invite-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }
</style>
