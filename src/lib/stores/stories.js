import { writable, derived, get } from "svelte/store";
import { invoke } from "$lib/utils/invoke";

const STORE_KEY = "stories_cache";

export const storiesCurrentUserId = writable(null);
export function setStoriesCurrentUserId(id) {
  storiesCurrentUserId.set(id != null ? Number(id) : null);
}

export const storiesPreviews = writable([]);
export const peerStoriesCache = writable({});
export const lastViewedStories = writable({});
export const isFeedLoading = writable(false);
export const activeStoryViewer = writable(null);
export const storyComposerState = writable({
  isOpen: false,
  file: null,
  attach: null,
  onSave: null
});
export const isStoryComposerOpen = derived(storyComposerState, ($s) => $s.isOpen);

export function openStoryComposer(options = null) {
  storyComposerState.set({
    isOpen: true,
    file: options?.file || null,
    attach: options?.attach || null,
    onSave: options?.onSave || null
  });
}

export function closeStoryComposer() {
  storyComposerState.set({
    isOpen: false,
    file: null,
    attach: null,
    onSave: null
  });
}

function normalizeMs(t) {
  if (!t || t <= 0) return 0;
  return t < 1000000000000 ? t * 1000 : t;
}

export async function loadStoriesCacheFromDisk() {
  try {
    const raw = await invoke("common_store_load", { store: STORE_KEY }).catch(() => null);
    if (!raw) return;
    const now = Date.now();
    if (Array.isArray(raw.previews)) {
      const validPreviews = raw.previews.filter((p) => {
        if (!p?.owner?.ownerId || (p.totalCount || 0) <= 0) return false;
        const exp = normalizeMs(p.lastStoryExpirationTime);
        return exp === 0 || exp > now;
      });
      storiesPreviews.set(validPreviews);
    }
    if (raw.peers && typeof raw.peers === "object") {
      peerStoriesCache.set(raw.peers);
    }
    if (raw.lastViewed && typeof raw.lastViewed === "object") {
      lastViewedStories.set(raw.lastViewed);
    }
  } catch (_) {}
}

async function persistStoriesCacheToDisk() {
  try {
    const data = {
      previews: get(storiesPreviews),
      peers: get(peerStoriesCache),
      lastViewed: get(lastViewedStories)
    };
    await invoke("common_store_save", { store: STORE_KEY, data }).catch(() => {});
  } catch (_) {}
}

export function updateStoryPreviewFromPush(preview) {
  if (!preview?.owner?.ownerId) return;
  const ownerId = Number(preview.owner.ownerId);
  const now = Date.now();
  const exp = normalizeMs(preview.lastStoryExpirationTime);

  storiesPreviews.update((list) => {
    const isExpired = exp !== 0 && exp <= now;
    const isEmpty = (preview.totalCount || 0) <= 0 || isExpired;
    const idx = list.findIndex((p) => Number(p.owner?.ownerId) === ownerId);

    if (isEmpty) {
      if (idx !== -1) list.splice(idx, 1);
      return [...list];
    }

    if (idx !== -1) {
      list[idx] = { ...list[idx], ...preview };
    } else {
      list.push(preview);
    }
    return [...list];
  });

  persistStoriesCacheToDisk();
}

export async function refreshStoriesFeed(api) {
  if (!api || typeof api.getStoriesFeed !== "function") return;
  isFeedLoading.set(true);
  try {
    const response = await api.getStoriesFeed("0", 30);
    const previews = response?.storiesPreviews || [];
    const now = Date.now();

    const valid = previews.filter((p) => {
      if (!p?.owner?.ownerId || (p.totalCount || 0) <= 0) return false;
      const exp = normalizeMs(p.lastStoryExpirationTime);
      return exp === 0 || exp > now;
    });

    storiesPreviews.update((current) => {
      const myId = get(storiesCurrentUserId);
      const selfPrev = myId ? current.find((p) => Number(p.owner?.ownerId) === myId) : null;
      const merged = [...valid];
      if (selfPrev && (selfPrev.totalCount || 0) > 0 && !merged.some((p) => Number(p.owner?.ownerId) === myId)) {
        merged.unshift(selfPrev);
      }
      return merged;
    });
    persistStoriesCacheToDisk();
  } catch (_) {
  } finally {
    isFeedLoading.set(false);
  }
}

