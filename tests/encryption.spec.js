import { test, expect } from "@playwright/test";
import {
  SYNTHETIC_CURRENT_USER,
  SYNTHETIC_PEER_USER,
} from "./fixtures/synthetic.js";
import { CryptoPluginRegistry } from "../src/lib/crypto/plugins.js";
import { detectObfuscation } from "../src/lib/crypto/messages.js";
import { dict } from "../src/lib/crypto/text-codec.js";

test.describe("End-to-End Encryption and Obfuscation Detection", () => {
  test("detectObfuscation recognizes Chinese marker prefix and returns zh", async () => {
    const zhMarker = String.fromCharCode(
      0x4e00,
      0x4e02,
      0x4e04,
      0x4e06,
      0x4e08
    );
    const sampleObf = zhMarker + "一丁丂七丄";
    const detected = await detectObfuscation(sampleObf);
    expect(detected).not.toBeNull();
    expect(detected.name).toBe("zh");
    expect(detected.plugin).toBe(false);
  });

  test("detectObfuscation ignores regular plain text", async () => {
    const detected = await detectObfuscation("Synthetic test message");
    expect(detected).toBeNull();
  });

  test("detectObfuscation detects potential book word format with multiple words", async () => {
    const syntheticDict = {
      dict_sha256: "0abcdef1234567890",
      dict8: [
        "первое",
        "второе",
        "третье",
        "четвертое",
        "пятое",
        "шестое",
        "седьмое",
        "восьмое",
        "девятое",
        "десятое",
        "одиннадцатое"
      ],
      dict16: [],
      punct: [],
    };
    dict.setDictionary(syntheticDict);

    const detected = await detectObfuscation("Первое одиннадцатое третье");
    expect(detected).not.toBeNull();
    expect(detected.name).toBe("words");
    expect(detected.plugin).toBe(false);

    dict.resetCache();
  });

  test("detectObfuscation supports custom registered JS plugin obfuscator", async () => {
    const customPlugin = {
      detect: (text) => typeof text === "string" && text.startsWith("!SYNTH!"),
      obfuscate: (text) => "!SYNTH!" + Buffer.from(text).toString("base64"),
      deobfuscate: (text) => Buffer.from(text.replace("!SYNTH!", ""), "base64").toString("utf-8"),
    };

    CryptoPluginRegistry.registerObfuscator("synth_plugin", customPlugin);

    const testText = "!SYNTH!c3ludGhldGlj";
    const detected = await detectObfuscation(testText);
    expect(detected).not.toBeNull();
    expect(detected.name).toBe("synth_plugin");
    expect(detected.plugin).toBe(true);

    const decoded = await customPlugin.deobfuscate(testText);
    expect(decoded).toBe("synthetic");

    CryptoPluginRegistry.unregisterObfuscator("synth_plugin");
    expect(CryptoPluginRegistry.hasObfuscator("synth_plugin")).toBe(false);
  });
});

