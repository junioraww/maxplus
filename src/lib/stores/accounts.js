const _invoke = async (...args) => {
  if (typeof window === "undefined" || !window.__TAURI_INTERNALS__) {
    console.warn("[browser-mode] invoke called but Tauri unavailable:", args[0]);
    return null;
  }

  // Wait for the bridge module on every call, including startup and login.
  // Never silently skip account initialization or persistence while it loads.
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(...args);
};

export const addAccount = (token, device) => _invoke("accounts_add", { token, device });
export const saveDataEntry = (id, file, value) => _invoke("data_save", { id, file, value });
export const getAccounts = () => _invoke("accounts_get");
export const loadAccount = async () => {
  // The shared wrapper waits for the native bridge module before invoking.
  const current = await _invoke("current_get");
  if (!current) return null;
  const accounts = await _invoke("accounts_get");
  const acc = Array.isArray(accounts) ? accounts.find(x => x.id === current) : null;
  return acc ? { id: acc.id, encryption: acc.encryption } : null;
};
export const getCurrentAccount = () => _invoke("current_account_meta");
export const getAccount = id => _invoke("account_get", { id });
export const setCurrentAccount = id => _invoke("current_set", { id });
export const init = () => _invoke("accounts_init");
export const getAccountMeta = id => _invoke("account_get", { id });
export const getAccountContact = id => _invoke("account_contact", { id });
export const setAccountContact = (id, data) => _invoke("account_contact", { id, data });
export const removeAccount = id => _invoke("account_delete", { id });
export const removeAccountByUserId = async uid => {
  const accounts = await _invoke("accounts_get");
  const acc = Array.isArray(accounts) ? accounts.find(x => x.uid === uid) : null;
  if (acc?.id) return _invoke("account_delete", { id: acc.id });
};
export const setEncryption = (account, key, enabled) => _invoke("set_encryption", { account, key, enabled });
export const getDatabaseFilesCount = account => _invoke("get_database_files_count", { account });
export const decrypt = (account, key) => _invoke("decrypt_account", { account, key });
export const getDevice = () => _invoke("common_store_load", { store: "device" });
export const saveDevice = device => _invoke("common_store_save", { store: "device", data: device });
