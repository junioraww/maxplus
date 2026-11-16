import { getAttachText, getSystemText } from "$lib/utils/attachs";

export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) {
    digits = "7" + digits;
  } else if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  return digits ? "+" + digits : "";
}

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

  const systemText = getSystemText(message, false);
  if (systemText) {
    return systemText;
  }

  const attach = getAttachText(message);
  if (attach) {
    if (message.text?.length) return attach + ", " + message.text;
    return attach;
  }

  return message.text || "";
}
