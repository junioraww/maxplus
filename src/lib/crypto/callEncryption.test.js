import { describe, it, expect } from 'bun:test';
import { CallEncryptionSession } from './callEncryption.js';

describe('Header-Preserving SFrame CallEncryptionSession', () => {
  const syntheticSecret = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const syntheticConversationId = 'synthetic_conv_99999';

  it('initializes session and derives fingerprint from synthetic secret', async () => {
    const session = new CallEncryptionSession();
    await session.initFromChatSecret(syntheticSecret, syntheticConversationId, true);
    expect(session.mode).toBe('secure');
    expect(session.fingerprint).toBeDefined();
    expect(typeof session.fingerprint).toBe('string');
    expect(session.fingerprint.length).toBeGreaterThan(0);
  });

  it('preserves Opus TOC byte 0 and appends SFrame trailer on audio encryption', async () => {
    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();
    await alice.initFromChatSecret(syntheticSecret, syntheticConversationId, true);
    await bob.initFromChatSecret(syntheticSecret, syntheticConversationId, false);

    const syntheticOpusFrame = new Uint8Array(160);
    syntheticOpusFrame[0] = 0x78;
    for (let i = 1; i < syntheticOpusFrame.length; i++) {
      syntheticOpusFrame[i] = (i * 37) & 0xff;
    }

    const encrypted = await alice.encryptFrame(syntheticOpusFrame, 'audio');
    expect(encrypted.length).toBe(syntheticOpusFrame.length + 30);
    expect(encrypted[0]).toBe(0x78);
    expect(encrypted[encrypted.length - 2]).toBe(0x0c);
    expect(encrypted[encrypted.length - 1]).toBe(0x00);

    const decrypted = await bob.decryptFrame(encrypted, 'audio');
    expect(decrypted).not.toBeNull();
    expect(decrypted.length).toBe(syntheticOpusFrame.length);
    expect(decrypted[0]).toBe(0x78);
    expect(Array.from(decrypted)).toEqual(Array.from(syntheticOpusFrame));
  });

  it('supports bidirectional audio encryption between originator and responder', async () => {
    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();
    await alice.initFromChatSecret(syntheticSecret, syntheticConversationId, true);
    await bob.initFromChatSecret(syntheticSecret, syntheticConversationId, false);

    const bobOpusFrame = new Uint8Array(120);
    bobOpusFrame[0] = 0xfc;
    for (let i = 1; i < bobOpusFrame.length; i++) {
      bobOpusFrame[i] = (i * 13) & 0xff;
    }

    const encryptedFromBob = await bob.encryptFrame(bobOpusFrame, 'audio');
    expect(encryptedFromBob[0]).toBe(0xfc);
    expect(encryptedFromBob[encryptedFromBob.length - 2]).toBe(0x0c);

    const decryptedByAlice = await alice.decryptFrame(encryptedFromBob, 'audio');
    expect(decryptedByAlice).not.toBeNull();
    expect(Array.from(decryptedByAlice)).toEqual(Array.from(bobOpusFrame));
  });

  it('preserves VP8 uncompressed headers and round-trips video frames', async () => {
    const alice = new CallEncryptionSession();
    const bob = new CallEncryptionSession();
    await alice.initFromChatSecret(syntheticSecret, syntheticConversationId, true);
    await bob.initFromChatSecret(syntheticSecret, syntheticConversationId, false);

    const syntheticKeyFrame = new Uint8Array(500);
    syntheticKeyFrame[0] = 0x00;
    syntheticKeyFrame[1] = 0x9d;
    syntheticKeyFrame[2] = 0x01;
    syntheticKeyFrame[3] = 0x2a;
    for (let i = 4; i < syntheticKeyFrame.length; i++) {
      syntheticKeyFrame[i] = (i * 7) & 0xff;
    }

    const encKeyFrame = await alice.encryptFrame(syntheticKeyFrame, 'video');
    expect(encKeyFrame.length).toBe(syntheticKeyFrame.length + 30);
    expect(encKeyFrame[0]).toBe(0x00);
    expect(encKeyFrame[1]).toBe(0x9d);
    expect(encKeyFrame[2]).toBe(0x01);
    expect(encKeyFrame[3]).toBe(0x2a);
    expect(encKeyFrame[encKeyFrame.length - 2]).toBe(0x0c);

    const decKeyFrame = await bob.decryptFrame(encKeyFrame, 'video');
    expect(decKeyFrame).not.toBeNull();
    expect(Array.from(decKeyFrame)).toEqual(Array.from(syntheticKeyFrame));

    const syntheticDeltaFrame = new Uint8Array(300);
    syntheticDeltaFrame[0] = 0x01;
    syntheticDeltaFrame[1] = 0x10;
    syntheticDeltaFrame[2] = 0x20;
    for (let i = 3; i < syntheticDeltaFrame.length; i++) {
      syntheticDeltaFrame[i] = (i * 11) & 0xff;
    }

    const encDelta = await alice.encryptFrame(syntheticDeltaFrame, 'video');
    expect(encDelta.length).toBe(syntheticDeltaFrame.length + 30);
    expect(encDelta[0]).toBe(0x01);
    expect(encDelta[encDelta.length - 2]).toBe(0x0c);

    const decDelta = await bob.decryptFrame(encDelta, 'video');
    expect(decDelta).not.toBeNull();
    expect(Array.from(decDelta)).toEqual(Array.from(syntheticDeltaFrame));
  });

  it('handles corrupted frames gracefully without throwing errors', async () => {
    const bob = new CallEncryptionSession();
    await bob.initFromChatSecret(syntheticSecret, syntheticConversationId, false);

    const corrupted = new Uint8Array(35);
    corrupted[0] = 0x78;
    corrupted[corrupted.length - 2] = 0x0c;
    corrupted[corrupted.length - 1] = 0x00;
    const result = await bob.decryptFrame(corrupted, 'audio');
    expect(result).toBeNull();

    const shortPlain = new Uint8Array([0x78, 0x12, 0x34]);
    const plainResult = await bob.decryptFrame(shortPlain, 'audio');
    expect(plainResult).toBe(shortPlain);
  });

  it('exports keys and salts suitable for Linux NativeWebRtcSession', async () => {
    const session = new CallEncryptionSession();
    await session.initFromChatSecret(syntheticSecret, syntheticConversationId, true);
    const exported = session.getExportedKeys();

    expect(exported.audioSendKey).toBeDefined();
    expect(exported.audioSendKey.length).toBe(16);
    expect(exported.audioRecvKey).toBeDefined();
    expect(exported.audioRecvKey.length).toBe(16);
    expect(exported.audioSendSalt).toBeDefined();
    expect(exported.audioSendSalt.length).toBe(8);
    expect(exported.videoSendKey).toBeDefined();
    expect(exported.videoSendKey.length).toBe(16);
  });
});
