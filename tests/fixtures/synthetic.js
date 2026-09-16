export const SYNTHETIC_CURRENT_USER = 10001;
export const SYNTHETIC_PEER_USER = 20002;

export const syntheticContacts = [
  {
    id: SYNTHETIC_PEER_USER,
    names: [{ name: "Synthetic Contact", firstName: "Synthetic", lastName: "Contact" }],
    avatar: null,
    options: [],
  },
  {
    id: 30003,
    names: [{ name: "Synthetic Bot", firstName: "Synthetic", lastName: "Bot" }],
    avatar: null,
    options: ["BOT"],
  },
];

export const syntheticChats = [
  {
    id: 50001,
    type: "DIALOG",
    title: "Synthetic Dialog",
    participants: { [SYNTHETIC_CURRENT_USER]: 1700000000000, [SYNTHETIC_PEER_USER]: 1700000005000 },
    otherReadTime: 1700000005000,
    newMessages: 0,
  },
  {
    id: 50002,
    type: "CHAT",
    title: "Synthetic Group Chat",
    participants: { [SYNTHETIC_CURRENT_USER]: 1700000000000, [SYNTHETIC_PEER_USER]: 1700000002000 },
    otherReadTime: 1700000002000,
    newMessages: 2,
  },
];

export const syntheticMessages = {
  textMessage: {
    id: 90001,
    chatId: 50001,
    sender: SYNTHETIC_PEER_USER,
    text: "Synthetic message content",
    time: 1700000000000,
    attaches: [],
  },
  photoMessage: {
    id: 90002,
    chatId: 50001,
    sender: SYNTHETIC_PEER_USER,
    text: "",
    time: 1700000001000,
    attaches: [{ _type: "PHOTO", photoId: 101 }],
  },
  multiPhotoMessage: {
    id: 90003,
    chatId: 50001,
    sender: SYNTHETIC_PEER_USER,
    text: "Look at pictures",
    time: 1700000002000,
    attaches: [{ _type: "PHOTO", photoId: 102 }, { _type: "PHOTO", photoId: 103 }],
  },
  videoMessage: {
    id: 90004,
    chatId: 50001,
    sender: SYNTHETIC_PEER_USER,
    text: "",
    time: 1700000003000,
    attaches: [{ _type: "VIDEO", videoId: 201 }],
  },
  fileMessage: {
    id: 90005,
    chatId: 50001,
    sender: SYNTHETIC_PEER_USER,
    text: "",
    time: 1700000004000,
    attaches: [{ _type: "FILE", name: "synthetic_doc.pdf" }],
  },
  outgoingPendingMessage: {
    id: 90006,
    chatId: 50001,
    sender: SYNTHETIC_CURRENT_USER,
    text: "Sending...",
    time: 1700000006000,
    status: 0,
  },
  outgoingSentMessage: {
    id: 90007,
    chatId: 50001,
    sender: SYNTHETIC_CURRENT_USER,
    text: "Sent message",
    time: 1700000007000,
    status: 1,
  },
  outgoingReadMessage: {
    id: 90008,
    chatId: 50001,
    sender: SYNTHETIC_CURRENT_USER,
    text: "Read message",
    time: 1700000004000,
    status: 1,
  },
};
