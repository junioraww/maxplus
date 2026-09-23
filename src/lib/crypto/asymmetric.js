import { invoke } from "@tauri-apps/api/core";

export async function initHandshake(account, chatId, obf = "zh") {
  return invoke("init_e2e_handshake", {
    account: Number(account),
    chatId: Number(chatId),
    obf: obf || "zh",
  });
}

export async function acceptHandshake(account, chatId, handshakeData, obf = "zh") {
  return invoke("accept_e2e_handshake", {
    account: Number(account),
    chatId: Number(chatId),
    handshakeData,
    obf: obf || "zh",
  });
}

export async function processAccept(account, chatId, handshakeData) {
  return invoke("process_e2e_accept", {
    account: Number(account),
    chatId: Number(chatId),
    handshakeData,
  });
}

export async function getEncryptionInfo(account, chatId) {
  return invoke("get_chat_encryption_info", {
    account: Number(account),
    chatId: Number(chatId),
  });
}
