import { invoke } from "@tauri-apps/api/core";

export async function pickFile(options = {}) {
  try {
    const res = await invoke("pick", options);
    if (!res || !res.uri) return null;
    return res;
  } catch (e) {
    if (e === "CANCEL" || e?.message === "CANCEL") return null;
    throw e;
  }
}

export async function pickFileBytes(options = {}) {
  const picked = await pickFile(options);
  if (!picked) return null;

  const raw = await invoke("read_file", { path: picked.uri });
  const bytes = new Uint8Array(raw);
  return {
    ...picked,
    bytes,
    arrayBuffer: bytes.buffer,
  };
}

export async function pickFileText(options = {}) {
  const picked = await pickFile(options);
  if (!picked) return null;

  const raw = await invoke("read_file", { path: picked.uri });
  const text = new TextDecoder().decode(new Uint8Array(raw));
  return {
    ...picked,
    text,
  };
}
