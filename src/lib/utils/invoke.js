import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";

import {
  error as logError,
  add as addLog,
} from "$lib/stores/logs";
import API from "$lib/stores/api";
import {
  removeAccount,
  getCurrentAccount,
} from "$lib/stores/accounts";

export const invoke = async (command, args) => {
  try {
    const response = await tauriInvoke(command, args);
    return response;
  } catch (error) {
    console.error(error);
    logError(error);

    const type = error?.type;
    const text = typeof error === "string" ? error : (error?.text || error?.message || "");

    if (type === "RequestTimeout")
      return restart("Сервер не отвечает!\nПереподключение...", command, args);
    if (type === "ConnectionFailed")
      return restart("Откис интернет!\nПереподключение...", command, args);
    if (text && text.includes("proto.state"))
      return restart("Сломалась сессия!\nПереподключение...", command, args);

    if (text && text.includes("login.token")) {
      alert("Выкинуло из аккаунта!");
      const current = await getCurrentAccount();
      if (current) await removeAccount(current.id);
      goto("/auth/login");
      return;
    }

    if (type !== "ApiResponse") return error;

    try {
      return {
        ...JSON.parse(text),
        type
      };
    } catch {
      return error;
    }
  }
};

let recentAlert = 0;

async function restart(text, command, args) {
  if (recentAlert < Date.now() - 5000) {
    alert(text);
  }
  recentAlert = Date.now();
  await new Promise(r => setTimeout(r, 3000));
  await get(API).init(true);
  return invoke(command, args);
}
