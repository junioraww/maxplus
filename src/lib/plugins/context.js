import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { pluginOn, pluginOff, pluginEmit } from './events.js';
import { mountedContent, registerMount, unregisterMount } from './mount-registry.js';

import API, {
  currentUser,
  currentUserDetails,
  currentSessionChats,
  currentSessionCalls,
  currentFolders,
  currentPresence,
  serverConfig,
} from '$lib/stores/api.js';
import Session, { openChat, closeChat, openSettingsPage, closeSettingsPage } from '$lib/stores/session.js';
import { panelConfig } from '$lib/stores/panel.js';
import { activeWebApps, openMiniApp } from '$lib/stores/webapp.js';
import {
  orderedSetIds, favoriteSetIds, stickerSets,
  stickersById, recentStickerIds, stickersLoading,
} from '$lib/stores/stickers.js';
import { CryptoPluginRegistry } from '$lib/crypto/plugins.js';
import { showAlert } from '$lib/utils/alert.js';

function makeStorage(pluginId) {
  return {
    async get(key) {
      try {
        const val = await invoke('plugin_storage_get', { pluginId, key });
        if (val === null || val === undefined) return undefined;
        try { return JSON.parse(val); } catch { return val; }
      } catch { return undefined; }
    },
    async set(key, value) {
      await invoke('plugin_storage_set', {
        pluginId,
        key,
        value: value === undefined ? null : JSON.stringify(value),
      });
    },
    async remove(key) {
      await invoke('plugin_storage_set', { pluginId, key, value: null });
    },
    async getAll() {
      try {
        const data = await invoke('plugin_storage_get_all', { pluginId });
        if (!data || typeof data !== 'object') return {};
        const result = {};
        for (const [k, v] of Object.entries(data)) {
          try { result[k] = JSON.parse(v); } catch { result[k] = v; }
        }
        return result;
      } catch { return {}; }
    },
    async clear() {
      await invoke('plugin_storage_clear', { pluginId });
    },
  };
}

function makeLog(pluginId) {
  const prefix = `[plugin:${pluginId}]`;
  return {
    info: (...a) => console.info(prefix, ...a),
    warn: (...a) => console.warn(prefix, ...a),
    error: (...a) => console.error(prefix, ...a),
  };
}

function injectCSS(css, pluginId) {
  const el = document.createElement('style');
  el.setAttribute('data-plugin', pluginId);
  const nonce = document.querySelector('style[nonce]')?.nonce || document.querySelector('script[nonce]')?.nonce;
  if (nonce) el.nonce = nonce;
  el.textContent = css;
  document.head.appendChild(el);
  return el;
}

function removeCSS(el) {
  el?.parentNode?.removeChild(el);
}

export function buildPluginContext(manifest, pluginId) {
  const styleHandles = [];
  const mountHandles = [];
  const eventBindings = [];

  const ctx = {
    manifest,
    pluginId,

    stores: {
      session: Session,
      currentUser,
      currentUserDetails,
      currentSessionChats,
      currentSessionCalls,
      currentFolders,
      currentPresence,
      serverConfig,
      panelConfig,
      activeWebApps,
      stickers: {
        orderedSetIds,
        favoriteSetIds,
        stickerSets,
        stickersById,
        recentStickerIds,
        stickersLoading,
      },
    },

    get api() {
      return get(API);
    },

    getStore(store) {
      return get(store);
    },

    subscribe(store, cb) {
      return store.subscribe(cb);
    },

    openChat,
    closeChat,
    openSettingsPage,
    closeSettingsPage,
    openMiniApp,

    mount(mountPoint, html, options = {}) {
      const handle = registerMount(mountPoint, { html, pluginId, options });
      mountHandles.push(handle);
      return handle;
    },

    unmount(handle) {
      unregisterMount(handle);
      const idx = mountHandles.indexOf(handle);
      if (idx !== -1) mountHandles.splice(idx, 1);
    },

    injectCSS(css) {
      const el = injectCSS(css, pluginId);
      styleHandles.push(el);
      return el;
    },

    removeCSS(handle) {
      removeCSS(handle);
      const idx = styleHandles.indexOf(handle);
      if (idx !== -1) styleHandles.splice(idx, 1);
    },

    on(event, cb) {
      pluginOn(event, cb);
      eventBindings.push({ event, cb });
    },

    off(event, cb) {
      pluginOff(event, cb);
    },

    emit(event, data) {
      pluginEmit(event, data);
    },

    storage: makeStorage(pluginId),

    showNotification(message) {
      showAlert(message);
    },

    crypto: CryptoPluginRegistry,

    invoke,

    log: makeLog(pluginId),

    _cleanup() {
      for (const el of styleHandles) removeCSS(el);
      styleHandles.length = 0;
      for (const handle of mountHandles) unregisterMount(handle);
      mountHandles.length = 0;
      for (const { event, cb } of eventBindings) pluginOff(event, cb);
      eventBindings.length = 0;
    },
  };

  return ctx;
}
