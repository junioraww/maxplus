import { invoke } from "@tauri-apps/api/core";

export async function initHandshake(account, chatId, obf = "ru") {
  return invoke("init_e2e_handshake", {
    account: Number(account),
    chatId: Number(chatId),
    obf: obf || "ru",
  });
}

export async function acceptHandshake(account, chatId, handshakeData, obf = "ru") {
  return invoke("accept_e2e_handshake", {
    account: Number(account),
    chatId: Number(chatId),
    handshakeData,
    obf: obf || "ru",
  });
}

export async function processAccept(account, chatId, handshakeData) {
  return invoke("process_e2e_accept", {
    account: Number(account),
    chatId: Number(chatId),
    handshakeData,
  });
}

export async function verifyHandshakePacket(bytes, chatId) {
  return invoke("verify_e2e_handshake_packet", {
    bytes: Array.from(bytes),
    chatId: Number(chatId),
  });
}

export async function getEncryptionInfo(account, chatId) {
  return invoke("get_chat_encryption_info", {
    account: Number(account),
    chatId: Number(chatId),
  });
}
