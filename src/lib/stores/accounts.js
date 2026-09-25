import { invoke } from "@tauri-apps/api/core";

export const addAccount = (token, device) => invoke("accounts_add", { token, device });
export const saveDataEntry = (id, file, value) => invoke("data_save", { id, file, value });
export const getAccounts = () => invoke("accounts_get");
export const loadAccount = () => invoke("current_account"); // TODO currently messed up names
export const getCurrentAccount = () => invoke("current_account_meta");
export const getAccount = id => invoke("account_get", { id });
export const setCurrentAccount = id => invoke("current_account_set", { id });
export const init = () => invoke("accounts_init");
export const getAccountMeta = id => invoke("account_meta", { id });
export const getAccountContact = id => invoke("account_contact", { id });
export const setAccountContact = (id, data) => invoke("account_contact", { id, data });
export const removeAccount = id => invoke("account_delete", { id });
export const removeAccountByUserId = uid => invoke("account_delete_by_uid", { uid });
export const setEncryption = (account, key, enabled) => invoke("set_encryption", { account, key, enabled });
export const getDatabaseFilesCount = account => invoke("get_database_files_count", { account });
export const decrypt = (account, key) => invoke("decrypt_account", { account, key });
