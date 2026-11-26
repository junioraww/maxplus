import { writable, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { hashString, generateProceduralTheme, renderIconToRgba } from "./engine";
import { getCurrentAccount, decryptHardware } from "$lib/stores/accounts";
import { retrieveHardwareKey } from "$lib/services/hardwareSecurity";
import { openLockScreen } from "$lib/stores/lockScreen";
import decoysData from "./decoys.json";

export function pickDecoyVariant(appType, seed = Date.now()) {
  if (decoysData?.categories?.[appType]?.length) {
    const items = decoysData.categories[appType];
    const index = Math.abs(seed) % items.length;
    const chosen = items[index];
    const iconObj = decoysData.icons?.find(ic => ic.index === chosen.iconIndex) || decoysData.icons?.[0];
    return {
      aliasIndex: chosen.aliasIndex,
      appLabel: chosen.label,
      iconIndex: chosen.iconIndex,
      iconSvg: iconObj?.svgContent || null
    };
  }
  return null;
}

export function resolveProceduralTheme(settings) {
  const seed = settings?.seed || 133742;
  const appType = settings?.appType || "calculator";
  const isLight = typeof document !== "undefined"
    ? document.documentElement?.getAttribute("data-theme") === "light"
    : false;
  const cached = settings?.proceduralTheme;
  const theme = (cached && cached.seed === seed && Boolean(cached.isLight) === isLight)
    ? { ...cached }
    : generateProceduralTheme(seed, isLight);
  const variant = pickDecoyVariant(appType, seed);
  if (variant?.iconSvg) {
    theme.iconSvg = variant.iconSvg;
  }
  return theme;
}

const DEFAULT_SETTINGS = {
  enabled: false,
  appType: "calculator",
  pin: "0000",
  seed: 133742,
  aliasIndex: 1,
  appLabel: "Калькулятор",
  autoLock: true
};

const preloaded = typeof window !== "undefined" && window.__CAMOUFLAGE_DATA__;
const initialSettings = preloaded ? { ...DEFAULT_SETTINGS, ...preloaded } : DEFAULT_SETTINGS;
const initialCamouflaged = typeof window !== "undefined" && (Boolean(window.__CAMOUFLAGE_BOOT__) || Boolean(initialSettings.enabled));
const initialTheme = resolveProceduralTheme(initialSettings);

export const camouflageSettings = writable(initialSettings);
export const isCamouflageLocked = writable(initialCamouflaged);
export const activeProceduralTheme = writable(initialTheme);
export const pluginCustomApps = writable([]);

export function registerCamouflagePluginApp(app) {
  if (!app?.id || !app?.label) return;
  pluginCustomApps.update(list => [...list.filter(a => a.id !== app.id), app]);
}

export function unregisterCamouflagePluginApp(appId) {
  pluginCustomApps.update(list => list.filter(a => a.id !== appId));
}

function getHardwareSeed() {
  if (typeof window === "undefined") return 133742;
  const metrics = [
    window.screen?.width || 0,
    window.screen?.height || 0,
    window.screen?.colorDepth || 0,
    window.devicePixelRatio || 1,
    navigator?.hardwareConcurrency || 2,
    navigator?.platform || "",
    navigator?.userAgent || ""
  ].join("_");
  return hashString(metrics);
}

export function generateNewSeed() {
  const base = getHardwareSeed();
  return (base ^ hashString(String(Date.now()))) >>> 0;
}

export async function syncCamouflageWindowIcon(theme, label, aliasIndex) {
  if (typeof window === "undefined") return;
  let iconData = null;
  if (theme?.iconSvg) {
    try {
      iconData = await renderIconToRgba(theme.iconSvg, 128);
    } catch {}
  }
  const width = iconData?.width || 2;
  const height = iconData?.height || 2;
  const rgba = (iconData?.rgba && iconData.rgba.length === width * height * 4)
    ? iconData.rgba
    : new Array(width * height * 4).fill(0);

  try {
    await invoke("set_camouflage_icon", {
      rgba,
      pngBase64: iconData?.pngBase64 || null,
      width,
      height,
      label: label || null,
      aliasIndex: Number(aliasIndex) || 1
    });
  } catch {}
}

export async function restoreCamouflageWindowIcon() {
  if (typeof window === "undefined") return;
  try {
    await invoke("restore_camouflage_icon");
  } catch {}
}

let initPromise = null;

export function initCamouflageOnStartup() {
  if (initPromise) return initPromise;
  initPromise = loadCamouflageSettings();
  return initPromise;
}

if (typeof window !== "undefined") {
  initCamouflageOnStartup();
}

export async function loadCamouflageSettings() {
  try {
    const data = await invoke("common_store_load", { store: "camouflage" });
    if (data && typeof data === "object") {
      const merged = { ...DEFAULT_SETTINGS, ...data };
      if (!merged.seed) merged.seed = 133742;
      const variant = pickDecoyVariant(merged.appType, merged.seed);
      if (variant) {
        merged.appLabel = variant.appLabel;
        merged.aliasIndex = variant.aliasIndex;
      }
      const theme = resolveProceduralTheme(merged);
      merged.proceduralTheme = theme;
      camouflageSettings.set(merged);
      activeProceduralTheme.set(theme);
      if (!data.proceduralTheme) {
        invoke("common_store_save", { store: "camouflage", data: merged }).catch(() => {});
      }
      if (merged.enabled) {
        isCamouflageLocked.set(true);
        syncCamouflageWindowIcon(theme, merged.appLabel, merged.aliasIndex).catch(() => {});
      }
      return merged;
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export async function saveCamouflageSettings(newSettings) {
  const current = get(camouflageSettings);
  const updated = { ...current, ...newSettings };
  if (newSettings.seed !== undefined && newSettings.seed !== current.seed) {
    delete updated.proceduralTheme;
  }
  const variant = pickDecoyVariant(updated.appType, updated.seed);
  if (variant) {
    updated.appLabel = variant.appLabel;
    updated.aliasIndex = variant.aliasIndex;
  }
  const theme = resolveProceduralTheme(updated);

  updated.proceduralTheme = theme;
  camouflageSettings.set(updated);
  activeProceduralTheme.set(theme);
  await invoke("common_store_save", { store: "camouflage", data: updated }).catch(() => {});
  if (updated.enabled) {
    await syncCamouflageWindowIcon(theme, updated.appLabel, updated.aliasIndex);
  } else if (current.enabled && !updated.enabled) {
    await restoreCamouflageWindowIcon();
  }
}

export function lockCamouflage() {
  const s = get(camouflageSettings);
  if (s.enabled) {
    isCamouflageLocked.set(true);
    syncCamouflageWindowIcon(get(activeProceduralTheme), s.appLabel, s.aliasIndex).catch(() => {});
  }
}

export async function verifyAndUnlockCamouflage(enteredPin) {
  const s = get(camouflageSettings);
  const unlock = () => {
    isCamouflageLocked.set(false);
    return { success: true };
  };

  if (!s.enabled) return unlock();

  if (String(enteredPin).trim() !== String(s.pin || "0000").trim()) {
    return { success: false, reason: "mismatch" };
  }

  const acc = await getCurrentAccount().catch(() => null);

  if (acc?.encryption?.type === "hardware-1") {
    try {
      const key = await retrieveHardwareKey(acc.id, "Разблокировка учетной записи");
      if (!key) return { success: false, reason: "biometry_canceled" };
      await decryptHardware(acc.id, key);
      return unlock();
    } catch {
      return { success: false, reason: "biometry_failed" };
    }
  }

  if (acc?.encryption?.type === "pin-1") {
    unlock();
    openLockScreen({ mode: "decrypt" });
    return { success: true };
  }

  return unlock();
}