export async function fetchStoriesForOwner(api, ownerId, ownerType = 0) {
  const oId = Number(ownerId);
  if (!oId || !api || typeof api.getStoriesByOwners !== "function") {
    return get(peerStoriesCache)[oId] || [];
  }

  try {
    const response = await api.getStoriesByOwners([{ ownerId: oId, type: ownerType }]);
    const peerStories = response?.peerStories || [];
    let resultStories = [];

    for (const peer of peerStories) {
      const pid = Number(peer.owner?.ownerId);
      if (peer.stories) {
        peerStoriesCache.update((cache) => ({ ...cache, [pid]: peer.stories }));
        if (pid === oId) {
          resultStories = peer.stories;
        }
      }
    }

    if (response?.storiesPreviews) {
      for (const pr of response.storiesPreviews) {
        updateStoryPreviewFromPush(pr);
      }
    }

    persistStoriesCacheToDisk();
    return resultStories.length > 0 ? resultStories : (get(peerStoriesCache)[oId] || []);
  } catch (_) {
    return get(peerStoriesCache)[oId] || [];
  }
}

export function addStoryLocally(ownerId, storyItem) {
  const oId = Number(ownerId);
  if (!oId || !storyItem) return;

  peerStoriesCache.update((cache) => {
    const list = cache[oId] || [];
    return { ...cache, [oId]: [storyItem, ...list.filter((s) => Number(s.id) !== Number(storyItem.id))] };
  });

  storiesPreviews.update((list) => {
    const idx = list.findIndex((p) => Number(p.owner?.ownerId) === oId);
    if (idx !== -1) {
      const prev = list[idx];
      list[idx] = {
        ...prev,
        totalCount: (prev.totalCount || 0) + 1,
        updateTime: Date.now(),
        lastStoryExpirationTime: Date.now() + 172800000
      };
      return [...list];
    } else {
      return [
        {
          owner: { ownerId: oId, type: 0 },
          totalCount: 1,
          readCount: 0,
          updateTime: Date.now(),
          lastStoryExpirationTime: Date.now() + 172800000,
          settings: 1
        },
        ...list
      ];
    }
  });

  persistStoriesCacheToDisk();
}

export function removeStoryLocally(ownerId, storyId) {
  const oId = Number(ownerId);
  const sId = Number(storyId);
  if (!oId || !sId) return;

  peerStoriesCache.update((cache) => {
    const list = cache[oId] || [];
    return { ...cache, [oId]: list.filter((s) => Number(s.id) !== sId) };
  });

  storiesPreviews.update((list) => {
    return list
      .map((p) => {
        if (Number(p.owner?.ownerId) === oId) {
          const newTotal = Math.max(0, (p.totalCount || 1) - 1);
          if (newTotal === 0) return null;
          return {
            ...p,
            totalCount: newTotal,
            readCount: Math.min(newTotal, p.readCount || 0)
          };
        }
        return p;
      })
      .filter(Boolean);
  });

  persistStoriesCacheToDisk();
}

export async function markStoryAsRead(api, ownerId, storyId, ownerType = 0) {
  const oId = Number(ownerId);
  const sId = Number(storyId);
  if (!oId || !sId) return;

  lastViewedStories.update((map) => ({ ...map, [oId]: sId }));

  storiesPreviews.update((list) => {
    return list.map((p) => {
      if (Number(p.owner?.ownerId) === oId) {
        const nextRead = Math.min(p.totalCount, (p.readCount || 0) + 1);
        return { ...p, readCount: nextRead };
      }
      return p;
    });
  });

  if (api && typeof api.readStory === "function") {
    try {
      await api.readStory({ ownerId: oId, type: ownerType }, sId);
    } catch (_) {}
  }

  persistStoriesCacheToDisk();
}

export const sortedStoriesFeed = derived(
  [storiesPreviews, storiesCurrentUserId],
  ([$previews, $myId]) => {
    const me = Number($myId);
    const copy = [...$previews];
    copy.sort((a, b) => {
      const aIsMe = Boolean(me && Number(a.owner?.ownerId) === me);
      const bIsMe = Boolean(me && Number(b.owner?.ownerId) === me);
      if (aIsMe) return -1;
      if (bIsMe) return 1;

      const aUnread = (a.totalCount || 0) > (a.readCount || 0);
      const bUnread = (b.totalCount || 0) > (b.readCount || 0);
      if (aUnread !== bUnread) return aUnread ? -1 : 1;

      return (b.updateTime || 0) - (a.updateTime || 0);
    });
    return copy;
  }
);

export const selfStoryPreview = derived(
  [storiesPreviews, storiesCurrentUserId],
  ([$previews, $myId]) => {
    const me = Number($myId);
    if (!me) return null;
    return $previews.find((p) => Number(p.owner?.ownerId) === me) || null;
  }
);

export function getStoryPreviewForUser(userId) {
  const id = Number(userId);
  if (!id) return null;
  const list = get(storiesPreviews);
  return list.find((p) => Number(p.owner?.ownerId) === id) || null;
}

export function openStoriesViewer(initialOwnerId, initialStoryId = null) {
  activeStoryViewer.set({
    ownerId: Number(initialOwnerId),
    storyId: initialStoryId ? Number(initialStoryId) : null
  });
}

export function closeStoriesViewer() {
  activeStoryViewer.set(null);
}
