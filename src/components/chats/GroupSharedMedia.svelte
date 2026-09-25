<script>
  import { get } from "svelte/store";
  import { invoke } from "@tauri-apps/api/core";
  import API from "$lib/stores/api";
  import { formatMs } from "$lib/utils/time";
  import { getAssetUrl, getProxiedMediaUrl } from "$lib/utils/images";
  import { activeChatMessages } from "$lib/stores/mediaPlayback";
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

  const decryptedCache = new Map();

  $: if (chat?.id && activeTab && (chat.id !== currentChatId || activeTab !== currentTab)) {
    currentChatId = chat.id;
    currentTab = activeTab;
    loadTabMedia(true);
  }

  $: viewerMediaList = items
    .filter(i => i.type === "PHOTO" || i.type === "VIDEO")
    .map(item => ({
      _type: item.type,
      type: item.type,
      baseUrl: item.url,
      localPath: item.localPath,
      url: item.url,
      name: item.name,
      size: item.size,
      messageId: item.messageId,
      videoId: item.videoId,
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

  const PAGE_SIZE = 30;

  async function loadTabMedia(reset = false) {
    if (!chat?.id || isLoading) return;
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
      const types = tabDef?.types || ["PHOTO", "VIDEO"];

      const activeList = get(activeChatMessages) || [];
      const isMatchingChat = activeList.length > 0 && (String(activeList[0].chatId) === String(chat.id) || activeList[0].chatId == null);

      let localMessages = [];
      if (!reachedLocalEnd) {
        const searchTime = oldestLocalTime ?? (Date.now() + 86400000);
        const stored = await getChat(chat.id).loadMessages(searchTime, PAGE_SIZE * 2).catch(() => []);
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

      let anchor = lastMessageId || chat.lastMessage?.id || highestLocalId || null;
      if (!anchor && !reachedRemoteEnd && reset) {
        const probe = await $API.getMessages(chat.id, Date.now() + 100000, 1, 0).catch(() => null);
        const probeList = probe?.messages || (Array.isArray(probe) ? probe : []);
        if (probeList.length > 0 && probeList[0]?.id != null) {
          anchor = probeList[0].id;
        }
      }

      let remoteList = [];
      if (!reachedRemoteEnd && anchor) {
        const res = await $API.fetchChatMedia(chat.id, anchor, types, 0, PAGE_SIZE).catch(() => null);
        remoteList = res?.messages || res?.attaches || res?.items || (Array.isArray(res) ? res : []);
        if (remoteList.length < PAGE_SIZE) {
          reachedRemoteEnd = true;
        }
        if (remoteList.length > 0) {
          const lastMsg = remoteList[remoteList.length - 1];
          lastMessageId = lastMsg?.id || null;
        }
      } else {
        reachedRemoteEnd = true;
      }

      const parsedItems = [];
      const seen = new Set(reset ? [] : items.map(i => i.id));

      function addItem(item) {
        if (!item || !item.id) return;
        if (!seen.has(item.id)) {
          seen.add(item.id);
          parsedItems.push(item);
        }
      }

      for (const msg of remoteList) {
        const attaches = msg.attaches || msg.attachments || [];
        for (const att of attaches) {
          const rawType = (att.type || att._type || "").toUpperCase();
          if (!types.includes(rawType)) continue;

          let targetUrl = "";
          if (rawType === "VIDEO") {
            targetUrl = att.thumbnail || att.previewUrl || getPlaceholderUrl(att.previewData) || att.baseUrl || att.url || "";
          } else if (rawType === "PHOTO") {
            targetUrl = att.baseUrl || att.url || att.previewUrl || getPlaceholderUrl(att.previewData) || "";
          } else if (rawType === "AUDIO") {
            targetUrl = att.url || att.fileUrl || att.baseUrl || "";
          } else if (rawType === "FILE") {
            targetUrl = att.url || att.fileUrl || att.baseUrl || "";
          } else if (rawType === "SHARE") {
            targetUrl = att.link || att.url || att.shareUrl || "";
          }

          const fid = att.id || att.photoId || att.videoId || att.fileId || att.audioId || targetUrl || `${msg.id}_${rawType}`;
          addItem({
            id: `${msg.id}_${fid}`,
            messageId: msg.id,
            type: rawType,
            url: targetUrl,
            name: att.name || att.fileName || att.title || msg.text || "Вложение",
            size: att.size || att.fileSize || 0,
            time: msg.time || msg.created || Date.now(),
            link: att.link || att.url || att.shareUrl || targetUrl,
            isEncryptedMedia: false,
            videoType: att.videoType,
            width: att.width,
            height: att.height,
            duration: att.duration,
          });
        }
      }

      for (const msg of localMessages) {
        const attaches = msg.attaches || msg.attachments || [];
        for (const att of attaches) {
          const rawType = (att.type || att._type || "").toUpperCase();
          if (!types.includes(rawType)) continue;

          let targetUrl = "";
          if (rawType === "VIDEO") {
            targetUrl = att.thumbnail || att.previewUrl || getPlaceholderUrl(att.previewData) || att.baseUrl || att.url || (att.localPath ? getProxiedMediaUrl(att.localPath) : "");
          } else if (rawType === "PHOTO") {
            targetUrl = att.baseUrl || att.url || att.previewUrl || getPlaceholderUrl(att.previewData) || (att.localPath ? getProxiedMediaUrl(att.localPath) : "");
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
            type: rawType,
            url: targetUrl,
            name: att.name || att.fileName || att.title || msg.text || "Вложение",
            size: att.size || att.fileSize || 0,
            time: msg.time || msg.created || Date.now(),
            link: att.link || att.url || att.shareUrl || targetUrl,
            isEncryptedMedia: false,
            localPath: att.localPath || null,
            videoType: att.videoType,
            width: att.width,
            height: att.height,
            duration: att.duration,
          });
        }
      }

      const fileMsgs = localMessages.filter(m => {
        if (!m || !m.text || typeof m.text !== "string") return false;
        const attaches = m.attaches || m.attachments || [];
        return attaches.some(a => (a.type || a._type || "").toUpperCase() === "FILE" || a.isEncryptedMedia);
      });

      if (fileMsgs.length > 0) {
        const uncached = fileMsgs.filter(m => !decryptedCache.has(String(m.id)));
        if (uncached.length > 0) {
          const account = await getCurrentAccount().catch(() => null);
          const chatSettings = getChatSettings(chat.id);
          const password = (chatSettings ? get(chatSettings)?.password : null) || null;
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

        const account = await getCurrentAccount().catch(() => null);
        const accountId = Number(account?.id || 0);

        for (const msg of fileMsgs) {
          const dec = decryptedCache.get(String(msg.id));
          if (!dec || !dec.is_encrypted || dec.error || !dec.media) continue;
          const mType = (dec.media.media_type || "").toUpperCase();

          const isMatchingTab =
            (activeTab === "media" && (mType === "PHOTO" || mType === "VIDEO")) ||
            (activeTab === "audio" && mType === "AUDIO") ||
            (activeTab === "files" && mType === "FILE");

          if (!isMatchingTab) continue;

          const attachIdx = dec.media.attach_index ?? 0;
          const attaches = msg.attaches || msg.attachments || [];
          const rawAttach = attaches[attachIdx] || attaches[0];
          const fid = rawAttach?.fileId || rawAttach?.encryptedAttach?.fileId || msg.id;

          let resolvedUrl = "";
          let resolvedLocalPath = rawAttach?.localPath || null;

          if (resolvedLocalPath) {
            resolvedUrl = getProxiedMediaUrl(resolvedLocalPath);
          } else if (fid) {
            const cached = await invoke("get_cached_file", {
              account: accountId,
              src: `enc_media_${fid}`
            }).catch(() => null);
            if (cached) {
              resolvedLocalPath = cached;
              resolvedUrl = getProxiedMediaUrl(cached);
            }
          }

          addItem({
            id: `enc_${msg.id}_${fid}`,
            messageId: msg.id,
            type: mType,
            url: resolvedUrl,
            name: dec.media.name || rawAttach?.name || (mType === "VIDEO" ? "Видео" : "Фото"),
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
        }
      }

      parsedItems.sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));

      hasMore = !reachedRemoteEnd || !reachedLocalEnd;

      items = reset ? parsedItems : [...items, ...parsedItems];
    } catch (_) {
      hasMore = false;
    } finally {
      isLoading = false;
    }
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
            node.onload = () => { node.style.opacity = "1"; };
            node.onerror = () => { node.style.opacity = "1"; };
            node.src = proxied;
            if (node.complete) node.style.opacity = "1";
            return;
          }
          if ($autoDownloadEncryptedMedia && !cancelled) {
            const res = await $API.getFileById(chat.id, item.messageId, item.fileId).catch(() => null);
            if (res?.url && !cancelled) {
              const settingsStore = getChatSettings(chat.id);
              const settings = get(settingsStore);
              const cachedPath = await invoke("cache_encrypted_media", {
                account: accountId,
                chatId: Number(chat.id || 0),
                fileId: Number(item.fileId),
                src: res.url,
                password: settings?.password || null
              }).catch(() => null);
              if (cachedPath && !cancelled) {
                const proxied = getProxiedMediaUrl(cachedPath);
                item.url = proxied;
                item.localPath = cachedPath;
                node.onload = () => { node.style.opacity = "1"; };
                node.onerror = () => { node.style.opacity = "1"; };
                node.src = proxied;
                if (node.complete) node.style.opacity = "1";
                return;
              }
            }
          }
        } catch (_) {}
        node.style.opacity = "1";
        return;
      }

      const src = item?.url || item;
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
        } else if (!cancelled && src) {
          node.onload = () => { node.style.opacity = "1"; };
          node.onerror = () => { node.style.opacity = "1"; };
          node.src = src;
          if (node.complete) node.style.opacity = "1";
        }
      } catch (_) {
        if (!cancelled && src) {
          node.src = src;
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

  function openItem(item, idx) {
    if (activeTab === "media") {
      const mediaIdx = viewerMediaList.findIndex(m => m.baseUrl === item.url || m.fileId === item.fileId || (item.messageId && m.name === item.name));
      viewerIndex = mediaIdx >= 0 ? mediaIdx : (idx >= 0 ? idx : 0);
      viewerOpen = true;
    } else if (item.link) {
      window.open(item.link, "_blank");
    } else if (item.url) {
      getAssetUrl(item.url).then(cached => {
        window.open(cached || item.url, "_blank");
      }).catch(() => {
        window.open(item.url, "_blank");
      });
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
      <div class="media-grid">
        {#each items as item, idx (item.id)}
          <div class="media-tile" on:click={() => openItem(item, idx)}>
            {#if item.url}
              <img use:lazyLoad={item} alt={item.name} />
            {:else}
              <div class="media-placeholder">
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
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="media-list">
        {#each items as item (item.id)}
          <div class="media-list-row" on:click={() => openItem(item)}>
            <div class="icon-bubble">
              {#if activeTab === "files"}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                  <polyline points="13 2 13 9 20 9"/>
                </svg>
              {:else if activeTab === "audio"}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
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
                {formatMs(item.time)}
              </span>
            </div>
          </div>
        {/each}
      </div>
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
    on:close={() => (viewerOpen = false)}
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

  .media-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }

  .media-tile {
    position: relative;
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
    cursor: pointer;
  }

  .media-tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.2s;
  }

  .media-tile:hover img {
    transform: scale(1.04);
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
    color: #fff;
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
