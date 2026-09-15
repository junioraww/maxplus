import {
  currentSessionChats,
} from "$lib/stores/api";
import {
  updateContact,
  getCachedContacts,
  getContact as getContactStore
} from "$lib/stores/contacts";
import { invoke } from "$lib/utils/invoke";
import { get, writable } from "svelte/store";

export const syncContacts = async (contacts, requireInfo) => {
  contacts.forEach((raw) => {
    updateContact(normalizeContact(raw));
    requireInfo.delete(+raw.id);
  });

  const userIds = [...requireInfo].map(Number).filter(id => id > 0);
  if (userIds.length) {
    const response = await invoke("fetch_contacts", {
      userIds,
    });

    if (response?.contacts) {
      response.contacts.forEach(raw => {
        updateContact(normalizeContact(raw));
      });
    }
  }
};

const empty = writable(null);
let contactBatch = null;

export const getContact = contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return empty;

  getCachedContacts().then(contacts => {
    if (!contacts.some(x => x.id === id))
      requestAndCacheContact(id);
  });

  return getContactStore(id);
};

const requestAndCacheContact = async contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return;

  if (!contactBatch) {
    contactBatch = {
      ids: [],
      promise: new Promise(resolve =>
        setTimeout(resolve, 300)
      )
    };
  }

  contactBatch.ids.push(id);

  const batch = contactBatch;

  await batch.promise;

  if (contactBatch === batch) {
    contactBatch = null;

    const validIds = [...new Set(batch.ids)].filter(x => x > 0);
    if (!validIds.length) return;

    const response = await invoke("fetch_contacts", {
      userIds: validIds
    });

    if (response?.contacts) {
      for (const raw of response.contacts) {
        updateContact(normalizeContact(raw));
      }
    }
  }
}

export const getContactAsync = async contactId => {
  const id = Number(contactId);
  if (!id || id <= 0) return empty;
  const contacts = await getCachedContacts();

  if (!contacts.some(x => x.id === id)) {
    await requestAndCacheContact(id);
  }

  return getContactStore(id);
}

const normalizeContact = (contact) => {
  const { baseRawUrl, baseUrl, ...rest } = contact;

  return {
    ...rest,
    avatar: baseRawUrl || baseUrl,
  };
};

// access, baseIconUrl, baseRawIconUrl, created, description
// id, lastDelayedUpdateTime, lastEventTime, lastFireDelayedErrorTime,
// lastMessage, link, messagesCount, modified, options, owner, participants
// participantsCount, pinnedMessage, reactions, restrictions, status, title, type
