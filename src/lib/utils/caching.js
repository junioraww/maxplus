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

  if (requireInfo.size) {
    console.log("Необходимые для обновления контакты", requireInfo);

    const response = await invoke("fetch_contacts", {
      userIds: [...requireInfo],
    });

    response.contacts.forEach(raw => {
      updateContact(normalizeContact(raw));
    });
  }
};

const empty = writable(null);
let contactBatch = null;

export const getContact = contactId => {
  if (!+contactId) return empty;

  getCachedContacts().then(async contacts => {
    // TODO return only ids (that are cached)
    if (!contacts.some(x => x.id === +contactId)) {
      if (!contactBatch) {
        contactBatch = {
          ids: [],
          promise: new Promise(resolve =>
            setTimeout(resolve, 300)
          )
        };
      }

      contactBatch.ids.push(+contactId);

      const batch = contactBatch;

      await batch.promise;

      if (contactBatch === batch) {
        contactBatch = null;

        const response = await invoke("fetch_contacts", {
          userIds: [...new Set(batch.ids)]
        });

        for (const raw of response.contacts) {
          updateContact(normalizeContact(raw));
        }
      }
    }
  });

  return getContactStore(+contactId);
};

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
