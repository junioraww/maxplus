import { invoke } from "@tauri-apps/api/core";
import { writable, get } from "svelte/store";

const dictionaryStore = writable(undefined);

export const dict = {
  getUrl: () => invoke("get_dictionary_url"),
  setUrl: (url) => invoke("set_dictionary_url", { url }),
  getDictionary: async () => {
    const cached = get(dictionaryStore);
    if (cached) return cached;

    const loaded = await invoke("load_dictionary");
    const data = loaded?.data || loaded;
    if (data?.dict8 && data?.dict16) {
      dictionaryStore.set(data);
      return data;
    }
    return null;
  },
  setDictionary: (data) => {
    dictionaryStore.set(data);
  },
  resetCache: () => {
    dictionaryStore.set(undefined);
  }
};

export async function makeDictionary(text) {
  let textStr = text;
  if (text instanceof Uint8Array || Array.isArray(text)) {
    textStr = new TextDecoder().decode(new Uint8Array(text));
  } else if (typeof text !== "string") {
    textStr = String(text);
  }
  const result = await invoke("make_dictionary", { text: textStr });
  dictionaryStore.set(result);
  return JSON.stringify(result, null, 2);
}
