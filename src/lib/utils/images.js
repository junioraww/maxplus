import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCachedFile, setCachedFile } from "../stores/cache";
import { getCurrentAccount } from "../stores/accounts";
import { getVideoProxyBase } from './proxyConfig';

const MAX_CONCURRENT_DOWNLOADS = 16;
let activeDownloads = 0;
const downloadQueue = [];
const inflightRequests = new Map();
let cachedAccountId = 0;

if (typeof window !== "undefined") {
    getCurrentAccount().then((acc) => {
        if (acc?.id) cachedAccountId = Number(acc.id);
    }).catch(() => {});
}

function processQueue() {
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS || downloadQueue.length === 0) {
        return;
    }
    const next = downloadQueue.shift();
    if (!next) return;
    activeDownloads++;
    next.task()
        .then(next.resolve, next.reject)
        .finally(() => {
            activeDownloads--;
            processQueue();
        });
}

function enqueueDownload(task) {
    return new Promise((resolve, reject) => {
        downloadQueue.push({ task, resolve, reject });
        processQueue();
    });
}

const localFilePathCache = new Map();
const proxiedUrlCache = new Map();
const MAX_RESOLVED_CACHE = 1000;

function setCachedPath(src, path) {
    if (!src || !path) return;
    if (localFilePathCache.size >= MAX_RESOLVED_CACHE) {
        const first = localFilePathCache.keys().next().value;
        localFilePathCache.delete(first);
    }
    localFilePathCache.set(src, path);
}

function setCachedProxied(src, url) {
    if (!src || !url) return;
    if (proxiedUrlCache.size >= MAX_RESOLVED_CACHE) {
        const first = proxiedUrlCache.keys().next().value;
        proxiedUrlCache.delete(first);
    }
    proxiedUrlCache.set(src, url);
}

export function resetImageCaches(newAccountId = 0) {
    localFilePathCache.clear();
    proxiedUrlCache.clear();
    cachedAccountId = newAccountId ? Number(newAccountId) : 0;
}

export function clearSafeAvatarImageCache() {
    for (const key of localFilePathCache.keys()) if (key.includes("/api/avatars/")) localFilePathCache.delete(key);
    for (const key of proxiedUrlCache.keys()) if (key.includes("/api/avatars/")) proxiedUrlCache.delete(key);
}

export async function getLocalFilePath(src, accountId = null) {
    if (!src) return null;
    if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("asset:") || src.startsWith("http://asset.localhost/")) {
        return null;
    }
    if (!src.startsWith("http://") && !src.startsWith("https://")) {
        return src;
    }

    const cacheKey = accountId ? `${accountId}:${src}` : src;

    if (localFilePathCache.has(cacheKey)) {
        return localFilePathCache.get(cacheKey);
    }

    if (inflightRequests.has(cacheKey)) {
        return inflightRequests.get(cacheKey);
    }

    let accId = accountId ? Number(accountId) : cachedAccountId;
    if (!accId) {
        const account = await getCurrentAccount().catch(() => null);
        if (account?.id) {
            accId = Number(account.id);
            if (!accountId) cachedAccountId = accId;
        }
    }

    try {
        const directCached = await invoke("get_cached_file", { account: accId, src }).catch(() => null);
        if (directCached) {
            setCachedPath(cacheKey, directCached);
            return directCached;
        }
    } catch {}

    const promise = enqueueDownload(async () => {
        try {
            let currentId = accountId ? Number(accountId) : cachedAccountId;
            if (!currentId) {
                const account = await getCurrentAccount().catch(() => null);
                if (account?.id) {
                    currentId = Number(account.id);
                    if (!accountId) cachedAccountId = currentId;
                }
            }
            const res = await invoke("cache_url", { account: currentId, src });
            if (res) {
                setCachedPath(cacheKey, res);
            }
            return res;
        } catch {
            return null;
        }
    }).finally(() => {
        inflightRequests.delete(cacheKey);
    });

    inflightRequests.set(cacheKey, promise);
    return promise;
}

export async function getAssetUrl(src, accountId = null) {
    if (!src) return null;
    const cacheKey = accountId ? `${accountId}:${src}` : src;
    if (proxiedUrlCache.has(cacheKey)) {
        return proxiedUrlCache.get(cacheKey);
    }
    if (src.startsWith("data:") || src.startsWith("blob:") || isProxiedMediaUrl(src)) {
        return src;
    }
    if (!src.startsWith("http://") && !src.startsWith("https://")) {
        const res = getProxiedMediaUrl(src);
        setCachedProxied(cacheKey, res);
        return res;
    }
    const path = await getLocalFilePath(src, accountId);
    if (path) {
        const res = getProxiedMediaUrl(path);
        setCachedProxied(cacheKey, res);
        return res;
    }
    return null;
}

