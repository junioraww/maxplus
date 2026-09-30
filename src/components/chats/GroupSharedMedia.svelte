<script>
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { save } from "@tauri-apps/plugin-dialog";
  import API from "$lib/stores/api";
  import { formatMs } from "$lib/utils/time";
  import { getAssetUrl, getProxiedMediaUrl } from "$lib/utils/images";
  import { activeChatMessages, playMedia } from "$lib/stores/mediaPlayback";
  import { getChat, getChatSettings } from "$lib/stores/messages";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { batchDecrypt } from "$lib/crypto/messages";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings";
  import MediaViewer from "$components/ChatWindow/MediaViewer.svelte";

  export let chat;

  const TABS = [
    { id: "media", label: "Медиа", types: ["PHOTO", "VIDEO"] },
    { id: "files", label: "Файлы", types: ["FILE"] },
    { id: "audio", label: "Аудио", types: ["AUDIO"] },
    { id: "links", label: "Ссылки", types: ["SHARE"] },
  ];

  let activeTab = "media";
  let items = [];
  let isLoading = false;
  let hasMore = true;
  let lastMessageId = null;
  let oldestLocalTime = null;
  let reachedLocalEnd = false;
  let reachedRemoteEnd = false;

  let currentChatId = null;
  let currentTab = null;

  let viewerOpen = false;
  let viewerIndex = 0;
  let viewerOriginEl = null;

  const decryptedCache = new Map();

  $: if (chat?.id != null && activeTab && (String(chat.id) !== String(currentChatId) || activeTab !== currentTab)) {
    currentChatId = chat.id;
    currentTab = activeTab;
    loadTabMedia(true);
  }

  $: viewerMediaList = items
    .filter(i => i.type === "PHOTO" || i.type === "VIDEO")
    .map(item => ({
      uid: String(item.id),
      _type: item.type,
      type: item.type,
      baseUrl: item.type === "VIDEO" ? (item.localPath ? getProxiedMediaUrl(item.localPath) : (item.url && !item.url.startsWith("http") ? item.url : null)) : item.url,
      thumbnail: item.thumbnail || item.url,
      localPath: item.localPath,
      url: item.url,
      name: item.name,
      size: item.size,
      time: item.time,
      chatId: chat?.id,
      senderId: item.senderId,
      senderName: item.senderName,
      messageId: item.messageId,
      videoId: item.videoId,
      token: item.token || item.videoToken,
      videoToken: item.videoToken || item.token,
      photoId: item.photoId,
      isEncryptedMedia: Boolean(item.isEncryptedMedia),
      encryptedAttach: item.encryptedAttach,
      fileId: item.fileId,
      color: item.color,
      width: item.width,
      height: item.height,
      duration: item.duration,
      videoType: item.videoType,
    }));

  function getPlaceholderUrl(previewData) {
    if (!previewData) return null;
    if (typeof previewData === "string") {
      if (previewData.startsWith("data:") || previewData.startsWith("http")) return previewData;
      return `data:image/webp;base64,${previewData}`;
    }
    if (Array.isArray(previewData)) {
      try {
        const bytes = new Uint8Array(previewData);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        return `data:image/webp;base64,${btoa(binary)}`;
      } catch (_) {}
    }
    return null;
  }

  function formatMonthHeader(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const months = [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const currentYear = new Date().getFullYear();
    return year === currentYear ? month : `${month} ${year}`;
  }

  function getMonthKey(timestamp) {
    if (!timestamp) return "unknown";
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${d.getMonth()}`;
  }

  $: groupedItems = (() => {
    const groups = [];
    let currentKey = null;
    for (const item of items) {
      const key = getMonthKey(item.time);
      if (key !== currentKey) {
        currentKey = key;
        groups.push({
          key,
          label: formatMonthHeader(item.time),
          items: [item]
        });
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }
    return groups;
  })();

  function formatDuration(value, type = "VIDEO") {
    if (!value || isNaN(value)) return "";
    let totalSec = 0;
    if (type === "AUDIO") {
      totalSec = Math.round(Number(value) / 1000);
    } else {
      totalSec = Math.round(Number(value) > 1000 ? Number(value) / 1000 : Number(value));
    }
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  const PAGE_SIZE = 40;

  async function loadTabMedia(reset = false) {
    if (chat?.id == null || isLoading) return;
    if (reset) {
      items = [];
      hasMore = true;
      lastMessageId = null;
      oldestLocalTime = null;
      reachedLocalEnd = false;
      reachedRemoteEnd = false;
    }
    if (!hasMore && !reset) return;

    isLoading = true;
    try {
      const tabDef = TABS.find(t => t.id === activeTab);
      const baseTypes = tabDef?.types || ["PHOTO", "VIDEO"];

      const chatSettingsStore = getChatSettings(chat.id);
      const chatSettingsVal = chatSettingsStore ? get(chatSettingsStore) : null;
      const isEncryptedChat = Boolean(chatSettingsVal?.keys?.current || chatSettingsVal?.session || chatSettingsVal?.enabled);

      let serverTypes = [...baseTypes];
      if (isEncryptedChat && activeTab === "media" && !serverTypes.includes("FILE")) {
        serverTypes.push("FILE");
      }

      let localMessages = [];
      if (!reachedLocalEnd) {
        const searchTime = oldestLocalTime ?? (Date.now() + 86400000);
        const stored = await getChat(chat.id).loadMessages(searchTime, PAGE_SIZE * 2).catch(() => []);
        const activeList = get(activeChatMessages) || [];
        const isMatchingChat = activeList.length > 0 && (String(activeList[0].chatId) === String(chat.id) || activeList[0].chatId == null);
        const inMemory = (reset && isMatchingChat) ? activeList : [];
        const localMap = new Map();
        for (const m of [...stored, ...inMemory]) {
          if (m && m.id != null) {
            localMap.set(String(m.id), m);
          }
        }
        localMessages = Array.from(localMap.values());
        if (stored.length < PAGE_SIZE * 2) {
          reachedLocalEnd = true;
        }
        let minTime = null;
        for (const m of stored) {
          const t = Number(m.time);
          if (!isNaN(t) && t > 0) {
            if (minTime === null || t < minTime) {
              minTime = t;
            }
          }
        }
        if (minTime !== null) {
          oldestLocalTime = minTime - 1;
        }
      }

      let highestLocalId = null;
      for (const m of localMessages) {
        const num = Number(m.id);
        if (!isNaN(num) && num > 0) {
          if (highestLocalId === null || num > highestLocalId) {
            highestLocalId = num;
          }
        }
      }

      let anchor = null;
      if (reset) {
        anchor = chat.lastMessage?.id || highestLocalId || null;
        if (!anchor) {
          const probe = await $API.getMessages(Number(chat.id), Date.now() + 100000, 1, 0).catch(() => null);
          const probeList = probe?.messages || (Array.isArray(probe) ? probe : []);
          if (probeList.length > 0 && probeList[0]?.id != null) {
            anchor = probeList[0].id;
          }
        }
      } else {
        const oldestDisplayed = items[items.length - 1];
        anchor = oldestDisplayed?.messageId || lastMessageId || null;
      }

      let remoteList = [];
      if (!reachedRemoteEnd && anchor != null) {
        const forward = reset ? PAGE_SIZE : 0;
        const backward = PAGE_SIZE;
        const res = await $API.fetchChatMedia(chat.id, anchor, serverTypes, forward, backward).catch(() => null);
        remoteList = res?.messages || res?.attaches || res?.items || (Array.isArray(res) ? res : []);
        if (remoteList.length < PAGE_SIZE) {
          reachedRemoteEnd = true;
        }
      } else if (!anchor) {
        reachedRemoteEnd = true;
      }

      const allFileCandidates = [...remoteList, ...localMessages].filter(m => {
        if (!m || !m.text || typeof m.text !== "string") return false;
        const attaches = m.attaches || m.attachments || [];
        return attaches.some(a => (a.type || a._type || "").toUpperCase() === "FILE" || a.isEncryptedMedia);
      });

      if (allFileCandidates.length > 0) {
        const uncached = allFileCandidates.filter(m => !decryptedCache.has(String(m.id)));
        if (uncached.length > 0) {
          const account = await getCurrentAccount().catch(() => null);
          const password = chatSettingsVal?.password || null;
          const updates = await batchDecrypt(
            Number(account?.id || 0),
            Number(chat.id),
            uncached,
            password
          ).catch(() => ({}));
          for (const m of uncached) {
            const sid = String(m.id);
            decryptedCache.set(sid, updates?.[sid] || null);
          }
        }
      }

      const account = await getCurrentAccount().catch(() => null);
      const accountId = Number(account?.id || 0);

      const parsedItems = [];
      const seen = new Set(reset ? [] : items.map(i => i.id));

      function addItem(item) {
        if (!item || !item.id) return;
        if (!seen.has(item.id)) {
          seen.add(item.id);
          parsedItems.push(item);
        }
      }

      const combinedMessages = [];
      const msgSeen = new Set();
      for (const m of [...remoteList, ...localMessages]) {
        if (m && m.id != null) {
          const sid = String(m.id);
          if (!msgSeen.has(sid)) {
            msgSeen.add(sid);
            combinedMessages.push(m);
          }
        }
      }

      for (const msg of combinedMessages) {
        const dec = decryptedCache.get(String(msg.id));
        if (dec && dec.is_encrypted && !dec.error && dec.media) {
          const mType = (dec.media.media_type || "").toUpperCase();
          const matchesActive =
            (activeTab === "media" && (mType === "PHOTO" || mType === "VIDEO")) ||
            (activeTab === "audio" && mType === "AUDIO") ||
            (activeTab === "files" && mType === "FILE");

          if (matchesActive) {
            const attaches = msg.attaches || msg.attachments || [];
            const attachIdx = dec.media.attach_index ?? 0;
            const rawAttach = attaches[attachIdx] || attaches[0];
            const fid = rawAttach?.fileId || rawAttach?.file_id || rawAttach?.id || rawAttach?.encryptedAttach?.fileId || rawAttach?.encryptedAttach?.file_id || rawAttach?.encryptedAttach?.id || msg.id;

            let resolvedUrl = "";
            let resolvedLocalPath = rawAttach?.localPath || rawAttach?.path || null;

            if (resolvedLocalPath) {
              resolvedUrl = getProxiedMediaUrl(resolvedLocalPath);
            }

            addItem({
              id: `enc_${msg.id}_${fid}`,
              messageId: msg.id,
              senderId: Number(msg.sender || 0),
              senderName: msg.senderName || msg.sender_name || "",
              type: mType,
              url: resolvedUrl,
              thumbnail: resolvedUrl,
              name: dec.media.name || rawAttach?.name || (mType === "VIDEO" ? "Видео" : (mType === "AUDIO" ? "Голосовое сообщение" : "Фото")),
              size: dec.media.size || rawAttach?.size || 0,
              time: msg.time || msg.created || Date.now(),
              link: "",
              isEncryptedMedia: true,
              color: dec.media.color || null,
              fileId: fid,
              localPath: resolvedLocalPath,
              encryptedAttach: rawAttach,
              width: dec.media.width,
              height: dec.media.height,
              duration: dec.media.duration,
              videoType: dec.media.video_type,
            });
            continue;
          }
        }

        const attaches = msg.attaches || msg.attachments || [];
        for (const att of attaches) {
          const rawType = (att.type || att._type || "").toUpperCase();
          if (!baseTypes.includes(rawType)) continue;

          let targetUrl = "";
          let thumbUrl = "";
          const videoToken = att.videoToken || att.token || null;
          if (rawType === "VIDEO") {
            thumbUrl = att.thumbnail || att.baseUrl || att.previewUrl || getPlaceholderUrl(att.previewData) || (att.localPath ? getProxiedMediaUrl(att.localPath) : "");
            targetUrl = att.localPath ? getProxiedMediaUrl(att.localPath) : "";
          } else if (rawType === "PHOTO") {
            targetUrl = att.baseUrl || att.url || att.previewUrl || getPlaceholderUrl(att.previewData) || (att.localPath ? getProxiedMediaUrl(att.localPath) : "");
            thumbUrl = targetUrl;
          } else if (rawType === "AUDIO") {
            targetUrl = att.url || att.fileUrl || att.baseUrl || (att.localPath ? getProxiedMediaUrl(att.localPath) : "");
          } else if (rawType === "FILE") {
            targetUrl = att.url || att.fileUrl || att.baseUrl || (att.localPath ? getProxiedMediaUrl(att.localPath) : "");
          } else if (rawType === "SHARE") {
            targetUrl = att.link || att.url || att.shareUrl || "";
          }

          const fid = att.id || att.photoId || att.videoId || att.fileId || att.audioId || targetUrl || `${msg.id}_${rawType}`;
          addItem({
            id: `${msg.id}_${fid}`,
            messageId: msg.id,
            senderId: Number(msg.sender || 0),
            senderName: msg.senderName || msg.sender_name || "",
            type: rawType,
            url: targetUrl,
            thumbnail: thumbUrl,
            name: att.name || att.fileName || att.title || msg.text || (rawType === "FILE" ? "Файл" : "Вложение"),
            size: att.size || att.fileSize || 0,
            time: msg.time || msg.created || Date.now(),
            link: att.link || att.url || att.shareUrl || targetUrl,
            isEncryptedMedia: false,
            localPath: att.localPath || null,
            videoId: att.videoId,
            photoId: att.photoId,
            token: videoToken,
            videoToken,
            fileId: att.fileId,
            audioId: att.audioId,
            videoType: att.videoType,
            width: att.width,
            height: att.height,
            duration: att.duration,
          });
        }
      }

      parsedItems.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));

      if (parsedItems.length > 0) {
        lastMessageId = parsedItems[parsedItems.length - 1].messageId;
      }

      hasMore = !reachedRemoteEnd || !reachedLocalEnd;
      items = reset ? parsedItems : [...items, ...parsedItems];
    } catch (_) {
      hasMore = false;
    } finally {
      isLoading = false;
    }
  }

  let activeEncDownloads = 0;
  const encDownloadQueue = [];

  function enqueueEncDownload(fn) {
    return new Promise((resolve, reject) => {
      encDownloadQueue.push({ fn, resolve, reject });
      processEncDownloadQueue();
    });
  }

  async function processEncDownloadQueue() {
    if (activeEncDownloads >= 2 || encDownloadQueue.length === 0) return;
    activeEncDownloads++;
    const { fn, resolve, reject } = encDownloadQueue.shift();
    try {
      const res = await fn();
      resolve(res);
    } catch (err) {
      reject(err);
    } finally {
      activeEncDownloads--;
      processEncDownloadQueue();
    }
  }

  function lazyLoadEncrypted(node, item) {
    let cancelled = false;
    let observer = null;

    async function load() {
      if (cancelled || !item?.fileId) return;
      try {
        const account = await getCurrentAccount().catch(() => null);
        const accountId = Number(account?.id || 0);
        const cached = await invoke("get_cached_file", {
          account: accountId,
          src: `enc_media_${item.fileId}`
        }).catch(() => null);

        if (cached && !cancelled) {
          const proxied = getProxiedMediaUrl(cached);
          item.url = proxied;
          item.localPath = cached;
          item.thumbnail = proxied;
          items = items;
          return;
        }

        if ($autoDownloadEncryptedMedia && !cancelled) {
          const cachedPath = await enqueueEncDownload(async () => {
            if (cancelled) return null;
            const res = await $API.getFileById(chat.id, item.messageId, item.fileId).catch(() => null);
            if (!res?.url || cancelled) return null;
            const settingsStore = getChatSettings(chat.id);
            const settings = get(settingsStore);
            return await invoke("cache_encrypted_media", {
              account: accountId,
              chatId: Number(chat.id || 0),
              fileId: Number(item.fileId),
              src: res.url,
              password: settings?.password || null,
              mediaType: item.type || null
            }).catch(() => null);
          }).catch(() => null);

          if (cachedPath && !cancelled) {
            const proxied = getProxiedMediaUrl(cachedPath);
            item.url = proxied;
            item.localPath = cachedPath;
            item.thumbnail = proxied;
            items = items;
            return;
          }
        }
      } catch (_) {}
      if (!cancelled && !item.url) {
        item.failed = true;
        items = items;
      }
    }

    if (typeof window !== "undefined" && typeof node.getBoundingClientRect === "function") {
      const rect = node.getBoundingClientRect();
      if (rect.top < window.innerHeight + 150 && rect.bottom > -150) {
        load();
        return {
          destroy() {
            cancelled = true;
          }
        };
      }
    }

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries[0]?.isIntersecting) {
          load();
          if (observer) observer.disconnect();
        }
      }, { rootMargin: "150px" });
      observer.observe(node);
    } else {
      load();
    }

    return {
      destroy() {
        cancelled = true;
        if (observer) observer.disconnect();
      }
    };
  }

  function lazyLoad(node, item) {
    let cancelled = false;
    let observer = null;
    node.style.opacity = "0";

    async function load() {
      if (cancelled) return;
      if (item?.isEncryptedMedia && !item.url && item.fileId) {
        try {
          const account = await getCurrentAccount().catch(() => null);
          const accountId = Number(account?.id || 0);
          const cached = await invoke("get_cached_file", {
            account: accountId,
            src: `enc_media_${item.fileId}`
          }).catch(() => null);
          if (cached && !cancelled) {
            const proxied = getProxiedMediaUrl(cached);
            item.url = proxied;
            item.localPath = cached;
            item.thumbnail = proxied;
            node.onload = () => { node.style.opacity = "1"; };
            node.onerror = () => { node.style.opacity = "1"; };
            node.src = proxied;
            if (node.complete) node.style.opacity = "1";
            return;
          }
        } catch (_) {}
      }

      const src = item?.thumbnail || item?.url || item;
      if (!src) {
        node.style.opacity = "1";
        return;
      }
      try {
        const cachedUrl = await getAssetUrl(src);
        if (!cancelled && cachedUrl) {
          node.onload = () => { node.style.opacity = "1"; };
          node.onerror = () => { node.style.opacity = "1"; };
          node.src = cachedUrl;
          if (node.complete) node.style.opacity = "1";
        } else if (!cancelled && src && !src.startsWith("http://") && !src.startsWith("https://")) {
          node.onload = () => { node.style.opacity = "1"; };
          node.onerror = () => { node.style.opacity = "1"; };
          node.src = src;
          if (node.complete) node.style.opacity = "1";
        } else if (!cancelled) {
          node.style.opacity = "1";
        }
      } catch (_) {
        if (!cancelled) {
          node.style.opacity = "1";
        }
      }
    }

    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          load();
          observer.disconnect();
        }
      });
      observer.observe(node);
    } else {
      load();
    }

    return {
      destroy() {
        cancelled = true;
        if (observer) observer.disconnect();
      }
    };
  }

  function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return "";
    const b = Number(bytes);
    if (b < 1024) return b + " Б";
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " КБ";
    return (b / (1024 * 1024)).toFixed(1) + " МБ";
  }

  async function openItem(item, idx, e = null) {
    if (activeTab === "media") {
      const mediaIdx = viewerMediaList.findIndex(m => String(m.uid) === String(item.id));
      viewerIndex = mediaIdx >= 0 ? mediaIdx : (idx >= 0 ? idx : 0);
      viewerOriginEl = e?.currentTarget || null;
      viewerOpen = true;
      return;
    }

    if (activeTab === "audio") {
      let audioSrc = item.url;
      if (!audioSrc && item.fileId) {
        const res = await $API.getFileById(chat.id, item.messageId, item.fileId).catch(() => null);
        if (res?.url) audioSrc = res.url;
      }
      if (audioSrc) {
        const durSec = item.duration ? (Number(item.duration) > 1000 ? Math.round(Number(item.duration) / 1000) : Number(item.duration)) : 0;
        playMedia({
          id: item.id,
          url: audioSrc,
          name: item.name,
          duration: durSec,
          chatId: chat.id,
          messageId: item.messageId,
          senderId: item.senderId
        });
      }
      return;
    }

    if (activeTab === "files") {
      let downloadUrl = item.url;
      if (!downloadUrl && item.fileId) {
        const res = await $API.getFileById(chat.id, item.messageId, item.fileId).catch(() => null);
        if (res?.url) downloadUrl = res.url;
      }
      if (downloadUrl) {
        if (downloadUrl.startsWith("http")) {
          const filePath = await save({ defaultPath: item.name }).catch(() => null);
          if (filePath) {
            await invoke("download_to_path", { url: downloadUrl, path: filePath }).catch(() => {
              openUrl(downloadUrl).catch(() => window.open(downloadUrl, "_blank"));
            });
            return;
          }
        }
        openUrl(downloadUrl).catch(() => window.open(downloadUrl, "_blank"));
      }
      return;
    }

    if (item.link) {
      openUrl(item.link).catch(() => window.open(item.link, "_blank"));
    } else if (item.url) {
      openUrl(item.url).catch(() => window.open(item.url, "_blank"));
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape" && viewerOpen) {
      viewerOpen = false;
      e.stopPropagation();
    }
  }

  function observeSentinel(node) {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore && !isLoading) {
        loadTabMedia(false);
      }
    }, { rootMargin: "300px" });
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      }
    };
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="shared-media-block">
  <div class="media-tabs-bar">
    {#each TABS as tab}
      <button
        type="button"
        class="media-tab-btn"
        class:active={activeTab === tab.id}
        on:click={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="media-content-container">
    {#if activeTab === "media"}
      {#each groupedItems as group (group.key)}
        <div class="media-group-header">{group.label}</div>
        <div class="media-grid">
          {#each group.items as item, idx (item.id)}
            <div
              class="media-tile"
              data-media-uid={String(item.id)}
              on:click={(e) => openItem(item, idx, e)}
            >
              {#if item.type === "VIDEO" && item.isEncryptedMedia && item.url}
                <video
                  class="media-video-thumb"
                  src={item.url}
                  preload="metadata"
                  muted
                  playsinline
                ></video>
              {:else if item.url || item.thumbnail}
                <img use:lazyLoad={item} alt={item.name} />
              {:else if item.isEncryptedMedia}
                <div
                  class="media-placeholder"
                  use:lazyLoadEncrypted={item}
                  style={item.color ? `background-color: ${item.color}` : ""}
                >
                  {#if $autoDownloadEncryptedMedia && !item.failed}
                    <div class="tile-spinner"></div>
                  {:else}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  {/if}
                </div>
              {:else}
                <div class="media-placeholder" style={item.color ? `background-color: ${item.color}` : ""}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </div>
              {/if}
              {#if item.isEncryptedMedia}
                <div class="enc-pill">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
              {/if}
              {#if item.type === "VIDEO"}
                <div class="video-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  {#if item.duration}
                    <span class="video-duration">{formatDuration(item.duration, item.type)}</span>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {:else}
      {#each groupedItems as group (group.key)}
        <div class="media-group-header">{group.label}</div>
        <div class="media-list">
          {#each group.items as item (item.id)}
            <div class="media-list-row" on:click={() => openItem(item)}>
              <div class="icon-bubble">
                {#if activeTab === "files"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                    <polyline points="13 2 13 9 20 9"/>
                  </svg>
                {:else if activeTab === "audio"}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
                  </svg>
                {:else}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                {/if}
              </div>
              <div class="row-info">
                <span class="row-title">{item.name || item.link}</span>
                <span class="row-meta">
                  {#if item.size}
                    {formatFileSize(item.size)} ·
                  {/if}
                  {#if item.duration}
                    {formatDuration(item.duration, item.type)} ·
                  {/if}
                  {formatMs(item.time)}
                </span>
              </div>
              {#if item.isEncryptedMedia}
                <div class="row-enc-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}

    {#if !isLoading && items.length === 0}
      <div class="media-empty">
        <span>Нет вложений в этой категории</span>
      </div>
    {/if}

    {#if hasMore}
      <div class="scroll-sentinel" use:observeSentinel></div>
    {/if}

    {#if isLoading}
      <div class="loading-bar">
        <span>Загрузка...</span>
      </div>
    {:else if hasMore && items.length > 0}
      <button type="button" class="btn-more" on:click={() => loadTabMedia(false)}>
        Показать ещё
      </button>
    {/if}
  </div>
</div>

{#if viewerOpen && viewerMediaList.length > 0}
  <MediaViewer
    chatId={chat?.id}
    bind:index={viewerIndex}
    allMedia={viewerMediaList}
    originEl={viewerOriginEl}
    originRadius={8}
    on:close={() => {
      viewerOpen = false;
      viewerOriginEl = null;
    }}
  />
{/if}

<style>
  .shared-media-block {
    display: flex;
    flex-direction: column;
    margin-top: 10px;
  }

  .media-tabs-bar {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.22);
    padding: 3px;
    border-radius: 10px;
    margin-bottom: 12px;
  }

  .media-tab-btn {
    flex: 1;
    background: none;
    border: none;
    color: #8b98a5;
    font-size: 13px;
    font-weight: 500;
    padding: 7px 8px;
    border-radius: 7px;
    cursor: pointer;
    transition: 0.15s;
  }

  .media-tab-btn.active {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-weight: 600;
  }

  .media-content-container {
    display: flex;
    flex-direction: column;
  }

  .media-group-header {
    font-size: 12px;
    font-weight: 600;
    color: #8b98a5;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 4px 6px;
    margin-top: 6px;
  }

  .media-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin-bottom: 8px;
  }

  .media-tile {
    position: relative;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
    cursor: pointer;
  }

  .media-tile img,
  .media-tile video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s;
    pointer-events: none;
  }

  .media-tile:hover img,
  .media-tile:hover video {
    transform: scale(1.04);
  }

  .media-tile-loader {
    width: 100%;
    height: 100%;
    display: contents;
  }

  .tile-spinner {
    width: 22px;
    height: 22px;
    border: 2px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    border-radius: 50%;
    animation: tileSpin 0.8s linear infinite;
  }

  @keyframes tileSpin {
    to {
      transform: rotate(360deg);
    }
  }

  .media-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
  }

  .video-pill {
    position: absolute;
    bottom: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.65);
    border-radius: 4px;
    padding: 3px 5px;
    display: flex;
    align-items: center;
    gap: 4px;
    color: #fff;
  }

  .video-duration {
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
  }

  .enc-pill {
    position: absolute;
    top: 6px;
    right: 6px;
    background: rgba(0, 0, 0, 0.65);
    border-radius: 4px;
    padding: 3px 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #60a5fa;
  }

  .media-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 8px;
  }

  .media-list-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.12s;
  }

  .media-list-row:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .icon-bubble {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    background: rgba(43, 130, 246, 0.12);
    color: #3b82f6;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .row-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .row-title {
    font-size: 13.5px;
    font-weight: 500;
    color: #f1f5f9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-meta {
    font-size: 12px;
    color: #8b98a5;
  }

  .row-enc-badge {
    color: #60a5fa;
    display: flex;
    align-items: center;
    margin-left: 6px;
  }

  .media-empty {
    padding: 32px 16px;
    text-align: center;
    color: #64748b;
    font-size: 13px;
  }

  .loading-bar {
    padding: 16px;
    text-align: center;
    color: #8b98a5;
    font-size: 13px;
  }

  .btn-more {
    margin: 10px auto;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: #3b82f6;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-more:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .scroll-sentinel {
    width: 100%;
    height: 1px;
    pointer-events: none;
    opacity: 0;
  }
</style>
