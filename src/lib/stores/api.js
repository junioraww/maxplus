import "$lib/utils/browserShim";
import { invoke } from "@tauri-apps/api/core";
import { writable, get } from "svelte/store";
import { goto } from "$app/navigation";
import { page } from "$app/stores";

export const currentUser = writable(undefined);
export const currentUserDetails = writable(undefined);
export const currentSessionCalls = writable(undefined);
export const currentlySyncing = writable(false);
export const currentFolders = writable([]);
export const currentPresence = writable({});
export const serverConfig = writable({});
export const currentRealChats = writable([]);
export const currentRealContacts = writable([]);

import MobileApi from "$lib/api/MobileApi";
import MockApi from "$lib/api/MockApi";
import { isBrowserMode } from "$lib/utils/browserShim";
import * as Accounts from "$lib/stores/accounts";
import {
  get as sessionGet,
  set as sessionSet
} from "$lib/stores/session";
import { openLockScreen } from "$lib/stores/lockScreen";
import { initCamouflageOnStartup, isCamouflageLocked } from "$lib/camouflage/store";
import { setStoriesCurrentUserId } from "$lib/stores/stories";
import { resetImageCaches } from "$lib/utils/images";
import { clearCachingUtils } from "$lib/utils/caching";

const API = isBrowserMode() ? new MockApi() : new MobileApi();
if (typeof window !== "undefined") {
  window.__API = API;
}
export default writable(API);

currentUser.subscribe(async userId => {
  setStoriesCurrentUserId(userId);
  clearCachingUtils();
  const curAcc = await Accounts.getCurrentAccount().catch(() => null);
  if (curAcc?.id) {
    resetImageCaches(curAcc.id);
  }
  if (userId === undefined) {
    const account = await Accounts.getCurrentAccount();
    if (!account) return currentUser.set(null);
    const data = await Accounts.getAccount(account.id);
    console.log('Loaded current account =', data);
    if (!data) {
      currentUser.set(null);
    }
    else if (data.encryption && (!data.unlocked || !data.meta?.device)) {
      const enc = data.encryption;

      if (enc.type !== "pin-1" && enc.type !== "hardware-1") return alert("Данные зашифрованы неизвестным способом!");

      await initCamouflageOnStartup();
      if (get(isCamouflageLocked)) {
        sessionSet("loaded", true);
        return;
      }

      openLockScreen({ mode: "decrypt", from: "/auth/select" });
      sessionSet("loaded", true);
    } else {
      if (!data?.contact?.id) {
        try {
          if (!sessionGet("connected")) {
            const ok = await API.init(true);
            if (ok && !sessionGet("sync")) await API.sync();
          } else if (!sessionGet("sync")) {
            await API.sync();
          }
        } catch (e) {
          console.error(e);
        } finally {
          sessionSet("loaded", true);
        }
      } else {
        currentUserDetails.set(data.contact);
        currentUser.set(data.contact.id);
      }
    }
  }
  else if (userId === null) {
    sessionSet("sync", false);
    sessionSet("connected", false);
    API.latest_init = 0;
    invoke("disconnect").catch(() => {});
    await openAuth();
  }
  else {
    try {
      if (sessionGet("sync")) return;
      if (!sessionGet("connected")) {
        const ok = await API.init(true);
        if (ok && !sessionGet("sync")) await API.sync();
      } else {
        await API.sync();
      }
    } catch (e) {
      console.error(e);
    } finally {
      sessionSet("loaded", true);
    }
  }
});

async function openAuth() {
  try {
    const acs = await Accounts.getAccounts();
    const target = "/auth/" + (acs && acs[0] ? "select" : "login");
    await goto(target, { replaceState: true });
  } finally {
    sessionSet("loaded", true);
  }
}