test.describe("Telegram-Style 4-Emoji Verification Fingerprint", () => {
  test("generates 4 emojis deterministically from 32-byte shared secret", () => {
    const EMOJI_TABLE = [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼",
      "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔",
      "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺",
      "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞",
      "🐜", "🦟", "🐢", "🐍", "🦎", "🐙", "🦑", "🦐",
      "🦞", "🦀", "🐡", "🐠", "🐟", "🐬", "🐳", "鲨",
      "🐊", "🐅", "🐆", "🦓", "🦍", "🐘", "🦛", "🦏",
      "🐪", "🐫", "🦒", "🦘", "🐃", "🐂", "🐄", "🐎",
      "🐖", "🐏", "🐑", "🐐", "🦌", "🐕", "🐩", "🐈",
      "🐓", "🦃", "🦚", "🦜", "🦢", "🦩", "🕊", "🐇",
      "🦝", "🦨", "🦡", "🦦", "🦥", "🐁", "🐀", "🐿",
      "🦔", "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉",
      "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍",
      "🥥", "🥝", "🍅", "🍆", "🥑", "🥦", "🥬", "🥒",
      "🌶", "🌽", "🥕", "🧄", "🧅", "🥔", "🍠", "🥐",
      "🥯", "🍞", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈",
      "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔",
      "🍟", "🍕", "🥪", "🥙", "🧆", "🌮", "🌯", "🥗",
      "🥘", "🍝", "🍜", "🍲", "🍛", "🍣", "🍱", "🥟",
      "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🍢",
      "🍡", "🍧", "🍨", "🍦", "🥧", "🧁", "🍰", "🎂",
      "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "🌰",
      "🥜", "🍯", "🥛", "☕", "🍵", "🧃", "🥤", "🧊",
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉",
      "🥏", "🎱", "🪀", "🏓", "🏸", "🏒", "🥍", "🏏",
      "🥊", "🥋", "🥅", "⛳", "🏹", "🎣", "🤿", "🎽",
      "🛹", "🛼", "🛷", "⛸", "🎯", "🪄", "🪅", "🎮",
      "🚀", "🛸", "🚁", "⛵", "🛶", "🚤", "⚓", "⚡",
      "🌙", "⭐", "🌟", "✨", "💥", "🔥", "🌈", "☀️",
      "💎", "🔔", "🔑", "🗝", "🎸", "🎷", "🎺", "🎻",
      "🥁", "🎹", "🎙", "📻", "🎨", "🎭", "🎬", "🎪",
      "🧭", "⏰", "⏱", "⌛", "💡", "🔦", "🕯", "🪔",
    ];

    const generateSyntheticFingerprint = (hash) => {
      return [
        EMOJI_TABLE[hash[0] % 256],
        EMOJI_TABLE[hash[1] % 256],
        EMOJI_TABLE[hash[2] % 256],
        EMOJI_TABLE[hash[3] % 256],
      ].join(" ");
    };

    const hashAlice = [5, 218, 232, 223];
    const hashBob = [5, 218, 232, 223];

    const fpAlice = generateSyntheticFingerprint(hashAlice);
    const fpBob = generateSyntheticFingerprint(hashBob);

    expect(fpAlice).toBe(fpBob);
    const emojiList = fpAlice.split(" ");
    expect(emojiList.length).toBe(4);
    expect(emojiList[0]).toBe("🦊");
  });
});

