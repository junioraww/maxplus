const MAX_STORAGE_KEYS = 500;
const memoryStore = new Map();

function storageGet(key) {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
  } catch {}
  return memoryStore.get(key) || null;
}

function storageSet(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, String(value));
      return;
    }
  } catch {}
  memoryStore.set(key, String(value));
}

function storageRemove(key) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
      return;
    }
  } catch {}
  memoryStore.delete(key);
}

function buildStorageKey(userId, botId, isSecure, key) {
  const scope = isSecure ? "sec" : "dev";
  return `max_wa_${userId}_${botId}_${scope}_${key}`;
}

function buildIndexKey(userId, botId, isSecure) {
  const scope = isSecure ? "sec" : "dev";
  return `max_wa_idx_${userId}_${botId}_${scope}`;
}

function getStoredKeys(userId, botId, isSecure) {
  try {
    const raw = storageGet(buildIndexKey(userId, botId, isSecure));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setStoredKeys(userId, botId, isSecure, keys) {
  try {
    storageSet(
      buildIndexKey(userId, botId, isSecure),
      JSON.stringify(keys)
    );
  } catch {}
}

export function saveStorageKey(userId, botId, isSecure, key, value) {
  if (!key || typeof key !== "string") return false;
  const storageKey = buildStorageKey(userId, botId, isSecure, key);

  if (value === null || value === undefined) {
    try {
      storageRemove(storageKey);
      const keys = getStoredKeys(userId, botId, isSecure).filter((k) => k !== key);
      setStoredKeys(userId, botId, isSecure, keys);
      return true;
    } catch {
      return false;
    }
  }

  const keys = getStoredKeys(userId, botId, isSecure);
  if (!keys.includes(key)) {
    if (keys.length >= MAX_STORAGE_KEYS) return false;
    keys.push(key);
    setStoredKeys(userId, botId, isSecure, keys);
  }

  try {
    storageSet(storageKey, String(value));
    return true;
  } catch {
    return false;
  }
}

export function getStorageKey(userId, botId, isSecure, key) {
  if (!key) return null;
  try {
    return storageGet(buildStorageKey(userId, botId, isSecure, key));
  } catch {
    return null;
  }
}

export function clearStorageKeys(userId, botId, isSecure) {
  const keys = getStoredKeys(userId, botId, isSecure);
  try {
    for (const k of keys) {
      storageRemove(buildStorageKey(userId, botId, isSecure, k));
    }
    setStoredKeys(userId, botId, isSecure, []);
    return true;
  } catch {
    return false;
  }
}

function buildBiometryKey(userId, botId) {
  return `max_wa_bio_${userId}_${botId}`;
}

function readBiometryData(userId, botId) {
  try {
    const raw = storageGet(buildBiometryKey(userId, botId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeBiometryData(userId, botId, data) {
  try {
    storageSet(buildBiometryKey(userId, botId), JSON.stringify(data));
  } catch {}
}

export function fetchBiometryStatus(userId, botId, deviceId) {
  const data = readBiometryData(userId, botId);
  const requested = !!data.requested;
  const granted = !!data.granted;
  const tokenSaved = !!data.token;
  let devId = deviceId || "";
  if (!devId) {
    try {
      devId = storageGet("max_device_id") || "";
      if (!devId) {
        devId = crypto.randomUUID().replace(/-/g, "");
        storageSet("max_device_id", devId);
      }
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

export function requestBiometryAuth(userId, botId) {
  const data = readBiometryData(userId, botId);
  if (!data.token) {
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    data.token = Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  data.requested = true;
  data.granted = true;
  writeBiometryData(userId, botId, data);

  return {
    token: data.token,
    status: "authorized",
    granted: true,
    accessGranted: true,
  };
}

export function updateBiometryTokenValue(userId, botId, token) {
  const data = readBiometryData(userId, botId);
  if (!token) {
    delete data.token;
    writeBiometryData(userId, botId, data);
    try {
      storageRemove("digital_id_biometry_token");
    } catch {}
    return { status: "removed" };
  }
  if (token.length > 1024) {
    return { error: "too_large" };
  }
  data.token = String(token);
  data.requested = true;
  data.granted = true;
  writeBiometryData(userId, botId, data);
  try {
    storageSet("digital_id_biometry_token", String(token));
  } catch {}
  return { status: "updated" };
}
