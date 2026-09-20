import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import { goto } from "$app/navigation";

import {
  error as logError,
  add as addLog,
} from "$lib/stores/logs";
import API from "$lib/stores/api";
import {
  removeAccount,
  getCurrentAccount,
} from "$lib/stores/accounts";
import { get as sessionGet } from "$lib/stores/session";

const inflightRetries = new Map();

export const invoke = async (command, args) => {
  try {
    const response = await tauriInvoke(command, args);
    return response;
  } catch (error) {
    const type = error?.type;
    const text = typeof error === "string" ? error : (error?.text || error?.message || "");

    const isConnError =
      type === "RequestTimeout" ||
      type === "ConnectionFailed" ||
      type === "NotConnected" ||
      type === "ConnectionClosed" ||
      type === "SendFailed" ||
      (text && text.includes("proto.state"));

    if (!isConnError || sessionGet("connected")) {
      console.error(error);
      logError(error);
    }

    if (isConnError) {
      if (command !== "init" && command !== "sync_client") {
        return restart(command, args, error);
      }
    }

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

let activeReconnect = null;

async function restart(command, args, originalError) {
  const retryKey = command + ":" + JSON.stringify(args || {});
  const currentRetries = inflightRetries.get(retryKey) || 0;
  if (currentRetries >= 2) {
    inflightRetries.delete(retryKey);
    return originalError;
  }
  inflightRetries.set(retryKey, currentRetries + 1);

  if (!activeReconnect) {
    activeReconnect = (async () => {
      try {
        const api = get(API);
        if (api && typeof api.reconnect === "function") {
          await api.reconnect();
        } else if (api) {
          await api.init(true);
        }
      } finally {
        activeReconnect = null;
      }
    })();
  }
  await activeReconnect;

  if (!sessionGet("connected")) {
    inflightRetries.delete(retryKey);
    return originalError;
  }

  try {
    const res = await invoke(command, args);
    inflightRetries.delete(retryKey);
    return res;
  } catch (err) {
    inflightRetries.delete(retryKey);
    return err;
  }
}
