import { invoke as tauriInvoke, Channel } from "@tauri-apps/api/core";
import { get } from "svelte/store";
import { goto } from "$app/navigation";

import {
  error as logError,
  add as addLog,
} from "$lib/stores/logs";
import { recordApiRequest, recordApiResponse } from "$lib/services/trace";
import API from "$lib/stores/api";
import {
  removeAccount,
  getCurrentAccount,
} from "$lib/stores/accounts";
import { get as sessionGet } from "$lib/stores/session";
import { showAlert } from "$lib/utils/alert";
import { parseApiError, isNo2FaError } from "$lib/utils/errors";

const inflightRetries = new Map();

function notifyApiError(command, errObj) {
  if (isNo2FaError(errObj)) return;
  if (command === "get_video_by_id" && errObj?.error === "video.not.found") return;
  const parsedMsg = parseApiError(errObj);
  const code = typeof errObj?.error === "string" ? errObj.error : "";
  const details = code && code !== parsedMsg ? `${command}: ${code}` : command;
  showAlert(`Ошибка API: ${parsedMsg}`, details);
}

export const invoke = async (command, args) => {
  if (command === "download_to_path" && args && !args.onProgress) {
    args = { ...args, onProgress: new Channel() };
  }
  const reqStart = Date.now();
  recordApiRequest(command, args);
  try {
    const response = await tauriInvoke(command, args);
    recordApiResponse(command, response, Date.now() - reqStart);
    if (response && typeof response === "object" && response.error) {
      notifyApiError(command, response);
    }
    return response;
  } catch (error) {
    recordApiResponse(command, null, Date.now() - reqStart, error);
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

    if (type !== "ApiResponse") {
      notifyApiError(command, error);
      return error;
    }

    try {
      const parsed = {
        ...JSON.parse(text),
        type
      };
      notifyApiError(command, parsed);
      return parsed;
    } catch {
      notifyApiError(command, error);
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
    notifyApiError(command, originalError);
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
    notifyApiError(command, originalError);
    return originalError;
  }

  try {
    const res = await invoke(command, args);
    inflightRetries.delete(retryKey);
    return res;
  } catch (err) {
    inflightRetries.delete(retryKey);
    notifyApiError(command, err);
    return err;
  }
}
