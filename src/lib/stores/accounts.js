import { invoke } from "@tauri-apps/api/core";

export const addAccount = (token, device) => invoke("accounts_add", { token, device });
export const saveDataEntry = (id, file, value) => invoke("data_save", { id, file, value });
export const getAccounts = () => invoke("accounts_get");
export const loadAccount = async () => {
  const current = await invoke("current_get");
  if (!current) return null;
  const accounts = await invoke("accounts_get");
  const acc = Array.isArray(accounts) ? accounts.find(x => x.id === current) : null;
  return acc ? { id: acc.id, encryption: acc.encryption } : null;
};
export const getCurrentAccount = () => invoke("current_account_meta");
export const getAccount = id => invoke("account_get", { id });
export const setCurrentAccount = id => invoke("current_set", { id });
export const init = () => invoke("accounts_init");
export const getAccountMeta = id => invoke("account_get", { id });
export const getAccountContact = id => invoke("account_contact", { id });
export const setAccountContact = (id, data) => invoke("account_contact", { id, data });
export const removeAccount = id => invoke("account_delete", { id });
export const removeAccountByUserId = async uid => {
  const accounts = await invoke("accounts_get");
  const acc = Array.isArray(accounts) ? accounts.find(x => x.uid === uid) : null;
  if (acc?.id) return invoke("account_delete", { id: acc.id });
};
export const setEncryption = (account, key, enabled) => invoke("set_encryption", { account, key, enabled });
export const getDatabaseFilesCount = account => invoke("get_database_files_count", { account });
export const decrypt = (account, key) => invoke("decrypt_account", { account, key });
export const getDevice = () => invoke("common_store_load", { store: "device" });
export const saveDevice = device => invoke("common_store_save", { store: "device", data: device });
