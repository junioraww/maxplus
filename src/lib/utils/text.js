import { getAttachText } from "$lib/utils/attachs";

export function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getMessagePreview(message) {
  if (!message) return "";
  const attach = getAttachText(message);

  if (attach) {
    if (message.text?.length) return attach + ", " + message.text;
    return attach;
  }

  return message.text || "";
}
