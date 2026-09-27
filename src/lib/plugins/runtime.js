import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { validateManifest, PluginLoadError } from './manifest.js';
import { satisfies } from './semver.js';
import { buildPluginContext } from './context.js';
import { pluginStore } from '$lib/stores/plugins.js';

const APP_VERSION = __APP_VERSION__;
const MAXPLUS_API_BASE = 'https://maxplus.dev';

const activePlugins = new Map();

async function parseMxp(arrayBuffer) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(arrayBuffer);

  const files = new Map();
  for (const [path, zipObj] of Object.entries(zip.files)) {
    if (!zipObj.dir) {
      const content = await zipObj.async('string');
      files.set(path, content);
    }
  }

  const manifestRaw = files.get('manifest.json');
  if (!manifestRaw) throw new PluginLoadError('MISSING_MANIFEST', 'manifest.json not found in .mxp archive');

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new PluginLoadError('MISSING_MANIFEST', 'manifest.json is not valid JSON');
  }

  validateManifest(manifest, files);

  return { manifest, files };
}

async function computeHash(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function loadPlugin(pluginId) {
  const state = get(pluginStore);
  const entry = state.plugins.get(pluginId);
  if (!entry || activePlugins.has(pluginId)) return;
  if (!entry.enabled) return;

  const { manifest, files } = entry;

  const getFile = (path) => {
    if (!files) return null;
    if (files instanceof Map) return files.get(path);
    return files[path] || null;
  };

  if (!satisfies(APP_VERSION, manifest.minAppVersion, manifest.maxAppVersion)) {
    console.warn(`[plugins] ${pluginId} version mismatch, skipping load`);
    return;
  }

  const ctx = buildPluginContext(manifest, pluginId);

  const styles = manifest.styles || [];
  const styleHandles = [];
  for (const s of styles) {
    const path = typeof s === 'string' ? s : s.path;
    const css = getFile(path);
    if (css) styleHandles.push(ctx.injectCSS(css));
  }

  const entrySource = getFile(manifest.entry);
  if (!entrySource) {
    console.error(`[plugins] entry script "${manifest.entry}" not found for ${pluginId}`);
    return;
  }

  let cleanup = null;
  try {
    const blob = new Blob([entrySource], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const mod = await import(/* @vite-ignore */ url);
    URL.revokeObjectURL(url);

    const setup = mod.setup || mod.default;
    if (typeof setup === 'function') {
      cleanup = await setup(ctx);
    }
  } catch (e) {
    console.error(`[plugins] failed to run ${pluginId}:`, e);
    ctx._cleanup();
    return;
  }

  activePlugins.set(pluginId, { ctx, cleanup });
}

export async function unloadPlugin(pluginId) {
  const active = activePlugins.get(pluginId);
  if (!active) return;

  try {
    if (typeof active.cleanup === 'function') await active.cleanup();
  } catch (e) {
    console.error(`[plugins] cleanup error for ${pluginId}:`, e);
  }

  active.ctx._cleanup();
  activePlugins.delete(pluginId);
}

export async function enablePlugin(pluginId) {
  pluginStore.setEnabled(pluginId, true);
  await loadPlugin(pluginId);
}

export async function disablePlugin(pluginId) {
  pluginStore.setEnabled(pluginId, false);
  await unloadPlugin(pluginId);
}

export async function installPlugin(arrayBuffer, options = {}) {
  const hash = await computeHash(arrayBuffer);
  const { manifest, files } = await parseMxp(arrayBuffer);

  const state = get(pluginStore);
  if (state.plugins.has(manifest.id)) {
    throw new PluginLoadError('DUPLICATE_PLUGIN', `Plugin "${manifest.id}" is already installed`);
  }

  let verificationStatus = 'unverified_plugin';
  try {
    const res = await fetch(`${MAXPLUS_API_BASE}/api/plugins/verify-hash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plugin_id: manifest.id,
        version: manifest.version,
        hash,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.found && data.verified) verificationStatus = 'verified';
      else if (data.found && !data.verified) verificationStatus = 'unverified_version';
    }
  } catch {}

  const fileContents = Object.fromEntries(files.entries());

  pluginStore.install({
    id: manifest.id,
    manifest,
    files: fileContents,
    enabled: options.enable ?? true,
    installedAt: Date.now(),
    verificationStatus,
    sourceHash: hash,
  });

  if (options.enable !== false) {
    await loadPlugin(manifest.id);
  }

  return { manifest, verificationStatus };
}

export async function uninstallPlugin(pluginId) {
  await unloadPlugin(pluginId);
  pluginStore.uninstall(pluginId);
  await invoke('plugin_storage_clear', { pluginId });
}

export async function initPluginSystem() {
  const state = get(pluginStore);
  const sorted = [...state.plugins.values()].sort((a, b) => a.order - b.order);
  for (const entry of sorted) {
    if (entry.enabled) {
      await loadPlugin(entry.id);
    }
  }
}

export async function handlePluginDeepLink(pluginId) {
  try {
    const res = await fetch(`${MAXPLUS_API_BASE}/api/plugins/${encodeURIComponent(pluginId)}/download`);
    if (!res.ok) throw new Error('Plugin not found');
    const arrayBuffer = await res.arrayBuffer();

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(arrayBuffer);
    const manifestStr = await zip.file("manifest.json")?.async("string");
    if (!manifestStr) throw new Error('В архиве плагина отсутствует manifest.json');
    const manifest = JSON.parse(manifestStr);

    let entryCode = "";
    if (manifest.entry && zip.file(manifest.entry)) {
      entryCode = await zip.file(manifest.entry).async("string");
    }

    const { showPluginImportModal } = await import('$lib/stores/plugins.js');
    showPluginImportModal({
      arrayBuffer,
      manifest,
      verificationStatus: 'verified',
      entryCode,
    });
  } catch (e) {
    console.error('[plugins] deep link error:', e);
    const { showAlert } = await import('$lib/utils/alert.js');
    showAlert("Не удалось загрузить плагин по ссылке");
  }
}
