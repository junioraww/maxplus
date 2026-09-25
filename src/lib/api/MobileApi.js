import { listen } from "@tauri-apps/api/event";
import { goto } from "$app/navigation";
import { get } from "svelte/store";

import { invoke } from "$lib/utils/invoke";
import {
  currentUser,
  currentUserDetails,
  currentSessionChats,
  currentSessionCalls,
  currentRealChats,
  currentRealContacts,
  currentFolders,
  currentlySyncing,
  currentPresence,
  serverConfig,
} from "$lib/stores/api";
import {
  get as sessionGet,
  set as sessionSet
} from "$lib/stores/session";
import {
  syncContacts,
} from "$lib/utils/caching";
import { handlePushUpdate } from "$lib/stores/stickers";
import { handleTranscriptionPush } from "$lib/stores/transcription.js";
import {
  addAccount,
  getAccounts,
  removeAccountByUserId,
  getCurrentAccount,
  setCurrentAccount,
  setAccountContact,
} from "$lib/stores/accounts";
import {
  getChat,
  loadChats,
  saveChats,
} from "$lib/stores/messages";
import {
  getContact,
  getContactDirect,
  updateContact,
  getCachedContacts,
} from "$lib/stores/contacts";
import {
  getContactAsync,
} from "$lib/utils/caching";
import {
  setupPushNotifications,
  newMessage,
  applyUserConfig,
  loadAccountNotificationSettings
} from "$lib/utils/notifications";
import {
  getMessagePreview
} from "$lib/utils/text";

import BaseAPI from "./BaseApi";

function sortFolders(folders, order) {
  if (!folders || !Array.isArray(folders)) return [];
  if (!order || !order.length) return [...folders];
  const orderMap = new Map(order.map((id, index) => [String(id), index]));
  return [...folders].sort((a, b) => {
    const ai = orderMap.has(String(a.id)) ? orderMap.get(String(a.id)) : 999999;
    const bi = orderMap.has(String(b.id)) ? orderMap.get(String(b.id)) : 999999;
    return ai - bi;
  });
}

export { parseApiError } from "$lib/utils/errors.js";

export default class MobileApi extends BaseAPI {
  resolve_sync = null;
  synchronizedPending = true;
  synchronized = new Promise((resolve) => (this.resolve_sync = resolve));
  latest_init = null;
  unlisten = null;
  notify = {};
  savedMessages = {};
  reconnectPromise = null;
  reconnectAttempts = 0;

  constructor(token) {
    super(token);
    if (typeof window !== "undefined") {
      try {
        const cachedCfg = JSON.parse(localStorage.getItem("max_server_config") || "{}");
        if (cachedCfg && Object.keys(cachedCfg).length) serverConfig.set(cachedCfg);
      } catch {}
      window.addEventListener("online", () => {
        if (!sessionGet("connected") && get(currentUser)) {
          this.reconnectAttempts = 0;
          this.reconnect();
        }
      });
    }
  }

