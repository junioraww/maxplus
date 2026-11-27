import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { get } from "svelte/store";
import { browser } from "$app/environment";
import { normalizePhone } from "$lib/utils/text";
import { currentRealContacts } from "$lib/stores/api";
import { updateContact } from "$lib/stores/contacts";
import { clientSettings, initClientSettings, updateClientSetting } from "$lib/stores/clientSettings";

let cachedSupported = null;

export async function isMobileAddressBookSupported() {
  if (!browser) return false;
  if (cachedSupported !== null) return cachedSupported;
  try {
    const p = await platform();
    cachedSupported = p === "android" || p === "ios";
  } catch {
    cachedSupported = false;
  }
  return cachedSupported;
}

export async function checkAddressBookPermission() {
  return await invoke("plugin:addressbook|check_permission");
}

export async function requestAddressBookPermission() {
  return await invoke("plugin:addressbook|request_permission");
}

export async function readDeviceContacts() {
  const res = await invoke("plugin:addressbook|read_contacts");
  const rawList = Array.isArray(res?.contacts) ? res.contacts : [];
  const seenPhones = new Set();
  const normalized = [];

  for (const item of rawList) {
    const phone = normalizePhone(item?.phone || "");
    const digits = phone.replace(/\D/g, "");
    if (!phone || digits.length < 5 || seenPhones.has(phone)) continue;
    seenPhones.add(phone);

    const firstName = (item.firstName || item.displayName || phone).trim();
    const lastName = item.lastName ? item.lastName.trim() : "";
    const displayName = (item.displayName || [firstName, lastName].filter(Boolean).join(" ") || phone).trim();

    normalized.push({
      id: item.id || phone,
      phone,
      firstName,
      lastName: lastName || null,
      displayName,
      avatarDataUrl: item.avatarDataUrl || null,
    });
  }

  return normalized;
}

export async function importPhonebookContacts(selectedContacts) {
  const payload = selectedContacts.map((c) => ({
    phone: c.phone,
    firstName: c.firstName || c.displayName || c.phone,
    lastName: c.lastName || null,
  }));

  const res = await invoke("import_phonebook_contacts", { contacts: payload });
  const imported = Array.isArray(res?.contacts) ? res.contacts : [];

  if (imported.length > 0) {
    const existing = new Set((get(currentRealContacts) || []).map(Number));
    for (const contact of imported) {
      const cid = Number(contact?.id);
      if (cid > 0) {
        existing.add(cid);
        updateContact(contact);
      }
    }
    currentRealContacts.set(Array.from(existing));
  }

  return {
    importedCount: imported.length,
    contacts: imported,
  };
}

export async function hasPromptedAddressBook(accountId) {
  await initClientSettings();
  const settings = get(clientSettings);
  const map = settings?.contactsImportPromptedByAccount || {};
  const key = accountId ? String(accountId) : "default";
  return Boolean(map[key]);
}

export async function markAddressBookPrompted(accountId) {
  await initClientSettings();
  const settings = get(clientSettings);
  const prev = settings?.contactsImportPromptedByAccount || {};
  const key = accountId ? String(accountId) : "default";
  if (prev[key]) return;
  await updateClientSetting("contactsImportPromptedByAccount", {
    ...prev,
    [key]: true,
  });
}
