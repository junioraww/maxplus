<script>
  import { convertFileSrc, invoke } from '@tauri-apps/api/core';
  import { save } from "@tauri-apps/plugin-dialog";
  import { openPath } from "@tauri-apps/plugin-opener";
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';

  import { getAssetUrl, getProxiedMediaUrl } from "$lib/utils/images";
  import API from "$lib/stores/api";
  import { getCurrentAccount } from "$lib/stores/accounts";
  import { getChatSettings } from "$lib/stores/messages";
  import { autoDownloadEncryptedMedia } from "$lib/stores/e2eSettings";
  import StickerMedia from "$components/ChatWindow/Stickers/StickerMedia.svelte";
  import VoiceBubble from "$components/ChatWindow/VoiceBubble.svelte";
  import VideoNoteBubble from "$components/ChatWindow/VideoNoteBubble.svelte";

  export let getFile;
  export let attaches;
  export let handleMediaClick;
  export let chatId = null;
  export let messageId = null;
  export let isMe = false;

  let downloadingMap = {};

  $: mediaAttaches = (attaches || []).filter(
    (a) => {
      const t = a._type || a.type;
      return t === "PHOTO" || t === "VIDEO" || t === "FILE" || t === "AUDIO";
    }
  );
  $: mediaItems = mediaAttaches.filter(a => {
    const t = a._type || a.type;
    return t === "PHOTO" || (t === "VIDEO" && a.videoType !== 1 && !a.isNote);
  });

  let placeholderUrls = {};
  function getPlaceholderUrl(previewData) {
    if (!previewData) return null;
    if (placeholderUrls[previewData]) return placeholderUrls[previewData];
    try {
      const bytes = Uint8Array.from(previewData, c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/webp' });
      const url = URL.createObjectURL(blob);
      placeholderUrls[previewData] = url;
      return url;
    } catch (e) {
      console.warn('Failed to create placeholder URL', e);
      return null;
    }
  }

  onDestroy(() => {
    Object.values(placeholderUrls).forEach(url => URL.revokeObjectURL(url));
  });

  function lazyLoad(node, src) {
    let cancelled = false;
    let url = null;
    let observer;

    if (!node.src || node.src.startsWith("data:")) {
      node.style.opacity = "0";
    }

    async function load() {
      url = await getAssetUrl(src);

      if (!cancelled && url) {
        node.onload = () => {
          node.style.opacity = "1";
        };
        node.src = url;
      }
    }

    if (IntersectionObserver) {
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

  function computeLayout(items) {
    const n = items.length;
    if (n === 0) return { gridTemplateColumns: '', gridTemplateRows: '', items: [] };

    if (n === 1) {
      const item = items[0];
      const w = item.width || 1;
      const h = item.height || 1;
      const maxWidth = 320;
      const maxHeight = 450;

      const computedHeight = Math.min((maxWidth / (w / h)), maxHeight);
      return {
        gridTemplateColumns: '1fr',
        gridTemplateRows: 'auto',
        items: [{ style: `height: ${computedHeight}px;` }]
      };
    }

    if (n === 2) {
      return {
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '200px',
        items: [{}, {}]
      };
    }

    if (n === 3) {
      return {
        gridTemplateColumns: '2fr 1fr',
        gridTemplateRows: '150px 150px',
        items: [
          { gridColumn: '1 / 2', gridRow: '1 / 3' },
          { gridColumn: '2 / 3', gridRow: '1 / 2' },
          { gridColumn: '2 / 3', gridRow: '2 / 3' }
        ]
      };
    }

    if (n === 4) {
      return {
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '150px 150px',
        items: [
          { gridColumn: '1 / 2', gridRow: '1 / 2' },
          { gridColumn: '2 / 3', gridRow: '1 / 2' },
          { gridColumn: '1 / 2', gridRow: '2 / 3' },
          { gridColumn: '2 / 3', gridRow: '2 / 3' }
        ]
      };
    }

    const cols = 3;
    const rows = Math.ceil(n / cols);
    const height = 150;
    const itemsLayout = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      itemsLayout.push({
        gridColumn: `${col + 1} / ${col + 2}`,
        gridRow: `${row + 1} / ${row + 2}`
      });
    }
    return {
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${rows}, ${height}px)`,
      items: itemsLayout
    };
  }

  $: layout = computeLayout(mediaItems);

  async function openFile(attach) {
    if (attach.filePath) {
      try {
        await openPath(attach.filePath);
      } catch (e) {
        console.error("Failed to open file", e);
      }
    }
  }

  let encryptedMediaUrls = {};
  let downloadingEncrypted = {};

  async function ensureEncryptedMediaUrl(attach) {
    if (!attach.isEncryptedMedia) return null;
    const fid = attach.fileId || attach.encryptedAttach?.fileId;
    if (!fid) return null;

    if (attach.localPath) {
      const url = convertFileSrc(attach.localPath);
      if (encryptedMediaUrls[fid] !== url) {
        encryptedMediaUrls = { ...encryptedMediaUrls, [fid]: url };
      }
      return url;
    }

    if (encryptedMediaUrls[fid]) {
      return encryptedMediaUrls[fid];
    }

    try {
      const account = await getCurrentAccount().catch(() => null);
      const accountId = Number(account?.id || 0);
      const cached = await invoke("get_cached_file", {
        account: accountId,
        src: `enc_media_${fid}`
      }).catch(() => null);

      if (cached) {
        const url = convertFileSrc(cached);
        encryptedMediaUrls = { ...encryptedMediaUrls, [fid]: url };
        attach.localPath = cached;
        attach.baseUrl = url;
        return url;
      }
    } catch (_) {}

    if ($autoDownloadEncryptedMedia && !downloadingEncrypted[fid]) {
      downloadAndCacheEncrypted(attach);
    }

    return null;
  }

  async function downloadAndCacheEncrypted(attach) {
    const fid = attach.fileId || attach.encryptedAttach?.fileId;
    if (!fid || downloadingEncrypted[fid]) return;
    downloadingEncrypted = { ...downloadingEncrypted, [fid]: true };

    try {
      const response = await getFile(fid);
      if (!response?.url) return;

      const account = await getCurrentAccount().catch(() => null);
      const accountId = Number(account?.id || 0);
      const settings = chatId ? get(getChatSettings(chatId)) : null;

      const cachedPath = await invoke("cache_encrypted_media", {
        account: accountId,
        chatId: Number(chatId || 0),
        fileId: Number(fid),
        src: response.url,
        password: settings?.password || null,
      });

      if (cachedPath) {
        const url = convertFileSrc(cachedPath);
        encryptedMediaUrls = { ...encryptedMediaUrls, [fid]: url };
        attach.localPath = cachedPath;
        attach.baseUrl = url;
      }
    } catch (err) {
      console.error("Failed to download encrypted media:", err);
    } finally {
      downloadingEncrypted = { ...downloadingEncrypted, [fid]: false };
    }
  }

  $: (mediaItems || []).forEach(a => {
    if (a.isEncryptedMedia) ensureEncryptedMediaUrl(a);
  });

  $: (attaches || []).forEach(a => {
    if (a.isEncryptedMedia && (a._type === "AUDIO" || (a._type === "VIDEO" && a.videoType === 1))) {
      ensureEncryptedMediaUrl(a);
    }
  });

  function onMediaItemClick(attach) {
    if (attach.isEncryptedMedia) {
      const fid = attach.fileId || attach.encryptedAttach?.fileId;
      const isVideo = (attach._type || attach.type) === "VIDEO";
      const resolved = attach.localPath
        ? (isVideo ? getProxiedMediaUrl(attach.localPath) : convertFileSrc(attach.localPath))
        : encryptedMediaUrls[fid];
      if (!resolved) {
        downloadAndCacheEncrypted(attach);
        return;
      }
      attach.baseUrl = resolved;
    }
    handleMediaClick(attach);
  }

  function isDownloaded(attach) { return Boolean(attach.filePath); }

  function isDownloading(attach) {
    const fid = attach.fileId || attach.encryptedAttach?.fileId;
    return Boolean(downloadingMap[fid]);
  }

  async function handleFileClick(attach) {
    if (isDownloaded(attach)) { openFile(attach); return; }
    const fileId = attach.fileId || attach.encryptedAttach?.fileId;
    if (!fileId || isDownloading(attach)) return;
    downloadingMap = { ...downloadingMap, [fileId]: true };

    const path = await save({
      defaultPath: attach.name || "downloaded_file",
    });

    if (!path) {
      downloadingMap = { ...downloadingMap, [fileId]: false };
      return;
    }

    try {
      if (attach.isEncryptedMedia) {
        if (attach.localPath) {
          await invoke("download_to_path", { url: attach.localPath, path });
          for (const a of (attaches || [])) {
            if (a.fileId === fileId || a.encryptedAttach?.fileId === fileId) {
              a.filePath = path;
            }
          }
          attaches = attaches;
          return;
        }

        const currentAccount = await getCurrentAccount();
        const accountId = Number(currentAccount?.id || 0);
        const cached = await invoke("get_cached_file", {
          account: accountId,
          src: `enc_media_${fileId}`,
        }).catch(() => null);
        if (cached) {
          attach.localPath = cached;
          await invoke("download_to_path", { url: cached, path });
          for (const a of (attaches || [])) {
            if (a.fileId === fileId || a.encryptedAttach?.fileId === fileId) {
              a.filePath = path;
            }
          }
          attaches = attaches;
          return;
        }
      }

      const response = await getFile(fileId);
      if (!response?.url) {
        downloadingMap = { ...downloadingMap, [fileId]: false };
        return;
      }

      if (attach.isEncryptedMedia) {
        const tempEncPath = `${path}.enc`;
        await invoke("download_to_path", {
          url: response.url,
          path: tempEncPath,
        });

        const currentAccount = await getCurrentAccount();
        const settings = chatId ? get(getChatSettings(chatId)) : null;
        await invoke("decrypt_media_file", {
          account: Number(currentAccount?.id || 0),
          chatId: Number(chatId || 0),
          filePath: tempEncPath,
          outPath: path,
          targetPath: path,
          password: settings?.password || null,
        });
      } else {
        await invoke("download_to_path", {
          url: response.url,
          path,
        });
      }

      for (const a of (attaches || [])) {
        if (a.fileId === fileId || a.encryptedAttach?.fileId === fileId) {
          a.filePath = path;
        }
      }

      attaches = attaches;
    } catch (err) {
      console.error("Ошибка при загрузке файла:", err);
    } finally {
      downloadingMap = { ...downloadingMap, [fileId]: false };
    }
  }

  async function downloadMediaItem(attach) {
    try {
      if (attach.isEncryptedMedia) {
        const defaultName = attach.name || (attach._type === "VIDEO" ? `video_${Date.now()}.mp4` : `photo_${Date.now()}.jpg`);
        const filePath = await save({
          defaultPath: defaultName,
        });
        if (!filePath) return;

        if (attach.localPath) {
          await invoke("download_to_path", { url: attach.localPath, path: filePath });
          return;
        }

        const fileId = attach.fileId || attach.encryptedAttach?.fileId;
        const currentAccount = await getCurrentAccount();
        const accountId = Number(currentAccount?.id || 0);
        const cached = await invoke("get_cached_file", {
          account: accountId,
          src: `enc_media_${fileId}`,
        }).catch(() => null);
        if (cached) {
          attach.localPath = cached;
          await invoke("download_to_path", { url: cached, path: filePath });
          return;
        }

        const response = await getFile(fileId);
        if (!response?.url) return;

        const tempEncPath = `${filePath}.enc`;
        await invoke("download_to_path", {
          url: response.url,
          path: tempEncPath,
        });

        const settings = chatId ? get(getChatSettings(chatId)) : null;
        await invoke("decrypt_media_file", {
          account: accountId,
          chatId: Number(chatId || 0),
          filePath: tempEncPath,
          outPath: filePath,
          targetPath: filePath,
          password: settings?.password || null,
        });
        return;
      }
      if (attach._type === "PHOTO") {
        const url = attach.baseUrl;
        if (!url) return;
        const defaultName = attach.name || `photo_${Date.now()}.jpg`;
        const filePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
        });
        if (filePath) {
          await invoke("download_to_path", { url, path: filePath });
        }
      } else if (attach._type === "VIDEO") {
        let videoUrl = null;
        if (attach.videoId && chatId != null && (attach.messageId || messageId)) {
          const response = await $API.getVideoById(
            chatId,
            attach.messageId || messageId,
            attach.videoId,
            attach.videoToken || attach.token,
          );
          const qualityPriority = ["MP4_1080", "MP4_720", "MP4_480", "MP4_360"];
          for (const quality of qualityPriority) {
            if (response[quality]) {
              videoUrl = response[quality];
              break;
            }
          }
          if (!videoUrl && response.HLS) videoUrl = response.HLS;
        }
        if (!videoUrl) videoUrl = attach.baseUrl;
        if (!videoUrl) return;
        const defaultName = attach.name || `video_${Date.now()}.mp4`;
        const filePath = await save({
          defaultPath: defaultName,
          filters: [{ name: "Videos", extensions: ["mp4", "webm", "mov"] }],
        });
        if (filePath) {
          await invoke("download_to_path", { url: videoUrl, path: filePath });
        }
      }
    } catch (e) {
      console.error("downloadMediaItem error:", e);
    }
  }
</script>

<div
  class="media-grid"
  style="grid-template-columns: {layout.gridTemplateColumns}; grid-template-rows: {layout.gridTemplateRows};"
>
  {#each mediaItems as attach, i}
    <div
      class="grid-item"
      style="grid-column: {layout.items[i]?.gridColumn || 'auto'}; grid-row: {layout.items[i]?.gridRow || 'auto'}; {layout.items[i]?.style || ''}"
      on:mousedown|stopPropagation
      on:mouseup|stopPropagation
      on:click|stopPropagation={() => onMediaItemClick(attach)}
    >
      <button
        class="media-download-badge"
        on:mousedown|stopPropagation
        on:mouseup|stopPropagation
        on:click|stopPropagation={() => downloadMediaItem(attach)}
        title="Скачать"
      >
        <svg viewBox="0 0 24 24">
          <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
        </svg>
      </button>
      {#if attach._type === "PHOTO"}
        {#if attach.isEncryptedMedia && !(attach.localPath || encryptedMediaUrls[attach.fileId || attach.encryptedAttach?.fileId])}
          <div
            class="encrypted-media-box"
            style="background: {attach.color || '#272b35'}; width: 100%; height: 100%; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;"
            on:mousedown|stopPropagation
            on:mouseup|stopPropagation
            on:click|stopPropagation={() => downloadAndCacheEncrypted(attach)}
          >
            {#if downloadingEncrypted[attach.fileId || attach.encryptedAttach?.fileId]}
              <div class="spinner"></div>
            {:else}
              <div class="enc-action-circle">
                <svg viewBox="0 0 24 24" class="enc-icon"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>
              </div>
              <span class="enc-size-label">{(attach.size / 1024).toFixed(1)} KB</span>
            {/if}
          </div>
        {:else}
          <img
            use:lazyLoad={attach.isEncryptedMedia ? (attach.localPath ? convertFileSrc(attach.localPath) : encryptedMediaUrls[attach.fileId || attach.encryptedAttach?.fileId]) : attach.baseUrl}
            src={getPlaceholderUrl(attach.previewData) || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"}
            alt=""
            loading="lazy"
            decoding="async"
            width={attach.width}
            height={attach.height}
          />
        {/if}
      {:else if attach._type === "VIDEO"}
        {#if attach.isEncryptedMedia && !(attach.localPath || encryptedMediaUrls[attach.fileId || attach.encryptedAttach?.fileId])}
          <div
            class="encrypted-media-box"
            style="background: {attach.color || '#1e2430'}; width: 100%; height: 100%; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;"
            on:mousedown|stopPropagation
            on:mouseup|stopPropagation
            on:click|stopPropagation={() => downloadAndCacheEncrypted(attach)}
          >
            {#if downloadingEncrypted[attach.fileId || attach.encryptedAttach?.fileId]}
              <div class="spinner"></div>
            {:else}
              <div class="enc-action-circle">
                <svg viewBox="0 0 24 24" class="enc-icon"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/></svg>
              </div>
              <span class="enc-size-label">{(attach.size / 1024).toFixed(1)} KB</span>
            {/if}
          </div>
        {:else}
          <div class="video-preview">
            {#if attach.isEncryptedMedia}
              <video
                src={getProxiedMediaUrl(attach.localPath || encryptedMediaUrls[attach.fileId || attach.encryptedAttach?.fileId])}
                preload="metadata"
                muted
                playsinline
                class="video-preview-element"
              ></video>
            {:else}
              <img
                use:lazyLoad={attach.thumbnail || attach.baseUrl}
                src={getPlaceholderUrl(attach.previewData) || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"}
                alt=""
                loading="lazy"
                decoding="async"
                width={attach.width}
                height={attach.height}
              />
            {/if}
            <div class="play-icon">▶</div>
          </div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

{#each mediaAttaches.filter(a => a._type === "FILE") as attach}
  <div
    class="file-attach"
    on:mousedown|stopPropagation
    on:mouseup|stopPropagation
    on:click|stopPropagation={() => handleFileClick(attach)}
  >
    <div class="file-icon">
      {#if isDownloading(attach)}<div class="spinner"></div>
      {:else if isDownloaded(attach)}📄{:else}⬇️{/if}
    </div>
    <div class="file-info">
      <div class="file-name">{attach.name}</div>
      <div class="file-size">{(attach.size / 1024).toFixed(1)} KB</div>
    </div>
  </div>
{/each}

{#each attaches.filter(a => a._type === "STICKER") as attach}
  <div class="sticker-inline" on:click|stopPropagation={() => handleMediaClick(attach)}>
    <StickerMedia
      url={attach.baseUrl || attach.url}
      lottieUrl={attach.lottieUrl}
      size={140}
      autoplay={true}
      loop={true}
    />
  </div>
{/each}

{#each attaches.filter(a => (a._type || a.type) === "AUDIO") as attach}
  <VoiceBubble {attach} {messageId} {chatId} {isMe} />
{/each}

{#each attaches.filter(a => ((a._type || a.type) === "VIDEO") && (a.videoType === 1 || a.isNote)) as attach}
  <VideoNoteBubble {attach} {messageId} {chatId} {isMe} />
{/each}

{#each attaches.filter(a =>
  a._type !== "PHOTO" &&
  a._type !== "VIDEO" &&
  a._type !== "AUDIO" &&
  a._type !== "FILE" &&
  a._type !== "STICKER" &&
  a._type !== "CONTROL" &&
  a._type !== "INLINE_KEYBOARD" &&
  a._type !== "REPLY" &&
  a._type !== "FORWARD") as attach}
  <div class="unsupported-attach">{attach._type} не поддерживается</div>
{/each}

<style>
  .media-grid {
    display: grid;
    gap: 4px;
    margin-top: 6px;
    margin-right: 8px;
    border-radius: 10px;
    overflow: hidden;
    width: 100%;
    max-width: 320px;
  }

  .grid-item {
    cursor: pointer;
    position: relative;
    overflow: hidden;
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0%,
      rgba(255, 255, 255, 0.12) 35%,
      rgba(79, 195, 247, 0.16) 50%,
      rgba(255, 255, 255, 0.12) 65%,
      rgba(255, 255, 255, 0.04) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.6s infinite linear;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .media-download-badge {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    border: none;
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    opacity: 0;
    transition: opacity 0.2s, transform 0.15s, background 0.2s;
    padding: 0;
  }

  .media-download-badge svg {
    width: 16px;
    height: 16px;
    fill: #ffffff;
  }

  .grid-item:hover .media-download-badge {
    opacity: 1;
  }

  .media-download-badge:hover {
    background: rgba(0, 0, 0, 0.85);
    transform: scale(1.1);
  }

  .grid-item img,
  .grid-item video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: opacity 0.2s ease;
  }

  .video-preview {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .video-preview .play-icon {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.6);
    color: white;
    width: 40px; height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    pointer-events: none;
  }

  .file-attach {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 10px;
    cursor: pointer;
    background-color: #0002;
    margin-right: 10px;
    margin-top: 4px;
  }

  .file-icon {
    min-width: 36px;
    max-width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
  }

  .file-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .file-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-size {
    font-size: 11px;
    opacity: 0.6;
  }

  .unsupported-attach {
    font-size: 11px;
    opacity: 0.5;
    margin-top: 5px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 3px;
  }

  img {
    transform: translateZ(0);
  }

  .encrypted-media-box {
    border-radius: 8px;
    position: relative;
    overflow: hidden;
    transition: filter 0.2s ease, transform 0.2s ease;
  }

  .encrypted-media-box:hover {
    filter: brightness(1.08);
  }

  .enc-action-circle {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    margin-bottom: 6px;
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .encrypted-media-box:hover .enc-action-circle {
    transform: scale(1.08);
  }

  .enc-icon {
    width: 22px;
    height: 22px;
  }

  .enc-size-label {
    font-size: 12px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
</style>
