import { get } from 'svelte/store';
import { pluginStore, pluginSettingsStore } from '$lib/stores/plugins';
import { APP_VERSION, installPlugin, unloadPlugin } from './runtime';
import { showAlert } from '$lib/utils/alert';

const DEFAULT_UPDATE_API = 'https://maxplus.dev/api/plugins/check-updates';

async function computeSha256(arrayBuffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkPluginUpdates(options = {}) {
  const silent = options.silent === true;
  const autoApply = options.autoApply !== false;

  const state = get(pluginStore);
  const installed = Array.from(state.plugins.values());
  if (installed.length === 0) {
    pluginSettingsStore.setAvailableUpdates([]);
    pluginSettingsStore.setLastCheckedAt(Date.now());
    return [];
  }

  pluginSettingsStore.setChecking(true);

  const groups = new Map();
  for (const p of installed) {
    const rawUrl = p.manifest?.updateUrl?.trim();
    const endpoint = rawUrl || DEFAULT_UPDATE_API;
    if (!groups.has(endpoint)) {
      groups.set(endpoint, []);
    }
    groups.get(endpoint).push({
      id: p.id,
      version: p.manifest?.version || '0.0.0',
    });
  }

  const allUpdates = [];

  for (const [endpoint, pluginItems] of groups.entries()) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_version: APP_VERSION,
          plugins: pluginItems,
        }),
      });

      if (!res.ok) continue;

      const data = await res.json().catch(() => ({}));
      const updates = Array.isArray(data?.updates) ? data.updates : [];

      let baseUrl = 'https://maxplus.dev';
      try {
        const u = new URL(endpoint);
        baseUrl = u.origin;
      } catch {}

      for (const item of updates) {
        if (!item?.id || !item?.target_version) continue;
        let dl = item.download_url || '';
        if (dl.startsWith('/')) {
          dl = `${baseUrl}${dl}`;
        }
        allUpdates.push({
          ...item,
          download_url: dl,
        });
      }
    } catch (e) {
      console.error('[plugins] check update error for', endpoint, e);
    }
  }

  pluginSettingsStore.setAvailableUpdates(allUpdates);
  pluginSettingsStore.setLastCheckedAt(Date.now());
  pluginSettingsStore.setChecking(false);

  const settings = get(pluginSettingsStore);
  if (autoApply && settings.autoUpdate && allUpdates.length > 0) {
    const appliedNames = [];
    for (const update of allUpdates) {
      try {
        await applyPluginUpdate(update);
        appliedNames.push(update.name || update.id);
      } catch (err) {
        console.error('[plugins] auto update failed for', update.id, err);
      }
    }
    if (appliedNames.length > 0 && !silent) {
      showAlert(`Плагины автоматически обновлены: ${appliedNames.join(', ')}`);
    }
  }

  return allUpdates;
}

export async function applyPluginUpdate(updateInfo) {
  if (!updateInfo?.download_url) {
    throw new Error('Отсутствует ссылка на скачивание обновления');
  }

  const res = await fetch(updateInfo.download_url);
  if (!res.ok) {
    throw new Error(`Не удалось загрузить обновление (${res.status})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const actualHash = await computeSha256(arrayBuffer);

  if (
    updateInfo.sha256_hash &&
    updateInfo.sha256_hash.toLowerCase() !== actualHash.toLowerCase()
  ) {
    throw new Error('Контрольная сумма SHA-256 не совпадает! Обновление отклонено.');
  }

  const currentStore = get(pluginStore);
  const existing = currentStore.plugins.get(updateInfo.id);
  const wasEnabled = existing?.enabled ?? true;

  await installPlugin(arrayBuffer, { enable: wasEnabled });
  pluginSettingsStore.removeUpdate(updateInfo.id);
}

export async function updateAllAvailablePlugins() {
  const updates = Array.from(get(pluginSettingsStore).availableUpdates.values());
  if (updates.length === 0) return;

  const updatedNames = [];
  for (const u of updates) {
    try {
      await applyPluginUpdate(u);
      updatedNames.push(u.name || u.id);
    } catch (e) {
      console.error('Update failed for', u.id, e);
    }
  }

  if (updatedNames.length > 0) {
    showAlert(`Успешно обновлено: ${updatedNames.join(', ')}`);
  }
}
