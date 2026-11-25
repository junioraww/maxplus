/**
 * Checks whether the given user has permission to pin/unpin messages in a chat.
 */
export function canPinInChat(chat, userId) {
  if (!chat || userId == null) return false;
  if (chat.type === "DIALOG") return true;

  const myId = Number(userId);
  if (Number(chat.owner ?? chat.ownerId) === myId) return true;

  const isAdmin = Array.isArray(chat.admins) && chat.admins.some((a) => Number(a) === myId);
  if (isAdmin) {
    const adminInfo = chat.adminParticipants?.[myId] || chat.adminParticipants?.[String(myId)];
    const perms = adminInfo?.permissions;
    if (typeof perms === "number") return (perms & 16) !== 0;
    if (Array.isArray(perms)) return perms.includes("PIN_MESSAGE");
    return true;
  }

  if (chat.type === "CHANNEL") return false;

  const opts = chat.options || {};
  return Boolean(opts.ALL_CAN_PIN_MESSAGE || opts.allCanPinMessage);
}
