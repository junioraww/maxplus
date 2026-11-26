<script>
  import { fly, fade, scale } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import {
    createEventDispatcher,
    onMount,
    onDestroy
  } from "svelte";
  import { get } from "svelte/store";
  import { registerBackHandler } from "$lib/utils/backButton";
  import ConfirmModal from "$components/main/ConfirmModal.svelte";
  import Signature from "$components/main/Signature.svelte";
  import Avatar from "$components/main/Avatar.svelte";
  import GroupAdminModal from "$components/chats/GroupAdminModal.svelte";
  import GroupSharedMedia from "$components/chats/GroupSharedMedia.svelte";
  import GroupJoinRequestsModal from "$components/chats/GroupJoinRequestsModal.svelte";

  import { getContact } from "$lib/utils/caching";
  import { getContactDisplayName } from "$lib/stores/contacts";
  import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";
  import { getSafeAvatarMediaUrl } from "$lib/services/uplink";
  import { disableMaxPlusAvatars } from "$lib/stores/avatarSettings";
  import { formatMs } from "$lib/utils/time";
  import { dict } from "$lib/crypto/text-codec";
  import { isChatMuted } from "$lib/utils/notifications";
  import { CallService } from "$lib/services/CallService";
  import { getStoryPreviewForUser, openStoriesViewer } from "$lib/stores/stories";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings";
  import Switch from "$components/common/Switch.svelte";
  import { switchEnc } from "$components/ChatWindow/e2e";
  import { getChatSettings, getChat } from "$lib/stores/messages";
  import { openScreen } from "$lib/services/layerManager";
  import Session, {
    openChat as _openChat,
    openProfile,
    closeChat as _closeChat,
    openAvatarGallery as _openAvatarGallery,
    openSafeAvatarPicker as _openSafeAvatarPicker,
  } from "$lib/stores/session";
  import API, {
    currentUser,
    currentUserDetails,
    currentPresence,
    currentRealContacts,
    currentRealChats,
  } from "$lib/stores/api";

  let showReportLeaveConfirm = false;

  function handleProfileBack() {
    if (showReportLeaveConfirm) { showReportLeaveConfirm = false; return false; }
    if (showDeleteConfirm) { showDeleteConfirm = false; return false; }
    if (showPurgeConfirm) { showPurgeConfirm = false; return false; }
    if (showRemoveMemberConfirm) { showRemoveMemberConfirm = false; return false; }
    if (showAdminModal) { showAdminModal = false; return false; }
    if (showJoinRequestsModal) { showJoinRequestsModal = false; return false; }
    if (showMenu) { showMenu = false; return false; }
    if (selectedMemberMenuId) { selectedMemberMenuId = null; return false; }
    if (subview !== "main") {
      subview = "main";
      return false;
    }
    if (profileHistory.length > 0) {
      goBack();
      return false;
    }
    goBack();
    return false;
  }

  let unregisterBack = null;

  $: if (setBackHandler) {
    setBackHandler(handleProfileBack);
  }

  onMount(() => {
    if (!setBackHandler) {
      unregisterBack = registerBackHandler(handleProfileBack);
    }
  });

  onDestroy(() => {
    if (typeof unregisterBack === "function") {
      unregisterBack();
      unregisterBack = null;
    }
  });

  let propChatId = null;
  let propUserId = null;
  export { propChatId as chatId, propUserId as userId };
  export let view = null;
  export let history = [];
  export let close = null;
  export let onClose = null;
  export let setBackHandler = null;

  const dispatch = createEventDispatcher();

  let fetchedChat = null;
  let fetchingChatId = null;
  let currentNavChatId = null;
  let currentNavUserId = null;
  let profileHistory = Array.isArray(history) ? [...history] : [];

  $: if (propChatId != null) currentNavChatId = propChatId;
  $: if (propUserId != null) currentNavUserId = propUserId;

  $: chatId = (() => {
    const cid = currentNavChatId ?? propChatId;
    if (cid != null) return cid;
    const uid = currentNavUserId ?? propUserId;
    if (uid != null && $currentUser != null) {
      try {
        const xorId = Number(BigInt(uid) ^ BigInt($currentUser));
        return xorId;
      } catch (e) {}
    }
    return undefined;
  })();

  $: if (chatId != null && fetchingChatId !== chatId) {
    const existing = getChat(chatId).getInfo();
    if (!existing) {
      fetchingChatId = chatId;
      $API.getChat(chatId).then(res => {
        if (res?.chats?.length) {
          fetchedChat = res.chats[0];
          getChat(chatId).chatInfo.set(res.chats[0]);
        }
      }).catch(() => {});
    }
  }

  $: chatStore = chatId != null ? getChat(chatId).chatInfo : null;
  $: chat = (chatStore && $chatStore) || fetchedChat;

  $: userId = (() => {
    const uid = currentNavUserId ?? propUserId;
    if (uid != null) return uid;
    if (chat?.type === "DIALOG" && chat?.participants) {
      const other = Object.keys(chat.participants).find(id => String(id) !== String($currentUser));
      if (other) return Number(other);
    }
    const cid = chatId ?? propChatId ?? currentNavChatId;
    if (cid && $currentUser && (chat?.type === "DIALOG" || (!chat && !isChannel && Number(cid) > 0))) {
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
  $: isChannelOwner = isChannel && (String(chat?.owner) === String($currentUser) || Number(chat?.owner) === Number($currentUser));
  $: channelAdminPerms = (() => {
    if (!isChannel || !chat?.participants || !$currentUser) return 0;
    const p = chat.participants[$currentUser] || chat.participants[String($currentUser)] || chat.participants[Number($currentUser)];
    if (!p) return 0;
    if (typeof p.adminPermissions === 'number') return p.adminPermissions;
    if (typeof p.permissions === 'number') return p.permissions;
    if (Array.isArray(p.permissions)) {
      let mask = 0;
      for (const perm of p.permissions) {
        if (perm === 'CHANGE_CHAT_INFO') mask |= 8;
        else if (perm === 'POST_MESSAGE') mask |= 256;
        else if (perm === 'EDIT_MESSAGE') mask |= 512;
        else if (perm === 'DELETE_MESSAGE') mask |= 1024;
        else if (perm === 'PIN_MESSAGE') mask |= 16;
        else if (perm === 'ADD_REMOVE_MEMBER') mask |= 2;
        else if (perm === 'VIEW_STATS') mask |= 2048;
        else if (perm === 'ADD_ADMIN') mask |= 4;
      }
      return mask;
    }
    return 0;
  })();
  $: isChannelAdmin = isChannel && (
    isChannelOwner ||
    channelAdminPerms !== 0 ||
    Boolean(chat?.admins?.some(a => String(a) === String($currentUser)))
  );
  $: hasSettings = Boolean(chat && (!isChannel || isChannelAdmin));
  $: isBot = Boolean(
    $contact?.options?.includes("BOT") ||
    $contact?.bot ||
    $contact?.type === "BOT" ||
    chat?.isBot
  );
  $: isDeletedOrBlocked = Boolean(
    $contact?.status === "REMOVED" ||
    $contact?.accountStatus === "DELETED" ||
    $contact?.blocked
  );
  $: canCallUser = Boolean(
    userId &&
    (!chat || chat.type === "DIALOG") &&
    Number(userId) !== Number($currentUser) &&
    !isBot &&
    !isDeletedOrBlocked
  );

  let subview = "main";
  let didInitialSelect = false;

  $: if (view && !didInitialSelect) {
    if (view === "settings" && hasSettings) {
      subview = "channel_settings";
      didInitialSelect = true;
    } else if (view === "media") {
      subview = "media";
      didInitialSelect = true;
    } else {
      subview = "main";
      didInitialSelect = true;
    }
  }

  let showMenu = false;
  let showDeleteConfirm = false;
  let memberSearch = "";

  $: isGroupChat = chat?.type === "CHAT";
  $: isGroupAdmin = isGroupChat && (chat?.admins?.includes(Number($currentUser)) || chat?.admins?.includes($currentUser) || Number(chat?.owner) === Number($currentUser));
  $: isGroupOwner = isGroupChat && Number(chat?.owner) === Number($currentUser);

  let groupMembers = [];
  let groupMembersMarker = null;
  let groupMembersLoading = false;
  let groupMembersEnd = false;
  let memberSearchResults = [];
  let isSearchingMembers = false;
  let searchDebounceTimer;

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
  $: if (chatId && (chat?.type === "CHAT" || isChannel) && loadedGroupChatId !== chatId) {
    loadedGroupChatId = chatId;
    loadInitialMembers();
  }

  $: {
    clearTimeout(searchDebounceTimer);
    if (!memberSearch.trim()) {
      memberSearchResults = [];
      isSearchingMembers = false;
    } else if (chat?.type === "CHAT" || isChannel) {
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

  let cachedTitle = "";
  let lastProfileChatId = null;
  $: if (chatId !== lastProfileChatId) {
    lastProfileChatId = chatId;
    cachedTitle = "";
  }
  $: title = (() => {
    if (isChannel || isGroupChat) {
      return chat?.title || chat?.name || cachedTitle || "Без названия";
    }
    return ($contact && getContactDisplayName($contact)) || chat?.title || chat?.name || cachedTitle || ($contact ? "Пользователь" : "");
  })();
  $: if (chat?.title && (isChannel || isGroupChat)) {
    cachedTitle = chat.title;
  }
  $: avatar = chat?.baseRawUrl || chat?.baseUrl || chat?.baseRawIconUrl || chat?.baseIconUrl || chat?.iconUrl || $contact?.baseRawUrl || $contact?.baseUrl || null;
  $: chatLink = chat?.link;

  let editTitle = "";
  let editDescription = "";

  async function handleEditClick() {
    if (isChannel || isGroupChat) {
      const mod = await import("$components/ChatEditScreen.svelte");
      openScreen(
        mod.default || mod,
        {
          chat,
          onAvatarClick: openAvatarGallery,
          onUpdated: (updated) => {
            chat = updated;
          },
          onDeleted: () => {
            closeModal();
          },
          onLeft: () => {
            closeModal();
          },
        },
        { canSwipe: true }
      );
    } else if (isOwnProfile) {
      const mod = await import("../routes/settings/profile/+page.svelte");
      openScreen(mod.default || mod, {}, { canSwipe: true });
    }
  }

  async function saveChatProfile() {
    if (!chat?.id) return;
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) {
      showToast("Введите название");
      return;
    }
    try {
      chat.title = trimmedTitle;
      chat.description = editDescription.trim() || undefined;
      await $API.updateChatProfile(chat);
      showToast("Изменения сохранены");
      subview = "main";
    } catch (e) {
      showToast("Не удалось сохранить");
    }
  }

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
  $: ownPhotoId = isOwnProfile ? ($currentUserDetails?.photoId || null) : ($contact?.photoId || null);
  $: canDeleteOwnAvatar = Boolean(isOwnProfile && (ownPhotoId || avatar));

  let isUploadingAvatar = false;
  let isDeletingAvatar = false;
  let avatarWrapEl;

  $: targetProfileEntityId = Number((chat?.id && chat.id !== 0 ? chat.id : null) ?? (userId || $contact?.id || (isOwnProfile ? ($currentUserDetails?.id || $currentUser) : 0)));
  $: profileSafeAvatarUid = !$disableMaxPlusAvatars && targetProfileEntityId ? ($safeAvatarMapStore.get(Number(targetProfileEntityId)) || $safeAvatarMapStore.get(Math.abs(Number(targetProfileEntityId))) || $safeAvatarMapStore.get(String(targetProfileEntityId)) || (isOwnProfile ? ($safeAvatarMapStore.get(Number($currentUserDetails?.id)) || $safeAvatarMapStore.get(Number($currentUser))) : null) || null) : null;
  $: profileStoryPreview = targetProfileEntityId ? getStoryPreviewForUser(targetProfileEntityId) : null;
  $: hasProfileStories = Boolean(profileStoryPreview && (profileStoryPreview.totalCount || 0) > 0);

  function openAvatarGallery(e) {
    const highResSafeUrl = profileSafeAvatarUid ? getSafeAvatarMediaUrl(profileSafeAvatarUid) : null;
    const galleryUrl = highResSafeUrl || avatar;
    if (galleryUrl || (userId && (!chat || chat.type === "DIALOG"))) {
      const targetEl = avatarWrapEl || e?.currentTarget;
      const rect = targetEl?.getBoundingClientRect?.();
      _openAvatarGallery({
        initialUrl: avatar || galleryUrl,
        initialPhotoId: ownPhotoId,
        fallbackUrl: avatar,
        targetEntityId: (targetProfileEntityId && targetProfileEntityId !== 0 ? targetProfileEntityId : (isOwnProfile ? Number($currentUserDetails?.id || $currentUser) : (userId || $contact?.id || null))),
        safeAvatarUid: profileSafeAvatarUid,
        userId: isOwnProfile ? Number($currentUserDetails?.id || $currentUser) : (!chat || chat.type === "DIALOG" ? ($contact?.id ?? userId) : null),
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

  function formatPhone(phone) {
    if (!phone) return "";
    const s = String(phone).trim();
    return s.startsWith("+") ? s : `+${s}`;
  }

  $: infoFields = [
    info(chat?.description || $contact?.description, "about", "Описание", chat?.description || $contact?.description),
    info(chat?.phone || $contact?.phone, "phone", "Телефон", formatPhone(chat?.phone || $contact?.phone)),
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

  async function triggerSwitchEnc() {
    if (!chat || !chatSettings) return;
    const wasEnc = Boolean(
      $chatSettings?.session?.shared_secret ||
        $chatSettings?.session?.fingerprint ||
        $chatSettings?.keys?.current
    );
    const ok = await switchEnc(chat, chatSettings, null);
    if (ok) {
      showToast(wasEnc ? "Шифрование отключено" : "Запрос на шифрование отправлен");
    }
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
    if (action === "edit")     return handleEditClick();
    if (action === "mute")     return toggleMute();
    if (action === "copy")     return copyLink();
    if (action === "settings") return handleEditClick();
    if (action === "delete")   return showDeleteConfirm = true;
    if (action === "quit")     return leaveChat();
    if (action === "invite")   return refreshInvite();
  }

  function closeModal() {
    dispatch("close");
    if (close) close();
    if (onClose) onClose();
  }
  const closeChat = () => chat?.id != null && _closeChat(chat.id);

  function handleWindowClick(e) {
    if (showMenu && !e.target.closest(".profile-action-tile-wrap") && !e.target.closest(".profile-menu-container")) showMenu = false;
    if (selectedMemberMenuId && !e.target.closest(".profile-member-more-container")) selectedMemberMenuId = null;
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

  function formatSubscribersCount(count) {
    const num = Math.max(0, Number(count) || 0);
    const mod10 = num % 10;
    const mod100 = num % 100;
    if (mod100 >= 11 && mod100 <= 19) return `${num} подписчиков`;
    if (mod10 === 1) return `${num} подписчик`;
    if (mod10 >= 2 && mod10 <= 4) return `${num} подписчика`;
    return `${num} подписчиков`;
  }

  function formatOnlineCount(count) {
    if (count <= 0) return "";
    return `${count} в сети`;
  }

  function getMemberName(memberItem) {
    if (memberItem?.contact?.names?.[0]?.name) return memberItem.contact.names[0].name;
    if (memberItem?.contact?.name) return memberItem.contact.name;
    if (memberItem?.contact?.names?.[0]?.firstName) {
      const n = memberItem.contact.names[0];
      return [n.firstName, n.lastName].filter(Boolean).join(" ");
    }
    const id = memberItem?.contact?.id || memberItem?.userId || memberItem?.id || memberItem;
    if (id) {
      if (Number(id) === Number($currentUser)) {
        const selfName = $currentUserDetails?.names?.[0]?.name || $currentUserDetails?.name;
        if (selfName) return selfName;
      }
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
    if (!chatId || (chat?.type !== "CHAT" && !isChannel)) return;
    groupMembersLoading = true;
    try {
      const res = await $API.fetchGroupMembers(chatId, null, 50);
      groupMembers = res?.members || [];
      groupMembersMarker = res?.marker || null;
      groupMembersEnd = !res?.marker || (res?.members?.length || 0) < 50;
      if (isGroupAdmin || (isChannel && isChannelAdmin)) {
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
    if (!chatId || (!isGroupAdmin && !(isChannel && isChannelAdmin))) return;
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
    if (Number(mId) === Number($currentUser)) return false;
    if (Number(mId) === Number(chat?.owner)) return false;
    if (isChannel) {
      if (!isChannelAdmin) return false;
      if (isChannelOwner) return true;
      const isAdmin = Boolean(chat?.admins?.some(a => Number(a) === Number(mId)));
      return !isAdmin && ((channelAdminPerms & 4) !== 0 || (channelAdminPerms & 2) !== 0);
    }
    if (!isGroupAdmin) return false;
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
      showToast(isChannel ? "Подписчик удален" : "Участник удален");
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
      if (isChannel) {
        await $API.revokeChannelAdmin(chatId, memberId);
      } else {
        await $API.revokeGroupAdmin(chatId, memberId);
      }
      if (chat?.admins) {
        chat.admins = chat.admins.filter(id => Number(id) !== Number(memberId));
      }
      groupMembers = groupMembers.map(m => {
        const id = m.contact?.id || m.userId || m.id || m;
        if (Number(id) === Number(memberId)) {
          return { ...m, permissions: isChannel ? 0 : [], alias: null };
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
        return { ...m, permissions: isChannel ? 0 : [], alias: null };
      }
      return m;
    });
    showAdminModal = false;
    adminModalMember = null;
    showToast("Права администратора сняты");
  }

  function onOwnershipTransferred(event) {
    const { newOwnerId } = event.detail;
    if (chat && newOwnerId) {
      chat.owner = Number(newOwnerId);
      chat = { ...chat };
    }
    showAdminModal = false;
    adminModalMember = null;
    showToast("Права владельца переданы");
  }

  async function openUserPickerForMembers(pickingAdmin = false) {
    const mod = await import("$components/chats/UserSelectScreen.svelte");
    const existingIds = new Set((groupMembers || []).map((m) => m.id).filter(Boolean));
    openScreen(
      mod.default || mod,
      pickingAdmin
        ? {
            title: "Добавить администратора",
            multiSelect: false,
            autoAddToChat: false,
            onSelect: (picked) => {
              if (picked?.id) {
                openAdminModal({ contact: { id: picked.id }, userId: picked.id });
              }
            }
          }
        : {
            title: isChannel ? "Добавить подписчиков" : "Пригласить участников",
            confirmLabel: "Добавить",
            multiSelect: true,
            chat,
            chatId,
            isChannel,
            existingMemberIds: existingIds,
            autoAddToChat: true,
            onConfirm: (userIds) => {
              showToast(
                isChannel
                  ? `Добавлено подписчиков: ${userIds.length}`
                  : `Добавлено участников: ${userIds.length}`
              );
              loadInitialMembers();
            }
          },
      { canSwipe: true }
    );
  }

  $: channelCommentsEnabled = Boolean(
    chat?.options?.COMMENTS ?? chat?.options?.comments ?? chat?.comments
  );
  $: channelSignaturesEnabled = Boolean(
    chat?.options?.SIGNATURES ?? chat?.options?.signatures ?? chat?.signatures
  );
  $: channelJoinRequestEnabled = Boolean(
    chat?.options?.JOIN_REQUEST ?? chat?.options?.joinRequest ?? chat?.joinRequest
  );
  $: channelAccessType = (chat?.access === "PUBLIC" || (chat?.link && !chat.link.includes("join/"))) ? "PUBLIC" : "PRIVATE";

  let channelLinkInput = "";
  let isEditingChannelLink = false;

  function initChannelLinkInput() {
    channelLinkInput = (chat?.link && !chat.link.includes("join/"))
      ? chat.link.replace(/^https?:\/\/max\.ru\//, "").replace(/^@/, "").trim()
      : "";
  }

  $: if (chat && !isEditingChannelLink) {
    initChannelLinkInput();
  }

  $: canEditChatSettings = Boolean(isChannelAdmin || isGroupAdmin || isGroupOwner);

  function normalizeChannelSlug(value) {
    return String(value || "")
      .trim()
      .replace(/^(https?:\/\/)?(www\.)?max\.ru\//i, "")
      .replace(/^@/, "")
      .trim();
  }

  function extractLinkError(err, fallback) {
    const raw = typeof err === "string" ? err : (err?.localizedMessage || err?.message || "");
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.localizedMessage || parsed?.message || parsed?.title || fallback;
    } catch {
      return raw;
    }
  }

  async function setChannelAccessType(type) {
    if (!chatId || !canEditChatSettings) return;
    try {
      const slug = normalizeChannelSlug(channelLinkInput);
      const link = type === "PUBLIC" ? (slug || undefined) : undefined;
      const res = await $API.setChannelAccess(chatId, type, link);
      if (chat) {
        chat.access = type;
        const newL = res?.chat?.link || res?.link;
        if (newL) {
          chat.link = newL;
          chatLink = newL;
        }
        chat = { ...chat };
      }
      showToast(type === "PUBLIC" ? (isChannel ? "Канал стал публичным" : "Чат стал публичным") : (isChannel ? "Канал стал частным" : "Чат стал частным"));
    } catch (e) {
      showToast(extractLinkError(e, "Ошибка смены типа"));
    }
  }

  async function savePublicChannelLink() {
    const raw = normalizeChannelSlug(channelLinkInput);
    if (!raw || !chatId) return;
    const currentSlug = (chat?.link && !chat.link.includes("join/")) ? normalizeChannelSlug(chat.link) : "";
    if (raw === currentSlug && channelAccessType === "PUBLIC") {
      isEditingChannelLink = false;
      showToast("Ссылка сохранена");
      return;
    }
    try {
      const res = await $API.setChannelAccess(chatId, "PUBLIC", raw);
      if (chat) {
        chat.access = "PUBLIC";
        chat.link = res?.chat?.link || res?.link || `https://max.ru/${raw}`;
        chatLink = chat.link;
        chat = { ...chat };
      }
      isEditingChannelLink = false;
      showToast("Ссылка сохранена");
    } catch (e) {
      showToast(extractLinkError(e, "Ошибка сохранения ссылки"));
    }
  }

  async function toggleChannelComments() {
    if (!chatId || !canEditChatSettings) return;
    const next = !channelCommentsEnabled;
    try {
      await $API.setChannelOptions(chatId, {
        comments: next,
        signatures: channelSignaturesEnabled,
        joinRequest: channelJoinRequestEnabled,
      });
      if (!chat.options) chat.options = {};
      chat.options.COMMENTS = next;
      chat.options.comments = next;
      chat = { ...chat };
      showToast(next ? "Комментарии включены" : "Комментарии отключены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }

  async function toggleChannelSignatures() {
    if (!chatId || !canEditChatSettings) return;
    const next = !channelSignaturesEnabled;
    try {
      await $API.setChannelOptions(chatId, {
        comments: channelCommentsEnabled,
        signatures: next,
        joinRequest: channelJoinRequestEnabled,
      });
      if (!chat.options) chat.options = {};
      chat.options.SIGNATURES = next;
      chat.options.signatures = next;
      chat = { ...chat };
      showToast(next ? "Подписи сообщений включены" : "Подписи сообщений отключены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }

  async function toggleChannelJoinRequest() {
    if (!chatId || !canEditChatSettings) return;
    const next = !channelJoinRequestEnabled;
    try {
      await $API.setChannelOptions(chatId, {
        comments: channelCommentsEnabled,
        signatures: channelSignaturesEnabled,
        joinRequest: next,
      });
      if (!chat.options) chat.options = {};
      chat.options.JOIN_REQUEST = next;
      chat.options.joinRequest = next;
      chat = { ...chat };
      showToast(next ? "Заявки на вступление включены" : "Заявки на вступление выключены");
    } catch (e) {
      showToast("Ошибка сохранения настроек");
    }
  }

  async function revokeChannelLink() {
    if (!chatId || !canEditChatSettings) return;
    try {
      const res = await $API.revokeChannelInviteLink(chatId);
      const updatedLink = res?.chat?.link || res?.link;
      if (updatedLink && chat) {
        chat.link = updatedLink;
        chatLink = updatedLink;
        chat = { ...chat };
      }
      showToast("Ссылка приглашения обновлена");
    } catch (e) {
      showToast("Ошибка при обновлении ссылки");
    }
  }

  $: channelAdmins = (() => {
    if (!isChannel || !chat) return [];
    const list = [];
    const ownerId = Number(chat.owner);
    if (ownerId) {
      list.push({
        id: ownerId,
        isOwner: true,
        alias: "Владелец",
        contact: { id: ownerId }
      });
    }
    const adminIds = new Set(chat.admins ? chat.admins.map(Number) : []);
    if (chat.participants) {
      Object.keys(chat.participants).forEach(uid => {
        const p = chat.participants[uid];
        const numId = Number(uid);
        if (numId !== ownerId && (p.role === 'ADMIN' || p.adminPermissions || (Array.isArray(p.permissions) && p.permissions.length > 0) || adminIds.has(numId))) {
          list.push({
            id: numId,
            isOwner: false,
            alias: p.alias || "Администратор",
            permissions: p.adminPermissions || p.permissions,
            contact: { id: numId }
          });
          adminIds.delete(numId);
        }
      });
    }
    adminIds.forEach(numId => {
      if (numId !== ownerId && !list.some(a => a.id === numId)) {
        list.push({
          id: numId,
          isOwner: false,
          alias: "Администратор",
          contact: { id: numId }
        });
      }
    });
    return list;
  })();

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
    try {
      await $API.deleteChatForAll(chat);
    } catch (e) {
      showToast("Не удалось удалить чат");
    }
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
    if (!memberId) return;
    openProfile({ userId: memberId, stack: true });
  }

  async function openSharedMediaScreen() {
    if (!chat) return;
    const mod = await import("$components/chats/SharedMediaScreen.svelte");
    openScreen(mod.default || mod, { chat }, { canSwipe: true });
  }

  async function openAdvancedSettings() {
    const mod = await import("$components/ChatWindow/AdvancedSettingsScreen.svelte");
    openScreen(mod.default || mod, { chat, userId }, { canSwipe: true });
  }

  function handleProfileSearch() {
    closeModal();
    if (chat?.id) {
      _openChat(chat.id);
      setTimeout(() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("open-chat-search", { detail: { chatId: chat.id } }));
        }
      }, 100);
    }
  }

  async function handleReportAndLeave() {
    showReportLeaveConfirm = false;
    try {
      if (chat?.id) {
        await $API.leaveGroup(chat.id);
      }
    } catch (e) {}
    closeModal();
    showToast("Вы вышли из группы");
  }

  function goBack() {
    if (subview === "chat_link_settings") {
      subview = "channel_settings";
      return;
    }
    if (subview !== "main") {
      subview = "main";
      return;
    }
    if (profileHistory.length > 0) {
      const prev = profileHistory.pop();
      currentNavChatId = prev.chatId;
      currentNavUserId = prev.userId;
      if (prev.view) subview = prev.view;
    } else {
      closeModal();
    }
  }
</script>

<svelte:window
  on:click={handleWindowClick}
/>

<div class="profile-window">
  <!-- Top Navigation Toolbar (56px) -->
  <header class="profile-toolbar">
    <button type="button" class="profile-icon-button" on:click={goBack} aria-label="Назад">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
    </button>

    <div class="profile-toolbar-title">
      {#if subview === "media"}
        Вложения
      {:else if subview === "channel_settings"}
        {isChannel ? "Редактировать" : ""}
      {:else if subview === "chat_link_settings"}
        {isChannel ? "Тип канала" : "Тип чата"}
      {/if}
    </div>

    <div class="profile-toolbar-right">
      {#if subview === "main"}
        {#if isChannelAdmin || isGroupAdmin || isGroupOwner || isOwnProfile}
          <button
            type="button"
            class="profile-icon-button"
            on:click={handleEditClick}
            aria-label="Редактировать"
            title="Редактировать"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
        {/if}
      {/if}
    </div>
  </header>

  <!-- Body Container -->
  <div class="profile-body-stage">
    {#if subview === "media"}
    <div class="profile-subview-content" in:fly={{ x: 30, duration: 200 }} out:fly={{ x: 30, duration: 150 }}>
      {#if chat}
        <GroupSharedMedia {chat} />
      {/if}
    </div>

  {:else if subview === "channel_settings"}
    <div class="profile-subview-content" in:fly={{ x: 30, duration: 200 }} out:fly={{ x: 30, duration: 150 }}>
      <div class="profile-cards-list">
        <!-- Avatar preview with blue corner camera badge (matching MAX Screenshot 2) -->
        <div class="profile-edit-avatar-wrap" on:click={openAvatarGallery}>
          <Avatar
            chat={chat}
            title={editTitle || title}
            size={96}
            allowStories={false}
          />
          <div class="profile-avatar-camera-overlay">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </div>
        </div>

        <!-- Separate Name card with clear button (matching MAX Screenshot 2) -->
        <div class="profile-card">
          <div class="profile-field-name-row">
            <input
              type="text"
              class="profile-field-edit-input"
              bind:value={editTitle}
              placeholder={isChannel ? "Название канала" : "Название чата"}
            />
            {#if editTitle}
              <button
                type="button"
                class="profile-field-clear-btn"
                on:click={() => (editTitle = "")}
                aria-label="Очистить"
              >
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/close.svg'); mask-image: url('/icons/close.svg'); width: 16px; height: 16px;"></span>
              </button>
            {/if}
          </div>
        </div>

        <!-- Separate Description card (matching MAX Screenshot 2) -->
        <div class="profile-card">
          <div class="profile-field-edit-group">
            <textarea
              class="profile-field-edit-textarea"
              bind:value={editDescription}
              placeholder={isChannel ? "О канале" : "О чате"}
              rows="3"
            ></textarea>
          </div>
        </div>

        <!-- Chat/Channel Type & Invite Link subscreen entry (d23.java) -->
        <div class="profile-card">
          <div class="profile-item-row" on:click={() => (subview = "chat_link_settings")}>
            <div class="profile-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="profile-item-content">
              <div class="profile-item-title">{isChannel ? "Тип канала и ссылка" : "Тип чата и ссылка"}</div>
            </div>
            <span class="profile-item-trailing">{channelAccessType === "PUBLIC" ? "Публичный" : "Частный"}</span>
            <span class="mask-icon profile-item-chevron" style="-webkit-mask-image: url('/icons/arrow.svg'); mask-image: url('/icons/arrow.svg'); width: 14px; height: 14px;"></span>
          </div>
        </div>

        {#if isChannel}
          <!-- Channel Options (ep6.java:104-127) -->
          <div class="profile-card">
            <div class="profile-item-row" on:click={toggleChannelComments}>
              <div class="profile-item-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/chats.svg'); mask-image: url('/icons/chats.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title">Комментарии</div>
                <div class="profile-item-subtitle">Обсуждение публикаций</div>
              </div>
              <Switch checked={channelCommentsEnabled} ariaLabel="Комментарии" />
            </div>

            <div class="profile-item-row" on:click={toggleChannelSignatures}>
              <div class="profile-item-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/edit.svg'); mask-image: url('/icons/edit.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title">Подписи сообщений</div>
                <div class="profile-item-subtitle">Имя автора в каждом посте</div>
              </div>
              <Switch checked={channelSignaturesEnabled} ariaLabel="Подписи сообщений" />
            </div>
          </div>
        {/if}

        <!-- Admins management -->
        {#if isChannel}
          <div class="profile-card-caption">Администраторы · {channelAdmins.length}</div>
          <div class="profile-card">
            {#if isChannelOwner || (channelAdminPerms & 4) !== 0}
              <div class="profile-item-row" on:click={() => openUserPickerForMembers(true)}>
                <div class="profile-item-icon accent">
                  <span class="mask-icon" style="-webkit-mask-image: url('/icons/user-plus.svg'); mask-image: url('/icons/user-plus.svg'); width: 22px; height: 22px;"></span>
                </div>
                <div class="profile-item-content">
                  <div class="profile-item-title accent">Добавить администратора</div>
                </div>
              </div>
            {/if}

            {#each channelAdmins as adminItem}
              <div class="profile-item-row" on:click={() => openAdminModal(adminItem)}>
                <Avatar
                  contactId={adminItem.id}
                  size={40}
                  src={adminItem?.contact?.baseUrl || adminItem?.contact?.baseRawUrl}
                  title={getMemberName(adminItem)}
                />
                <div class="profile-item-content">
                  <div class="profile-name-badge-row">
                    <span class="profile-item-title">{getMemberName(adminItem)}</span>
                    <span class="profile-role-pill" class:admin={!adminItem.isOwner}>{adminItem.alias}</span>
                  </div>
                  <div class="profile-item-subtitle">
                    <Signature contactId={adminItem.id} />
                  </div>
                </div>
                <span class="mask-icon profile-item-chevron" style="-webkit-mask-image: url('/icons/arrow.svg'); mask-image: url('/icons/arrow.svg'); width: 14px; height: 14px;"></span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Actions card (matching MAX Screenshot 2 & ep6.java:202-206) -->
        <div class="profile-card">
          <div class="profile-item-row" on:click={() => { purgeForAll = false; showPurgeConfirm = true; }}>
            <div class="profile-item-icon">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="profile-item-content">
              <div class="profile-item-title">Стереть переписку</div>
            </div>
          </div>

          <div class="profile-item-row danger" on:click={() => (isChannel ? quitChannel() : leaveChat())}>
            <div class="profile-item-icon danger">
              <span class="mask-icon" style="-webkit-mask-image: url('/icons/forward.svg'); mask-image: url('/icons/forward.svg'); width: 22px; height: 22px;"></span>
            </div>
            <div class="profile-item-content">
              <div class="profile-item-title danger">{isChannel ? "Покинуть канал" : "Выйти из чата"}</div>
            </div>
          </div>
        </div>

        <!-- Delete Chat/Channel card (matching MAX Screenshot 2) -->
        {#if (isChannel && isChannelOwner) || (isGroupChat && isGroupOwner)}
          <div class="profile-card">
            <div class="profile-item-row danger" on:click={() => (showDeleteConfirm = true)}>
              <div class="profile-item-icon danger">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title danger">{isChannel ? "Удалить канал" : "Удалить чат"}</div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

  {:else if subview === "chat_link_settings"}
    <div class="profile-subview-content" in:fly={{ x: 30, duration: 200 }} out:fly={{ x: 30, duration: 150 }}>
      <div class="profile-cards-list">
        <div class="profile-card-caption">{isChannel ? "Тип канала" : "Тип чата"}</div>
        <div class="profile-card">
          <div class="profile-segmented-row">
            <button
              type="button"
              class="profile-segmented-btn"
              class:active={channelAccessType === "PUBLIC"}
              on:click={() => setChannelAccessType("PUBLIC")}
            >
              <span class="profile-seg-title">Публичный</span>
              <span class="profile-seg-sub">Доступен всем</span>
            </button>
            <button
              type="button"
              class="profile-segmented-btn"
              class:active={channelAccessType === "PRIVATE"}
              on:click={() => setChannelAccessType("PRIVATE")}
            >
              <span class="profile-seg-title">Частный</span>
              <span class="profile-seg-sub">По ссылке</span>
            </button>
          </div>
        </div>

        {#if channelAccessType === "PUBLIC"}
          <div class="profile-card-caption">Публичная ссылка</div>
          <div class="profile-card">
            <div class="profile-input-item">
              <input
                type="text"
                bind:value={channelLinkInput}
                placeholder="username"
                class="profile-input-field"
                on:keydown={(e) => e.key === "Enter" && savePublicChannelLink()}
              />
              <button
                type="button"
                class="profile-pill-button"
                on:click={savePublicChannelLink}
              >
                Сохранить
              </button>
            </div>
            <div class="profile-item-hint">max.ru/{channelLinkInput ? channelLinkInput.trim() : "username"}</div>
          </div>
        {:else}
          <div class="profile-card-caption">Ссылка-приглашение</div>
          <div class="profile-card">
            <div class="profile-item-row" on:click={copyLink}>
              <div class="profile-item-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title link">{chat?.link || "Создание ссылки..."}</div>
                <div class="profile-item-subtitle">Нажмите для копирования</div>
              </div>
              <button type="button" class="profile-action-icon-btn" title="Сбросить" on:click|stopPropagation={() => (showRefreshInviteConfirm = true)}>
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/reload.svg'); mask-image: url('/icons/reload.svg'); width: 18px; height: 18px;"></span>
              </button>
            </div>
          </div>

          <div class="profile-card">
            <div class="profile-item-row" on:click={toggleChannelJoinRequest}>
              <div class="profile-item-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/user-plus.svg'); mask-image: url('/icons/user-plus.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title">Заявки на вступление</div>
                <div class="profile-item-subtitle">Требуется подтверждение админом</div>
              </div>
              <Switch checked={channelJoinRequestEnabled} ariaLabel="Заявки на вступление" />
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Main Profile Screen -->
    <div class="profile-scroll-body" in:fade={{ duration: 150 }}>
      <!-- Hero Header Section -->
      <section class="profile-hero-section">
        <div
          class="profile-avatar-container"
          bind:this={avatarWrapEl}
          class:clickable={Boolean(avatar || canUploadAvatar || (userId && (!chat || chat.type === "DIALOG")))}
          on:click={openAvatarGallery}
        >
          <Avatar
            chat={chat}
            title={title}
            contactId={chat?.type === "DIALOG" ? ($contact?.id ?? userId) : undefined}
            isSelf={isOwnProfile}
            userId={isOwnProfile ? Number($currentUserDetails?.id || $currentUser) : userId}
            size={96}
            allowStories={true}
          />
        </div>

        <h1 class="profile-hero-title">{title}</h1>

        <div class="profile-hero-subtitle">
          {#if chat?.type === "CHAT"}
            {#if onlineCount > 0}
              <span>{onlineCount} из {totalMemberCount} в сети</span>
            {:else}
              <span>{formatMembersCount(totalMemberCount)}</span>
            {/if}
          {:else if isChannel}
            <span>{formatSubscribersCount(totalMemberCount)}</span>
          {:else}
            <Signature contact={contact} chat={chat} />
          {/if}
        </div>

        {#if hasProfileStories}
          <button
            type="button"
            class="profile-story-pill"
            on:click={() => openStoriesViewer(targetProfileEntityId)}
          >
            <span class="profile-story-dot"></span>
            <span>{profileStoryPreview.totalCount} {profileStoryPreview.totalCount === 1 ? "история" : profileStoryPreview.totalCount < 5 ? "истории" : "историй"}</span>
          </button>
        {/if}

        <!-- Capsule Action Tiles Grid (1-to-1 visual parity with Screenshots 3 & 4) -->
        <div class="profile-action-tiles-grid">
          {#if isChannel}
            <!-- Channel Profile: [ Звук ] [ Найти ] [ Поделиться ] [ Ещё ] -->
            <button type="button" class="profile-action-tile" on:click={toggleMute}>
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </div>
              <span class="profile-action-tile-label">{muted ? "Звук вкл." : "Звук"}</span>
            </button>

            <button type="button" class="profile-action-tile" on:click={handleProfileSearch}>
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <span class="profile-action-tile-label">Найти</span>
            </button>

            <button type="button" class="profile-action-tile" on:click={copyLink}>
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                  <polyline points="16 6 12 2 8 6"></polyline>
                  <line x1="12" y1="2" x2="12" y2="15"></line>
                </svg>
              </div>
              <span class="profile-action-tile-label">Поделиться</span>
            </button>

            <div class="profile-action-tile-wrap">
              <button type="button" class="profile-action-tile" on:click|stopPropagation={toggleMenu}>
                <div class="profile-action-tile-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="2.2"></circle>
                    <circle cx="12" cy="12" r="2.2"></circle>
                    <circle cx="19" cy="12" r="2.2"></circle>
                  </svg>
                </div>
                <span class="profile-action-tile-label">Ещё</span>
              </button>

              {#if showMenu}
                <div class="profile-dropdown-menu" transition:scale={{ duration: 140, start: 0.92 }}>
                  {#if chatLink}
                    <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; copyLink(); }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 18px; height: 18px;"></span>
                      <span>Скопировать ссылку</span>
                    </button>
                  {/if}
                  <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; purgeForAll = false; showPurgeConfirm = true; }}>
                    <span class="mask-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 18px; height: 18px;"></span>
                    <span>Очистить историю</span>
                  </button>
                  {#if isChannelOwner}
                    <button type="button" class="profile-dropdown-item danger" on:click={() => { showMenu = false; showDeleteConfirm = true; }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 18px; height: 18px;"></span>
                      <span>Удалить канал</span>
                    </button>
                  {:else}
                    <button type="button" class="profile-dropdown-item danger" on:click={() => { showMenu = false; quitChannel(); }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/forward.svg'); mask-image: url('/icons/forward.svg'); width: 18px; height: 18px;"></span>
                      <span>Покинуть канал</span>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

          {:else if isGroupChat}
            <!-- Group Profile: [ Звонок ] [ Звук ] [ Найти ] [ Ещё ] -->
            <button
              type="button"
              class="profile-action-tile"
              on:click={() => {
                closeModal();
                if (chat?.id) CallService.placeAudioCall(chat.id, chat.title, chat.baseUrl || chat.baseRawUrl);
              }}
            >
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <span class="profile-action-tile-label">Звонок</span>
            </button>

            <button type="button" class="profile-action-tile" on:click={toggleMute}>
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </div>
              <span class="profile-action-tile-label">{muted ? "Звук вкл." : "Звук"}</span>
            </button>

            <button type="button" class="profile-action-tile" on:click={handleProfileSearch}>
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </div>
              <span class="profile-action-tile-label">Найти</span>
            </button>

            <div class="profile-action-tile-wrap">
              <button type="button" class="profile-action-tile" on:click|stopPropagation={toggleMenu}>
                <div class="profile-action-tile-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="2.2"></circle>
                    <circle cx="12" cy="12" r="2.2"></circle>
                    <circle cx="19" cy="12" r="2.2"></circle>
                  </svg>
                </div>
                <span class="profile-action-tile-label">Ещё</span>
              </button>

              {#if showMenu}
                <div class="profile-dropdown-menu" transition:scale={{ duration: 140, start: 0.92 }}>
                  {#if chatLink}
                    <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; copyLink(); }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 18px; height: 18px;"></span>
                      <span>Скопировать ссылку</span>
                    </button>
                  {/if}
                  {#if (isGroupAdmin || isGroupOwner) && chatLink}
                    <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; showRefreshInviteConfirm = true; }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/reload.svg'); mask-image: url('/icons/reload.svg'); width: 18px; height: 18px;"></span>
                      <span>Обновить ссылку</span>
                    </button>
                  {/if}
                  {#if (isGroupAdmin || isGroupOwner) && joinRequests.length > 0}
                    <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; showJoinRequestsModal = true; }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/user-plus.svg'); mask-image: url('/icons/user-plus.svg'); width: 18px; height: 18px;"></span>
                      <span>Заявки на вступление</span>
                      <span class="profile-menu-badge">{joinRequests.length}</span>
                    </button>
                  {/if}
                  <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; purgeForAll = false; showPurgeConfirm = true; }}>
                    <span class="mask-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 18px; height: 18px;"></span>
                    <span>Очистить историю</span>
                  </button>
                  {#if isGroupOwner}
                    <button type="button" class="profile-dropdown-item danger" on:click={() => { showMenu = false; showDeleteConfirm = true; }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 18px; height: 18px;"></span>
                      <span>Удалить чат</span>
                    </button>
                  {:else}
                    <button type="button" class="profile-dropdown-item danger" on:click={() => { showMenu = false; leaveChat(); }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/forward.svg'); mask-image: url('/icons/forward.svg'); width: 18px; height: 18px;"></span>
                      <span>Выйти из чата</span>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>

          {:else}
            <!-- 1:1 Direct User Profile: [ Звонок ] [ Видео ] [ Звук ] [ Ещё ] -->
            <button
              type="button"
              class="profile-action-tile"
              on:click={() => {
                const targetId = userId;
                const targetTitle = title;
                const targetAvatar = $contact?.baseUrl || $contact?.baseRawUrl;
                closeModal();
                CallService.placeAudioCall(targetId, targetTitle, targetAvatar);
              }}
            >
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <span class="profile-action-tile-label">Звонок</span>
            </button>

            <button
              type="button"
              class="profile-action-tile"
              on:click={() => {
                const targetId = userId;
                const targetTitle = title;
                const targetAvatar = $contact?.baseUrl || $contact?.baseRawUrl;
                closeModal();
                CallService.placeVideoCall(targetId, targetTitle, targetAvatar);
              }}
            >
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
              </div>
              <span class="profile-action-tile-label">Видео</span>
            </button>

            <button type="button" class="profile-action-tile" on:click={toggleMute}>
              <div class="profile-action-tile-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </div>
              <span class="profile-action-tile-label">{muted ? "Звук вкл." : "Звук"}</span>
            </button>

            <div class="profile-action-tile-wrap">
              <button type="button" class="profile-action-tile" on:click|stopPropagation={toggleMenu}>
                <div class="profile-action-tile-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="2.2"></circle>
                    <circle cx="12" cy="12" r="2.2"></circle>
                    <circle cx="19" cy="12" r="2.2"></circle>
                  </svg>
                </div>
                <span class="profile-action-tile-label">Ещё</span>
              </button>

              {#if showMenu}
                <div class="profile-dropdown-menu" transition:scale={{ duration: 140, start: 0.92 }}>
                  {#if chatLink || $contact?.link}
                    <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; copyLink(); }}>
                      <span class="mask-icon" style="-webkit-mask-image: url('/icons/link.svg'); mask-image: url('/icons/link.svg'); width: 18px; height: 18px;"></span>
                      <span>Скопировать ссылку</span>
                    </button>
                  {/if}
                  <button type="button" class="profile-dropdown-item" on:click={() => { showMenu = false; purgeForAll = false; showPurgeConfirm = true; }}>
                    <span class="mask-icon" style="-webkit-mask-image: url('/icons/recent.svg'); mask-image: url('/icons/recent.svg'); width: 18px; height: 18px;"></span>
                    <span>Очистить историю</span>
                  </button>
                  <button type="button" class="profile-dropdown-item danger" on:click={() => { showMenu = false; showDeleteConfirm = true; }}>
                    <span class="mask-icon" style="-webkit-mask-image: url('/icons/trash.svg'); mask-image: url('/icons/trash.svg'); width: 18px; height: 18px;"></span>
                    <span>Удалить чат</span>
                  </button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        {#if isGroupChat && !isGroupOwner}
          <!-- Large Primary Button «Выйти и пожаловаться» (Matching Screenshot 2 & ok3.java:869) -->
          <div class="profile-wide-btn-wrap">
            <button
              type="button"
              class="profile-leave-report-large-btn"
              on:click={() => (showReportLeaveConfirm = true)}
            >
              Выйти и пожаловаться
            </button>
          </div>
        {/if}
      </section>

      <!-- Profile Cards List -->
      <div class="profile-cards-list">
        {#if !isGroupChat && !isChannel}
          <!-- 1:1 Contact Phone Card -->
          {#if chat?.phone || $contact?.phone}
            <div class="profile-card">
              <div class="profile-item-row" on:click={() => copyText(formatPhone(chat?.phone || $contact?.phone), "Телефон")}>
                <div class="profile-item-content">
                  <div class="profile-item-caption">Номер телефона</div>
                  <div class="profile-item-title">{formatPhone(chat?.phone || $contact?.phone)}</div>
                </div>
              </div>
            </div>
          {/if}

          <!-- Bio / Description Card -->
          {#if chat?.description || $contact?.description}
            <div class="profile-card">
              <div class="profile-item-row no-hover" on:click={() => copyText(chat?.description || $contact?.description, "Описание")}>
                <div class="profile-item-content">
                  <div class="profile-item-caption">О себе</div>
                  <div class="profile-item-body-text">{chat?.description || $contact?.description}</div>
                </div>
              </div>
            </div>
          {/if}
        {/if}

        {#if isChannel && (chat?.description || $contact?.description)}
          <div class="profile-card">
            <div class="profile-item-row no-hover" on:click={() => copyText(chat?.description || $contact?.description, "Описание")}>
              <div class="profile-item-content">
                <div class="profile-item-caption">Описание канала</div>
                <div class="profile-item-body-text">{chat?.description || $contact?.description}</div>
              </div>
            </div>
          </div>
        {/if}

        {#if isGroupChat && chat?.description}
          <div class="profile-card">
            <div class="profile-item-row no-hover" on:click={() => copyText(chat.description, "Описание")}>
              <div class="profile-item-content">
                <div class="profile-item-caption">Описание группы</div>
                <div class="profile-item-body-text">{chat.description}</div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Shared Media ("Вложения") Card (Matches Screenshot 2) -->
        {#if chat}
          <div class="profile-card">
            <div class="profile-item-row" on:click={openSharedMediaScreen}>
              <div class="profile-item-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="13" height="13" rx="3" ry="3"></rect>
                  <path d="M5 14l3-3 2.5 2.5 2-2 3.5 3.5"></path>
                  <circle cx="7" cy="7" r="1.2"></circle>
                  <path d="M21 8v10a3 3 0 0 1-3 3H8"></path>
                </svg>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title">Вложения</div>
                <div class="profile-item-subtitle">Фото, видео, файлы и ссылки</div>
              </div>
              <span class="profile-item-chevron">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
            </div>
          </div>
        {/if}

        <!-- Channel Settings Nav Row (for Channel Admins) -->
        {#if isChannel && isChannelAdmin}
          <div class="profile-card">
            <div class="profile-item-row" on:click={() => (subview = "channel_settings")}>
              <div class="profile-item-icon">
                <span class="mask-icon" style="-webkit-mask-image: url('/icons/settings.svg'); mask-image: url('/icons/settings.svg'); width: 22px; height: 22px;"></span>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title">Управление каналом</div>
                <div class="profile-item-subtitle">Ссылка, параметры, администраторы</div>
              </div>
              <span class="profile-item-chevron">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </span>
            </div>
          </div>
        {/if}

        <!-- Members Section (for Groups & Channels - matching Screenshot 2) -->
        {#if chat?.type === "CHAT" || isChannel}
          <div class="profile-section-title-outside">
            {isChannel ? "ПОДПИСЧИКИ" : "УЧАСТНИКИ"}
          </div>

          <div class="profile-card">
            {#if isGroupAdmin || isGroupOwner || (isChannel && isChannelAdmin)}
              <!-- Row 1: Добавить участника (blue) -->
              <div
                class="profile-item-row action-row-blue"
                on:click={() => openUserPickerForMembers(false)}
              >
                <div class="profile-item-icon blue-tint">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <line x1="19" y1="8" x2="19" y2="14"></line>
                    <line x1="22" y1="11" x2="16" y2="11"></line>
                  </svg>
                </div>
                <div class="profile-item-content">
                  <div class="profile-item-title blue-text">
                    {isChannel ? "Добавить подписчика" : "Добавить участника"}
                  </div>
                </div>
              </div>

              <!-- Row 2: Пригласить по ссылке (blue) -->
              {#if chatLink}
                <div class="profile-item-row action-row-blue" on:click={copyLink}>
                  <div class="profile-item-icon blue-tint">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                  </div>
                  <div class="profile-item-content">
                    <div class="profile-item-title blue-text">Пригласить по ссылке</div>
                  </div>
                </div>
              {/if}
            {/if}

            <!-- Members List Rows -->
            <div class="profile-members-list-wrapper">
              {#each displayedMembers as memberItem (memberItem.contact?.id || memberItem.userId || memberItem.id || memberItem)}
                {@const mId = memberItem.contact?.id || memberItem.userId || memberItem.id || memberItem}
                {@const isMemberOwner = Number(chat?.owner) === Number(mId)}
                {@const isMemberAdmin = !isMemberOwner && Boolean(chat?.admins?.includes(Number(mId)) || memberItem.role === 'ADMIN' || memberItem.alias === 'Администратор')}
                {@const isSelf = Number(mId) === Number($currentUser)}
                <div class="profile-item-row" on:click={() => selectMember(Number(mId))}>
                  <Avatar
                    contactId={Number(mId)}
                    size={42}
                    src={memberItem?.contact?.baseUrl || memberItem?.contact?.baseRawUrl}
                    title={getMemberName(memberItem)}
                  />
                  <div class="profile-item-content">
                    <div class="profile-name-badge-row">
                      <span class="profile-item-title">{getMemberName(memberItem)}</span>
                    </div>
                    <div class="profile-item-subtitle">
                      {#if isSelf}
                        Вы
                      {:else}
                        <Signature contactId={Number(mId)} />
                      {/if}
                    </div>
                  </div>

                  {#if isMemberOwner}
                    <span class="profile-member-role-text">владелец</span>
                  {:else if isMemberAdmin}
                    <span class="profile-member-role-text">администратор</span>
                  {/if}
                </div>
              {/each}

              {#if !groupMembersEnd && !memberSearch.trim()}
                <button type="button" class="profile-load-more-btn" on:click={loadMoreMembers} disabled={groupMembersLoading}>
                  {groupMembersLoading ? "Загрузка..." : "Показать ещё"}
                </button>
              {/if}
            </div>
          </div>
        {/if}

        <!-- MaxPlus Advanced Settings Entry Row (Opens as Screen) -->
        <div class="profile-card">
          <div class="profile-item-row clickable" on:click={openAdvancedSettings}>
            <div class="profile-item-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              </svg>
            </div>
            <div class="profile-item-content">
              <div class="profile-item-title">Расширенные настройки</div>
              <div class="profile-item-subtitle">
                {#if $chatSettings?.session?.shared_secret || $chatSettings?.session?.fingerprint || $chatSettings?.keys?.current}
                  <span class="profile-status-badge success">E2E активно</span>
                {:else if $chatSettings?.pending}
                  <span class="profile-status-badge warning">Запрос E2E</span>
                {:else}
                  Шифрование, E2E, приватность
                {/if}
              </div>
            </div>
            <span class="profile-item-chevron">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </span>
          </div>
        </div>

        <!-- Danger Actions Card -->
        <div class="profile-card">
          {#if chat}
            <div class="profile-item-row danger" on:click={() => { purgeForAll = false; showPurgeConfirm = true; }}>
              <div class="profile-item-icon danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title danger">Очистить историю</div>
              </div>
            </div>
          {/if}

          {#if isChannel}
            {#if isChannelOwner}
              <div class="profile-item-row danger" on:click={() => (showDeleteConfirm = true)}>
                <div class="profile-item-icon danger">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </div>
                <div class="profile-item-content">
                  <div class="profile-item-title danger">Удалить канал</div>
                </div>
              </div>
            {:else}
              <div class="profile-item-row danger" on:click={quitChannel}>
                <div class="profile-item-icon danger">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                </div>
                <div class="profile-item-content">
                  <div class="profile-item-title danger">Покинуть канал</div>
                </div>
              </div>
            {/if}
          {:else if chat?.type === "CHAT"}
            <div class="profile-item-row danger" on:click={leaveChat}>
              <div class="profile-item-icon danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title danger">Покинуть группу</div>
              </div>
            </div>
          {:else if chat}
            <div class="profile-item-row danger" on:click={() => (showDeleteConfirm = true)}>
              <div class="profile-item-icon danger">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </div>
              <div class="profile-item-content">
                <div class="profile-item-title danger">Удалить чат</div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
  </div>

  <!-- Toast notification overlay -->
  {#if toastMessage}
    <div class="profile-toast" transition:fade={{ duration: 120 }}>
      <span>{toastMessage}</span>
    </div>
  {/if}
</div>

<!-- Modals & Overlays -->
{#if showAdminModal && adminModalMember}
  <GroupAdminModal
    {chatId}
    member={adminModalMember}
    isChannel={isChannel}
    isOwner={isChannel ? isChannelOwner : isGroupOwner}
    currentUserId={$currentUser}
    on:close={() => { showAdminModal = false; adminModalMember = null; }}
    on:saved={onAdminSaved}
    on:revoked={onAdminRevoked}
    on:transferOwnership={onOwnershipTransferred}
  />
{/if}

{#if showJoinRequestsModal}
  <GroupJoinRequestsModal
    {chatId}
    isChannel={isChannel}
    on:close={() => (showJoinRequestsModal = false)}
    on:updated={onJoinRequestsUpdated}
  />
{/if}

{#if showDeleteConfirm}
  <ConfirmModal
    title={isChannel ? "Удалить канал?" : "Удалить чат?"}
    message="Это действие нельзя отменить. Вся история сообщений будет удалена для всех."
    confirmText="Удалить"
    isDanger={true}
    on:confirm={deleteChat}
    on:cancel={() => (showDeleteConfirm = false)}
  />
{/if}

{#if showPurgeConfirm}
  <ConfirmModal
    title="Очистить историю сообщений?"
    message="Все сообщения в этом чате будут безвозвратно удалены."
    confirmText="Очистить"
    isDanger={true}
    on:confirm={confirmPurgeHistory}
    on:cancel={() => (showPurgeConfirm = false)}
  />
{/if}

{#if showRemoveMemberConfirm && memberToRemove}
  <ConfirmModal
    title="Исключить участника?"
    message="Вы действительно хотите исключить {getMemberName(memberToRemove)}?"
    confirmText="Исключить"
    isDanger={true}
    on:confirm={kickConfirmedMember}
    on:cancel={() => { showRemoveMemberConfirm = false; memberToRemove = null; }}
  />
{/if}

{#if showRefreshInviteConfirm}
  <ConfirmModal
    title="Отозвать ссылку приглашения?"
    message="Предыдущая ссылка станет недействительной, и будет создана новая ссылка."
    confirmText="Создать новую"
    on:confirm={() => { showRefreshInviteConfirm = false; refreshInvite(); }}
    on:cancel={() => (showRefreshInviteConfirm = false)}
  />
{/if}

{#if showReportLeaveConfirm}
  <ConfirmModal
    title="Выйти и пожаловаться?"
    message="Вы покинете эту группу, а диалог будет отмечен как спам."
    confirmText="Выйти и пожаловаться"
    isDanger={true}
    on:confirm={handleReportAndLeave}
    on:cancel={() => (showReportLeaveConfirm = false)}
  />
{/if}

<style>
  :root,
  .profile-window {
    --profile-bg: #0f1013;
    --profile-card-bg: #21232c;
    --profile-card-hover: #262933;
    --profile-primary-blue: #007aff;
    --profile-text-primary: #ffffff;
    --profile-text-secondary: #8e8e93;
    --profile-danger: #ff3b30;
    --profile-radius: 16px;
  }

  .profile-window {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--profile-bg, #0f1013);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    color: var(--profile-text-primary, #ffffff);
    font-family: var(--font-family-base, system-ui, -apple-system, sans-serif);
  }

  /* Toolbar */
  .profile-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: calc(56px + var(--safe-top, 0px));
    padding: var(--safe-top, 0px) 12px 0 12px;
    background: var(--profile-bg, #0f1013);
    border: none;
    flex-shrink: 0;
    box-sizing: border-box;
    z-index: var(--z-header, 4);
  }

  .profile-toolbar-title {
    color: var(--profile-text-primary, #ffffff);
    font-size: 17px;
    line-height: 22px;
    font-weight: 600;
    flex: 1;
    margin: 0 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .profile-toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .profile-icon-button {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--profile-text-primary, #ffffff);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
    flex-shrink: 0;
  }

  .profile-icon-button:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .profile-icon-button:active {
    transform: scale(0.92);
  }

  /* Scrollable Body */
  .profile-body-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: hidden;
  }

  .profile-scroll-body,
  .profile-subview-content {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .profile-subview-content {
    padding: 12px 16px calc(24px + var(--safe-bottom, 0px));
  }

  /* Hero Section */
  .profile-hero-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 8px 16px 16px 16px;
    border: none;
    flex-shrink: 0;
  }

  .profile-avatar-container {
    position: relative;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    margin-top: 4px;
    margin-bottom: 12px;
  }

  .profile-avatar-container.clickable {
    cursor: pointer;
    transition: transform 0.14s;
  }

  .profile-avatar-container.clickable:active {
    transform: scale(0.96);
  }

  .profile-hero-title {
    margin: 0;
    color: var(--profile-text-primary, #ffffff);
    font-size: 22px;
    line-height: 28px;
    font-weight: 600;
    text-align: center;
    word-break: break-word;
    max-width: 90%;
  }

  .profile-hero-subtitle {
    margin-top: 4px;
    color: var(--profile-text-secondary, #8e8e93);
    font-size: 14px;
    line-height: 18px;
    font-weight: 400;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    text-align: center;
  }

  .profile-story-pill {
    margin-top: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 12px;
    background: rgba(0, 122, 255, 0.14);
    color: var(--profile-primary-blue, #007aff);
    font-size: 13px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }

  .profile-story-pill:hover {
    background: rgba(0, 122, 255, 0.22);
  }

  .profile-story-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--profile-primary-blue, #007aff);
  }

  /* Action Tiles Grid */
  .profile-action-tiles-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 18px;
    width: 100%;
    max-width: 480px;
    box-sizing: border-box;
  }

  .profile-action-tile-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .profile-action-tile {
    width: 100%;
    min-height: 64px;
    border-radius: var(--profile-radius, 16px);
    background: var(--profile-card-bg, #21232c);
    border: none !important;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 8px 4px;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
    user-select: none;
    box-sizing: border-box;
    box-shadow: none;
  }

  .profile-action-tile:hover {
    background: var(--profile-card-hover, #262933);
  }

  .profile-action-tile:active {
    transform: scale(0.96);
  }

  .profile-action-tile-icon {
    color: var(--profile-primary-blue, #007aff);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .profile-action-tile-label {
    color: var(--profile-primary-blue, #007aff);
    font-size: 12px;
    font-weight: 500;
    line-height: 15px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .profile-wide-btn-wrap {
    width: 100%;
    max-width: 480px;
    margin-top: 12px;
    box-sizing: border-box;
  }

  .profile-leave-report-large-btn {
    width: 100%;
    height: 50px;
    border-radius: var(--profile-radius, 16px);
    background: var(--profile-primary-blue, #007aff);
    color: #ffffff;
    border: none;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: none;
    transition: opacity 0.15s, transform 0.1s;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .profile-leave-report-large-btn:hover {
    opacity: 0.92;
  }

  .profile-leave-report-large-btn:active {
    transform: scale(0.98);
  }

  /* Cards List & Cards */
  .profile-cards-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px calc(24px + var(--safe-bottom, 0px));
    box-sizing: border-box;
  }

  .profile-card {
    background: var(--profile-card-bg, #21232c);
    border: none !important;
    border-radius: var(--profile-radius, 16px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: none;
  }

  .profile-card-caption {
    font-size: 13px;
    font-weight: 600;
    color: var(--profile-primary-blue, #007aff);
    padding: 6px 6px 2px 6px;
    letter-spacing: 0.1px;
  }

  .profile-section-title-outside {
    font-size: 13px;
    font-weight: 500;
    color: var(--profile-text-secondary, #8e8e93);
    text-transform: uppercase;
    padding: 14px 16px 6px 16px;
    letter-spacing: 0.4px;
  }

  .profile-item-row {
    min-height: 54px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    cursor: pointer;
    transition: background 0.12s;
    user-select: none;
    box-sizing: border-box;
  }

  .profile-item-row:last-child {
    border-bottom: none;
  }

  .profile-item-row:hover:not(.no-hover) {
    background: rgba(255, 255, 255, 0.03);
  }

  .profile-item-row.no-hover {
    cursor: default;
  }

  .action-row-blue {
    cursor: pointer;
  }

  .action-row-blue:hover {
    background: rgba(0, 122, 255, 0.08);
  }

  .blue-tint {
    color: var(--profile-primary-blue, #007aff) !important;
  }

  .blue-text {
    color: var(--profile-primary-blue, #007aff) !important;
    font-weight: 500 !important;
  }

  .profile-member-role-text {
    font-size: 13px;
    color: var(--profile-text-secondary, #8e8e93);
    margin-right: 4px;
    flex-shrink: 0;
    font-weight: 400;
  }

  .profile-item-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--profile-text-primary, #ffffff);
    flex-shrink: 0;
  }

  .profile-item-icon.accent {
    color: var(--profile-primary-blue, #007aff);
  }

  .profile-item-icon.danger {
    color: var(--profile-danger, #ff3b30);
  }

  .profile-item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .profile-item-caption {
    font-size: 13px;
    color: var(--profile-text-secondary, #8e8e93);
    font-weight: 400;
  }

  .profile-item-body-text {
    font-size: 16px;
    line-height: 21px;
    color: var(--profile-text-primary, #ffffff);
    word-break: break-word;
    user-select: text;
  }

  .profile-item-title {
    font-size: 16px;
    line-height: 21px;
    font-weight: 500;
    color: var(--profile-text-primary, #ffffff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-item-title.danger {
    color: var(--profile-danger, #ff3b30);
  }

  .profile-item-subtitle {
    font-size: 13px;
    line-height: 17px;
    color: var(--profile-text-secondary, #8e8e93);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-item-chevron {
    color: var(--profile-text-secondary, #8e8e93);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .profile-name-badge-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .profile-load-more-btn {
    width: 100%;
    padding: 12px;
    background: transparent;
    border: none;
    color: var(--profile-primary-blue, #007aff);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s;
  }

  .profile-load-more-btn:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  /* Segmented Controls for Channel Settings subview */
  .profile-segmented-row {
    display: flex;
    gap: 4px;
    padding: 6px;
    box-sizing: border-box;
  }

  .profile-segmented-btn {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: 10px;
    padding: 8px 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--profile-text-secondary, #8e8e93);
    transition: background 0.15s, color 0.15s;
  }

  .profile-segmented-btn.active {
    background: var(--profile-primary-blue, #007aff);
    color: #ffffff;
  }

  .profile-seg-title {
    font-size: 13px;
    font-weight: 500;
  }

  .profile-seg-sub {
    font-size: 11px;
    opacity: 0.8;
  }

  .profile-input-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    box-sizing: border-box;
  }

  .profile-input-field {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--profile-text-primary, #ffffff);
    font-size: 15px;
    font-family: inherit;
  }

  .profile-input-field::placeholder {
    color: var(--profile-text-secondary, #8e8e93);
  }

  .profile-item-hint {
    padding: 0 16px 10px 16px;
    font-size: 12px;
    color: var(--profile-text-secondary, #8e8e93);
  }

  .profile-pill-button {
    padding: 6px 14px;
    border-radius: 10px;
    border: none;
    background: var(--profile-primary-blue, #007aff);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s, transform 0.1s;
    flex-shrink: 0;
  }

  .profile-action-icon-btn {
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    border-radius: 50%;
    color: var(--profile-text-secondary, #8e8e93);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .profile-action-icon-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--profile-text-primary, #ffffff);
  }

  .profile-status-badge {
    font-size: 12px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 6px;
    display: inline-block;
  }

  .profile-status-badge.success {
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
  }

  .profile-status-badge.warning {
    background: rgba(251, 191, 36, 0.15);
    color: #fbbf24;
  }

  /* Dropdown Menu */
  .profile-dropdown-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: var(--profile-card-bg, #21232c);
    min-width: 210px;
    border-radius: 16px;
    padding: 6px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.65);
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 100;
    border: none;
    box-sizing: border-box;
  }

  .profile-dropdown-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    color: var(--profile-text-primary, #ffffff);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 10px;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    box-sizing: border-box;
    transition: background 0.12s;
  }

  .profile-dropdown-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .profile-dropdown-item.danger {
    color: var(--profile-danger, #ff3b30);
  }

  .profile-dropdown-item.danger:hover {
    background: rgba(255, 59, 48, 0.14);
  }

  .profile-menu-badge {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    background: var(--profile-primary-blue, #007aff);
    color: #ffffff;
    padding: 2px 7px;
    border-radius: 10px;
  }

  .profile-toast {
    position: absolute;
    bottom: calc(24px + var(--safe-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    width: auto !important;
    max-width: min(400px, 90%);
    background: rgba(33, 35, 44, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: none;
    color: #ffffff;
    padding: 10px 20px;
    border-radius: 24px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    z-index: 120;
    pointer-events: none;
    white-space: nowrap;
  }

  .profile-edit-avatar-wrap {
    position: relative;
    width: 96px;
    height: 96px;
    margin: 16px auto 20px auto;
    cursor: pointer;
    border-radius: 50%;
  }

  .profile-avatar-camera-overlay {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--profile-primary-blue, #007aff);
    border: 2.5px solid var(--bg-main, #101114);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    z-index: 5;
    pointer-events: none;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }

  .profile-edit-avatar-wrap:hover .profile-avatar-camera-overlay {
    transform: scale(1.06);
  }

  .profile-field-name-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 13px 14px;
  }

  .profile-field-name-row .profile-field-edit-input {
    flex: 1;
    min-width: 0;
  }

  .profile-field-clear-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.45);
    padding: 4px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .profile-field-clear-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .profile-item-trailing {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    margin-right: 4px;
    flex-shrink: 0;
  }

  .profile-field-edit-group {
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
    gap: 4px;
  }

  .profile-field-edit-input {
    background: transparent;
    border: none;
    color: var(--text-primary, #ffffff);
    font-size: 15px;
    font-weight: 500;
    outline: none;
    padding: 0;
    width: 100%;
  }

  .profile-field-edit-input::placeholder {
    color: var(--text-muted, rgba(255, 255, 255, 0.4));
  }

  .profile-field-edit-textarea {
    background: transparent;
    border: none;
    color: var(--text-primary, #ffffff);
    font-size: 14px;
    line-height: 1.4;
    outline: none;
    padding: 0;
    width: 100%;
    resize: none;
    font-family: inherit;
  }

  .profile-field-edit-textarea::placeholder {
    color: var(--text-muted, rgba(255, 255, 255, 0.4));
  }
</style>
