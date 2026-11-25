import { writable, get } from "svelte/store";
import { invoke } from "$lib/utils/invoke";
import { emojiIndex } from "$lib/utils/emojiIndex";

export const favoriteSetIds = writable([]);
export const orderedSetIds = writable([]);
export const stickerSets = writable(new Map());
export const stickersById = writable(new Map());
export const recentStickerIds = writable([]);
export const stickersLoading = writable(false);

const RECENT_STORAGE_KEY = "maxplus_recent_stickers";
const MAX_RECENTS = 24;

let loadPromise = null;
let favPromise = null;

function loadLocalRecents() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) {
        recentStickerIds.set(ids.filter(x => typeof x === "number"));
      }
    }
  } catch {}
}

function saveLocalRecents(ids) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_RECENTS)));
  } catch {}
}

loadLocalRecents();

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function ensureFavoritesLoaded() {
  if (favPromise) return favPromise;
  favPromise = (async () => {
    try {
      const fav = await invoke("get_favorite_stickers", { sync: 0 });
      const favIds = [];
      const sections = fav?.sections || [];
      let marker = 0;
      for (const s of sections) {
        if (s?.id === "FAVORITE_STICKER_SETS") {
          if (Array.isArray(s.stickerSets)) {
            for (const id of s.stickerSets) {
              if (typeof id === "number") favIds.push(id);
            }
          }
          if (typeof s.marker === "number") marker = s.marker;
        }
      }

      let guard = 0;
      while (marker !== 0 && guard < 50) {
        guard++;
        const page = await invoke("get_assets_section", {
          sectionId: "FAVORITE_STICKER_SETS",
          from: marker,
          count: 100,
        });
        if (!page) break;
        const beforeLen = favIds.length;
        if (Array.isArray(page.stickerSets)) {
          for (const id of page.stickerSets) {
            if (typeof id === "number") favIds.push(id);
          }
        }
        if (favIds.length === beforeLen) break;
        marker = typeof page.marker === "number" ? page.marker : 0;
      }

      if (favIds.length === 0) {
        _populateMockStickers();
        return get(favoriteSetIds);
      }

      favoriteSetIds.set(favIds);
      return favIds;
    } catch (e) {
      favPromise = null;
      _populateMockStickers();
      return get(favoriteSetIds);
    }
  })();
  return favPromise;
}

function _populateMockStickers() {
  const mockPacks = [
    { id: 101, name: "София", count: 42, iconUrl: "/icons/sticker.svg", isFav: true },
    { id: 102, name: "Лисёнок", count: 24, iconUrl: "/icons/sticker.svg", isFav: true },
    { id: 103, name: "Амфибия", count: 48, iconUrl: "/icons/sticker.svg", isFav: true },
    { id: 104, name: "Зумер", count: 28, iconUrl: "/icons/sticker.svg", isFav: false },
    { id: 105, name: "Цветы", count: 28, iconUrl: "/icons/sticker.svg", isFav: false },
    { id: 106, name: "Неваляшка", count: 28, iconUrl: "/icons/sticker.svg", isFav: false },
    { id: 107, name: "Котик-призрак", count: 22, iconUrl: "/icons/sticker.svg", isFav: false },
    { id: 108, name: "Магические слова", count: 20, iconUrl: "/icons/sticker.svg", isFav: false },
    { id: 109, name: "Скелетик", count: 40, iconUrl: "/icons/sticker.svg", isFav: false },
  ];

  const setsMap = new Map(get(stickerSets));
  const stickersMap = new Map(get(stickersById));
  const ordered = [];
  const favs = [];

  for (const p of mockPacks) {
    ordered.push(p.id);
    if (p.isFav) favs.push(p.id);

    const sIds = [];
    for (let i = 1; i <= 5; i++) {
      const sid = p.id * 100 + i;
      sIds.push(sid);
      if (!stickersMap.has(sid)) {
        stickersMap.set(sid, {
          id: sid,
          setId: p.id,
          url: "/icons/smile.svg",
          width: 200,
          height: 200,
          tags: ["smile", p.name],
        });
      }
    }

    setsMap.set(p.id, {
      id: p.id,
      name: p.name,
      iconUrl: p.iconUrl,
      stickerIds: sIds,
    });
  }

  stickerSets.set(setsMap);
  stickersById.set(stickersMap);
  orderedSetIds.set(ordered);
  favoriteSetIds.set(favs);

  if (get(recentStickerIds).length === 0) {
    const recents = [10101, 10102, 10103, 10104, 10105, 10201, 10202, 10203, 10301, 10302, 10303];
    recentStickerIds.set(recents);
    saveLocalRecents(recents);
  }
}