export function isProxiedMediaUrl(src) {
    if (!src || typeof src !== "string") return false;
    return (
        src.startsWith("http://127.0.0.1:") ||
        src.startsWith("http://localhost:")
    );
}

export function unwrapProxiedMediaUrl(src) {
    if (!src || typeof src !== "string") return src;
    if (!isProxiedMediaUrl(src)) return src;
    try {
        const u = new URL(src);
        const parts = u.pathname.split("/").filter(Boolean);
        if (parts.length > 0) {
            const last = parts[parts.length - 1];
            return decodeURIComponent(last);
        }
    } catch {}
    return src;
}

export function getProxiedMediaUrl(src) {
    if (!src) return null;
    if (
        src.startsWith("data:") ||
        src.startsWith("blob:") ||
        isProxiedMediaUrl(src)
    ) {
        return src;
    }
    const base = getVideoProxyBase();
    if (src.startsWith("asset://")) {
        let rawPath = src.slice("asset://".length);
        if (rawPath.startsWith("localhost/")) {
            rawPath = rawPath.slice("localhost/".length);
        }
        let decoded = decodeURIComponent(rawPath);
        if (!decoded.startsWith("/") && !decoded.includes("://") && !/^[a-zA-Z]:/.test(decoded)) {
            decoded = "/" + decoded;
        }
        return `${base}/${encodeURIComponent(decoded)}`;
    }
    if (src.startsWith("http://asset.localhost/")) {
        const rawPath = src.slice("http://asset.localhost/".length);
        let decoded = decodeURIComponent(rawPath);
        if (!decoded.startsWith("/") && !decoded.includes("://") && !/^[a-zA-Z]:/.test(decoded)) {
            decoded = "/" + decoded;
        }
        return `${base}/${encodeURIComponent(decoded)}`;
    }
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/") || src.startsWith("file://")) {
        let clean = src;
        if (clean.startsWith("file://")) {
            clean = clean.slice("file://".length);
        }
        return `${base}/${encodeURIComponent(clean)}`;
    }
    return src;
}

export function getAvatarPlaceholder(id, type = "USER") {
    const colors = [
        "#e17076", "#7bc862", "#65aadd",
        "#a695e7", "#ee7aae", "#6ec9cb"
    ];

    if (type === "CHAT") {
        const x = -id % colors.length;
        const y = -Math.floor(id + id / 2) % colors.length;
        return `linear-gradient(135deg, ${colors[x]}, ${colors[y]})`;
    }

    return colors[Math.abs(id) % colors.length];
}

export function getInitials(name) {
    if (!name) return "";
    return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

async function generateInitialsImageBuffer(id, name, type = "USER") {
    const size = 128;
    const initials = getInitials(name);
    const background = getAvatarPlaceholder(id, type);

    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = background.startsWith('linear-gradient') ? '#65aadd' : background;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${size / 2.5}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, size / 2, size / 2 + (size * 0.05));

    const blob = await canvas.convertToBlob({ type: "image/png" });
    return await blob.arrayBuffer();
}

export async function getFallbackAvatarLocalPath(id, name, type = "USER") {
    try {
        const account = await getCurrentAccount();
        const cacheKey = `generated_avatar_${type}_${id}_${name}`;

        let path = await getCachedFile(account.id, cacheKey);

        if (!path) {
            const buffer = await generateInitialsImageBuffer(id, name, type);
            path = await setCachedFile(account.id, cacheKey, new Uint8Array(buffer));
        }

        return path;
    } catch (e) {
        console.error("Failed to generate fallback avatar:", e);
        return null;
    }
}

export async function createBlurredAvatarPreview(rawSrc) {
    if (!rawSrc || typeof window === "undefined") return null;
    try {
        const assetUrl = await getAssetUrl(rawSrc).catch(() => null);
        const src = assetUrl || rawSrc;
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = 16;
                    canvas.height = 16;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return resolve(null);
                    ctx.imageSmoothingEnabled = true;
                    ctx.drawImage(img, 0, 0, 16, 16);
                    resolve(canvas.toDataURL("image/jpeg", 0.5));
                } catch {
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    } catch {
        return null;
    }
}
