import {
  currentSessionChats,
} from "$lib/stores/api";
import {
  updateContact as saveToStore,
  getCachedContacts,
  getContact as getContactStore
} from "$lib/stores/contacts";
import { invoke } from "$lib/utils/invoke";
import { get, writable } from "svelte/store";

const empty = writable(null);
const knownContactIds = new Set();
const pendingContactIds = new Set();
const failedContactIds = new Map();

export const updateContact = (contact) => {
  if (contact?.id) {
    knownContactIds.add(Number(contact.id));
    pendingContactIds.delete(Number(contact.id));
    failedContactIds.delete(Number(contact.id));
  }
  saveToStore(contact);
};

export const syncContacts = async (contacts, requireInfo) => {
  contacts.forEach((raw) => {
    updateContact(normalizeContact(raw));
    requireInfo.delete(+raw.id);
  });

  const userIds = [...requireInfo].map(Number).filter(id => id > 0);
  if (!userIds.length) return;

  const CHUNK_SIZE = 50;
  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);
    try {
      const response = await invoke("fetch_contacts", {
        userIds: chunk,
      });

      if (response?.contacts) {
        response.contacts.forEach(raw => {
          updateContact(normalizeContact(raw));
        });
      }
    } catch {}

    if (i + CHUNK_SIZE < userIds.length) {
      await new Promise(r => setTimeout(r, 60));
    }
  }
};

let contactBatch = null;

export const getContact = contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return empty;

  if (knownContactIds.has(id)) {
    return getContactStore(id);
  }

  const failedAt = failedContactIds.get(id);
  if (failedAt && (Date.now() - failedAt < 15000)) {
    return getContactStore(id);
  }

  getCachedContacts().then(contacts => {
    if (Array.isArray(contacts)) {
      for (const c of contacts) {
        const cId = typeof c === 'object' && c !== null ? Number(c.id) : Number(c);
        if (cId > 0) knownContactIds.add(cId);
      }
    }
    if (!knownContactIds.has(id)) {
      requestAndCacheContact(id);
    }
  });

  return getContactStore(id);
};

const requestAndCacheContact = async contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return;
  if (knownContactIds.has(id) || pendingContactIds.has(id)) return;

  const failedAt = failedContactIds.get(id);
  if (failedAt && (Date.now() - failedAt < 15000)) return;

  pendingContactIds.add(id);

  if (!contactBatch) {
    contactBatch = {
      ids: [],
      promise: new Promise(resolve =>
        setTimeout(resolve, 200)
      )
    };
  }

  contactBatch.ids.push(id);
  const batch = contactBatch;

  await batch.promise;

  if (contactBatch === batch) {
    contactBatch = null;

    const validIds = [...new Set(batch.ids)].filter(x => x > 0 && !knownContactIds.has(x));
    if (!validIds.length) return;

    const CHUNK_SIZE = 50;
    for (let i = 0; i < validIds.length; i += CHUNK_SIZE) {
      const chunk = validIds.slice(i, i + CHUNK_SIZE);
      try {
        const response = await invoke("fetch_contacts", {
          userIds: chunk
        });

        if (response?.contacts) {
          for (const raw of response.contacts) {
            updateContact(normalizeContact(raw));
          }
        }
      } catch {
        const now = Date.now();
        for (const cid of chunk) {
          failedContactIds.set(cid, now);
        }
      } finally {
        for (const cid of chunk) {
          pendingContactIds.delete(cid);
        }
      }

      if (i + CHUNK_SIZE < validIds.length) {
        await new Promise(r => setTimeout(r, 60));
      }
    }
  }
};

export const getContactAsync = async contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return empty;

  if (knownContactIds.has(id)) {
    return getContactStore(id);
  }

  const contacts = await getCachedContacts();
  if (Array.isArray(contacts)) {
    for (const c of contacts) {
      const cId = typeof c === 'object' && c !== null ? Number(c.id) : Number(c);
      if (cId > 0) knownContactIds.add(cId);
    }
  }

  if (!knownContactIds.has(id)) {
    await requestAndCacheContact(id);
  }

  return getContactStore(id);
};

const normalizeContact = (contact) => {
  const { baseRawUrl, baseUrl, ...rest } = contact;

  return {
    ...rest,
    avatar: baseRawUrl || baseUrl,
  };
};