export async function ensureLoaded() {
  if (loadPromise) return loadPromise;
  stickersLoading.set(true);
  loadPromise = (async () => {
    try {
      const newSetIds = [];
      let marker = 0;

      const stickerData = await invoke("get_sticker_sections", { sync: 0 });
      if (stickerData?.sections) {
        for (const s of stickerData.sections) {
          if (s?.id === "NEW_STICKER_SETS") {
            if (Array.isArray(s.stickerSets)) {
              for (const id of s.stickerSets) {
                if (typeof id === "number") newSetIds.push(id);
              }
            }
            if (typeof s.marker === "number") marker = s.marker;
          } else if (s?.type === "RECENTS" && Array.isArray(s.recentsList)) {
            const parsedRecents = [];
            for (const r of s.recentsList) {
              const sid = r?.stickerId ?? r?.id;
              if (typeof sid === "number") parsedRecents.push(sid);
            }
            if (parsedRecents.length) {
              recentStickerIds.update(existing => {
                const combined = Array.from(new Set([...existing, ...parsedRecents])).slice(0, MAX_RECENTS);
                saveLocalRecents(combined);
                return combined;
              });
            }
          }
        }
      }

      let guard = 0;
      while (marker !== 0 && guard < 50) {
        guard++;
        const page = await invoke("get_assets_section", {
          sectionId: "NEW_STICKER_SETS",
          from: marker,
          count: 100,
        });
        if (!page) break;
        const beforeLen = newSetIds.length;
        if (Array.isArray(page.stickerSets)) {
          for (const id of page.stickerSets) {
            if (typeof id === "number") newSetIds.push(id);
          }
        }
        if (newSetIds.length === beforeLen) break;
        marker = typeof page.marker === "number" ? page.marker : 0;
      }

      const favIds = await ensureFavoritesLoaded();

      if (newSetIds.length === 0) {
        _populateMockStickers();
        stickersLoading.set(false);
        return;
      }

      const ordered = [];
      const seen = new Set();
      for (const id of [...favIds, ...newSetIds]) {
        if (!seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }

      if (ordered.length === 0) {
        _populateMockStickers();
      } else {
        orderedSetIds.set(ordered);
        await ensureSetMetas(ordered);
      }

      const initialStickersToLoad = new Set(get(recentStickerIds));
      for (const fid of favIds) {
        const set = get(stickerSets).get(fid);
        if (set?.stickerIds) {
          for (const sid of set.stickerIds) initialStickersToLoad.add(sid);
        }
      }
      if (initialStickersToLoad.size > 0) {
        await ensureStickers(Array.from(initialStickersToLoad));
      }

      stickersLoading.set(false);
    } catch (e) {
      loadPromise = null;
      stickersLoading.set(false);
      _populateMockStickers();
    }
  })();
  return loadPromise;
}

export async function ensureSetMetas(ids) {
  const currentSets = get(stickerSets);
  const missing = ids.filter(id => !currentSets.has(id));
  if (!missing.length) return;

  const chunks = chunkArray(missing, 50);
  for (const batch of chunks) {
    try {
      const res = await invoke("get_assets_by_ids", {
        assetType: "STICKER_SET",
        ids: batch,
      });
      const list = res?.stickerSets;
      if (Array.isArray(list)) {
        stickerSets.update(map => {
          const next = new Map(map);
          for (const item of list) {
            if (item?.id) {
              const stickerIds = Array.isArray(item.stickers)
                ? item.stickers.filter(x => typeof x === "number")
                : [];
              next.set(item.id, {
                id: item.id,
                name: item.name || "",
                iconUrl: item.iconUrl || "",
                stickerIds,
                link: item.link || null,
              });
            }
          }
          return next;
        });
      }
    } catch (e) {
      console.error(e);
    }
  }
}

export async function ensureStickers(ids) {
  const current = get(stickersById);
  const missing = ids.filter(id => !current.has(id));
  if (!missing.length) {
    return ids.map(id => current.get(id)).filter(Boolean);
  }

  const chunks = chunkArray(missing, 50);
  for (const batch of chunks) {
    try {
      const res = await invoke("get_assets_by_ids", {
        assetType: "STICKER",
        ids: batch,
      });
      const list = res?.stickers;
      if (Array.isArray(list)) {
        stickersById.update(map => {
          const next = new Map(map);
          for (const item of list) {
            if (item?.id) {
              const tags = Array.isArray(item.tags)
                ? item.tags.map(t => String(t || "").trim()).filter(Boolean)
                : [];
              next.set(item.id, {
                id: item.id,
                url: item.url || "",
                lottieUrl: item.lottieUrl || null,
                setId: item.setId || null,
                width: item.width || null,
                height: item.height || null,
                tags,
              });
            }
          }
          return next;
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  const updated = get(stickersById);
  return ids.map(id => updated.get(id)).filter(Boolean);
}

export async function ensureSet(setId) {
  await ensureSetMetas([setId]);
  const s = get(stickerSets).get(setId);
  if (s?.stickerIds?.length) {
    await ensureStickers(s.stickerIds);
  }
  return get(stickerSets).get(setId) || null;
}

export async function ensureAllStickersLoaded() {
  const ids = new Set(get(recentStickerIds));
  for (const set of get(stickerSets).values()) {
    if (Array.isArray(set.stickerIds)) {
      for (const sid of set.stickerIds) ids.add(sid);
    }
  }
  return ensureStickers(Array.from(ids));
}

export async function favoriteSet(setId) {
  const res = await invoke("add_favorite_sticker_set", { setId });
  const ok = res?.success === true;
  if (ok) {
    favoriteSetIds.update(ids => {
      if (ids.includes(setId)) return ids;
      const next = [setId, ...ids];
      return next;
    });
    orderedSetIds.update(ids => {
      const filtered = ids.filter(x => x !== setId);
      return [setId, ...filtered];
    });
  }
  return ok;
}

export async function unfavoriteSet(setId) {
  const res = await invoke("remove_favorite_sticker_set", { setId });
  const ok = res?.success === true;
  if (ok) {
    favoriteSetIds.update(ids => ids.filter(x => x !== setId));
  }
  return ok;
}

export function handlePushUpdate(setId, updateType) {
  if (updateType === "ADDED") {
    favoriteSetIds.update(ids => {
      if (ids.includes(setId)) return ids;
      return [setId, ...ids];
    });
    orderedSetIds.update(ids => {
      const filtered = ids.filter(x => x !== setId);
      return [setId, ...filtered];
    });
  } else if (updateType === "REMOVED") {
    favoriteSetIds.update(ids => ids.filter(x => x !== setId));
  }
}

export function noteUsedSticker(sticker) {
  if (!sticker?.id) return;
  recentStickerIds.update(ids => {
    const filtered = ids.filter(x => x !== sticker.id);
    const next = [sticker.id, ...filtered].slice(0, MAX_RECENTS);
    saveLocalRecents(next);
    return next;
  });
}

export function clearRecentStickers() {
  recentStickerIds.set([]);
  saveLocalRecents([]);
}

export async function resolveSetByLink(link) {
  try {
    const res = await invoke("resolve_link", { link });
    const raw = res?.stickerSet;
    if (!raw?.id) return null;
    const stickerIds = Array.isArray(raw.stickers)
      ? raw.stickers.filter(x => typeof x === "number")
      : [];
    const setObj = {
      id: raw.id,
      name: raw.name || "",
      iconUrl: raw.iconUrl || "",
      stickerIds,
      link: raw.link || link,
    };
    stickerSets.update(map => new Map(map).set(setObj.id, setObj));
    return setObj;
  } catch (e) {
    console.error(e);
    return null;
  }
}

export async function resolveSetIdForSticker(stickerId) {
  await ensureStickers([stickerId]);
  return get(stickersById).get(stickerId)?.setId || null;
}

export async function searchStickers(query, limit = 10) {
  const q = (query || "").trim();
  if (!q) return [];

  await emojiIndex.ensureLoaded();
  await ensureLoaded();

  const currentStickers = Array.from(get(stickersById).values());
  if (!currentStickers.length) {
    await ensureAllStickersLoaded();
  }

  const targets = emojiIndex.resolve(q);
  const qLower = q.toLowerCase();
  const allStickers = Array.from(get(stickersById).values());

  const results = [];
  const seen = new Set();

  for (const sticker of allStickers) {
    if (!sticker.url) continue;
    let matched = false;

    for (const tag of sticker.tags) {
      const normTag = emojiIndex.normalize(tag).toLowerCase();
      if (targets.has(tag) || targets.has(normTag) || normTag.includes(qLower) || qLower.includes(normTag)) {
        matched = true;
        break;
      }
    }

    if (matched && !seen.has(sticker.id)) {
      seen.add(sticker.id);
      results.push(sticker);
      if (results.length >= limit) break;
    }
  }

  return results;
}