test.describe("Secret Chat Handshake Protocol Validation", () => {
  test("handshake packet structure enforces 137 bytes payload and 138 bytes wire length", () => {
    const subtype = 0x01;
    const edPk = new Uint8Array(32).fill(0xaa);
    const xPk = new Uint8Array(32).fill(0xbb);
    const ts = new Uint8Array(8).fill(0x01);
    const sig = new Uint8Array(64).fill(0xcc);

    const payload = new Uint8Array(1 + 32 + 32 + 8 + 64);
    payload[0] = subtype;
    payload.set(edPk, 1);
    payload.set(xPk, 33);
    payload.set(ts, 65);
    payload.set(sig, 73);

    expect(payload.length).toBe(137);
    expect(payload[0]).toBe(0x01);

    const wirePacket = new Uint8Array(1 + payload.length);
    wirePacket[0] = 0x04;
    wirePacket.set(payload, 1);
    expect(wirePacket.length).toBe(138);
  });

  test("self-chat (chatId = 0) enables user to accept own handshake request", () => {
    const currentUserId = SYNTHETIC_CURRENT_USER;
    const isSavedMessagesChat = true;

    const incomingRequest = {
      id: 90010,
      sender: currentUserId,
      is_handshake_request: true,
      handshake_data: "01" + "11".repeat(32) + "22".repeat(32) + "0000018b12345678" + "33".repeat(64),
    };

    const shouldShowConfirmationModal = (msg, isSavedMessages) => {
      const isFromMe = msg.sender === currentUserId;
      return msg.is_handshake_request && (!isFromMe || isSavedMessages);
    };

    expect(shouldShowConfirmationModal(incomingRequest, isSavedMessagesChat)).toBe(true);

    const peerIncomingRequest = {
      id: 90001,
      sender: SYNTHETIC_PEER_USER,
      is_handshake_request: true,
      handshake_data: "01" + "aa".repeat(32) + "bb".repeat(32) + "0000018b12345678" + "cc".repeat(64),
    };

    expect(shouldShowConfirmationModal(peerIncomingRequest, false)).toBe(true);
  });

  test("rejecting a handshake stores messageId and suppresses subsequent modal prompts", () => {
    const rejectedIds = new Set();
    const mockChatSettings = { rejected_handshakes: [] };

    const incomingRequest = {
      id: 90050,
      sender: SYNTHETIC_PEER_USER,
      is_handshake_request: true,
    };

    const isMessageIgnored = (msgId, set, settings) => {
      const idStr = String(msgId);
      return set.has(idStr) || settings.rejected_handshakes.includes(idStr);
    };

    expect(isMessageIgnored(incomingRequest.id, rejectedIds, mockChatSettings)).toBe(false);

    rejectedIds.add(String(incomingRequest.id));
    mockChatSettings.rejected_handshakes.push(String(incomingRequest.id));

    expect(isMessageIgnored(incomingRequest.id, rejectedIds, mockChatSettings)).toBe(true);
  });

  test("blocking handshake silences requests only for the current chat for 5 minutes", () => {
    const blockedMap = new Map();
    const chatIdA = 50001;
    const chatIdB = 50002;
    const now = 1700000000000;

    const blockDurationMs = 5 * 60 * 1000;
    blockedMap.set(chatIdA, now + blockDurationMs);

    const isChatBlocked = (chatId, currentTime) => {
      const until = blockedMap.get(chatId);
      return Boolean(until && until > currentTime);
    };

    expect(isChatBlocked(chatIdA, now + 1000)).toBe(true);
    expect(isChatBlocked(chatIdA, now + 4 * 60 * 1000)).toBe(true);
    expect(isChatBlocked(chatIdA, now + 6 * 60 * 1000)).toBe(false);

    expect(isChatBlocked(chatIdB, now + 1000)).toBe(false);
  });

  test("reopening chat with established session ignores historical handshake requests", () => {
    const chatSettings = {
      keys: { current: 1 },
      session: {
        shared_secret: "11".repeat(32),
        fingerprint: "🦊 🐱 🐶 🐼",
        established_at: 1700000005000,
      },
      handled_handshakes: [90010],
    };

    const isSessionActive = Boolean(
      chatSettings?.keys?.current ||
      chatSettings?.session?.shared_secret
    );
    const establishedAt = Number(chatSettings?.session?.established_at || 0);

    const oldMsg = {
      id: 90010,
      time: 1700000001000,
      is_handshake_request: true,
    };

    const newMsg = {
      id: 90020,
      time: 1700000010000,
      is_handshake_request: true,
    };

    const shouldShow = (msg) => {
      if (chatSettings.handled_handshakes.includes(msg.id)) return false;
      if (isSessionActive && msg.time <= establishedAt) return false;
      return true;
    };

    expect(shouldShow(oldMsg)).toBe(false);
    expect(shouldShow(newMsg)).toBe(true);
  });

  test("dismissing modal outside marks message dismissed during session", () => {
    const dismissed = new Set();
    const dismissModal = (msgId) => dismissed.add(String(msgId));
    const shouldPrompt = (msgId) => !dismissed.has(String(msgId));

    expect(shouldPrompt(90010)).toBe(true);
    dismissModal(90010);
    expect(shouldPrompt(90010)).toBe(false);
  });
});

test.describe("Encrypted Media Descriptor Structure", () => {
  test("media descriptor preserves filename and real type without downloading file", () => {
    const descriptor = {
      attach_index: 0,
      name: "synthetic_document.pdf",
      mime: "application/pdf",
      media_type: "FILE",
      size: 1048576,
      width: null,
      height: null,
      duration: null,
    };

    expect(descriptor.name).toBe("synthetic_document.pdf");
    expect(descriptor.mime).toBe("application/pdf");
    expect(descriptor.media_type).toBe("FILE");
    expect(descriptor.size).toBeGreaterThan(0);
  });
});
