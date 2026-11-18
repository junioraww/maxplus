import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import API, { currentUserDetails, currentUser, currentRealChats } from "$lib/stores/api";
import { updateContact } from "$lib/stores/contacts";
import { getCurrentAccount, setAccountContact } from "$lib/stores/accounts";
import { getChat, saveChats } from "$lib/stores/messages";
import { encodeStegoPayload, decodeStegoPayload } from "$lib/utils/stego";
import { getAssetUrl, getAvatarPlaceholder, getInitials, clearSafeAvatarImageCache, resetImageCaches } from "$lib/utils/images";
import { getSafeAvatarInstallUrl, getSafeAvatarMediaUrl, getSafeAvatarPreviewUrl } from "$lib/services/uplink";
import { safeAvatarMapStore, invalidateStegoScan, recordSafeAvatarForTarget } from "$lib/services/AvatarSyncManager";
import { MediaPool } from "$lib/services/MediaPool";

async function inspectImageCandidate(url, targetId) {
  if (!url) return null;
  const assetUrl = await getAssetUrl(url).catch(() => null) || url;
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = assetUrl;
  });

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h || w < 64 || h < 64) return null;

  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(512, 512)
    : document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 512, 512);
  const imgData = ctx.getImageData(0, 0, 512, 512);
  if (decodeStegoPayload(imgData, targetId)) return null;

  return { img, width: w, height: h };
}

