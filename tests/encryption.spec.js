import { test, expect } from "@playwright/test";
import { CryptoPluginRegistry } from "../src/lib/crypto/plugins";
import {
  detectObfuscation,
  extractDominantColor,
  encryptMediaAttachment,
  batchDecrypt,
} from "../src/lib/crypto/messages";
import { dict } from "../src/lib/crypto/text-codec";
import {
  CallEncryptionSession,
  generateCallKeyPair,
  exportPublicKeyBytes,
  deriveSharedSecret,
} from "../src/lib/crypto/callEncryption";

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

test.describe("Encrypted Media Operations", () => {
  test("extractDominantColor returns deterministic valid hex color fallback", async () => {
    const color = await extractDominantColor("/synthetic/path/image.jpg");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(color).not.toBeNull();
  });

  test("encryptMediaAttachment generates realistic decoy filename with supported extension", async () => {
    globalThis.window = globalThis;
    globalThis.__TAURI_INTERNALS__ = {
      invoke: async () => "/synthetic/cache/enc_uuid.pdf",
    };

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

test.describe("End-to-End Call Media Encryption", () => {
  const SYNTHETIC_SHARED_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const SYNTHETIC_CONV_ID = "conv-synth-1001-2002";

  test("deterministic derivation from chat secret produces matching fingerprints", async () => {
    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();

    await alice.initFromChatSecret(SYNTHETIC_SHARED_SECRET, SYNTHETIC_CONV_ID, true);
    await bob.initFromChatSecret(SYNTHETIC_SHARED_SECRET, SYNTHETIC_CONV_ID, false);

    expect(alice.mode).toBe("secure");
    expect(bob.mode).toBe("secure");
    expect(alice.fingerprint).toBe(bob.fingerprint);
    expect(alice.fingerprint).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  test("different secrets produce distinct fingerprints and keys", async () => {
    const sessionA = new CallEncryptionSession();
    const sessionB = new CallEncryptionSession();

    await sessionA.initFromChatSecret(SYNTHETIC_SHARED_SECRET, "conv-1", true);
    await sessionB.initFromChatSecret("fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210", "conv-2", true);

    expect(sessionA.fingerprint).not.toBe(sessionB.fingerprint);
  });

  test("audio frame encryption and decryption between originator and responder", async () => {
    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();

    await alice.initFromChatSecret(SYNTHETIC_SHARED_SECRET, SYNTHETIC_CONV_ID, true);
    await bob.initFromChatSecret(SYNTHETIC_SHARED_SECRET, SYNTHETIC_CONV_ID, false);

    const sampleAudio = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    const encrypted = await alice.encryptFrame(sampleAudio, "audio");

    expect(encrypted[0]).toBe(sampleAudio[0]);
    expect(encrypted.length).toBe(sampleAudio.length + 16 + 12 + 2);
    expect(encrypted[encrypted.length - 2]).toBe(12);
    expect(encrypted[encrypted.length - 1]).toBe(0);

    const decrypted = await bob.decryptFrame(encrypted, "audio");
    expect(Array.from(decrypted)).toEqual(Array.from(sampleAudio));
  });

  test("video frame encryption and decryption with key isolation from audio", async () => {
    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();

    await alice.initFromChatSecret(SYNTHETIC_SHARED_SECRET, SYNTHETIC_CONV_ID, true);
    await bob.initFromChatSecret(SYNTHETIC_SHARED_SECRET, SYNTHETIC_CONV_ID, false);

    const sampleVideo = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const encryptedVideo = await alice.encryptFrame(sampleVideo, "video");

    const decryptedVideo = await bob.decryptFrame(encryptedVideo, "video");
    expect(Array.from(decryptedVideo)).toEqual(Array.from(sampleVideo));

    const crossDecrypt = await bob.decryptFrame(encryptedVideo, "audio");
    expect(crossDecrypt).toBeNull();
  });

  test("plain frames pass through unchanged", async () => {
    const plainSession = new CallEncryptionSession();
    await plainSession.initPlain();

    const sampleData = new Uint8Array([99, 88, 77]);
    const result = await plainSession.encryptFrame(sampleData, "audio");
    expect(Array.from(result)).toEqual(Array.from(sampleData));

    const unencryptedIncoming = new Uint8Array([11, 22, 33]);
    const decryptedIncoming = await plainSession.decryptFrame(unencryptedIncoming, "audio");
    expect(Array.from(decryptedIncoming)).toEqual(Array.from(unencryptedIncoming));
  });

  test("ephemeral ECDH key agreement works end-to-end", async () => {
    const aliceKeypair = await generateCallKeyPair();
    const bobKeypair = await generateCallKeyPair();

    const alicePubBytes = await exportPublicKeyBytes(aliceKeypair);
    const bobPubBytes = await exportPublicKeyBytes(bobKeypair);

    const aliceShared = await deriveSharedSecret(aliceKeypair.privateKey, bobPubBytes);
    const bobShared = await deriveSharedSecret(bobKeypair.privateKey, alicePubBytes);

    expect(Array.from(aliceShared)).toEqual(Array.from(bobShared));

    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();

    await alice.initSecure(aliceShared, true);
    await bob.initSecure(bobShared, false);

    expect(alice.fingerprint).toBe(bob.fingerprint);

    const testPayload = new Uint8Array([5, 4, 3, 2, 1]);
    const encrypted = await alice.encryptFrame(testPayload, "audio");
    const decrypted = await bob.decryptFrame(encrypted, "audio");
    expect(Array.from(decrypted)).toEqual(Array.from(testPayload));
  });
});
