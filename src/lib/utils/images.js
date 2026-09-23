import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCachedFile, setCachedFile } from "$lib/stores/cache";
import { getCurrentAccount } from "$lib/stores/accounts";
import { getVideoProxyBase } from './proxyConfig.js';

const MAX_CONCURRENT_DOWNLOADS = 6;
let activeDownloads = 0;
const downloadQueue = [];
const inflightRequests = new Map();

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

export async function getLocalFilePath(src) {
    if (!src) return null;
    if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("asset:") || src.startsWith("http://asset.localhost/")) {
        return null;
    }
    if (!src.startsWith("http://") && !src.startsWith("https://")) {
        return src;
    }

    if (inflightRequests.has(src)) {
        return inflightRequests.get(src);
    }

    const promise = enqueueDownload(async () => {
        try {
            const account = await getCurrentAccount().catch(() => null);
            const accountId = account?.id ? Number(account.id) : 0;
            return await invoke("cache_url", { account: accountId, src });
        } catch (e) {
            console.error("Failed to load image to cache:", e);
            return null;
        }
    }).finally(() => {
        inflightRequests.delete(src);
    });

    inflightRequests.set(src, promise);
    return promise;
}

export async function getAssetUrl(src) {
    if (!src) return null;
    if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("asset:") || src.startsWith("http://asset.localhost/")) {
        return src;
    }
    if (!src.startsWith("http://") && !src.startsWith("https://")) {
        return convertFileSrc(src);
    }
    const path = await getLocalFilePath(src);
    if (path) {
        return convertFileSrc(path);
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
