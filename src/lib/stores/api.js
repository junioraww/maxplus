import { writable, get } from "svelte/store";
import { goto } from "$app/navigation";
import { page } from "$app/stores";

import MobileApi from "$lib/api/MobileApi.js";
import * as Accounts from "$lib/stores/accounts.js";
import {
  get as sessionGet,
  set as sessionSet
} from "$lib/stores/session.js";

export const currentUser = writable(undefined);
export const currentUserDetails = writable(undefined);
export const currentSessionChats = writable(undefined);
export const currentSessionCalls = writable(undefined);
export const currentlySyncing = writable(false);
export const currentFolders = writable([]);
export const currentPresence = writable({});

const API = new MobileApi();
export default writable(API);

export const currentRealChats = writable([]);
export const currentRealContacts = writable([]);

currentUser.subscribe(async userId => {
  if (userId === undefined) {
    const account = await Accounts.getCurrentAccount();
    if (!account) return currentUser.set(null);
    const data = await Accounts.getAccount(account.id);
    console.log('Loaded current account =', data);
    if (!data) {
      currentUser.set(null);
    }
    else if (data.encryption && !data.contact) {
      const enc = data.encryption;

      if (enc.type !== "pin-1") return alert("Данные зашифрованы неизвестным способом!");

      goto("/auth/lock?mode=decrypt&from=/auth/select")
      sessionSet("loaded", true);
    } else {
      if (!data?.contact?.id) {
        try {
          if (!sessionGet("connected")) {
            const ok = await API.init();
            if (ok) await API.sync();
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
    openAuth();
    sessionSet("loaded", true);
  }
  else {
    try {
      if (sessionGet("sync")) return;
      if (!sessionGet("connected")) {
        const ok = await API.init();
        if (ok) await API.sync();
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
  Accounts.getAccounts().then(acs => {
    goto("/auth/" + (acs && acs[0] ? "select" : "login"));
  });
}
