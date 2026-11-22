import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { pluginOn, pluginOff, pluginEmit } from './events';
import { mountedContent, registerMount, unregisterMount } from './mount-registry';

import API, {
  currentUser,
  currentUserDetails,
  currentRealChats,
  currentSessionCalls,
  currentFolders,
  currentPresence,
  serverConfig,
} from '$lib/stores/api';
import Session, { openChat, closeChat, openSettingsPage, closeSettingsPage } from '$lib/stores/session';
import { panelConfig } from '$lib/stores/panel';
import { activeWebApps, openMiniApp } from '$lib/stores/webapp';
import {
  orderedSetIds, favoriteSetIds, stickerSets,
  stickersById, recentStickerIds, stickersLoading,
} from '$lib/stores/stickers';
import { CryptoPluginRegistry } from '$lib/crypto/plugins';
import { showAlert } from '$lib/utils/alert';
import { mediaPipeline } from '$lib/services/MediaPipelineHost';
import { composerSelection } from '$lib/stores/composerSelection';
import { encodeStegoMessage, parseStegoColors, rgbToHex, hexToRgb, getContrastStyle } from '$lib/formatting/colorStego';
import { registerCamouflagePluginApp, unregisterCamouflagePluginApp } from '$lib/camouflage/store';

async function fetchAsset(url, options = {}) {
  const { sha256, type = 'text', headers, mode } = options;
  const res = await fetch(url, { headers, mode, cache: 'force-cache' });
  if (!res.ok) throw new Error(`Failed to fetch asset (${res.status} ${res.statusText})`);
  const buffer = await res.arrayBuffer();
  if (sha256) {
    const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    if (hashHex.toLowerCase() !== sha256.toLowerCase()) {
      throw new Error(`Integrity check failed: expected ${sha256}, got ${hashHex}`);
    }
  }
  if (type === 'arrayBuffer') return buffer;
  if (type === 'blob') return new Blob([buffer]);
  const text = new TextDecoder().decode(buffer);
  if (type === 'json') return JSON.parse(text);
  if (type === 'script') {
    const blob = new Blob([buffer], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await import(/* @vite-ignore */ blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
  return text;
}

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
  const granted = new Set(manifest.permissions || []);

  const check = (perm, action) => {
    if (!granted.has(perm)) {
      throw new Error(`[plugin:${pluginId}] Permission denied: "${perm}" required for ${action || 'operation'}`);
    }
  };

  const ctx = {
    manifest,
    pluginId,

    get stores() {
      check('stores:read', 'ctx.stores');
      return {
        session: Session,
        currentUser,
        currentUserDetails,
        currentRealChats,
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
        composerSelection,
      };
    },

    input: {
      getSelection() {
        if (!granted.has('stores:read') && !granted.has('ui:mount')) {
          check('stores:read', 'ctx.input.getSelection()');
        }
        return get(composerSelection);
      },
      replaceSelection(data) {
        if (!granted.has('stores:write') && !granted.has('events') && !granted.has('ui:mount')) {
          check('stores:write', 'ctx.input.replaceSelection()');
        }
        pluginEmit('input:replace-selection', data);
      },
      insert(data) {
        if (!granted.has('stores:write') && !granted.has('events') && !granted.has('ui:mount')) {
          check('stores:write', 'ctx.input.insert()');
        }
        pluginEmit('input:insert', data);
      },
    },

    get api() {
      check('api:call', 'ctx.api');
      return get(API);
    },

    getStore(store) {
      check('stores:read', 'ctx.getStore()');
      return get(store);
    },

    subscribe(store, cb) {
      check('stores:read', 'ctx.subscribe()');
      return store.subscribe(cb);
    },

    openChat,
    closeChat,
    openSettingsPage,
    closeSettingsPage,
    openMiniApp,

    mount(mountPoint, html, options = {}) {
      check('ui:mount', 'ctx.mount()');
      const handle = registerMount(mountPoint, { html, pluginId, options });
      mountHandles.push(handle);
      return handle;
    },

    unmount(handle) {
      check('ui:mount', 'ctx.unmount()');
      unregisterMount(handle);
      const idx = mountHandles.indexOf(handle);
      if (idx !== -1) mountHandles.splice(idx, 1);
    },

    injectCSS(css) {
      check('ui:style', 'ctx.injectCSS()');
      const el = injectCSS(css, pluginId);
      styleHandles.push(el);
      return el;
    },

    removeCSS(handle) {
      check('ui:style', 'ctx.removeCSS()');
      removeCSS(handle);
      const idx = styleHandles.indexOf(handle);
      if (idx !== -1) styleHandles.splice(idx, 1);
    },

    on(event, cb) {
      check('events', 'ctx.on()');
      pluginOn(event, cb);
      eventBindings.push({ event, cb });
    },

    off(event, cb) {
      check('events', 'ctx.off()');
      pluginOff(event, cb);
    },

    emit(event, data) {
      if (event === 'input:insert' || event === 'input:replace-selection') {
        if (!granted.has('events') && !granted.has('stores:write') && !granted.has('ui:mount')) {
          check('events', 'ctx.emit()');
        }
      } else {
        check('events', 'ctx.emit()');
      }
      pluginEmit(event, data);
    },

    get storage() {
      check('storage', 'ctx.storage');
      return makeStorage(pluginId);
    },

    showNotification(message) {
      showAlert(message);
    },

    get crypto() {
      check('crypto', 'ctx.crypto');
      return CryptoPluginRegistry;
    },

    invoke(...args) {
      check('tauri', 'ctx.invoke()');
      return invoke(...args);
    },

    log: makeLog(pluginId),

    get media() {
      check('media', 'ctx.media');
      return {
        registerVideoProcessor(processor) {
          return mediaPipeline.installVideoPlugin({ id: pluginId, ...processor });
        },
        unregisterVideoProcessor() {
          return mediaPipeline.removeVideoPlugin(pluginId);
        },
        registerAudioProcessor(processor) {
          return mediaPipeline.installAudioPlugin({ id: pluginId, ...processor });
        },
        unregisterAudioProcessor() {
          return mediaPipeline.removeAudioPlugin(pluginId);
        },
        notifyAudioPipelineChange() {
          return mediaPipeline.restartAudioPipeline?.();
        },
        listVideoProcessors() {
          return mediaPipeline.listVideoPlugins();
        },
        listAudioProcessors() {
          return mediaPipeline.listAudioPlugins();
        },
        registerMask(mask) {
          return mediaPipeline.registerMask({ ...mask, pluginId });
        },
        unregisterMask(maskId) {
          return mediaPipeline.unregisterMask(maskId);
        },
        registerBackground(bg) {
          return mediaPipeline.registerBackground({ ...bg, pluginId });
        },
        unregisterBackground(bgId) {
          return mediaPipeline.unregisterBackground(bgId);
        },
        registerVoiceFilter(vf) {
          return mediaPipeline.registerVoiceFilter({ ...vf, pluginId });
        },
        unregisterVoiceFilter(vfId) {
          return mediaPipeline.unregisterVoiceFilter(vfId);
        },
        getCustomEffects() {
          return mediaPipeline.getCustomEffects();
        },
        setActiveVideoEffects(active) {
          return mediaPipeline.setActiveVideoEffects(active);
        },
        hasActiveVideoEffects() {
          return mediaPipeline.hasActiveVideoEffects();
        },
      };
    },

    fetchAsset(url, options) {
      check('network', 'ctx.fetchAsset()');
      return fetchAsset(url, options);
    },

    formatting: {
      encodeColor(text, colorHex) {
        const res = encodeStegoMessage(text, [], [{ start: 0, end: text.length, color: colorHex }]);
        return {
          ...res,
          toString() {
            return this.textToSend;
          },
          [Symbol.toPrimitive]() {
            return this.textToSend;
          },
        };
      },
      encodeMessage(cleanText, colorSpans = [], elements = []) {
        return encodeStegoMessage(cleanText, elements, colorSpans);
      },
      decodeColors(rawText, rawElements = []) {
        return parseStegoColors(rawText, rawElements);
      },
      stripColors(rawText, rawElements = []) {
        return parseStegoColors(rawText, rawElements).cleanText;
      },
      getContrastStyle(hex, isMe) {
        return getContrastStyle(hex, isMe);
      },
      rgbToHex,
      hexToRgb,
    },

    camouflage: {
      registerApp(app) {
        registerCamouflagePluginApp(app);
      },
      unregisterApp(appId) {
        unregisterCamouflagePluginApp(appId);
      }
    },

    _cleanup() {
      for (const el of styleHandles) removeCSS(el);
      styleHandles.length = 0;
      for (const handle of mountHandles) unregisterMount(handle);
      mountHandles.length = 0;
      for (const { event, cb } of eventBindings) pluginOff(event, cb);
      eventBindings.length = 0;
      mediaPipeline.removeVideoPlugin(pluginId).catch(() => {});
      mediaPipeline.removeAudioPlugin(pluginId).catch(() => {});
      try {
        const effects = mediaPipeline.getCustomEffects();
        for (const m of effects.masks) if (m.pluginId === pluginId) mediaPipeline.unregisterMask(m.id);
        for (const b of effects.backgrounds) if (b.pluginId === pluginId) mediaPipeline.unregisterBackground(b.id);
        for (const v of effects.voiceFilters) if (v.pluginId === pluginId) mediaPipeline.unregisterVoiceFilter(v.id);
      } catch {}
    },
  };

  return ctx;
}
