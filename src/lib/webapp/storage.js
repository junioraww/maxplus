import { invoke } from "@tauri-apps/api/core";

const MAX_STORAGE_KEYS = 500;
const memoryStore = new Map();

async function callInvoke(cmd, args) {
  try {
    if (typeof window !== "undefined" && (window.__TAURI_INTERNALS__ || window.__TAURI__)) {
      return await invoke(cmd, args);
    }
  } catch {}
  return null;
}

function buildMemKey(userId, botId, isSecure, key) {
  const scope = isSecure ? "sec" : "dev";
  return `${userId || ""}_${botId || ""}_${scope}_${key}`;
}

function buildBioMemKey(userId, botId) {
  return `${userId || ""}_${botId || ""}`;
}

export async function saveStorageKey(userId, botId, isSecure, key, value) {
  if (!key || typeof key !== "string") return false;
  const memKey = buildMemKey(userId, botId, isSecure, key);

  if (value === null || value === undefined) {
    memoryStore.delete(memKey);
    try {
      await callInvoke("webapp_storage_save_key", {
        account: null,
        botId: String(botId || ""),
        isSecure: !!isSecure,
        key,
        value: null,
      });
      return true;
    } catch {
      return true;
    }
  }

  const prefix = `${userId || ""}_${botId || ""}_${isSecure ? "sec" : "dev"}_`;
  let existingCount = 0;
  for (const k of memoryStore.keys()) {
    if (k.startsWith(prefix)) existingCount++;
  }
  if (!memoryStore.has(memKey) && existingCount >= MAX_STORAGE_KEYS) {
    return false;
  }

  memoryStore.set(memKey, String(value));
  try {
    const res = await callInvoke("webapp_storage_save_key", {
      account: null,
      botId: String(botId || ""),
      isSecure: !!isSecure,
      key,
      value: String(value),
    });
    if (res === false) {
      memoryStore.delete(memKey);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function getStorageKey(userId, botId, isSecure, key) {
  if (!key) return null;
  const memKey = buildMemKey(userId, botId, isSecure, key);

  try {
    const remoteVal = await callInvoke("webapp_storage_get_key", {
      account: null,
      botId: String(botId || ""),
      isSecure: !!isSecure,
      key,
    });
    if (remoteVal !== null && remoteVal !== undefined) {
      memoryStore.set(memKey, String(remoteVal));
      return String(remoteVal);
    }
  } catch {}

  return memoryStore.get(memKey) || null;
}

export async function clearStorageKeys(userId, botId, isSecure) {
  const prefix = `${userId || ""}_${botId || ""}_${isSecure ? "sec" : "dev"}_`;
  for (const k of Array.from(memoryStore.keys())) {
    if (k.startsWith(prefix)) {
      memoryStore.delete(k);
    }
  }
  try {
    await callInvoke("webapp_storage_clear", {
      account: null,
      botId: String(botId || ""),
      isSecure: !!isSecure,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getStoredKeys(userId, botId, isSecure) {
  try {
    const keys = await callInvoke("webapp_storage_get_keys", {
      account: null,
      botId: String(botId || ""),
      isSecure: !!isSecure,
    });
    if (Array.isArray(keys)) return keys;
  } catch {}

  const prefix = `${userId || ""}_${botId || ""}_${isSecure ? "sec" : "dev"}_`;
  const keys = [];
  for (const k of memoryStore.keys()) {
    if (k.startsWith(prefix)) {
      keys.push(k.slice(prefix.length));
    }
  }
  return keys;
}

async function readBiometryData(userId, botId) {
  const memKey = buildBioMemKey(userId, botId);
  try {
    const remote = await callInvoke("webapp_biometry_get", {
      account: null,
      botId: String(botId || ""),
    });
    if (remote && typeof remote === "object" && Object.keys(remote).length > 0) {
      memoryStore.set(memKey, remote);
      return remote;
    }
  } catch {}
  return memoryStore.get(memKey) || {};
}

async function writeBiometryData(userId, botId, data) {
  const memKey = buildBioMemKey(userId, botId);
  memoryStore.set(memKey, data);
  try {
    await callInvoke("webapp_biometry_set", {
      account: null,
      botId: String(botId || ""),
      biometry: data,
    });
  } catch {}
}

export async function fetchBiometryStatus(userId, botId, deviceId) {
  const data = await readBiometryData(userId, botId);
  const requested = !!data.requested;
  const granted = !!data.granted;
  const tokenSaved = !!data.token;
  let devId = deviceId || "";
  if (!devId) {
    try {
      const dev = await callInvoke("get_device");
      if (dev && typeof dev === "object" && dev.deviceId) {
        devId = dev.deviceId;
      }
    } catch {}
  }
  if (!devId) {
    devId = crypto.randomUUID().replace(/-/g, "");
    try {
      await callInvoke("save_device", { device: { deviceId: devId } });
    } catch {}
  }
  return {
    available: true,
    type: ["unknown"],
    biometryType: "unknown",
    accessRequested: requested,
    access_requested: requested,
    accessGranted: granted,
    access_granted: granted,
    tokenSaved: tokenSaved,
    token_saved: tokenSaved,
    deviceId: devId,
    device_id: devId,
  };
}

export async function requestBiometryAuth(userId, botId) {
  const data = await readBiometryData(userId, botId);
  if (!data.token) {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    data.token = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  data.requested = true;
  data.granted = true;
  await writeBiometryData(userId, botId, data);

  return {
    token: data.token,
    status: "authorized",
    granted: true,
    accessGranted: true,
  };
}

export async function updateBiometryTokenValue(userId, botId, token) {
  const data = await readBiometryData(userId, botId);
  if (!token) {
    delete data.token;
    await writeBiometryData(userId, botId, data);
    return { status: "removed" };
  }
  if (token.length > 1024) {
    return { error: "too_large" };
  }
  data.token = String(token);
  data.requested = true;
  data.granted = true;
  await writeBiometryData(userId, botId, data);
  return { status: "updated" };
}
