import { invoke } from "@tauri-apps/api/core";

export const getDevice = () => invoke("common_store_load", { store: "device" });
export const saveDevice = device => invoke("common_store_save", { store: "device", data: device });
