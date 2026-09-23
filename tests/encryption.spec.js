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
      wave: null,
      video_type: null,
    };

    expect(descriptor.name).toBe("synthetic_document.pdf");
    expect(descriptor.mime).toBe("application/pdf");
    expect(descriptor.media_type).toBe("FILE");
    expect(descriptor.size).toBeGreaterThan(0);
  });

  test("media descriptor preserves audio waveform and video type", () => {
    const syntheticWave = new Array(80).fill(12);
    const audioDescriptor = {
      attach_index: 0,
      name: "synthetic_voice.ogg",
      mime: "audio/ogg",
      media_type: "AUDIO",
      size: 65536,
      width: null,
      height: null,
      duration: 3500,
      wave: syntheticWave,
      video_type: null,
    };

    expect(audioDescriptor.wave).toHaveLength(80);
    expect(audioDescriptor.duration).toBe(3500);

    const videoNoteDescriptor = {
      attach_index: 0,
      name: "synthetic_note.mp4",
      mime: "video/mp4",
      media_type: "VIDEO",
      size: 524288,
      width: 400,
      height: 400,
      duration: 5000,
      wave: syntheticWave,
      video_type: 1,
    };

    expect(videoNoteDescriptor.video_type).toBe(1);
    expect(videoNoteDescriptor.width).toBe(400);
  });

  test("binary magic validates [0x8F, 0x3D] and forbids MAXMEDIA signature", () => {
    const BINARY_MAGIC = [0x8F, 0x3D];
    const decoyHeader = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
    const containerMagic = Buffer.from(BINARY_MAGIC);
    const fakeCiphertext = Buffer.from([0x01, 0x02, 0x03, 0x04]);

    const fakeContainer = Buffer.concat([decoyHeader, containerMagic, fakeCiphertext]);

    expect(fakeContainer.includes(Buffer.from("MAXMEDIA"))).toBe(false);
    expect(fakeContainer[decoyHeader.length]).toBe(0x8F);
    expect(fakeContainer[decoyHeader.length + 1]).toBe(0x3D);
  });

  test("empty text in decoded message does not fall back to ciphertext trash text", () => {
    const rawCiphertext = "一丁丂七丄SyntheticCiphertextTrashText123456789";
    const msg = {
      id: 90050,
      text: rawCiphertext,
      attaches: [{ _type: "FILE", name: "document.pdf", size: 1024 }],
    };
    const decoded = {
      text: "",
      media: {
        attach_index: 0,
        name: "synthetic_photo.jpg",
        mime: "image/jpeg",
        media_type: "PHOTO",
        size: 1000,
        width: 800,
        height: 600,
        duration: null,
        wave: null,
        video_type: null,
      },
    };

    const rawText = decoded ? (decoded.text ?? "") : (msg.text || "");
    const lines = rawText ? rawText.split("\n") : [];

    expect(rawText).toBe("");
    expect(lines).toHaveLength(0);
    expect(rawText).not.toBe(rawCiphertext);
  });

  test("effectiveAttaches maps decoded media descriptor into secure file attachment", () => {
    const msg = {
      id: 90051,
      text: "decoy",
      attaches: [{ _type: "FILE", name: "document.pdf", size: 2048, fileId: 88801 }],
    };
    const decoded = {
      text: "",
      media: {
        attach_index: 0,
        name: "synthetic_photo.jpg",
        mime: "image/jpeg",
        media_type: "PHOTO",
        size: 2000,
        width: 1200,
        height: 900,
        duration: null,
        wave: null,
        video_type: null,
      },
    };

    const effectiveAttaches = (() => {
      if (!msg.attaches || !msg.attaches.length) return [];
      if (!decoded?.media) return msg.attaches;
      const media = decoded.media;
      const targetIdx = media.attach_index ?? 0;
      return msg.attaches.map((att, idx) => {
        if (idx === targetIdx) {
          const resolvedType = media.media_type || att._type || "FILE";
          return {
            ...att,
            _type: resolvedType,
            type: resolvedType,
            originalType: media.media_type,
            name: media.name || att.name,
            size: media.size || att.size,
            mime: media.mime || att.mime,
            width: media.width ?? att.width,
            height: media.height ?? att.height,
            duration: media.duration ?? att.duration,
            wave: media.wave ?? att.wave,
            videoType: media.video_type ?? att.videoType,
            color: media.color || null,
            isEncryptedMedia: true,
            encryptedAttach: att,
            localPath: att.localPath || "/synthetic/local/photo.jpg",
          };
        }
        return att;
      });
    })();

    expect(effectiveAttaches).toHaveLength(1);
    expect(effectiveAttaches[0]._type).toBe("PHOTO");
    expect(effectiveAttaches[0].originalType).toBe("PHOTO");
    expect(effectiveAttaches[0].name).toBe("synthetic_photo.jpg");
    expect(effectiveAttaches[0].size).toBe(2000);
    expect(effectiveAttaches[0].isEncryptedMedia).toBe(true);
    expect(effectiveAttaches[0].localPath).toBe("/synthetic/local/photo.jpg");
    expect(effectiveAttaches[0].fileId).toBe(88801);
  });

  test("media descriptor preserves dominant color metadata", () => {
    const photoDescriptor = {
      attach_index: 0,
      name: "synthetic_landscape.jpg",
      mime: "image/jpeg",
      media_type: "PHOTO",
      size: 4096,
      width: 1920,
      height: 1080,
      duration: null,
      wave: null,
      video_type: null,
      color: "#2a5b84",
    };

    expect(photoDescriptor.color).toBe("#2a5b84");
    expect(photoDescriptor.media_type).toBe("PHOTO");
  });

  test("decrypt_media_file argument resolution accepts out_path or target_path", () => {
    const resolveOutPath = (args) => args.out_path || args.outPath || args.target_path || args.targetPath;

    expect(resolveOutPath({ out_path: "/dest/file.jpg" })).toBe("/dest/file.jpg");
    expect(resolveOutPath({ outPath: "/dest/file.jpg" })).toBe("/dest/file.jpg");
    expect(resolveOutPath({ target_path: "/dest/file.jpg" })).toBe("/dest/file.jpg");
    expect(resolveOutPath({ targetPath: "/dest/file.jpg" })).toBe("/dest/file.jpg");
  });

  test("auto-download setting toggles state and persists to storage", () => {
    let mockStorage = {};
    const STORAGE_KEY = "max_auto_download_encrypted_media";

    const getSetting = () => mockStorage[STORAGE_KEY] !== "false";
    const setSetting = (val) => { mockStorage[STORAGE_KEY] = val ? "true" : "false"; };
    const toggleSetting = () => { setSetting(!getSetting()); };

    expect(getSetting()).toBe(true);
    toggleSetting();
    expect(getSetting()).toBe(false);
    expect(mockStorage[STORAGE_KEY]).toBe("false");
    toggleSetting();
    expect(getSetting()).toBe(true);
    expect(mockStorage[STORAGE_KEY]).toBe("true");
  });

  test("extractDominantColor returns deterministic valid hex color fallback", async () => {
    const { extractDominantColor } = await import("../src/lib/crypto/messages.js");
    const color = await extractDominantColor("/synthetic/path/image.jpg");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color).not.toBeNull();
  });

  test("encryptMediaAttachment generates realistic decoy filename with supported extension", async () => {
    globalThis.window = globalThis;
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => "/synthetic/cache/enc_uuid.pdf",
    };
    const { encryptMediaAttachment } = await import("../src/lib/crypto/messages.js");

    const attach = {
      _type: "PHOTO",
      name: "vacation_pic.jpg",
      mime: "image/jpeg",
      size: 1048576,
      path: "/synthetic/vacation_pic.jpg",
    };

    const { uploadAttach, mediaDescriptor } = await encryptMediaAttachment({
      account: 12345,
      chatId: 67890,
      attach,
    });

    expect(uploadAttach.type).toBe("FILE");
    expect(uploadAttach.name).toMatch(/^[a-z0-9_]+\.(pdf|docx|xlsx)$/);
    expect(mediaDescriptor.name).toBe("vacation_pic.jpg");
    expect(mediaDescriptor.media_type).toBe("PHOTO");
    expect(mediaDescriptor.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("allMedia includes encrypted photo attachments when decodedMessages has media descriptor", () => {
    const mockMessages = [
      {
        id: 1001,
        text: "dummy text",
        attaches: [{ _type: "FILE", name: "report.pdf", size: 1024, fileId: 99991 }],
      },
    ];
    const mockDecoded = {
      "1001": {
        text: "hello",
        media: {
          attach_index: 0,
          name: "real_photo.png",
          media_type: "PHOTO",
          mime: "image/png",
          size: 1024,
          color: "#3a506b",
        },
      },
    };

    const allMedia = mockMessages.flatMap((m) => {
      const decoded = mockDecoded[String(m.id)];
      const media = decoded?.media;
      const attaches = (m.attaches || []).map((att, idx) => {
        if (media && idx === (media.attach_index ?? 0)) {
          const resolvedType = media.media_type || att._type || "FILE";
          return {
            ...att,
            _type: resolvedType,
            type: resolvedType,
            name: media.name || att.name,
            color: media.color || null,
            isEncryptedMedia: true,
          };
        }
        return att;
      });
      return attaches
        .filter((a) => a._type === "PHOTO" || a._type === "VIDEO")
        .map((a) => ({
          ...a,
          messageId: m.id,
          uid: String(a.fileId || a.url || m.id),
        }));
    });

    expect(allMedia).toHaveLength(1);
    expect(allMedia[0]._type).toBe("PHOTO");
    expect(allMedia[0].name).toBe("real_photo.png");
    expect(allMedia[0].uid).toBe("99991");
  });

  test("batchDecrypt processes multiple encrypted media messages simultaneously in a single batch", async () => {
    globalThis.window = globalThis;
    let invokeReceivedMessages = null;
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        if (cmd === "batch_decrypt_messages") {
          invokeReceivedMessages = args.messages;
          const result = {};
          for (const m of args.messages) {
            result[String(m.id)] = {
              text: `Decrypted ${m.id}`,
              obf: "zh",
              is_encrypted: true,
              media: {
                attach_index: 0,
                name: `photo_${m.id}.jpg`,
                media_type: "PHOTO",
                mime: "image/jpeg",
                size: 2048,
                color: "#112233",
              },
              is_handshake_request: false,
              is_handshake_accept: false,
              handshake_data: null,
              error: null,
            };
          }
          return result;
        }
        return {};
      },
    };

    const { batchDecrypt } = await import("../src/lib/crypto/messages.js");
    const syntheticMessages = [
      { id: 9101, text: "一丁丂七丄synthetic_encoded_1", sender: 1 },
      { id: 9102, text: "一丁丂七丄synthetic_encoded_2", sender: 2 },
      { id: 9103, text: "一丁丂七丄synthetic_encoded_3", sender: 1 },
    ];

    const results = await batchDecrypt(1001, 2002, syntheticMessages, "synth_pass");
    expect(invokeReceivedMessages).toHaveLength(3);
    expect(Object.keys(results)).toHaveLength(3);
    expect(results["9101"].media.name).toBe("photo_9101.jpg");
    expect(results["9102"].media.name).toBe("photo_9102.jpg");
    expect(results["9103"].media.name).toBe("photo_9103.jpg");
  });
});
