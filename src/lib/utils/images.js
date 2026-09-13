import { fetch } from '@tauri-apps/plugin-http';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCachedFile, setCachedFile } from "$lib/stores/cache";
import { getCurrentAccount } from "$lib/stores/accounts";

export async function getLocalFilePath(src) {
    if (!src) return null;

    try {
        const account = await getCurrentAccount();
        let path = await getCachedFile(account.id, src);

        if (!path) {
            const response = await fetch(src, { method: "GET" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const buffer = await response.arrayBuffer();
            path = await setCachedFile(account.id, src, new Uint8Array(buffer));
        }

        return path;
    } catch (e) {
        console.error("Failed to load image to cache:", e);
        return null;
    }
}

export async function getAssetUrl(src) {
    const path = await getLocalFilePath(src);
    if (path) {
        return convertFileSrc(path);
    }
    return null;
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
