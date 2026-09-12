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
} from "$lib/stores/api";
import {
  get as sessionGet,
  set as sessionSet
} from "$lib/stores/session";
import {
  syncContacts,
} from "$lib/utils/caching";
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
  updateContact,
  getCachedContacts,
} from "$lib/stores/contacts";

import BaseAPI from "./BaseApi";

export default class MobileApi extends BaseAPI {
  resolve_sync = null;
  /* TODO throw an error if sync takes > 10 sec?
  to prevent request spam
  1) async function waitSync() {}
  2) if (!await waitSync()) return null;
  */
  synchronized = new Promise((resolve) => (this.resolve_sync = resolve));
  latest_init = null;
  unlisten = null;
  notify = {};
  savedMessages = {};

  constructor(token) {
    super(token);
  }

  _telemetry() {
    /* Telemetry implemented in rust code */
  }

  async startListener() {
    if (this.unlisten) this.unlisten();

    this.unlisten = await listen("max", async (event) => {
      const { payload } = event;

      if (payload.type === "log") {
        if (payload.response === "closed") {
          await new Promise((r) => setTimeout(r, 1000));
          alert("Отключен сервером\nПереподключение...");
          this.init();
        }
        return;
      }
      if (payload.type === "tx") return;

      // only RX
      const { response } = payload;
      const opc = response.opcode;

      if (opc === 128) {
        // TODO event handler
        const message = response.payload.message;
        message.chatId = response.payload.chatId;
        const chat = getChat(message.chatId);
        chat.receivedMessage.set(message);
      } else if (opc == 129) {
        // typing
      } else if (opc === 136) {
        const { videoId, fileId } = response.payload;
        this.notify[videoId || fileId]?.();
      }
    });
  }

  waitForProcessing(id) {
    return new Promise(resolve => {
      this.notify[id] = (() => {
        delete this.notify[id];
        resolve();
      });
    });
  }

