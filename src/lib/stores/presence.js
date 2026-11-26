import { writable, get } from "svelte/store";
import { invoke } from "$lib/utils/invoke";
import { get as sessionGet } from "$lib/stores/session";
import { isBrowserMode } from "$lib/utils/browserShim";

export const currentPresence = writable({});

const PRESENCE_TTL_MS = 45_000;
const BATCH_DELAY_MS = 50;
const MAX_BATCH_SIZE = 100;

const lastFetchedAt = new Map();
const inFlightIds = new Set();
const pendingQueue = new Set();
let flushTimer = null;

export function normalizePresenceEntry(raw, fallbackSeenSec = 0) {
  if (!raw || typeof raw !== "object") {
    return { status: 0, seen: fallbackSeenSec, on: "OFF" };
  }
  const status = raw.status != null ? Number(raw.status) : 0;
  let seen = raw.seen != null ? Number(raw.seen) : fallbackSeenSec;
  if (!Number.isFinite(seen)) seen = fallbackSeenSec;
  if (seen > 1e12) seen = Math.floor(seen / 1000);
  return {
    status: Number.isFinite(status) ? status : 0,
    seen,
    on: status === 1 ? "ON" : "OFF",
  };
}

export function applyPresenceMap(presenceMap, fallbackSeenSec = 0) {
  if (!presenceMap || typeof presenceMap !== "object") return;
  const now = Date.now();
  const normalized = {};
  let hasEntries = false;

  for (const [rawId, rawPres] of Object.entries(presenceMap)) {
    const uid = Number(rawId);
    if (!Number.isSafeInteger(uid) || uid <= 0 || !rawPres) continue;
    normalized[uid] = normalizePresenceEntry(rawPres, fallbackSeenSec);
    lastFetchedAt.set(uid, now);
    hasEntries = true;
  }

  if (hasEntries) {
    currentPresence.update((prev) => ({ ...prev, ...normalized }));
  }
}

export function clearPresenceCache() {
  lastFetchedAt.clear();
  inFlightIds.clear();
  pendingQueue.clear();
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  currentPresence.set({});
}

export async function flushPresenceQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingQueue.size === 0 || isBrowserMode() || !sessionGet("sync")) return;

  const ids = Array.from(pendingQueue);
  pendingQueue.clear();

  for (let i = 0; i < ids.length; i += MAX_BATCH_SIZE) {
    const chunk = ids.slice(i, i + MAX_BATCH_SIZE);
    for (const id of chunk) inFlightIds.add(id);

    try {
      const resp = await invoke("fetch_presence", { userIds: chunk });
      const now = Date.now();
      for (const id of chunk) {
        lastFetchedAt.set(id, now);
      }
      if (resp?.presence && typeof resp.presence === "object") {
        applyPresenceMap(resp.presence, 0);
      }
    } catch {
      const retryAt = Date.now() - PRESENCE_TTL_MS + 10_000;
      for (const id of chunk) {
        if (!lastFetchedAt.has(id)) lastFetchedAt.set(id, retryAt);
      }
    } finally {
      for (const id of chunk) inFlightIds.delete(id);
    }
  }
}

export function requestPresence(ids, { force = false } = {}) {
  const list = Array.isArray(ids) ? ids : [ids];
  const now = Date.now();
  const currentMap = get(currentPresence) || {};
  let added = false;

  for (const raw of list) {
    const uid = Number(raw);
    if (!Number.isSafeInteger(uid) || uid <= 0) continue;
    if (inFlightIds.has(uid)) continue;

    if (!force) {
      const fetchedAt = lastFetchedAt.get(uid);
      if (fetchedAt != null && now - fetchedAt < PRESENCE_TTL_MS && currentMap[uid]) {
        continue;
      }
    }

    pendingQueue.add(uid);
    added = true;
  }

  if (added && !flushTimer && sessionGet("sync")) {
    flushTimer = setTimeout(flushPresenceQueue, BATCH_DELAY_MS);
  }
}
