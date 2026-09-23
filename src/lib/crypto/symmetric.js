import { invoke } from "@tauri-apps/api/core";

export async function encryptSymmetric(account, chatId, text, password, obf = null) {
  return invoke("encrypt_message", {
    account: Number(account),
    chatId: Number(chatId),
    text,
    media: null,
    password: password || null,
    useSession: false,
    obf: obf || null,
  });
}