  async init(forceSync = false) {
    if (this.latest_init > Date.now() - 5000) {
      console.error("Had recent reconnection, not trying again");
      return;
    }

    const account = await getCurrentAccount();

    if (!account?.meta?.device)
      throw new Error("No device entry");

    if (this.unlisten) await this.unlisten();
    this.startListener();

    this.latest_init = Date.now();
    sessionSet("connected", false);
    //sessionSet('sync', false);
    this.synchronized = new Promise((resolve) => (this.resolve_sync = resolve));
    sessionSet("sync", false);

    const response = await invoke("init", {
      userId: get(currentUser),
      token: account.meta.token,
      identity: account.meta.device,
    });

    console.log(response);

    if (response.success) {
      sessionSet("connected", true);
      if (forceSync) await this.sync();
      return true;
    }
    else alert(response);
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

  async login(code) {
    const checkCode = await invoke("check_code", { code });

    return this._handleLoginResponse(checkCode);
  }

  async register(code, first_name) {
    const checkCode = await invoke("check_code", { code });

    let register;

    if (checkCode.profile) {
      register = checkCode; // already registered
    } else {
      console.log("Not registered. Sending request...");
      register = await invoke("register", { first_name });
    }

    return this._handleLoginResponse(register);
  }

  async _handleLoginResponse(payload) {
    console.log(payload);
    if (!payload?.tokenAttrs?.LOGIN) return payload; // failed

    const accountEntry = await addAccount(
      payload.tokenAttrs.LOGIN.token,
      sessionGet("device")
    );

    await setCurrentAccount(accountEntry.id);

    const contact = payload.profile.contact;
    await setAccountContact(accountEntry.id, contact);
    currentUser.set(contact.id);

    await this.sync();

    return {
      success: true,
      payload
    }
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
    await this.synchronized;

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
  }

  async sync() {
    try {
      if (sessionGet("sync")) {
        console.warn("Уже синхронизовано!");
        return;
      }

      // TODO multi accounts?

      console.warn("Синхронизируем!");

      sessionSet("sync", true);

      const account = await getCurrentAccount();
      console.log('Current account', account);

      const t0 = Date.now();
      const synced = await invoke("sync_client", {
        accountId: account.id
      });
      const t1 = Date.now();

      const rtt = t1 - t0;
      const offset = Math.ceil(synced.time - (t0 + rtt / 2));

      // сдвиг системного времени относительно серверного
      sessionSet("drift", offset);

      console.log("Ответ sync", synced);

      const { chats, contacts, profile, config } = synced;

      if (profile.contact) {
        await setAccountContact(account.id, profile.contact);
        currentUserDetails.set(profile.contact);
      }

      const currentChats = await loadChats();
      const cachedContacts = await getCachedContacts();
      console.log(currentChats);
      let requireInfo = new Set();

      if (chats.length) {
        console.log('new chats', chats)
        await saveChats(chats);

        chats.forEach((chat) => {
          if (chat.type === "DIALOG") {
            Object.keys(chat.participants).forEach((member) => {
              if (!cachedContacts.includes(+member)) requireInfo.add(+member);
            });
          };
        });
      }

      if (requireInfo.size) {
        await syncContacts(contacts, requireInfo);
      }

      currentRealChats.set(currentChats.map(x => x.id));
      currentSessionChats.set(currentChats);

      //currentUser.set(profile.contact.id);
      //currentFolders.set(config.chatFolders?.FOLDERS || []);
      //currentPresence.set(res.presence);
      //currentRealChats.set(chats.map((x) => x.id));
      //currentRealContacts.set(contacts.map((x) => x.id));
      //if (!this.getUser()) this.setUser(res.profile.contact.id);
      //sessionSet("reactions", config.server["reactions-menu"]);
      //const callsEndpoint = config.server['calls-endpoint'];

    } catch (e) {
      console.error('Showing error via alert', e);
      alert(e);
      const text = e.toString();
      if (text.includes("login.token")) await this.logout();
    } finally {
      this.resolve_sync();
      console.log("Синхронизация завершена!");

      const calls = await this.getCalls();
      currentSessionCalls.set(calls);
    }
  }

  async fetchContacts(userIds) {
    await this.synchronized;
    return invoke("fetch_contacts", { userIds });
  }

  async getMessages(chatId, from_time = Date.now() + sessionGet("drift")) {
    await this.synchronized;

    const payload = {
      chatId,
      options: {
        from_time,
        backward: 40,
        interactive: true
      }
    }

    return await invoke("fetch_history", payload);
  }

  async sendMessage(message, chatId, params) {
    await this.synchronized;
    return await invoke("send_message", { message, chatId, params });
  }

  async react(chatId, messageId, reaction) {
    await this.synchronized;
    if (!reaction)
      return await invoke("remove_reaction", { chatId, messageId });
    return await invoke("add_reaction", { chatId, messageId, reaction });
  }

  async pinMessage(chatId, messageId) {
    await this.synchronized;
    return await invoke("pin_message", { chatId, messageId, notify: true });
  }

  async deleteMessage(chatId, messageId, forMe) {
    await this.synchronized;
    return await invoke("delete_message", { chatId, messageId, forMe });
  }

  async addContact(name, phone) {
    await this.synchronized;
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
    await this.synchronized;
    const response = await invoke("remove_contact", { contactId });
    currentRealContacts.update((contacts) =>
      contacts.filter((x) => x !== contactId),
    );
    return { success: true };
  }

  async getVideoById(chatId, messageId, videoId) {
    await this.synchronized;
    return await invoke("get_video_by_id", { chatId, messageId, videoId });
  }

  async getFileById(chatId, messageId, fileId) {
    await this.synchronized;
    return await invoke("get_file_by_id", { chatId, messageId, fileId });
  }

  async searchPublic(query) {
    await this.synchronized;
    return await invoke("search_public", { query, count: 5, type: "ALL" });
  }

  async searchMsg(query) {
    await this.synchronized;
    return await invoke("search_msg", { query, count: 30 });
  }

  async getChats(chatIds) {
    await this.synchronized;
    return await invoke("get_chats", { chatIds });
  }

  async getChat(chatId) {
    await this.synchronized;
    return await invoke("get_chats", { chatIds: [chatId] });
  }

  async getSessions() {
    await this.synchronized;
    return await invoke("get_sessions");
  }

  async uploadAttachment(attach) {
    await this.synchronized;
    const { type, path, mime } = attach;

    const response = await invoke("get_" + type.toLowerCase() + "_upload", {
      count: 1,
      profile: false,
    });

    if (!response?.url && !response?.info) {
      alert("Не удалось получить ссылку на загрузку " + type);
      return null;
    }

    console.log("response", response);

    const payload = {
      path,
      attachType: type,
      mime,
    };

    if (type === "PHOTO") {
      payload.uploadUrl = response.url;
      /* const formData = new FormData();
        formData.append(
        "file",
        await fetch(convertFileSrc(path)).then(r => r.blob()),
        "image.jpg"
        );
        const res = await fetch(response.url, {
        method: "POST",
        body: formData,
        referrer: "no-referrer",
      });
      const json = await res.json();
      const uploaded = Object.values(json.photos)[0];
      return { _type: "PHOTO", photoToken: uploaded.token };*/
    } else if (type === "VIDEO") {
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

    const data = await invoke("upload", payload);

    if (type === "VIDEO") await this.waitForProcessing(payload.videoId);
    if (type === "FILE") await this.waitForProcessing(payload.fileId);

    if (data.error) {
      alert("Не удалось загрузить " + type + "\n" + data.error);
      return null;
    }

    return { _type: type, ...data };
  }

  async updateProfile(firstName, lastName, description) {
    await this.synchronized;
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
    await this.synchronized;
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
    await this.synchronized;
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
    await this.synchronized;
    const channelId = chat.id;

    await invoke("leave_channel", { channelId });

    currentRealChats.update(chats => {
      const idx = chats.indexOf(chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      return chats;
    });

    if (chat.participants) chat.participants[get(currentUser)] = 0;
  }

  async leaveChat(chat) {
    await this.synchronized;
    const chatId = chat.id;

    await invoke("leave_group", { chatId });

    currentRealChats.update(chats => {
      const idx = chats.indexOf(chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      return chats;
    });
  }

  async deleteChatForAll(chat) {
    await this.synchronized;
    const chatId = chat.id;

    await invoke("leave_group", { chatId, forAll: true });

    currentRealChats.update(chats => {
      const idx = chats.indexOf(chat.id);
      if (idx !== -1) chats.splice(idx, 1);
      return chats;
    });
  }

  async updateChatProfile(chat) {
    await this.synchronized;
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
    await this.synchronized;
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
    await this.synchronized;
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
    await this.synchronized;
    return await invoke("get_calls", { forward: false, count: 100 });
  }

  async call(actionId, payload) {
    await this.synchronized;
    return await invoke("call", { actionId, payload });
  }

  async _command(cmd, options) {
    return await invoke(cmd, options);
  }
}
