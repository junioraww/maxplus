import { writable } from "svelte/store";

export const composerSelection = writable({
  text: "",
  selectedText: "",
  selectionStart: 0,
  selectionEnd: 0,
  hasSelection: false,
});
