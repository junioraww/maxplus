import API, {
  currentUser,
} from "$lib/stores/api";
import {
  createIdentity,
  getEncrypted,
  handleIncomingEnvelope,
  bufToBase64Url,
  publicIdentityPack,
} from "$lib/crypto/asymmetric.js";
import {
  xorDecrypt
} from "$lib/crypto/symmetric.js";
import { inflate, deflate, obfuscate, detectObfuscation } from "$lib/crypto/messages.js";
import { sendMessage } from "$components/ChatWindow/actions.js";
import { escapeHtml } from "$lib/utils/text.js";

import { writable, get } from "svelte/store";

const requestsBlocked = {};
const requests = {};

export const checkForEncryptionRequest = async (
  chat,
  chatSettings,
  newMessages,
) => {
  let encryptionRequest = null;
  let encryptionResponse = null;

  const isSavedMessagesChat = chat.id === 0;

  /*
   * EncryptionRequest - собеседник отправил запрос
   * EncryptionResponse - собеседник принял запрос
   */

  const password = get(chatSettings).password;
  const keys = get(chatSettings).keys;

  for (const msg of newMessages) {
    const hiddenData = await decode_msg(msg, password);
    if (hiddenData) {
      const sep = hiddenData.text.indexOf(124);

      console.log('Check Sep', sep);

      if (sep !== -1) {

      }
    }

    /*const dmsg = getDeobfuscatedMessage(msg);
     if (dmsg && dmsg.slice(0, 3) === "idx" && !encryptionRequest) {
     encryptionRequest = { sender: msg.sender, data: dmsg };
    }
    if (dmsg && dmsg.slice(0, 3) === "idy" && !encryptionResponse) {
      encryptionResponse = { sender: msg.sender, data: dmsg };
    }*/
  }

  if (
    encryptionRequest &&
    (isSavedMessagesChat || encryptionRequest.sender !== get(currentUser))
  ) {
    const [_, userId, ed_public, cv_public] = encryptionRequest.data.split("|");

    const entry = keys.keys.find((pairs) => pairs.edp === ed_public);

    // !!deny - отклонили
    // !!eds - уже согласились

    if (
      entry?.deny ||
      entry?.eds ||
      (requestsBlocked[chat.id] && requestsBlocked[chat.id] > Date.now())
    )
      return;

      requests[chat.id] = {
        userId,
        edp: ed_public,
        cvp: cv_public,
      };
  } else if (
    encryptionResponse &&
    (isSavedMessagesChat || encryptionResponse.sender !== get(currentUser))
  ) {
    const [_, userId, ed_public, cv_public] =
    encryptionResponse.data.split("|");

    const keyIndex = keys.keys.length;

    keys.current = keyIndex;

    chatSettings.update(data => ({
      ...data,
      keys
    }));
  }
};

export async function encryptMessage(chat, keys, text) {
  // TODO multiple participants support (MLS)
  const entry = keys.keys[keys.current];
  const otherIdentityPacked = publicIdentityPack(keys, chat.id ^ get(currentUser));
  return await getEncrypted(
    get(currentUser),
    entry,
    [otherIdentityPacked],
    text,
  );
}

function decryptMessage(keys, message, deobfuscated) {
  const entry = keys.messages?.find(
    (entry) => entry.from <= message.id && entry.to >= message.id,
  );
  if (!entry) return { ok: false, error: "Ключи шифрования не найдены!" };
  return handleIncomingEnvelope(
    deobfuscated,
    get(currentUser),
    message.sender, // UPD
    keys.keys[entry.key],
  );
}

export function buildHeader(version, xor, ass, compressed) {
  return (
    ((version & 0x0F) << 4) |
    ((xor ? 1 : 0) << 3) |
    ((ass ? 1 : 0) << 2) |
    ((compressed ? 1 : 0) << 1) |
    0
  );
}

export function parseHeader(byte) {
  return {
    version: (byte >> 4) & 0x0F,
    xor: !!((byte >> 3) & 1),
    ass: !!((byte >> 2) & 1),
    compressed: !!((byte >> 1) & 1),
  };
}

