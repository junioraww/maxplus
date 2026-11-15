import { invoke } from "@tauri-apps/api/core";

export const generateDevice = async (isMobile = true) => {
  return await invoke("generate_device", { isMobile });
};
