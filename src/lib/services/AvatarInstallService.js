import { invoke } from "@tauri-apps/api/core";
import { encodeStegoPayload } from "$lib/utils/stego";
import { getSafeAvatarPreviewUrl, getSafeAvatarInstallUrl } from "$lib/services/uplink";
import { safeAvatarMapStore } from "$lib/services/AvatarSyncManager";

export async function installSafeAvatar(avatarUid, targetId, onProgress) {
  if (!avatarUid || !targetId) {
    throw new Error("Не указан ID аватарки или ID профиля");
  }

  const cleanUid = String(avatarUid).trim();
  onProgress?.("Загрузка постера аватарки...");

  const previewUrl = getSafeAvatarPreviewUrl(cleanUid);
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("Не удалось загрузить постер аватарки"));
    img.src = previewUrl;
  });

  onProgress?.("Подготовка холста 512x512...");
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось создать контекст холста");

  ctx.drawImage(img, 0, 0, 512, 512);

  onProgress?.("Внедрение скрытой стеганографии...");
  const imgData = ctx.getImageData(0, 0, 512, 512);
  const encoded = encodeStegoPayload(imgData, targetId, cleanUid);
  if (!encoded) {
    throw new Error("Не удалось внедрить стеганографию");
  }
  ctx.putImageData(imgData, 0, 0);

  onProgress?.("Подготовка к отправке...");
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Ошибка создания файла изображения");

  const arrayBuffer = await blob.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);

  onProgress?.("Получение ссылки для загрузки...");
  const uploadReq = await invoke("get_photo_upload", { count: 1, profile: true });
  const uploadUrl = uploadReq?.url || uploadReq?.info?.[0]?.url;
  if (!uploadUrl) {
    throw new Error("Не удалось получить ссылку для загрузки фото профиля");
  }

  onProgress?.("Загрузка на сервер Max...");
  const tempFileName = `stego_avatar_${Date.now()}.jpg`;
  const tempPath = await invoke("save_temp_bytes", {
    fileName: tempFileName,
    bytes: Array.from(uint8)
  }).catch(() => null);

  let photoToken = null;
  if (tempPath) {
    const uploaded = await invoke("upload", {
      uploadUrl,
      path: tempPath,
      attachType: "PHOTO",
      mime: "image/jpeg",
    }).catch(() => null);
    photoToken = uploaded?.photoToken || uploaded?.token;
  }

  if (!photoToken) {
    const formData = new FormData();
    formData.append("file", blob, "image.jpg");
    const uploadRes = await fetch(uploadUrl, { method: "POST", body: formData });
    const uploadJson = await uploadRes.json();
    const photos = uploadJson?.photos;
    if (photos && typeof photos === "object") {
      const first = Object.values(photos)[0];
      photoToken = first?.token;
    }
  }

  if (!photoToken) {
    throw new Error("Ошибка получения токена фото");
  }

  onProgress?.("Обновление профиля...");
  await invoke("set_profile_photo", { photoToken });

  safeAvatarMapStore.update((map) => {
    map.set(Number(targetId), cleanUid);
    try {
      const entries = Array.from(map.entries());
      localStorage.setItem("maxplus_safe_avatar_map", JSON.stringify(entries));
    } catch {}
    return map;
  });

  fetch(getSafeAvatarInstallUrl(cleanUid), { method: "POST" }).catch(() => {});

  return { success: true, uid: cleanUid };
}