export async function installSafeAvatar(avatarUid, targetId, onProgress, isChatExplicit = null) {
  if (!avatarUid || !targetId) {
    throw new Error("Не указан ID аватарки или ID профиля");
  }

  const cleanUid = String(avatarUid).trim();
  const details = get(currentUserDetails);
  const myUserId = Number(details?.id || get(currentUser) || 0);
  const currentTargetId = Number(targetId || myUserId || 0);

  let isChat = isChatExplicit;
  if (isChat === null || isChat === undefined) {
    if (currentTargetId === myUserId) {
      isChat = false;
    } else {
      const chatEntry = getChat(currentTargetId);
      const existingChat = chatEntry?.getInfo?.();
      isChat = Boolean(existingChat || Number(currentTargetId) < 0 || (myUserId > 0 && currentTargetId !== myUserId));
    }
  }

  const api = get(API);

  onProgress?.("Поиск чистой аватарки...");

  let chatObj = null;
  if (isChat) {
    try {
      const entry = getChat(currentTargetId);
      chatObj = entry?.getInfo?.() || await entry;
    } catch {}
  }

  const historyRes = !isChat ? await api?.fetchUserPhotos?.(currentTargetId, 0, 50).catch(() => null) : null;
  const candidateUrls = [...new Set([
    chatObj?.baseUrl,
    chatObj?.baseRawUrl,
    chatObj?.baseIconUrl,
    (!isChat ? details?.baseUrl : null),
    (!isChat ? details?.baseRawUrl : null),
    ...(!isChat ? (historyRes?.urls || []) : [])
  ].filter(Boolean))];

  let cleanBase = null;
  for (const url of candidateUrls) {
    try {
      cleanBase = await inspectImageCandidate(url, currentTargetId);
      if (cleanBase) break;
    } catch {}
  }

  const size = 512;

  onProgress?.(`Подготовка холста ${size}x${size}...`);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Не удалось создать контекст холста");

  if (cleanBase) {
    let sx = 0;
    let sy = 0;
    let sw = cleanBase.width;
    let sh = cleanBase.height;
    if (sw > sh) {
      sx = Math.round((sw - sh) / 2);
      sw = sh;
    } else if (sh > sw) {
      sy = Math.round((sh - sw) / 2);
      sh = sw;
    }
    ctx.drawImage(cleanBase.img, sx, sy, sw, sh, 0, 0, size, size);
  } else {
    const bg = getAvatarPlaceholder(currentTargetId, isChat ? "CHANNEL" : "USER");
    if (bg.startsWith("linear-gradient")) {
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, "#3b82f6");
      grad.addColorStop(1, "#8b5cf6");
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = bg;
    }
    ctx.fillRect(0, 0, size, size);
    const title = chatObj?.title || details?.title || details?.name || details?.firstName || "";
    const initials = getInitials(title);
    if (initials) {
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(size / 2.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials, size / 2, size / 2);
    }
  }

  onProgress?.("Внедрение скрытой стеганографии...");
  const imgData = ctx.getImageData(0, 0, size, size);
  if (!encodeStegoPayload(imgData, currentTargetId, cleanUid)) {
    throw new Error("Не удалось внедрить стеганографию");
  }
  ctx.putImageData(imgData, 0, 0);

  onProgress?.("Подготовка к отправке...");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Ошибка создания файла изображения");

  onProgress?.("Получение ссылки для загрузки...");
  const uploadReq = await invoke("get_photo_upload", { count: 1, profile: !isChat });
  const uploadUrl = uploadReq?.url || uploadReq?.info?.[0]?.url;
  if (!uploadUrl) {
    throw new Error("Не удалось получить ссылку для загрузки фото");
  }

  onProgress?.("Загрузка на сервер Max...");
  let photoToken = null;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const tempPath = await invoke("save_temp_media", {
      bytes: Array.from(new Uint8Array(arrayBuffer)),
      extension: "jpg",
      isVideo: false
    });
    const uploaded = await invoke("upload", {
      uploadUrl,
      path: tempPath,
      attachType: "PHOTO",
      mime: "image/jpeg"
    });
    if (uploaded && !uploaded.error) {
      photoToken = uploaded?.photoToken || uploaded?.token || null;
      if (!photoToken && uploaded?.photos && typeof uploaded.photos === "object") {
        for (const entry of Object.values(uploaded.photos)) {
          if (entry && typeof entry === "object" && entry.token) {
            photoToken = String(entry.token);
            break;
          }
        }
      }
    }
  } catch {}

  if (!photoToken) {
    const formData = new FormData();
    formData.append("file", blob, "image.jpg");
    const uploadRes = await fetch(uploadUrl, { method: "POST", body: formData });
    const uploadJson = await uploadRes.json();
    const photos = uploadJson?.photos;
    photoToken = photos?.[0]?.token || Object.values(photos || {})?.[0]?.token;
  }
  if (!photoToken) {
    throw new Error("Сервер не вернул токен загруженного фото");
  }

  onProgress?.("Применение аватарки...");
  let updatedChat = null;
  let contact = null;
  if (isChat) {
    const res = await invoke("set_chat_photo", {
      chatId: Number(currentTargetId),
      photoToken
    });
    updatedChat = res?.chat || res;
    if (updatedChat) {
      const chat = getChat(currentTargetId);
      let merged = null;
      chat.chatInfo.update((c) => {
        merged = { ...(c || chat.getInfo() || {}), ...updatedChat };
        return merged;
      });
      if (merged) {
        await saveChats([merged]).catch(() => {});
      }
      currentRealChats.update((ids) => [...(ids || [])]);
    }
    const acc = await getCurrentAccount().catch(() => null);
    resetImageCaches(acc?.id ? Number(acc.id) : 0);
    invalidateStegoScan(currentTargetId);
  } else {
    const res = await invoke("set_profile_photo", { photoToken });
    contact = res?.profile?.contact || res?.contact;
    if (contact) {
      currentUserDetails.set(contact);
      await updateContact(contact);
      const acc = await getCurrentAccount().catch(() => null);
      if (acc?.id) {
        await setAccountContact(acc.id, contact);
      }
      currentRealChats.update((ids) => [...(ids || [])]);
    }
    const acc = await getCurrentAccount().catch(() => null);
    resetImageCaches(acc?.id ? Number(acc.id) : 0);
    invalidateStegoScan(currentTargetId);
  }

  const mediaUrl = getSafeAvatarMediaUrl(cleanUid);
  try {
    const acc = await getCurrentAccount().catch(() => null);
    await invoke("cache_url", {
      account: acc?.id ? Number(acc.id) : 0,
      src: mediaUrl
    }).catch(() => {});
    await getAssetUrl(mediaUrl).catch(() => null);
  } catch {}

  const installedPhotoUrl = contact?.baseRawUrl || contact?.baseUrl || updatedChat?.baseRawUrl || updatedChat?.baseUrl || null;
  recordSafeAvatarForTarget(currentTargetId, cleanUid, installedPhotoUrl);
  if (!isChat) {
    if (details?.id) {
      recordSafeAvatarForTarget(details.id, cleanUid, installedPhotoUrl);
    }
    const curr = get(currentUser);
    if (curr) {
      recordSafeAvatarForTarget(curr, cleanUid, installedPhotoUrl);
    }
  }

  fetch(getSafeAvatarInstallUrl(cleanUid), { method: "POST" }).catch(() => {});

  return { success: true, targetId: currentTargetId, avatarUid: cleanUid };
}
