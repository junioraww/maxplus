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
      await invoke('plugin_meta_save', { data: serializable });
    } catch (e) {
      console.error('[plugins] persist error:', e);
    }
  }

  async function load() {
    try {
      const raw = await invoke('plugin_meta_load');
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
