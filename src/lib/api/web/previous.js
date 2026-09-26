//import * as Settings from "$lib/stores/settings.js";

const Constants = {
  PHONE_REGEX: /^\+?\d{10,15}$/,
  WEBSOCKET_URI: "wss://ws-api.oneme.ru/websocket",
  DEFAULT_TIMEOUT: 10000,
  DEFAULT_USER_AGENT: {
    deviceType: "WEB",
    locale: "ru",
    deviceLocale: "ru",
    osVersion: "Linux",
    deviceName: "Chrome",
    headerUserAgent: "Mozilla/5.0 ...",
    appVersion: "25.8.5",
    screen: "1080x1920 1.0x",
    timezone: "Europe/Moscow",
  },
};

/**
 Websocket API
 Браузерновое (не мобильновое)
 */

export default class MaxClient {
  constructor() {
    this.phone = null;
    this.uri = Constants.WEBSOCKET_URI;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.incoming = [];
    this.token = null;
    this.userAgent = Constants.DEFAULT_USER_AGENT;

    this.onMessageHandler = null;
    this.onStartHandler = null;
    return this;
  }

  checkPhone(phone) {
    return Constants.PHONE_REGEX.test(phone);
  }

  setToken(token) {
    this.token = token;
    return this;
  }

  onMessage(handler) {
    this.onMessageHandler = handler;
    return handler;
  }

  onStart(handler) {
    this.onStartHandler = handler;
    return handler;
  }

  hasToken() {
    return this.token?.length;
  }

  makeMessage(opcode, payload, cmd = 0) {
    this.seq += 1;
    return {
      ver: 11,
      cmd,
      seq: this.seq,
      opcode,
      payload,
    };
  }

  async connect() {
    console.log("New socket conn");

    const deviceId = (await Settings.get("deviceIds")).default;
    if (!deviceId) throw "no device id";
    console.log("deviceId", deviceId, this.uri);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.uri, {
        headers: {
          Origin: "https://web.max.ru",
        },
      });

      this.ws.onopen = async () => {
        try {
          const handshake = await this.sendAndWait(6, {
            deviceId,
            userAgent: this.userAgent,
          });
          console.log("Handshake complete", handshake);
          resolve(handshake);
        } catch (e) {
          reject(e);
        }
      };