  async waitSync(timeoutMs = 15000) {
    if (sessionGet("connected") && sessionGet("sync")) return true;
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Request timed out waiting for connection"));
      }, timeoutMs);
    });
    try {
      await Promise.race([this.synchronized, timeoutPromise]);
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  async reconnect() {
    sessionSet("connected", false);
    sessionSet("sync", false);
    if (!this.synchronizedPending) {
      this.synchronizedPending = true;
      this.synchronized = new Promise((resolve) => (this.resolve_sync = resolve));
    }
    if (this.reconnectPromise) return this.reconnectPromise;

    this.reconnectPromise = (async () => {
      try {
        while (!sessionGet("connected")) {
          const current = get(currentUser);
          if (current === null || current === undefined) {
            break;
          }

          const delay = this.reconnectAttempts === 0
            ? 500
            : Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
          await new Promise((r) => setTimeout(r, delay));

          try {
            const success = await this.init(true, true);
            if (success) {
              this.reconnectAttempts = 0;
              break;
            }
          } catch (err) {
            console.error(err);
          }

          this.reconnectAttempts++;
        }
      } finally {
        this.reconnectPromise = null;
      }
    })();

    return this.reconnectPromise;
  }

  async startListener() {
    this.unlisten = await listen("max", async (event) => {
      const { payload } = event;

      if (payload.type === "log") {
        if (payload.response === "closed") {
          sessionSet("connected", false);
          this.reconnect();
        }
        return;
      }
      if (payload.type === "tx") return;

      // only RX
      const { response } = payload;
      const opc = response.opcode;

      if (opc === 128) {
        const message = response.payload.message;
        message.chatId = response.payload.chatId;

        const chat = getChat(message.chatId);
        chat.updateMessages([ message ]);

        if (message.status === "EDITED") {
          chat.receivedMessage.set(message);

          currentSessionChats.update((chats) => {
            if (!chats) return chats;
            const index = chats.findIndex((c) => String(c.id) === String(message.chatId));
            if (index !== -1 && chats[index].lastMessage && String(chats[index].lastMessage.id) === String(message.id)) {
              const updatedChat = {
                ...chats[index],
                lastMessage: message,
              };
              const next = [...chats];
              next[index] = updatedChat;
              return next;
            }
            return chats;
          });
        } else {
          chat.receivedMessage.set(message);

          const myId = Number(get(currentUser));
          const isOutgoing = Number(message.sender) === myId || Number(message.from) === myId;
          const msgTime = message.time || Date.now();

          currentSessionChats.update((chats) => {
            if (!chats) return chats;
            const index = chats.findIndex((c) => String(c.id) === String(message.chatId));
            if (index === -1) {
              const info = chat.getInfo() || { id: message.chatId, type: "DIALOG" };
              const newChat = {
                ...info,
                id: message.chatId,
                lastMessage: message,
                lastEventTime: msgTime,
                newMessages: isOutgoing ? 0 : 1,
              };
              return [newChat, ...chats];
            }
            const updatedChat = {
              ...chats[index],
              lastMessage: message,
              lastEventTime: msgTime,
              newMessages: isOutgoing ? (chats[index].newMessages || 0) : ((chats[index].newMessages || 0) + 1),
            };
            const next = [...chats];
            next.splice(index, 1);
            return [updatedChat, ...next];
          });

          currentRealChats.update((ids) => {
            if (!ids) return [message.chatId];
            return ids.some(id => String(id) === String(message.chatId)) ? ids : [message.chatId, ...ids];
          });

          if (!isOutgoing) {
            const info = chat.getInfo();
            if (info?.type === "DIALOG") {
              let peerId = null;
              if (info?.participants && Object.keys(info.participants).length > 0) {
                const other = Object.keys(info.participants).find(id => String(id) !== String(myId));
                if (other) peerId = Number(other);
              }
              if (!peerId && myId && message.chatId) {
                try {
                  peerId = Number(BigInt(message.chatId) ^ BigInt(myId));
                } catch {}
              }
              const contact = peerId ? await getContactDirect(peerId) : null;

              newMessage(
                message.chatId,
                chat,
                contact,
                message
              );
            } else {
              let contact = null;
              if (message.sender) {
                contact = await getContactDirect(message.sender);
              }
              newMessage(
                message.chatId,
                chat,
                contact,
                message
              );
            }
          }
        }
      } else if (opc === 129) {
      } else if (opc === 130) {
        const payload = response.payload;
        if (payload?.chatId && payload?.mark && payload?.setAsUnread !== true) {
          const chatId = payload.chatId;
          const userId = Number(payload.userId);
          const mark = Number(payload.mark);
          const myId = Number(get(currentUser));

          const chat = getChat(chatId);
          chat.readReceipt?.set({ userId, mark });

          currentSessionChats.update(chats => {
            if (!chats) return chats;
            const idx = chats.findIndex(c => String(c.id) === String(chatId));
            if (idx === -1) return chats;
            const current = chats[idx];
            const participants = { ...(current.participants || {}), [userId]: mark };
            let otherReadTime = current.otherReadTime || 0;
            if (userId !== myId && mark > otherReadTime) {
              otherReadTime = mark;
            }
            chats[idx] = { ...current, participants, otherReadTime };
            return [...chats];
          });
        }
      } else if (opc === 132) {
        const p = response.payload;
        if (p?.userId) {
          const userId = Number(p.userId);
          const presence = p.presence || p;
          const status = presence.status != null ? Number(presence.status) : 0;
          const seen = presence.seen != null ? Number(presence.seen) : Date.now();
          currentPresence.update(prev => ({
            ...prev,
            [userId]: {
              status,
              seen,
              on: status === 1 ? "ON" : "OFF"
            }
          }));
        }
      } else if (opc === 136) {
        const { videoId, fileId } = response.payload;
        const id = videoId ?? fileId;
        if (id != null) {
          this.notify[id]?.();
          this.notify[String(id)]?.();
          if (!isNaN(Number(id))) this.notify[Number(id)]?.();
        }
      } else if (opc === 277) {
        const p = response.payload;
        if (p?.folders) {
          const sorted = sortFolders(p.folders, p.foldersOrder || []);
          currentFolders.set(sorted);
        }
      } else if (opc === 150) {
        const p = response.payload;
        if (p?.type === "FAVORITE_STICKER_SET") {
          handlePushUpdate(p.id, p.updateType);
        }
      } else if (opc === 293) {
        handleTranscriptionPush(response.payload);
      } else if (opc === 142 || opc === 140) {
        const p = response.payload;
        const cId = p?.chatId || p?.chat?.id;
        const messageIds = p?.messageIds || (p?.messageId ? [p.messageId] : []);
        if (cId && messageIds.length) {
          const chat = getChat(cId);
          for (const mId of messageIds) {
            chat.markMessageDeleted?.(mId);
          }
        }
      }
    });
  }

  waitForProcessing(id) {
    return new Promise((resolve) => {
      const cleanup = () => {
        delete this.notify[id];
        delete this.notify[String(id)];
        if (!isNaN(Number(id))) delete this.notify[Number(id)];
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 20000);
      const cb = () => {
        clearTimeout(timer);
        cleanup();
        resolve();
      };
      this.notify[id] = cb;
      this.notify[String(id)] = cb;
      if (!isNaN(Number(id))) this.notify[Number(id)] = cb;
    });
  }

  async init(forceSync = false, isReconnect = false) {
    if (!isReconnect && this.latest_init > Date.now() - 3000) {
      return false;
    }

    const account = await getCurrentAccount();

    if (!account?.meta?.device)
      throw new Error("No device entry");

    loadAccountNotificationSettings(account.id);

    if (this.unlisten) await this.unlisten();
    this.startListener();

    this.latest_init = Date.now();
    sessionSet("connected", false);
    sessionSet("sync", false);
    if (!this.synchronizedPending) {
      this.synchronizedPending = true;
      this.synchronized = new Promise((resolve) => (this.resolve_sync = resolve));
    }

    const response = await invoke("init", {
      userId: get(currentUser),
      token: account.meta.token,
      identity: account.meta.device,
    });

    const isError = !response || Boolean(response.error) || (response.type && response.type !== "ApiResponse");

    if (!isError) {
      sessionSet("connected", true);
      if (forceSync) {
        await this.sync();
      } else {
        this.synchronizedPending = false;
        if (this.resolve_sync) {
          this.resolve_sync();
        }
      }
      return true;
    } else {
      sessionSet("connected", false);
      sessionSet("sync", false);
      if (!isReconnect) {
        alert(response?.message || response?.text || response?.error || "Ошибка подключения");
      }
      return false;
    }
  }

  async startAuth(phone) {
    const device = sessionGet("device");

    if (!device)
      throw new Error("Device data can't be undefined");

    const response = await invoke("init", {
      identity: device
    });

    const auth = await invoke("start_auth", { phone });

    const success = !!auth.token;
    if (!success) return auth;

    return {
      success: !!auth.token,
      codeLength: auth.codeLength,
    };
  }

  async checkCode(code) {
    return await invoke("check_code", { code });
  }

  async submitRegister(first_name, last_name = null) {
    const response = await invoke("register", { first_name });
    return this._handleLoginResponse(response);
  }

  async login(code) {
    const checkCode = await invoke("check_code", { code });
    if (checkCode?.passwordChallenge) {
      return checkCode;
    }
    return this._handleLoginResponse(checkCode);
  }

  async register(code, first_name) {
    const checkCode = await invoke("check_code", { code });
    if (checkCode?.passwordChallenge) {
      return checkCode;
    }
    let register;
    if (checkCode?.profile) {
      register = checkCode;
    } else {
      register = await invoke("register", { first_name });
    }
    return this._handleLoginResponse(register);
  }

  async _handleLoginResponse(payload) {
    if (!payload?.tokenAttrs?.LOGIN) return payload;

    const accountEntry = await addAccount(
      payload.tokenAttrs.LOGIN.token,
      sessionGet("device")
    );

    await setCurrentAccount(accountEntry.id);

    const contact = payload.profile?.contact || payload.contact;
    if (contact) {
      await setAccountContact(accountEntry.id, contact);
      currentUserDetails.set(contact);
      currentUser.set(contact.id);
    } else {
      const accountId = payload.accountId || payload.account_id || payload.profile?.id || payload.account?.id || payload.userId || payload.user_id;
      currentUser.set(accountId || accountEntry.id);
    }

    return {
      success: true,
      payload
    };
  }

  async handleLoginResponse(payload) {
    return this._handleLoginResponse(payload);
  }

  async checkPassword(password, trackId) {
    const response = await invoke("check_password", { password, trackId });
    return this._handleLoginResponse(response);
  }

  async logout(userId = get(currentUser), redirect = true) {
    await setCurrentAccount(null);

    try {
      await invoke("logout");
    } catch (e) {
      console.error(e);
    }

    if (get(currentUser) === userId) this.disconnect();

    await removeAccountByUserId(userId);

    if (redirect) goto("/auth/login");

    // TODO purge all data
  }

  async closeAllSessions() {
    await this.waitSync();

    await invoke("close_all_sessions");

    const userId = get(currentUser);
    const userDetails = get(currentUserDetails);

    this.disconnect();

    await removeAccountByUserId(userId);

    goto("/auth/login");
  }

  disconnect() {
    currentUserDetails.set(null);
    currentUser.set(null);

    sessionSet("sync", false);
    sessionSet("connected", false);
    this.synchronizedPending = true;
    this.synchronized = new Promise((resolve) => (this.resolve_sync = resolve));
  }

  async sync() {
    try {
      if (sessionGet("sync")) {
        console.warn("Уже синхронизовано!");
        return;
      }

      console.warn("Синхронизируем!");

      const account = await getCurrentAccount();
      console.log('Current account', account);

      const t0 = Date.now();
      const synced = await invoke("sync_client", {
        accountId: account.id
      });
      const t1 = Date.now();

      const isError = !synced || Boolean(synced.error) || (synced.type && synced.type !== "ApiResponse") || Boolean(synced.text);
      if (isError) {
        sessionSet("sync", false);
        return null;
      }

      sessionSet("sync", true);

      const rtt = t1 - t0;
      const offset = Math.ceil(synced.time - (t0 + rtt / 2));

      sessionSet("drift", offset);

      console.log("Ответ sync", synced);

      const { chats, contacts, profile, config } = synced;

      if (profile.contact) {
        await setAccountContact(account.id, profile.contact);
        currentUserDetails.set(profile.contact);
        currentUser.set(profile.contact.id);
      }

      const cachedContacts = await getCachedContacts();
      const cachedIds = new Set(
        (Array.isArray(cachedContacts) ? cachedContacts : [])
          .map((c) => (typeof c === "object" && c !== null ? Number(c.id) : Number(c)))
          .filter((id) => id > 0)
      );
      let requireInfo = new Set();

      if (chats.length) {
        const configChats = config?.chats || {};
        const mergedChats = chats.map((chat) => {
          const chatConfig = configChats[String(chat.id)];
          if (chatConfig && chatConfig.dontDisturbUntil != null) {
            return { ...chat, dontDisturbUntil: chatConfig.dontDisturbUntil };
          }
          return chat;
        });
        await saveChats(mergedChats);

        mergedChats.forEach((chat) => {
          if (chat.type === "DIALOG" && chat.participants) {
            Object.keys(chat.participants).forEach((member) => {
              const memId = Number(member);
              if (memId > 0 && !cachedIds.has(memId)) {
                requireInfo.add(memId);
              }
            });
          }
        });
      }

      if (requireInfo.size) {
        await syncContacts(contacts, requireInfo);
      }

      const currentChats = await loadChats();
      currentRealChats.set(currentChats.map(x => x.id));
      currentSessionChats.set(currentChats);

      const telemetrySetupResp = await invoke("set_chats_for_telemetry", {
        chats: currentChats.map(c => ({ chatId: c.id, chatType: c.type }))
      });

      console.log('Set chats for telemetry', telemetrySetupResp);

      if (config?.chatFolders?.FOLDERS) {
        const sorted = sortFolders(config.chatFolders.FOLDERS, config.chatFolders.foldersOrder || []);
        currentFolders.set(sorted);
      } else {
        this.getFolders().catch(() => {});
      }

      if (synced.presence && typeof synced.presence === "object") {
        const initialMap = {};
        for (const [uid, pres] of Object.entries(synced.presence)) {
          if (pres) {
            const status = pres.status != null ? Number(pres.status) : 0;
            const seen = pres.seen != null ? Number(pres.seen) : 0;
            initialMap[Number(uid)] = {
              status,
              seen,
              on: status === 1 ? "ON" : "OFF"
            };
          }
        }
        currentPresence.update(prev => ({ ...prev, ...initialMap }));
      }

      if (config?.server) {
        serverConfig.set(config.server);
        try {
          localStorage.setItem("max_server_config", JSON.stringify(config.server));
        } catch {}
      }

      if (config?.user) {
        applyUserConfig(config.user, account.id);
      }

      const entryBanners = config?.server?.["settings-entry-banners"];
      if (Array.isArray(entryBanners)) {
        for (const banner of entryBanners) {
          const items = banner?.items;
          if (Array.isArray(items)) {
            for (const item of items) {
              const appId = item?.appid;
              const icon = (item?.icon || "").toLowerCase();
              if (appId) {
                if (icon.includes("sferum")) {
                  localStorage.setItem("max_app_sferum_id", String(appId));
                }
                if (icon.includes("digital")) {
                  localStorage.setItem("max_app_digital_id", String(appId));
                }
              }
            }
          }
        }
      }

      setupPushNotifications();
    } catch (e) {
      console.error(e);
      const text = e?.toString() || "";
      if (text.includes("login.token")) await this.logout();
    } finally {
      if (sessionGet("sync")) {
        this.synchronizedPending = false;
        if (this.resolve_sync) {
          this.resolve_sync();
        }
        console.log("Синхронизация завершена!");

        try {
          const response = await invoke("sync_contacts");
          if (response?.contacts) {
            currentRealContacts.set(response.contacts.map(c => c.id));
            response.contacts.forEach(c => updateContact(c));
          }
        } catch {}

        try {
          const calls = await this.getCalls();
          if (calls) currentSessionCalls.set(calls);
        } catch {}
      }
    }
  }

  async fetchContacts(userIds) {
    await this.waitSync();
    return invoke("fetch_contacts", { userIds });
  }

  async getMessages(chatId, from_time = Date.now() + sessionGet("drift"), backward = 40, forward = 0) {
    await this.waitSync();

    const payload = {
      chatId,
      options: {
        from_time,
        backward,
        forward,
        interactive: true
      }
    };

    return await invoke("fetch_history", payload);
  }

  async getNewerMessages(chatId, from_time, forward = 40) {
    return this.getMessages(chatId, from_time, 0, forward);
  }

  async sendMessage(message, chatId, params) {
    await this.waitSync();
    return await invoke("send_message", { message, chatId, params });
  }

  async sendStickerMessage(chatId, stickerId, notify = true) {
    await this.waitSync();
    return await invoke("send_sticker_message", {
      chatId: Number(chatId),
      stickerId: Number(stickerId),
      notify,
    });
  }

  async react(chatId, messageId, reaction) {
    await this.waitSync();
    if (!reaction)
      return await invoke("remove_reaction", { chatId, messageId });
    return await invoke("add_reaction", { chatId, messageId, reaction });
  }

  async pinMessage(chatId, messageId) {
    await this.waitSync();
    return await invoke("pin_message", { chatId, messageId, notify: true });
  }

  async deleteMessage(chatId, messageId, forMe) {
    await this.waitSync();
    try {
      const account = await getCurrentAccount();
      if (account?.id) {
        await invoke("mark_message_deleted", {
          account: Number(account.id),
          chatId: Number(chatId),
          messageId: String(messageId),
        });
      }
    } catch {}
    return await invoke("delete_message", { chatId, messageId, forMe });
  }

  async editMessage(chatId, messageId, text, attaches = [], elements = []) {
    await this.waitSync();
    let res;
    try {
      res = await invoke("edit_message", {
        chatId: Number(chatId),
        messageId: String(messageId),
        text: String(text || ""),
        attaches: attaches || [],
        elements: elements || [],
      });
    } catch (e) {
      const msg = parseApiError(e);
      const err = new Error(msg);
      err.payload = e;
      throw err;
    }
    if (res && res.error) {
      const msg = parseApiError(res);
      const err = new Error(msg);
      err.payload = res;
      throw err;
    }
    return res;
  }

  async sendButtonCallback(chatId, messageId, callbackId, payload) {
    await this.waitSync();
    return await invoke("send_button_callback", {
      chatId,
      messageId: messageId.toString(),
      callbackId,
      payload: payload ?? null,
    });
  }

  async sendBotStart(chatId, startPayload) {
    await this.waitSync();
    return await invoke("send_bot_start", {
      chatId,
      startPayload: startPayload ?? null,
    });
  }

  async getBotInfo(botId) {
    await this.waitSync();
    return await invoke("get_bot_info", { botId });
  }

  async getChatBotCommands(chatId) {
    await this.waitSync();
    return await invoke("get_chat_bot_commands", { chatId });
  }

  async suspendBot(botId) {
    await this.waitSync();
    return await invoke("suspend_bot", { botId });
  }

  async resolveLink(link) {
    await this.waitSync();
    return await invoke("resolve_link", { link });
  }

  async setChatMute(chatId, dontDisturbUntil) {
    await this.waitSync();
    const res = await invoke("set_chat_mute", { chatId, dontDisturbUntil });
    let updatedChat = null;
    currentSessionChats.update((chats) => {
      if (!chats) return chats;
      return chats.map((c) => {
        if (String(c.id) === String(chatId)) {
          updatedChat = { ...c, dontDisturbUntil };
          return updatedChat;
        }
        return c;
      });
    });
    if (updatedChat) {
      await saveChats([updatedChat]);
    }
    return res;
  }

  async updateUserSettings(settings) {
    await this.waitSync();
    const account = await getCurrentAccount();
    return await invoke("update_user_settings", { accountId: account.id, settings });
  }

  async getFolders(folderSync = null) {
    await this.waitSync();
    const res = await invoke("get_folders", { folderSync });
    if (res?.folders) {
      const sorted = sortFolders(res.folders, res.foldersOrder || []);
      currentFolders.set(sorted);
      return sorted;
    }
    return [];
  }

  async updateFolder(folder) {
    const stringId = String(folder.id);
    const normalized = {
      ...folder,
      id: stringId,
      filters: (folder.filters || []).map(Number),
      include: (folder.include || []).map(Number),
      options: (folder.options || []).map(Number),
      favorites: (folder.favorites || []).map(Number),
    };

    currentFolders.update((folders) => {
      const list = folders || [];
      const idx = list.findIndex((f) => String(f.id) === stringId);
      if (idx !== -1) {
        const copy = [...list];
        copy[idx] = { ...copy[idx], ...normalized };
        return copy;
      }
      return [...list, normalized];
    });

    await this.waitSync();
    const res = await invoke("update_folder", {
      id: stringId,
      title: normalized.title,
      include: normalized.include,
      filters: normalized.filters,
      options: normalized.options,
      favorites: normalized.favorites,
    });
    if (res?.folders) {
      const sorted = sortFolders(res.folders, res.foldersOrder || []);
      currentFolders.set(sorted);
    } else if (res?.folder) {
      currentFolders.update(folders => {
        const idx = folders.findIndex(f => String(f.id) === String(res.folder.id));
        if (idx !== -1) {
          folders[idx] = res.folder;
          return [...folders];
        }
        return [...folders, res.folder];
      });
    }
    return res;
  }

  async reorderFolders(foldersOrder) {
    await this.waitSync();
    const res = await invoke("reorder_folders", { foldersOrder });
    currentFolders.update(folders => sortFolders(folders, foldersOrder));
    return res;
  }

  async deleteFolders(folderIds) {
    await this.waitSync();
    const res = await invoke("delete_folders", { folderIds });
    currentFolders.update(folders => folders.filter(f => !folderIds.includes(f.id)));
    return res;
  }

  async addContact(name, phone) {
    await this.waitSync();
    let oldContact;

    try {
      let response = await invoke("get_by_phone", { phone });
      oldContact = response.contact;
      if (!oldContact) throw new Error();
    } catch (e) {
      return { success: false, error: "not-found" };
    }

    const contactId = oldContact.id;

    const { contact: result } =
      (await invoke("add_contact", { contactId, firstName: name })) || {};

    if (!result) return { success: false, error: "denied" };

    const contact = {
      avatar: result.baseUrl,
      accountStatus: result.accountStatus,
      // country: result.country,
      // photoId: result.photoId,
      id: result.id,
      names: result.names,
      options: result.options,
      status: result.status,
      updateTime: result.updateTime,
      gender: result.gender,
      description: result.description,
    };

    await updateContact(contact);

    currentRealContacts.update((contacts) => {
      if (!contacts.includes(contactId)) return [...contacts, contactId];
      return contacts;
    });

    return { success: true };
  }

  async removeContact(contactId) {
    await this.waitSync();
    const response = await invoke("remove_contact", { contactId });
    currentRealContacts.update((contacts) =>
      contacts.filter((x) => x !== contactId),
    );
    return { success: true };
  }

  async getVideoById(chatId, messageId, videoId, token = null) {
    await this.waitSync();
    return await invoke("get_video_by_id", {
      chatId: Number(chatId),
      messageId: String(messageId),
      videoId: Number(videoId),
      token: token ? String(token) : null,
    });
  }

  async getFileById(chatId, messageId, fileId) {
    await this.waitSync();
    return await invoke("get_file_by_id", {
      chatId: Number(chatId),
      messageId: String(messageId),
      fileId: Number(fileId),
    });
  }

  async searchPublic(query) {
    await this.waitSync();
    return await invoke("search_public", { query, count: 5, type: "ALL" });
  }

  async searchMsg(query) {
    await this.waitSync();
    return await invoke("search_msg", { query, count: 30 });
  }

  async getChats(chatIds) {
    await this.waitSync();
    return await invoke("get_chats", { chatIds });
  }

  async getChat(chatId) {
    await this.waitSync();
    return await invoke("get_chats", { chatIds: [chatId] });
  }

  async getChatMedia(chatId, messageId = null, attachTypes = ["AUDIO", "VIDEO"], forward = 0, backward = 60) {
    await this.waitSync();
    return await invoke("get_chat_media", {
      chatId: Number(chatId),
      messageId: messageId ? String(messageId) : null,
      attachTypes,
      forward,
      backward
    });
  }

  async getSessions() {
    await this.waitSync();
    return await invoke("get_sessions");
  }

  async uploadAttachment(attach) {
    await this.waitSync();
    const { type, path, mime } = attach;

    let response;
    if (type === "AUDIO") {
      response = await invoke("get_audio_upload", { count: 1 });
    } else if (type === "VIDEO" && attach.videoType === 1) {
      response = await invoke("get_video_note_upload", { count: 1 });
    } else {
      response = await invoke("get_" + type.toLowerCase() + "_upload", {
        count: 1,
        profile: false,
      });
    }

    if (!response?.url && !response?.info) {
      alert("Не удалось получить ссылку на загрузку " + type);
      return null;
    }

    const payload = {
      path,
      attachType: type,
      mime,
      videoType: attach.videoType,
      fileName: attach.name || undefined,
    };

    if (type === "PHOTO") {
      payload.uploadUrl = response.url;
    } else if (type === "VIDEO" || type === "AUDIO") {
      const { token, url, videoId } = response.info[0];
      payload.token = token;
      payload.uploadUrl = url;
      payload.videoId = videoId;
    } else if (type === "FILE") {
      const { token, url, fileId } = response.info[0];
      payload.token = token;
      payload.uploadUrl = url;
      payload.fileId = fileId;
    }

    const processingPromise =
      (type === "VIDEO" && attach.videoType !== 1) ? this.waitForProcessing(payload.videoId) :
      type === "FILE" ? this.waitForProcessing(payload.fileId) :
      null;

    const data = await invoke("upload", payload);

    if (processingPromise) await processingPromise;

    if (data.error) {
      alert("Не удалось загрузить " + type + "\n" + data.error);
      return null;
    }

    const normalizedWave = (() => {
      const res = new Array(80).fill(0);
      if (Array.isArray(attach.wave) && attach.wave.length > 0) {
        if (attach.wave.length === 80) {
          for (let i = 0; i < 80; i++) {
            res[i] = Math.min(120, Math.max(0, Math.round(Number(attach.wave[i]) || 0)));
          }
        } else {
          const step = attach.wave.length / 80;
          for (let i = 0; i < 80; i++) {
            const idx = Math.min(Math.floor(i * step), attach.wave.length - 1);
            res[i] = Math.min(120, Math.max(0, Math.round(Number(attach.wave[idx]) || 0)));
          }
        }
      }
      return res;
    })();

    if (type === "AUDIO") {
      return {
        _type: "AUDIO",
        token: payload.token,
        videoId: payload.videoId,
        duration: Math.round(attach.duration || 0),
        wave: normalizedWave,
        localPath: attach.path,
      };
    }

    if (type === "VIDEO" && attach.videoType === 1) {
      return {
        _type: "VIDEO",
        videoType: 1,
        token: payload.token,
        videoId: payload.videoId,
        duration: Math.round(attach.duration || 0),
        wave: normalizedWave,
        localPath: attach.path,
      };
    }

    if (type === "VIDEO") {
      return {
        _type: "VIDEO",
        videoType: 0,
        token: payload.token,
        videoId: payload.videoId,
        ...data,
      };
    }

    return { _type: type, ...data };
  }

  async requestTranscription(chatId, messageId, mediaId) {
    await this.waitSync();
    return await invoke("request_transcription", {
      chatId: Number(chatId),
      messageId: String(messageId),
      mediaId: String(mediaId || messageId),
    });
  }

  async updateProfile(firstName, lastName, description) {
    await this.waitSync();
    const result = await invoke("update_profile", {
      firstName,
      lastName,
      description,
    });

    const details = get(currentUserDetails);
    if (!details) return null;

    details.names[0].firstName = firstName;
    details.names[0].lastName = lastName;
    if (description !== undefined) {
      details.description = description;
    }

    currentUserDetails.set(details);
    await setAccountContact(account.id, details);

    return result;
  }

  async createGroup(title) {
    await this.waitSync();
    const result = await invoke("create_group", {
      title,
      participantIds: [],
    });

    const payload = result.payload;

    if (!payload) return null;

    currentSessionChats.update(chats => {
      chats.push(payload.chat);
      return chats;
    });

    currentRealChats.update(x => [...x, payload.chatId]);

    return payload.chat;
  }

  async joinChannel(link) {
    await this.waitSync();
    const response = await invoke("join_channel", { link });
    const { chat } = response;

    currentRealChats.update(chats => [ ...chats, chat.id ]);

    currentSessionChats.update(chats => {
      const idx = chats.findIndex(x => x.id === chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      chats.push(chat);
    });

    await saveChats([ chat ]);

    return chat;
  }

  async leaveChannel(chat) {
    await this.waitSync();
    const channelId = chat.id;

    await invoke("leave_channel", { channelId });

    try {
      const account = await getCurrentAccount();
      if (account?.id) {
        await invoke("delete_chat_cache", {
          account: Number(account.id),
          chatId: Number(channelId),
          mediaType: null,
        });
      }
    } catch {}

    currentRealChats.update(chats => {
      const idx = chats.indexOf(chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      return chats;
    });

    if (chat.participants) chat.participants[get(currentUser)] = 0;
  }

  async leaveChat(chat) {
    await this.waitSync();
    const chatId = chat.id;

    await invoke("leave_group", { chatId });

    try {
      const account = await getCurrentAccount();
      if (account?.id) {
        await invoke("delete_chat_cache", {
          account: Number(account.id),
          chatId: Number(chatId),
          mediaType: null,
        });
      }
    } catch {}

    currentRealChats.update(chats => {
      const idx = chats.indexOf(chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      return chats;
    });
  }

  async deleteChatForAll(chat) {
    await this.waitSync();
    const chatId = chat.id;

    await invoke("leave_group", { chatId, forAll: true });

    try {
      const account = await getCurrentAccount();
      if (account?.id) {
        await invoke("delete_chat_cache", {
          account: Number(account.id),
          chatId: Number(chatId),
          mediaType: null,
        });
      }
    } catch {}

    currentRealChats.update(chats => {
      const idx = chats.indexOf(chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      return chats;
    });
  }

  async updateChatProfile(chat) {
    await this.waitSync();
    const response = await invoke("change_group_profile", {
      chatId: chat.id,
      title: chat.title,
      description: chat.description
    });

    currentSessionChats.update(chats => {
      const idx = chats.findIndex(x => x.id === chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      chats.push(chat);
    });

    await saveChats([ chat ]);

    return response.chat;
  }

  async readMessage(chatId, messageId) {
    await this.waitSync();
    const response = await invoke("read_message", {
      chatId, messageId
    });

    // TODO Optimize
    // сделать отдельные сторы под каждые значения? unreadStore, lastMessageStore и тд
    currentSessionChats.update(chats => {
      if (!chats) return;
      const updated = chats.find(x => x.id === chatId);
      if (updated) updated.newMessages = response.unread;
      return chats;
    });

    return response;
  }

  async refreshInviteLink(chatId) {
    await this.waitSync();
    const response = await invoke("refresh_invite_link", { chatId });

    if (!response.chat) throw new Error("Неизвестный ответ сервера");

    currentSessionChats.update(chats => {
      if (!chats) return;
      const updated = chats.find(x => x.id === chatId);
      if (updated) updated.link = response.chat.link;
      return chats;
    });

    return response;
  }

  async getCalls() {
    await this.waitSync();
    return await invoke("get_calls", { forward: false, count: 100 });
  }

  async call(actionId, payload) {
    await this.waitSync();
    return await invoke("call", { actionId, payload });
  }

  async _command(cmd, options) {
    return await invoke(cmd, options);
  }

  async openWebApp(botId, startParam = null, chatId = null) {
    await this.waitSync();
    return await invoke("open_web_app", {
      botId: Number(botId),
      startParam: startParam || null,
      chatId: chatId != null ? Number(chatId) : null,
    });
  }

  async sharePhoneWithBot(botId) {
    await this.waitSync();
    return await invoke("share_phone_with_bot", {
      botId: Number(botId),
    });
  }

  async submitExternalCallback(url) {
    await this.waitSync();
    return await invoke("submit_external_callback", { url });
  }

  async launchWebApp(botId, { startParam = null, chatId = null } = {}) {
    const resp = await this.openWebApp(botId, startParam, chatId);
    if (!resp || !resp.url) {
      throw new Error("Не удалось получить адрес мини-приложения");
    }
    return {
      url: resp.url,
      queryId: resp.query_id || resp.queryId || null,
      botId: Number(botId),
    };
  }

  async launchSferum() {
    const stored = localStorage.getItem("max_app_sferum_id");
    const botId = stored ? Number(stored) : 2340831;
    return await this.launchWebApp(botId);
  }

  async launchDigitalId() {
    const stored = localStorage.getItem("max_app_digital_id");
    const botId = stored ? Number(stored) : 8250447;
    return await this.launchWebApp(botId);
  }

  async processExternalCallback(url) {
    let normalized = String(url).trim();
    if (normalized.startsWith("max://")) {
      const withoutScheme = normalized.slice(6);
      normalized = withoutScheme.startsWith("max.ru")
        ? `https://${withoutScheme}`
        : `https://max.ru/${withoutScheme.replace(/^\/+/, "")}`;
    }
    const uri = new URL(normalized);
    if (uri.searchParams.get("externalCallback") !== "1" && !normalized.includes("externalCallback=1")) {
      throw new Error("Некорректный callback адрес");
    }
    const raw = await this.submitExternalCallback(normalized);
    let botId = null;
    let startParam = null;

    const parsePayload = (obj) => {
      if (!obj || typeof obj !== "object") return;
      if (obj.botId != null || obj.bot_id != null) {
        botId = Number(obj.botId ?? obj.bot_id);
        startParam = (obj.startParam ?? obj.start_param)?.toString() || null;
        return;
      }
      for (const k of ["data", "result", "response", "payload"]) {
        if (obj[k]) parsePayload(obj[k]);
      }
    };

    parsePayload(raw);

    if (!botId) {
      const stored = localStorage.getItem("max_app_digital_id");
      botId = stored ? Number(stored) : 8250447;
    }
    const launch = await this.launchWebApp(botId, { startParam });
    return {
      ...launch,
      startParam,
    };
  }

  async fetchGroupMembers(chatId, markerOrCount = null, countOrMarker = 50) {
    await this.waitSync();
    let count = 50;
    let marker = null;
    if (typeof markerOrCount === "number" && markerOrCount <= 100 && markerOrCount > 0) {
      count = markerOrCount;
      marker = countOrMarker != null ? Number(countOrMarker) : null;
    } else {
      marker = markerOrCount != null ? Number(markerOrCount) : null;
      if (typeof countOrMarker === "number" && countOrMarker <= 100 && countOrMarker > 0) {
        count = countOrMarker;
      }
    }
    const res = await invoke("fetch_group_members", {
      chatId: Number(chatId),
      count: Math.min(Math.max(Number(count) || 50, 1), 50),
      marker: marker != null ? Number(marker) : null
    });
    const members = res?.members || [];
    const nextMarker = res?.marker ?? null;
    const presenceUpdates = {};
    for (const m of members) {
      if (m.contact) {
        updateContact(m.contact);
      }
      if (m.presence && m.contact?.id) {
        presenceUpdates[m.contact.id] = {
          status: m.presence.status ?? 0,
          seen: m.presence.seen ?? 0
        };
      }
    }
    if (Object.keys(presenceUpdates).length > 0) {
      currentPresence.update(prev => ({ ...prev, ...presenceUpdates }));
    }
    return { members, marker: nextMarker };
  }

  async searchGroupMembers(chatId, query) {
    await this.waitSync();
    const res = await invoke("search_group_members", {
      chatId: Number(chatId),
      query: String(query || "")
    });
    const members = res?.members || [];
    const presenceUpdates = {};
    for (const m of members) {
      if (m.contact) {
        updateContact(m.contact);
      }
      if (m.presence && m.contact?.id) {
        presenceUpdates[m.contact.id] = {
          status: m.presence.status ?? 0,
          seen: m.presence.seen ?? 0
        };
      }
    }
    if (Object.keys(presenceUpdates).length > 0) {
      currentPresence.update(prev => ({ ...prev, ...presenceUpdates }));
    }
    return members;
  }

  async addGroupMembers(chatId, userIds, showHistory = true) {
    await this.waitSync();
    const ids = (userIds || []).map(Number);
    const res = await invoke("add_group_members", {
      chatId: Number(chatId),
      userIds: ids,
      showHistory: Boolean(showHistory)
    });
    if (res?.chat) {
      currentSessionChats.update(chats => {
        const idx = chats.findIndex(x => x.id === Number(chatId));
        if (idx !== -1) {
          chats[idx] = { ...chats[idx], ...res.chat };
        }
        return chats;
      });
    }
    return res;
  }

  async kickGroupMember(chatId, userIds, cleanPeriod = 0) {
    await this.waitSync();
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(Number);
    const res = await invoke("kick_group_member", {
      chatId: Number(chatId),
      userIds: ids,
      cleanMsgPeriod: Number(cleanPeriod)
    });
    if (res?.chat) {
      currentSessionChats.update(chats => {
        const idx = chats.findIndex(x => x.id === Number(chatId));
        if (idx !== -1) {
          chats[idx] = { ...chats[idx], ...res.chat };
        }
        return chats;
      });
    }
    return res;
  }

  async grantGroupAdmin(chatId, userId, permissions = [], alias = null) {
    await this.waitSync();
    const res = await invoke("grant_group_admin", {
      chatId: Number(chatId),
      userId: Number(userId),
      permissions: permissions || [],
      alias: alias ? String(alias) : null
    });
    if (res?.chat) {
      currentSessionChats.update(chats => {
        const idx = chats.findIndex(x => x.id === Number(chatId));
        if (idx !== -1) {
          chats[idx] = { ...chats[idx], ...res.chat };
        }
        return chats;
      });
    }
    return res;
  }

  async revokeGroupAdmin(chatId, userId) {
    await this.waitSync();
    const res = await invoke("revoke_group_admin", {
      chatId: Number(chatId),
      userId: Number(userId)
    });
    if (res?.chat) {
      currentSessionChats.update(chats => {
        const idx = chats.findIndex(x => x.id === Number(chatId));
        if (idx !== -1) {
          chats[idx] = { ...chats[idx], ...res.chat };
        }
        return chats;
      });
    }
    return res;
  }

  async setGroupOptions(chatId, options = {}) {
    await this.waitSync();
    const allCanPin = options.allCanPinMessage ?? options.ALL_CAN_PIN_MESSAGE ?? null;
    const onlyOwnerIcon = options.onlyOwnerCanChangeIconTitle ?? options.ONLY_OWNER_CAN_CHANGE_ICON_TITLE ?? null;
    const onlyAdminAdd = options.onlyAdminCanAddMember ?? options.ONLY_ADMIN_CAN_ADD_MEMBER ?? null;
    const onlyAdminCall = options.onlyAdminCanCall ?? options.ONLY_ADMIN_CAN_CALL ?? null;
    const membersLink = options.membersCanSeePrivateLink ?? options.MEMBERS_CAN_SEE_PRIVATE_LINK ?? null;

    const res = await invoke("set_group_options", {
      chatId: Number(chatId),
      allCanPinMessage: allCanPin,
      onlyOwnerCanChangeIconTitle: onlyOwnerIcon,
      onlyAdminCanAddMember: onlyAdminAdd,
      onlyAdminCanCall: onlyAdminCall,
      membersCanSeePrivateLink: membersLink
    });

    let targetChat = null;
    currentSessionChats.update(chats => {
      if (!chats) return chats;
      const idx = chats.findIndex(x => x.id === Number(chatId));
      if (idx !== -1) {
        const existing = chats[idx];
        const nextOpts = { ...(existing.options || {}), ...(res?.chat?.options || {}) };
        if (allCanPin !== null) {
          nextOpts.ALL_CAN_PIN_MESSAGE = allCanPin;
          nextOpts.allCanPinMessage = allCanPin;
        }
        if (onlyOwnerIcon !== null) {
          nextOpts.ONLY_OWNER_CAN_CHANGE_ICON_TITLE = onlyOwnerIcon;
          nextOpts.onlyOwnerCanChangeIconTitle = onlyOwnerIcon;
        }
        if (onlyAdminAdd !== null) {
          nextOpts.ONLY_ADMIN_CAN_ADD_MEMBER = onlyAdminAdd;
          nextOpts.onlyAdminCanAddMember = onlyAdminAdd;
        }
        if (onlyAdminCall !== null) {
          nextOpts.ONLY_ADMIN_CAN_CALL = onlyAdminCall;
          nextOpts.onlyAdminCanCall = onlyAdminCall;
        }
        if (membersLink !== null) {
          nextOpts.MEMBERS_CAN_SEE_PRIVATE_LINK = membersLink;
          nextOpts.membersCanSeePrivateLink = membersLink;
        }
        const updated = {
          ...existing,
          ...(res?.chat || {}),
          options: nextOpts,
        };
        chats[idx] = updated;
        targetChat = updated;
      }
      return [...chats];
    });

    if (targetChat) {
      await saveChats([targetChat]).catch(() => {});
    }

    return res;
  }

  async fetchJoinRequests(chatId) {
    await this.waitSync();
    const res = await invoke("fetch_join_requests", { chatId: Number(chatId) });
    return res?.members || res?.joinRequests || res || [];
  }

  async confirmJoinRequests(chatId, userIds, showHistory = true) {
    await this.waitSync();
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(Number);
    return await invoke("confirm_join_requests", {
      chatId: Number(chatId),
      userIds: ids,
      showHistory: Boolean(showHistory)
    });
  }

  async declineJoinRequests(chatId, userIds) {
    await this.waitSync();
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(Number);
    return await invoke("decline_join_requests", {
      chatId: Number(chatId),
      userIds: ids
    });
  }

  async purgeChatHistory(chatId, forAll = false) {
    await this.waitSync();
    const res = await invoke("purge_chat_history", {
      chatId: Number(chatId),
      lastEventTime: Date.now(),
      forAll: Boolean(forAll)
    });
    const c = getChat(chatId);
    if (c) {
      if (c.clearLocalMessages) {
        await c.clearLocalMessages().catch(() => {});
      }
      c.receivedMessage?.set({ chatId: Number(chatId), type: "CLEAR_HISTORY" });
    }
    currentSessionChats.update((chats) => {
      if (!chats) return chats;
      const idx = chats.findIndex((ch) => String(ch.id) === String(chatId));
      if (idx !== -1) {
        chats[idx] = {
          ...chats[idx],
          lastMessage: null,
          newMessages: 0,
        };
        return [...chats];
      }
      return chats;
    });
    return res;
  }

  async fetchChatMedia(chatId, messageId = null, attachTypes = ["PHOTO", "VIDEO"], forward = 0, backward = 50) {
    await this.waitSync();
    const res = await invoke("get_chat_media", {
      chatId: Number(chatId),
      messageId: messageId ? String(messageId) : null,
      attachTypes,
      forward: Number(forward),
      backward: Number(backward)
    });
    return res;
  }
}

