import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import API, { currentUserDetails, currentUser } from "$lib/stores/api";
import { updateContact } from "$lib/stores/contacts";
import { getCurrentAccount, setAccountContact } from "$lib/stores/accounts";
import { encodeStegoPayload, decodeStegoPayload } from "$lib/utils/stego";
import { getAssetUrl } from "$lib/utils/images";
import { getSafeAvatarInstallUrl } from "$lib/services/uplink";
import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";

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
    ? new OffscreenCanvas(w, h)
    : document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  if (decodeStegoPayload(imgData, targetId)) return null;

  return { img, width: w, height: h };
}

export async function installSafeAvatar(avatarUid, targetId, onProgress) {
  if (!avatarUid || !targetId) {
    throw new Error("Не указан ID аватарки или ID профиля");
  }

  const cleanUid = String(avatarUid).trim();
  const details = get(currentUserDetails);
  const currentTargetId = Number(targetId || details?.id || get(currentUser) || 0);
  const api = get(API);

  onProgress?.("Поиск чистой аватарки...");

  const historyRes = await api?.fetchUserPhotos?.(currentTargetId, 0, 50).catch(() => null);
  const candidateUrls = [...new Set([
    details?.baseRawUrl,
    details?.baseUrl,
    details?.avatar,
    ...(historyRes?.urls || [])
  ].filter(Boolean))];

  let cleanBase = null;
  for (const url of candidateUrls) {
    try {
      cleanBase = await inspectImageCandidate(url, currentTargetId);
      if (cleanBase) break;
    } catch {}
  }

  const size = cleanBase ? Math.min(1024, Math.max(512, Math.min(cleanBase.width, cleanBase.height))) : 512;

  onProgress?.(`Подготовка холста ${size}x${size}...`);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Не удалось создать контекст холста");

  if (cleanBase) {
    ctx.drawImage(cleanBase.img, 0, 0, size, size);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
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
  const uploadReq = await invoke("get_photo_upload", { count: 1, profile: true });
  const uploadUrl = uploadReq?.url || uploadReq?.info?.[0]?.url;
  if (!uploadUrl) {
    throw new Error("Не удалось получить ссылку для загрузки фото профиля");
  }

  onProgress?.("Загрузка на сервер Max...");
  const formData = new FormData();
  formData.append("file", blob, "image.jpg");
  const uploadRes = await fetch(uploadUrl, { method: "POST", body: formData });
  const uploadJson = await uploadRes.json();
  const photos = uploadJson?.photos;
  const photoToken = photos && typeof photos === "object" ? Object.values(photos)[0]?.token : null;

  if (!photoToken) {
    throw new Error("Ошибка получения токена фото");
  }

  onProgress?.("Обновление профиля...");
  const setRes = await invoke("set_profile_photo", { photoToken });
  const updatedContact = setRes?.profile?.contact || setRes?.contact;
  if (updatedContact) {
    currentUserDetails.set(updatedContact);
    await updateContact(updatedContact).catch(() => {});
    const account = await getCurrentAccount().catch(() => null);
    if (account?.id) {
      await setAccountContact(account.id, updatedContact).catch(() => {});
    }
  }

  safeAvatarMapStore.update((map) => {
    map.set(Number(currentTargetId), cleanUid);
    try {
      const entries = Array.from(map.entries());
      localStorage.setItem("maxplus_safe_avatar_map", JSON.stringify(entries));
    } catch {}
    return map;
  });

  fetch(getSafeAvatarInstallUrl(cleanUid), { method: "POST" }).catch(() => {});

  return { success: true, uid: cleanUid };
}