      this.ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          console.warn("Bad JSON from server");
          return;
        }

        const seq = data.seq;
        if (this.pending.has(seq)) {
          const resolver = this.pending.get(seq);
          this.pending.delete(seq);
          resolver(data);
        } else {
          if (data.opcode === 128 && this.onMessageHandler) {
            this.onMessageHandler(data.payload);
          }
        }
      };

      this.ws.onerror = (err) => {
        console.log(err);
        reject(err);
      };

      this.ws.onclose = (err) => {
        console.log(err);
      };
    });
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  async sendAndWait(
    opcode,
    payload,
    cmd = 0,
    timeout = Constants.DEFAULT_TIMEOUT,
  ) {
    if (!this.isConnected()) {
      throw new Error("WebSocket not connected");
    }

    const msg = this.makeMessage(opcode, payload, cmd);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(msg.seq);
        reject(new Error("Timeout waiting for response"));
      }, timeout);

      this.pending.set(msg.seq, (data) => {
        clearTimeout(timer);
        resolve(data);
      });

      this.ws.send(JSON.stringify(msg));
    });
  }

  async sendMessage(text, chatId, args) {
    if (!this.isConnected()) await this.sync();

    const { notify, replyTo, attaches } = args;

    const payload = {
      chatId,
      message: {
        text,
        cid: Date.now(),
        elements: [],
        attaches: attaches || [],
        link: replyTo ? { type: "REPLY", messageId: String(replyTo) } : null,
      },
      notify: notify === undefined ? true : notify,
    };

    try {
      const resp = await this.sendAndWait(64, payload);
      return resp.payload?.message || null;
    } catch (e) {
      console.error("Send message failed", e);
      return null;
    }
  }

  async editMessage(chatId, messageId, text) {
    const payload = {
      chatId,
      messageId,
      text,
      elements: [],
      attaches: [],
    };

    try {
      const resp = await this.sendAndWait(67, payload);
      return resp.payload?.message || null;
    } catch (e) {
      console.error("Edit message failed", e);
      return null;
    }
  }

  async deleteMessage(chatId, messageIds, forMe = false) {
    const payload = {
      chatId,
      messageIds,
      forMe,
    };

    try {
      const resp = await this.sendAndWait(66, payload);
      return !resp.payload?.error;
    } catch (e) {
      console.error("Delete message failed", e);
      return false;
    }
  }

  async startAuth(phone) {
    if (!this.ws) await this.connect();
    console.log("Requesting login code...");
    this.phone = phone;

    const resp = await this.sendAndWait(17, {
      phone: phone,
      type: "START_AUTH",
      language: "ru",
    });

    this.tempToken = resp.payload?.token;
    const success = this.tempToken !== undefined;
    return { success, ...resp.payload };
  }

  async resendAuth(phone) {
    if (!this.ws) await this.connect();
    const phoneToUse = phone || this.phone;
    const resp = await this.sendAndWait(17, {
      phone: phoneToUse,
      type: "RESEND",
      language: "ru",
    });

    if (resp.payload?.token) {
      this.tempToken = resp.payload.token;
    }
    const success = this.tempToken !== undefined;
    return { success, ...resp.payload };
  }

  async checkCode(code) {
    const check = await this.sendAndWait(18, {
      token: this.tempToken,
      verifyCode: code,
      authTokenType: "CHECK_CODE",
    });

    this.token = check.payload?.tokenAttrs?.LOGIN?.token || null;

    if (!this.token) return { success: false, ...check.payload };
    return { success: true, token: this.token, ...check.payload };
  }

  async fetchHistory(chatId, fromTime = null, forward = 0, backward = 40) {
    if (!this.isConnected()) await this.sync();
    if (!fromTime) fromTime = Date.now();

    const payload = {
      chatId,
      from: fromTime,
      forward,
      backward,
      getMessages: true,
    };

    try {
      const resp = await this.sendAndWait(49, payload, 0, 10000);
      if (resp.payload?.error) {
        console.error("Fetch history error:", resp.payload.error);
        return null;
      }
      return resp.payload?.messages || [];
    } catch (e) {
      console.error("Fetch history failed", e);
      return null;
    }
  }

  async fetchContacts(contact_ids) {
    if (!this.isConnected()) await this.sync();

    const payload = {
      contact_ids,
    };

    try {
      const resp = await this.sendAndWait(49, payload);
      if (resp.payload?.error) {
        console.error("Fetch contacts error:", resp.payload.error);
        return null;
      }
      return resp.payload?.messages || [];
    } catch (e) {
      console.error("Fetch contacts failed", e);
      return null;
    }
  }

  async contactInfo(contactIds) {
    if (!this.isConnected()) await this.sync();

    const payload = {
      contactIds,
    };
    console.log(payload);
    try {
      const resp = await this.sendAndWait(32, payload);
      if (resp.payload?.error) {
        console.error("Fetch contacts error:", resp.payload);
        return null;
      }
      return resp.payload || [];
    } catch (e) {
      console.error("Fetch contacts failed", e);
      return null;
    }
  }

  async fetchPhotos(contact_ids) {
    if (!this.isConnected()) await this.sync();

    const payload = {
      contact_ids,
    };

    try {
      const resp = await this.sendAndWait(39, payload);
      if (resp.payload?.error) {
        console.error("Fetch photos error:", resp.payload.error);
        return null;
      }
      return resp.payload?.messages || [];
    } catch (e) {
      console.error("Fetch photos failed", e);
      return null;
    }
  }

  async search(query) {
    if (!this.isConnected()) await this.sync();

    const payload = {
      query,
      count: 5,
      type: "ALL",
    };

    try {
      const resp = await this.sendAndWait(60, payload);
      if (resp.payload?.error) {
        console.error("Search error:", resp.payload.error, resp);
        return null;
      }
      console.log(resp);
      return resp.payload.result || [];
    } catch (e) {
      console.error("Search failed", e);
      return null;
    }
  }

  async createGroup(name, participantIds = [], notify = true) {
    const payload = {
      message: {
        cid: Date.now(),
        attaches: [
          {
            _type: "CONTROL",
            event: "new",
            chatType: "CHAT",
            title: name,
            userIds: participantIds,
          },
        ],
      },
      notify,
    };

    try {
      const resp = await this.sendAndWait(64, payload);
      if (resp.payload?.error) {
        console.error("Create group error:", resp.payload.error);
        return null;
      }
      const group = resp.payload?.chat || null;
      const message = resp.payload?.message || null;
      return { group, message };
    } catch (e) {
      console.error("Create group failed", e);
      return null;
    }
  }

  async changeProfile(firstName, lastName = null, description = null) {
    const payload = {
      firstName,
      lastName,
      description,
    };

    try {
      const resp = await this.sendAndWait(16, payload);
      if (resp.payload?.error) {
        console.error("Change profile error:", resp.payload.error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Change profile failed", e);
      return false;
    }
  }

  async resolveChannelByName(name) {
    const payload = {
      link: `https://max.ru/${name}`,
    };

    try {
      const resp = await this.sendAndWait(89, payload);
      if (resp.payload?.error) {
        console.error("Resolve link error:", resp.payload.error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Resolve channel failed", e);
      return false;
    }
  }

  async pinMessage(chatId, messageId, notifyPin = true) {
    const payload = {
      chatId,
      notifyPin,
      pinMessageId: messageId,
    };

    try {
      const resp = await this.sendAndWait(55, payload);
      if (resp.payload?.error) {
        console.error("Pin message error:", resp.payload.error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Pin message failed", e);
      return false;
    }
  }

  async sync() {
    console.log("Syncing");
    if (!this.token) throw "no token set";
    await this.connect();

    const payload = {
      interactive: true,
      token: this.token,
      chatsSync: 0,
      contactsSync: 0,
      presenceSync: 0,
      draftsSync: 0,
      chatsCount: 40,
    };

    const resp = await this.sendAndWait(19, payload);
    console.log("Sync ok", resp);
    if (resp.payload.error) throw resp.payload;
    return resp;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}
