import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { validateManifest, PluginLoadError } from './manifest';
import { satisfies } from './semver';
import { buildPluginContext } from './context';
import { pluginStore, pluginSettingsStore, showPluginImportModal } from '$lib/stores/plugins';

const APP_VERSION = __APP_VERSION__;
export { APP_VERSION };
const MAXPLUS_API_BASE = 'https://maxplus.dev';

const activePlugins = new Map();

function resolveModuleGraph(files, entryName) {
  const createdUrls = [];
  const resolved = new Map();
  const pending = new Map();

  const getFileCode = (name) => {
    if (!files) return null;
    if (files instanceof Map) return files.get(name);
    return files[name] || null;
  };

  const allKeys = files instanceof Map ? Array.from(files.keys()) : Object.keys(files || {});
  const jsKeys = allKeys.filter(k => k.endsWith('.js'));

  const isImageKey = (name) => /\.(svg|png|jpe?g|webp|gif|ico)$/i.test(name);
  for (const key of allKeys) {
    if (isImageKey(key)) {
      const content = getFileCode(key);
      if (content) {
        const modCode = `export default ${JSON.stringify(content)};`;
        const blob = new Blob([modCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);
        resolved.set(key, url);
      }
    }
  }

  if (jsKeys.length <= 1) {
    const code = getFileCode(entryName);
    if (!code) return { entryUrl: null, createdUrls: [] };
    const rewritten = rewriteImports(code);
    const blob = new Blob([rewritten], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    createdUrls.push(url);
    return { entryUrl: url, createdUrls };
  }

  function getLocalDeps(code) {
    const deps = new Set();
    const regex = /(?:from\s*|import\s*\(\s*|import\s+)(['"`])(\.\/)?([a-zA-Z0-9_\-\.\/]+)(['"`])/g;
    let match;
    while ((match = regex.exec(code)) !== null) {
      const raw = match[3];
      const normalized = raw.includes('.') ? raw : raw + '.js';
      const clean = normalized.replace(/^.*[\\\/]/, '');
      const hasTarget = files instanceof Map ? (files.has(clean) || files.has(normalized)) : Boolean(files[clean] || files[normalized]);
      if (hasTarget) {
        const targetKey = (files instanceof Map ? files.has(clean) : Boolean(files[clean])) ? clean : normalized;
        deps.add(targetKey);
      }
    }
    return deps;
  }

  function rewriteImports(code) {
    return code.replace(
      /(from\s*|import\s*\(\s*|import\s+)(['"`])(\.\/)?([a-zA-Z0-9_\-\.\/]+)(['"`])/g,
      (match, prefix, q1, dotSlash, importPath, q2) => {
        const normalized = importPath.includes('.') ? importPath : importPath + '.js';
        const clean = normalized.replace(/^.*[\\\/]/, '');
        const targetUrl = resolved.get(clean) || resolved.get(normalized);
        if (targetUrl) {
          return `${prefix}${q1}${targetUrl}${q2}`;
        }
        return match;
      }
    );
  }

  for (const key of jsKeys) {
    const code = getFileCode(key);
    if (code) {
      pending.set(key, { code, deps: getLocalDeps(code) });
    }
  }

  let progress = true;
  while (pending.size > 0 && progress) {
    progress = false;
    for (const [name, info] of pending.entries()) {
      const allResolved = Array.from(info.deps).every(d => resolved.has(d));
      if (allResolved) {
        const rewritten = rewriteImports(info.code);
        const blob = new Blob([rewritten], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        createdUrls.push(url);
        resolved.set(name, url);
        pending.delete(name);
        progress = true;
      }
    }
  }

  if (pending.size > 0) {
    for (const [name, info] of pending.entries()) {
      const rewritten = rewriteImports(info.code);
      const blob = new Blob([rewritten], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      createdUrls.push(url);
      resolved.set(name, url);
    }
    pending.clear();
  }

  return { entryUrl: resolved.get(entryName), createdUrls };
}

async function parseMxp(arrayBuffer) {
  const bytes = Array.from(new Uint8Array(arrayBuffer));
  const result = await invoke('parse_mxp', { bytes });

  const files = new Map(Object.entries(result.files));
  const manifest = result.manifest;

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
  if (manifest.permissions?.includes('ui:style')) {
    for (const s of styles) {
      const path = typeof s === 'string' ? s : s.path;
      const css = getFile(path);
      if (css) styleHandles.push(ctx.injectCSS(css));
    }
  } else if (styles.length > 0) {
    console.warn(`[plugins] ${pluginId} styles ignored: missing "ui:style" permission`);
  }

  const { entryUrl, createdUrls } = resolveModuleGraph(files, manifest.entry);
  if (!entryUrl) {
    console.error(`[plugins] entry script "${manifest.entry}" not found for ${pluginId}`);
    return;
  }

  let cleanup = null;
  try {
    const mod = await import(/* @vite-ignore */ entryUrl);
    const setup = mod.setup || mod.default;
    if (typeof setup === 'function') {
      cleanup = await setup(ctx);
    }
  } catch (e) {
    console.error(`[plugins] failed to run ${pluginId}:`, e);
    for (const u of createdUrls) {
      try { URL.revokeObjectURL(u); } catch {}
    }
    ctx._cleanup();
    return;
  }

  activePlugins.set(pluginId, { ctx, cleanup, blobUrls: createdUrls });
}

export async function unloadPlugin(pluginId) {
  const active = activePlugins.get(pluginId);
  if (!active) return;

  try {
    if (typeof active.cleanup === 'function') await active.cleanup();
  } catch (e) {
    console.error(`[plugins] cleanup error for ${pluginId}:`, e);
  }

  if (Array.isArray(active.blobUrls)) {
    for (const u of active.blobUrls) {
      try { URL.revokeObjectURL(u); } catch {}
    }
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
    await unloadPlugin(manifest.id);
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

export async function unloadAllPlugins() {
  const ids = Array.from(activePlugins.keys());
  for (const id of ids) {
    await unloadPlugin(id);
  }
}

export async function initPluginSystem() {
  await pluginSettingsStore.load();

  let lastAppVersion = null;
  try {
    lastAppVersion = await invoke('common_store_load', { store: 'app_version_tracker' });
  } catch {
    try {
      const meta = await invoke('common_store_load', { store: 'plugin_meta' }).catch(() => null);
      lastAppVersion = meta?.lastAppVersion || null;
    } catch {}
  }

  const isAppUpdated = lastAppVersion && lastAppVersion !== APP_VERSION;
  if (isAppUpdated) {
    await unloadAllPlugins();
  }

  const state = get(pluginStore);
  const sorted = [...state.plugins.values()].sort((a, b) => a.order - b.order);
  for (const entry of sorted) {
    if (entry.enabled) {
      const isCompat = satisfies(APP_VERSION, entry.manifest?.minAppVersion, entry.manifest?.maxAppVersion);
      if (!isCompat) {
        pluginStore.setEnabled(entry.id, false);
        const { showAlert } = await import('$lib/utils/alert');
        showAlert(`Плагин "${entry.manifest?.name || entry.id}" временно отключен из-за несовместимости с новой версией приложения`);
        continue;
      }
      await loadPlugin(entry.id);
    }
  }

  try {
    await invoke('common_store_save', { store: 'app_version_tracker', data: APP_VERSION });
  } catch {
    try {
      const meta = (await invoke('common_store_load', { store: 'plugin_meta' })) || {};
      meta.lastAppVersion = APP_VERSION;
      await invoke('common_store_save', { store: 'plugin_meta', data: meta });
    } catch {}
  }
}

export async function handlePluginDeepLink(pluginId) {
  try {
    const res = await fetch(`${MAXPLUS_API_BASE}/api/plugins/${encodeURIComponent(pluginId)}/download`);
    if (!res.ok) throw new Error('Plugin not found');
    const arrayBuffer = await res.arrayBuffer();

    const { manifest, files } = await parseMxp(arrayBuffer);

    const iconContent = manifest.icon ? (files.get(manifest.icon) || '') : '';

    showPluginImportModal({
      arrayBuffer,
      manifest,
      verificationStatus: 'verified',
      iconContent,
    });
  } catch (e) {
    console.error('[plugins] deep link error:', e);
    const { showAlert } = await import('$lib/utils/alert');
    showAlert("Не удалось загрузить плагин по ссылке");
  }
}
