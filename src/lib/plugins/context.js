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
import { panelConfig, registerPluginPanelItem, unregisterPluginPanelItem } from '$lib/stores/panel';
import { getEncryptionInfo } from '$lib/crypto/asymmetric';
import { encryptMessage, obfuscate } from '$lib/crypto/messages';
import { getChatSettings } from '$lib/stores/messages';
import { getCurrentAccount } from '$lib/stores/accounts';
import Dropdown from '$components/common/Dropdown.svelte';
import { mount as svelteMount, unmount as svelteUnmount } from 'svelte';
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
import { openSheet, openScreen, openDialog, dismissLayer } from '$lib/services/layerManager';
import { authenticateHardware, checkHardwareBiometry } from '$lib/services/hardwareSecurity';

async function fetchAsset(url, options = {}) {
  const { sha256, type = 'text', headers, mode } = options;
  if (type === 'script' && !sha256 && /^https:\/\//i.test(url)) {
    return await import(/* @vite-ignore */ url);
  }
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

function makeVault(pluginId) {
  return {
    async get(key) {
      const val = await invoke('plugin_vault_get', { pluginId, key });
      if (val === null || val === undefined) return undefined;
      try { return JSON.parse(val); } catch { return val; }
    },
    async set(key, value) {
      await invoke('plugin_vault_set', {
        pluginId,
        key,
        value: value === undefined ? null : JSON.stringify(value),
      });
    },
    async remove(key) {
      await invoke('plugin_vault_set', { pluginId, key, value: null });
    },
    async listKeys() {
      return await invoke('plugin_vault_list_keys', { pluginId });
    },
    async clear() {
      await invoke('plugin_vault_clear', { pluginId });
    },
  };
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function proxyFetch(url, options = {}) {
  let bodyBytes = null;
  if (options.body !== undefined && options.body !== null) {
    if (typeof options.body === 'string') {
      bodyBytes = Array.from(new TextEncoder().encode(options.body));
    } else if (options.body instanceof Uint8Array) {
      bodyBytes = Array.from(options.body);
    } else if (options.body instanceof ArrayBuffer) {
      bodyBytes = Array.from(new Uint8Array(options.body));
    }
  }
  const res = await invoke('proxy_http_request', {
    url: String(url),
    method: options.method || 'GET',
    headers: options.headers || null,
    body: bodyBytes,
  });
  const bytes = res.body_base64 ? base64ToUint8Array(res.body_base64) : new Uint8Array(0);
  return {
    ok: Boolean(res.ok),
    status: res.status,
    statusText: res.status_text || '',
    headers: res.headers || {},
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async json() {
      return JSON.parse(new TextDecoder().decode(bytes));
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
  const portalLayerIds = new Set();
  const messageCardIds = new Set();
  const panelTabIds = new Set();
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

    get vault() {
      check('vault', 'ctx.vault');
      return makeVault(pluginId);
    },

    get biometry() {
      check('biometry', 'ctx.biometry');
      return {
        checkStatus: () => checkHardwareBiometry(),
        authenticate: (reason) => authenticateHardware(reason),
      };
    },

    get net() {
      check('network', 'ctx.net');
      return {
        fetch: (url, options) => proxyFetch(url, options),
      };
    },

    get ui() {
      const checkPortal = (action) => {
        if (!granted.has('ui:portal') && !granted.has('ui:mount')) {
          check('ui:portal', action);
        }
      };

      const openPluginPortal = async (mode, opts = {}) => {
        checkPortal(`ctx.ui.${mode}`);
        const mod = await import('$components/plugins/PluginPortalContent.svelte');
        const Comp = mod.default || mod;
        const props = {
          mode,
          title: opts.title || '',
          maxHeight: opts.maxHeight || '85vh',
          showClose: opts.showClose ?? true,
          showHandle: opts.showHandle ?? true,
          showHeader: opts.showHeader ?? true,
          html: opts.html || '',
          className: opts.className || '',
          onMountCallback: opts.onMount || null,
        };
        const opener = mode === 'screen' ? openScreen : mode === 'dialog' ? openDialog : openSheet;
        const promise = opener(Comp, props, {
          dim: mode !== 'screen',
          dismissOnDim: opts.dismissOnDim ?? (mode !== 'screen'),
          canSwipe: opts.canSwipe ?? (mode === 'screen' || mode === 'sheet'),
          onClose: (res) => {
            portalLayerIds.delete(promise.id);
            if (typeof opts.onClose === 'function') opts.onClose(res);
          },
        });
        if (promise?.id) portalLayerIds.add(promise.id);
        return promise;
      };

      return {
        openSheet: (opts) => openPluginPortal('sheet', opts),
        openScreen: (opts) => openPluginPortal('screen', opts),
        openDialog: (opts) => openPluginPortal('dialog', opts),
        dismiss: (layerId, result) => {
          checkPortal('ctx.ui.dismiss()');
          if (layerId) {
            portalLayerIds.delete(layerId);
            dismissLayer(layerId, result);
          }
        },
        async confirm(opts = {}) {
          checkPortal('ctx.ui.confirm()');
          const mod = await import('$components/main/ConfirmModal.svelte');
          const Comp = mod.default || mod;
          const p = openDialog(Comp, {
            title: opts.title || 'Подтверждение',
            message: opts.message || '',
            confirmText: opts.confirmText || 'Подтвердить',
            cancelText: opts.cancelText || 'Отмена',
            isDangerous: opts.danger ?? false,
          });
          if (p?.id) portalLayerIds.add(p.id);
          const result = await p;
          if (p?.id) portalLayerIds.delete(p.id);
          return Boolean(result);
        },
        async openQRScanner() {
          checkPortal('ctx.ui.openQRScanner()');
          const mod = await import('$components/main/QRScannerModal.svelte');
          const Comp = mod.default || mod;
          return new Promise((resolve) => {
            let scanned = null;
            const p = openScreen(Comp, {
              onScan: (code) => {
                scanned = code;
                dismissLayer(p.id, code);
              },
            }, {
              onClose: () => {
                portalLayerIds.delete(p.id);
                resolve(scanned);
              },
            });
            if (p?.id) portalLayerIds.add(p.id);
          });
        },
        registerMessageCard(cardId, handler) {
          checkPortal('ctx.ui.registerMessageCard()');
          const fullId = `${pluginId}:${cardId}`;
          CryptoPluginRegistry.registerMessageCard(fullId, handler);
          messageCardIds.add(fullId);
          return fullId;
        },
        unregisterMessageCard(cardId) {
          const fullId = cardId.startsWith(`${pluginId}:`) ? cardId : `${pluginId}:${cardId}`;
          CryptoPluginRegistry.unregisterMessageCard(fullId);
          messageCardIds.delete(fullId);
        },
        registerPanelTab(opts = {}) {
          checkPortal('ctx.ui.registerPanelTab()');
          const rawId = `${pluginId}.${opts.id || 'tab'}`;
          const fullId = registerPluginPanelItem({
            id: rawId,
            name: opts.name || manifest.name,
            iconSvg: opts.iconSvg || '',
            title: opts.title ?? opts.name ?? manifest.name,
            showHeader: opts.showHeader ?? true,
            html: opts.html || '',
            onMount: opts.onMount || null,
          });
          if (fullId) panelTabIds.add(fullId);
          return fullId;
        },
        unregisterPanelTab(tabId) {
          if (!tabId) return;
          unregisterPluginPanelItem(tabId);
          panelTabIds.delete(tabId);
        },
        registerAttachAction(opts = {}) {
          checkPortal('ctx.ui.registerAttachAction()');
          const handle = registerMount('attach:action', {
            html: opts.iconSvg || '',
            pluginId,
            options: {
              label: opts.label || manifest.name,
              onClick: opts.onClick || null,
            },
          });
          mountHandles.push(handle);
          return handle;
        },
        mountDropdown(targetEl, opts = {}) {
          checkPortal('ctx.ui.mountDropdown()');
          if (!targetEl) return null;
          const instance = svelteMount(Dropdown, {
            target: targetEl,
            props: {
              options: opts.options || [],
              value: opts.value ?? null,
              placeholder: opts.placeholder || 'Выберите...',
              disabled: Boolean(opts.disabled),
              onChange: opts.onChange || null,
            },
          });
          return {
            destroy: () => {
              try { svelteUnmount(instance); } catch {}
            },
          };
        },
      };
    },

    showNotification(message) {
      showAlert(message);
    },

    get crypto() {
      check('crypto', 'ctx.crypto');
      return {
        ...CryptoPluginRegistry,
        async getChatEncryptionInfo(chatId) {
          const acc = await getCurrentAccount().catch(() => null);
          const accId = acc?.id ?? acc;
          if (!accId || !chatId) return null;
          return getEncryptionInfo(accId, chatId);
        },
        async sendEncryptedMessage(chatId, plaintext, params = {}) {
          check('api:call', 'ctx.crypto.sendEncryptedMessage()');
          const cid = Number(chatId);
          const settings = get(getChatSettings(cid)) || {};
          const hasSession = Boolean(settings?.keys?.current || settings?.session);
          const password = settings?.password || null;
          const obf = settings?.obfs || 'zh';

          let payloadText = String(plaintext ?? '');
          if (!hasSession && !password && CryptoPluginRegistry.hasObfuscator(obf)) {
            payloadText = await obfuscate(payloadText, obf);
          } else {
            const acc = await getCurrentAccount().catch(() => null);
            payloadText = await encryptMessage({
              account: Number(acc?.id ?? acc ?? 0),
              chatId: cid,
              text: payloadText,
              media: null,
              password,
              useSession: hasSession,
              obf,
            });
          }
          return get(API).sendMessage(payloadText, cid, params);
        },
      };
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
      for (const layerId of portalLayerIds) {
        try { dismissLayer(layerId); } catch {}
      }
      portalLayerIds.clear();
      for (const cardId of messageCardIds) {
        CryptoPluginRegistry.unregisterMessageCard(cardId);
      }
      messageCardIds.clear();
      for (const tabId of panelTabIds) {
        unregisterPluginPanelItem(tabId);
      }
      panelTabIds.clear();
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
