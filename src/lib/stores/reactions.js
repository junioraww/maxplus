import { writable } from "svelte/store";
import { invoke } from "$lib/utils/invoke";

const FALLBACK_REACTIONS = ["👍", "❤️", "🔥", "🤣", "😢", "😮", "🎉", "👎"];
const STORAGE_KEY = "maxplus_reaction_emojis";
const EXPIRATION_MS = 24 * 60 * 60 * 1000;

function readStoredEmojis() {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (!serialized) return FALLBACK_REACTIONS;
    const parsed = JSON.parse(serialized);
    if (
      Array.isArray(parsed?.emojis) &&
      parsed.emojis.length > 0 &&
      Date.now() - (parsed.timestamp || 0) < EXPIRATION_MS
    ) {
      return collectUniqueIds(parsed.emojis);
    }
  } catch {}
  return FALLBACK_REACTIONS;
}

function persistEmojis(emojis) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ emojis, timestamp: Date.now() })
    );
  } catch {}
}

export const reactionEmojis = writable(readStoredEmojis());

let ongoingFetch = null;

function collectUniqueIds(source) {
  const result = [];
  const tracked = new Set();
  for (const item of source) {
    if (!tracked.has(item)) {
      tracked.add(item);
      result.push(item);
    }
  }
  return result;
}

function partitionArray(items, chunkSize) {
  const slices = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    slices.push(items.slice(index, index + chunkSize));
  }
  return slices;
}

function appendNumericIds(destination, rawItems) {
  if (!Array.isArray(rawItems)) return;
  for (const entry of rawItems) {
    const value = typeof entry === "number" ? entry : Number(entry);
    if (Number.isFinite(value) && value > 0) {
      destination.push(value);
    }
  }
}

export async function ensureReactionsLoaded() {
  if (ongoingFetch) return ongoingFetch;
  ongoingFetch = fetchRemoteCatalog()
    .catch((err) => {
      console.error("Failed to load reaction emojis:", err);
    })
    .finally(() => {
      ongoingFetch = null;
    });
  return ongoingFetch;
}

async function fetchRemoteCatalog() {
  const candidateSetIds = [];
  const fallbackAssetIds = [];

  const catalogSync = await invoke("get_animoji_sets", { sync: 0 }).catch(() => null);
  if (catalogSync && Array.isArray(catalogSync.sections)) {
    for (const section of catalogSync.sections) {
      appendNumericIds(candidateSetIds, section?.animojiSetIds);
    }
    if (catalogSync.animojiUpdates && typeof catalogSync.animojiUpdates === "object") {
      for (const rawId of Object.keys(catalogSync.animojiUpdates)) {
        const idNumber = Number(rawId);
        if (Number.isFinite(idNumber) && idNumber > 0) {
          fallbackAssetIds.push(idNumber);
        }
      }
    }
  }

  const prioritizedAssetIds = [];
  const uniqueSetIds = collectUniqueIds(candidateSetIds);
  for (const setBatch of partitionArray(uniqueSetIds, 50)) {
    const setDetails = await invoke("get_assets_by_ids", {
      assetType: "ANIMOJI_SET",
      ids: setBatch,
    }).catch(() => null);

    if (Array.isArray(setDetails?.animojiSets)) {
      for (const pack of setDetails.animojiSets) {
        appendNumericIds(prioritizedAssetIds, pack?.animojis);
        appendNumericIds(prioritizedAssetIds, pack?.animojiIds);
      }
    }
  }

  const finalAssetIds = collectUniqueIds(
    prioritizedAssetIds.length > 0 ? prioritizedAssetIds : fallbackAssetIds
  );

  if (finalAssetIds.length === 0) return;

  const resolvedCharacters = [];
  for (const assetBatch of partitionArray(finalAssetIds, 100)) {
    const assetDetails = await invoke("get_assets_by_ids", {
      assetType: "ANIMOJI",
      ids: assetBatch,
    }).catch(() => null);

    if (Array.isArray(assetDetails?.animojis)) {
      for (const item of assetDetails.animojis) {
        const character = item?.emoji;
        if (typeof character === "string" && character.trim().length > 0) {
          resolvedCharacters.push(character.trim());
        }
      }
    }
  }

  const unique = collectUniqueIds(resolvedCharacters);
  if (unique.length > 0) {
    reactionEmojis.set(unique);
    persistEmojis(unique);
  }
}
