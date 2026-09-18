import { invoke } from "@tauri-apps/api/core";
import { writable, get } from "svelte/store";

import {
  getCurrentAccount
} from "$lib/stores/accounts";

const cache = {};

export const getContact = contactId => {
  if (!contactId) return null;
  if (cache[contactId]) return cache[contactId].store;

  const store = writable(undefined);
  cache[contactId] = { store };

  getCurrentAccount().then(async account => {
    const cached = await invoke("get_contact", { account: +account.id, contactId });
    if (cached) store.set(cached);

    cache[contactId].unsubscribe = store.subscribe(async data => {
      if (data !== undefined) {
        getCurrentAccount().then(async _account => {
          invoke("set_contact", { account: +_account.id, contactId, data });
        });
      }
    });
  });

  return store;
};

export const getContactDirect = async contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return null;
  if (cache[id]) {
    const val = get(cache[id].store);
    if (val !== undefined && val !== null) return val;
  }
  try {
    const account = await getCurrentAccount();
    if (!account?.id) return null;
    const cached = await invoke("get_contact", { account: +account.id, contactId: id });
    if (cached) {
      if (cache[id]) {
        cache[id].store.set(cached);
      }
      return cached;
    }
  } catch (_) {}
  return null;
};

export const updateContact = async contact => {
  if (!contact) throw new Error("Contact can't be undefined");
  if (!contact.id) throw new Error("No contact id!");
  const store = await getContact(contact.id);
  store.set(contact);
  if (!cachedContacts.includes(contact.id)) {
    cachedContacts.push(contact.id);
  }
}

let contactsLoaded = false;
let cachedContacts = [];

export const getCachedContacts = async () => {
  const account = await getCurrentAccount();
  return invoke("get_contacts", { account: +account.id });
}
