import { invoke } from "@tauri-apps/api/core";
import { writable, get } from "svelte/store";

import {
  getCurrentAccount
} from "$lib/stores/accounts";

const cache = {};

const emptyContactStore = writable(null);

export const getContact = contactId => {
  const cid = Number(contactId);
  if (!cid || cid <= 0 || !Number.isSafeInteger(cid)) return emptyContactStore;
  if (cache[cid]) return cache[cid].store;

  const store = writable(undefined);
  cache[cid] = { store };

  getCurrentAccount().then(async account => {
    try {
      const cached = await invoke("get_contact", { account: +account.id, contactId: cid });
      if (cached) store.set(cached);
    } catch {}

    let initial = true;
    cache[cid].unsubscribe = store.subscribe(async data => {
      if (initial) {
        initial = false;
        return;
      }
      if (data !== undefined) {
        try {
          const _account = await getCurrentAccount();
          invoke("set_contact", { account: +_account.id, contactId: cid, data });
        } catch {}
      }
    });
  }).catch(() => {});

  return store;
};

export function getContactDisplayName(contact) {
  if (!contact) return '';
  if (contact.names?.[0]?.firstName) {
    const fn = contact.names[0].firstName;
    const ln = contact.names[0].lastName || '';
    return `${fn} ${ln}`.trim();
  }
  if (contact.firstName) {
    const ln = contact.lastName || '';
    return `${contact.firstName} ${ln}`.trim();
  }
  return contact.name || contact.displayName || contact.title || '';
}

export function getContactAvatarUrl(contact) {
  if (!contact) return null;
  return contact.avatar || contact.baseRawUrl || contact.baseUrl || contact.photo || contact.iconUrl || null;
}

export const getContactDirect = async contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return null;
  if (cache[id]) {
    const val = get(cache[id].store);
    if (val !== undefined && val !== null) {
      return {
        ...val,
        avatar: getContactAvatarUrl(val),
        displayName: getContactDisplayName(val),
      };
    }
  }
  try {
    const account = await getCurrentAccount();
    if (!account?.id) return null;
    const cached = await invoke("get_contact", { account: +account.id, contactId: id });
    if (cached) {
      const normalized = {
        ...cached,
        avatar: getContactAvatarUrl(cached),
        displayName: getContactDisplayName(cached),
      };
      if (cache[id]) {
        cache[id].store.set(normalized);
      }
      return normalized;
    }
    const resp = await invoke("fetch_contacts", { userIds: [id] });
    if (resp?.contacts && resp.contacts.length > 0) {
      const raw = resp.contacts[0];
      const contact = {
        ...raw,
        avatar: getContactAvatarUrl(raw),
        displayName: getContactDisplayName(raw),
      };
      await updateContact(contact);
      return contact;
    }
  } catch (_) {}
  return null;
};

export const updateContact = async contact => {
  if (!contact) throw new Error("Contact can't be undefined");
  if (!contact.id) throw new Error("No contact id!");
  const store = await getContact(contact.id);
  store.set(contact);
  const idx = cachedContacts.findIndex(c => (typeof c === 'object' && c !== null ? c.id === contact.id : c === contact.id));
  if (idx === -1) {
    cachedContacts.push(contact);
  } else {
    cachedContacts[idx] = contact;
  }
};

let contactsLoaded = false;
let cachedContacts = [];
let cachedContactsPromise = null;

export const getCachedContacts = async () => {
  if (contactsLoaded && cachedContacts.length > 0) {
    return cachedContacts;
  }
  if (cachedContactsPromise) return cachedContactsPromise;

  cachedContactsPromise = (async () => {
    try {
      const account = await getCurrentAccount();
      if (!account?.id) return [];
      const res = await invoke("get_contacts", { account: +account.id });
      if (Array.isArray(res)) {
        cachedContacts = res;
        contactsLoaded = true;
      }
      return cachedContacts;
    } catch {
      return cachedContacts;
    } finally {
      cachedContactsPromise = null;
    }
  })();

  return cachedContactsPromise;
};
