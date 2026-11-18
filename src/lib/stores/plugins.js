import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

const importModalStore = writable(null);
export { importModalStore as pluginImportModal };

export function showPluginImportModal(data) {
  importModalStore.set(data);
}

export function closePluginImportModal() {
  importModalStore.set(null);
}

function createPluginStore() {
  const { subscribe, set, update } = writable({
    plugins: new Map(),
    loaded: false,
  });

  async function persist(state) {
    const serializable = {
      plugins: [...state.plugins.entries()].map(([id, entry]) => ({
        id,
        manifest: entry.manifest,
        files: entry.files instanceof Map
          ? Object.fromEntries(entry.files.entries())
          : (entry.files || {}),
        enabled: entry.enabled,
        order: entry.order,
        installedAt: entry.installedAt,
        verificationStatus: entry.verificationStatus,
        sourceHash: entry.sourceHash,
      })),
    };
    try {
      await invoke('common_store_save', { store: 'plugin_meta', data: serializable });
    } catch (e) {
      console.error('[plugins] persist error:', e);
    }
  }

  async function load() {
    try {
      const raw = await invoke('common_store_load', { store: 'plugin_meta' });
      if (!raw || !Array.isArray(raw.plugins)) {
        update(s => ({ ...s, loaded: true }));
        return;
      }
      const plugins = new Map();
      for (const entry of raw.plugins) {
        plugins.set(entry.id, {
          ...entry,
          files: entry.files instanceof Map
            ? entry.files
            : new Map(Object.entries(entry.files || {})),
        });
      }
      set({ plugins, loaded: true });
    } catch (e) {
      console.error('[plugins] load error:', e);
      update(s => ({ ...s, loaded: true }));
    }
  }

  function install(entry) {
    update(state => {
      const plugins = new Map(state.plugins);
      const maxOrder = plugins.size > 0
        ? Math.max(...[...plugins.values()].map(p => p.order || 0))
        : 0;
      const files = entry.files instanceof Map
        ? entry.files
        : new Map(Object.entries(entry.files || {}));
      plugins.set(entry.id, { ...entry, files, order: maxOrder + 10 });
      const next = { ...state, plugins };
      persist(next);
      return next;
    });
  }

  function uninstall(pluginId) {
    update(state => {
      const plugins = new Map(state.plugins);
      plugins.delete(pluginId);
      const next = { ...state, plugins };
      persist(next);
      return next;
    });
  }

  function setEnabled(pluginId, enabled) {
    update(state => {
      const plugins = new Map(state.plugins);
      const entry = plugins.get(pluginId);
      if (!entry) return state;
      plugins.set(pluginId, { ...entry, enabled });
      const next = { ...state, plugins };
      persist(next);
      return next;
    });
  }

  function setOrder(pluginId, order) {
    update(state => {
      const plugins = new Map(state.plugins);
      const entry = plugins.get(pluginId);
      if (!entry) return state;
      plugins.set(pluginId, { ...entry, order });
      const next = { ...state, plugins };
      persist(next);
      return next;
    });
  }

  function reorder(orderedIds) {
    update(state => {
      const plugins = new Map(state.plugins);
      orderedIds.forEach((id, idx) => {
        const entry = plugins.get(id);
        if (entry) plugins.set(id, { ...entry, order: (idx + 1) * 10 });
      });
      const next = { ...state, plugins };
      persist(next);
      return next;
    });
  }

  return {
    subscribe,
    load,
    install,
    uninstall,
    setEnabled,
    setOrder,
    reorder,
  };
}

export const pluginStore = createPluginStore();

function createPluginSettingsStore() {
  const { subscribe, set, update } = writable({
    autoUpdate: true,
    availableUpdates: new Map(),
    checkingUpdates: false,
    lastCheckedAt: null,
    loaded: false,
  });

  async function persist(state) {
    const data = {
      autoUpdate: state.autoUpdate,
      lastCheckedAt: state.lastCheckedAt,
    };
    try {
      await invoke('common_store_save', {
        store: 'plugin_settings',
        data,
      });
    } catch {
      try {
        const meta = (await invoke('common_store_load', { store: 'plugin_meta' })) || {};
        meta.settings = data;
        await invoke('common_store_save', { store: 'plugin_meta', data: meta });
      } catch {}
    }
  }

  async function load() {
    try {
      let raw = null;
      try {
        raw = await invoke('common_store_load', { store: 'plugin_settings' });
      } catch {
        const meta = await invoke('common_store_load', { store: 'plugin_meta' }).catch(() => null);
        raw = meta?.settings || null;
      }
      if (raw && typeof raw === 'object') {
        update(s => ({
          ...s,
          autoUpdate: raw.autoUpdate !== false,
          lastCheckedAt: raw.lastCheckedAt || null,
          loaded: true,
        }));
        return;
      }
      update(s => ({ ...s, loaded: true }));
    } catch {
      update(s => ({ ...s, loaded: true }));
    }
  }

  function setAutoUpdate(enabled) {
    update(state => {
      const next = { ...state, autoUpdate: Boolean(enabled) };
      persist(next);
      return next;
    });
  }

  function setAvailableUpdates(updatesList) {
    update(state => {
      const map = new Map();
      if (Array.isArray(updatesList)) {
        for (const u of updatesList) {
          if (u?.id) map.set(u.id, u);
        }
      } else if (updatesList instanceof Map) {
        for (const [k, v] of updatesList.entries()) {
          map.set(k, v);
        }
      }
      return { ...state, availableUpdates: map };
    });
  }

  function removeUpdate(pluginId) {
    update(state => {
      const map = new Map(state.availableUpdates);
      map.delete(pluginId);
      return { ...state, availableUpdates: map };
    });
  }

  function setChecking(checking) {
    update(state => ({ ...state, checkingUpdates: Boolean(checking) }));
  }

  function setLastCheckedAt(timestamp) {
    update(state => {
      const next = { ...state, lastCheckedAt: timestamp };
      persist(next);
      return next;
    });
  }

  return {
    subscribe,
    load,
    setAutoUpdate,
    setAvailableUpdates,
    removeUpdate,
    setChecking,
    setLastCheckedAt,
  };
}

export const pluginSettingsStore = createPluginSettingsStore();