export async function decode_msg(msg, password) {
  if (!msg?.text || typeof msg.text !== "string") return null;
  try {
    let obfuscator = await detectObfuscation(msg.text);
    if (!obfuscator) return null;
    const bytes = await obfuscator.deobfuscate(msg.text);
    const text = await tryDecryptMessage(bytes, password);
    if (!text) return null;
    return { text, obf: obfuscator.name };
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function tryDecryptMessage(bytes, password) {
  const header = parseHeader(bytes[0]);

  let payload = bytes.slice(1);

  if (header.version === 0) {
    if (header.xor) {
      if (!password)
        return "<b style=\"color:#f66\">Ошибка!</b> Не установлен общий секрет";
      payload = await xorDecrypt(payload, password);
      if (payload[0] !== 0xFF)
        return "<b style=\"color:#f66\">Ошибка!</b> Не совпадает общий секрет";
      payload = payload.slice(1);
    }

    if (header.ass) {
      payload = await decryptMessage(payload);
      if (!payload.ok) return "<b style=\"color:#f66\">Ошибка!</b> " + payload.error;
    }

    if (header.compressed) {}

    const text = new TextDecoder().decode(payload);

    if (!header.ass) {
      const sep = text.indexOf("|");

      if (sep !== -1) {
        const prefix = text.slice(0, sep);

        if (prefix === "idx")
          return "<b>Запрос на включение шифрования</b>";
        else if (prefix === "idy")
          return "<b>Ответ на включение шифрования</b>";
      }
    }

    return escapeHtml(text);
  }

  return "<b style=\"color:#f66\">Ошибка!</b> Сообщение не поддерживается текущей версией Max+";
}

function inflateWrap(text) {
  try {
    const result = inflate(text);
    return result;
  } catch (e) {
    return null;
  }
}

/* нажатие в меню запроса */
export async function handleEnc(chat, chatSettings, messages, action) {
  const request = requests[chat.id];
  if (!request) return alert("Ошибка! Код: 0");

  if (action === "agree") {
    const identity = await createIdentity(get(currentUser));

    await sendMyIdentity(chat, keys, messages, identity, "idy");

    const request = requests[chat.id];

    const entry = {
      eds: bufToBase64Url(identity.ed25519_sk),
      cvs: bufToBase64Url(identity.curve25519_sk),
      edp: request.edp,
      cvp: request.cvp,
      deny: false,
    };

    const keyIndex = keys.keys.length;
    keys.keys.push(entry);
    keys.current = keyIndex;
    chatSettings.update(data => ({
      ...data,
      keys
    }));
  } else if (action === "deny" || action === "block") {
    keys.keys.push({ edp: request.edp, deny: true });
    chatSettings.update(data => ({
      ...data,
      keys
    }));

    if (action === "block") {
      requestsBlocked[chat.id] = Date.now() + 10 * 60 * 1000;
      // TODO store
    }
  }

  gotSecretChatRequest = null;
}

/* нажатие в настройках */
export async function switchEnc(chat, chatSettings, messages) {
  const { keys } = get(chatSettings);

  if (keys.current === null) {
    const identity = await createIdentity(get(currentUser));

    const startSecretChatRequest = {
      eds: bufToBase64Url(identity.ed25519_sk),
      cvs: bufToBase64Url(identity.curve25519_sk),
    };

    keys.keys.push({
      eds: startSecretChatRequest.eds,
      cvs: startSecretChatRequest.cvs,
      edp: null,
      cvp: null,
      deny: false,
    });

    await new Promise((r) => setTimeout(r, 250));
    await sendMyIdentity(chat, chatSettings, messages, identity, "idx");
  } else {
    keys.current = null;
    chatSettings.update(data => ({
      ...data,
      keys
    }));

    // TODO signal to stop secret chat
    //newMessage = await encryptMessage('$stop-secret-chat')
    //await sendMessage()
  }
}

export const sendMyIdentity = async (
  chat,
  chatSettings,
  messages,
  identity,
  prefix,
) => {
  const identityTransfer = [
    prefix,
    get(currentUser),
    bufToBase64Url(identity.ed25519_pk),
    bufToBase64Url(identity.curve25519_pk),
  ].join("|");

  await sendMessage(
    chat,
    chatSettings,
    messages,
    identityTransfer,
    undefined,
    undefined,
    undefined,
    true
  );
};
