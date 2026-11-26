import { describe, it, expect } from 'bun:test';

describe('SFrame Encoded Transform Logic', () => {
  it('correctly encrypts and decrypts frames following the worker specification', async () => {
    const keyRaw = new Uint8Array(32);
    crypto.getRandomValues(keyRaw);
    const salt = new Uint8Array(12);
    crypto.getRandomValues(salt);

    const encKey = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['encrypt']);
    const decKey = await crypto.subtle.importKey('raw', keyRaw, { name: 'AES-GCM' }, false, ['decrypt']);

    let counter = 0n;
    const unencryptedBytes = 1;

    const originalOpus = new Uint8Array(200);
    originalOpus[0] = 0x78;
    for (let i = 1; i < originalOpus.length; i++) {
      originalOpus[i] = (i * 29) & 0xff;
    }

    const headerBytes = originalOpus.subarray(0, unencryptedBytes);
    const payload = originalOpus.subarray(unencryptedBytes);
    const iv = new Uint8Array(12);
    iv.set(salt.subarray(0, 12), 0);
    const c = counter++;
    for (let i = 0; i < 8; i++) {
      iv[11 - i] ^= Number((c >> BigInt(i * 8)) & 0xffn);
    }
    const aad = new Uint8Array(headerBytes.length + 2);
    aad.set(headerBytes, 0);
    aad[headerBytes.length] = 0x0c;
    aad[headerBytes.length + 1] = 0x00;

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      encKey,
      payload
    );
    const encBytes = new Uint8Array(encrypted);

    const out = new Uint8Array(unencryptedBytes + encBytes.length + 14);
    out.set(headerBytes, 0);
    out.set(encBytes, unencryptedBytes);
    out.set(iv, unencryptedBytes + encBytes.length);
    out[out.length - 2] = 0x0c;
    out[out.length - 1] = 0x00;

    expect(out.length).toBe(originalOpus.length + 30);
    expect(out[0]).toBe(0x78);
    expect(out[out.length - 2]).toBe(0x0c);
    expect(out[out.length - 1]).toBe(0x00);

    const recvHeader = out.subarray(0, unencryptedBytes);
    const recvIv = out.subarray(out.length - 14, out.length - 2);
    const cipherWithTag = out.subarray(unencryptedBytes, out.length - 14);
    const recvAad = new Uint8Array(recvHeader.length + 2);
    recvAad.set(recvHeader, 0);
    recvAad[recvHeader.length] = 0x0c;
    recvAad[recvHeader.length + 1] = out[out.length - 1];

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: recvIv, additionalData: recvAad, tagLength: 128 },
      decKey,
      cipherWithTag
    );
    const decBytes = new Uint8Array(decrypted);

    const recovered = new Uint8Array(unencryptedBytes + decBytes.length);
    recovered.set(recvHeader, 0);
    recovered.set(decBytes, unencryptedBytes);

    expect(Array.from(recovered)).toEqual(Array.from(originalOpus));
  });
});
